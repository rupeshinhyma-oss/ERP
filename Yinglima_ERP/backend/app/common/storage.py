"""
Storage utility module for Supabase Storage with graceful local disk fallback.

Handles:
1. Direct file upload to Supabase Storage buckets (e.g. product-images, supplier-media, quotations, purchase-bills).
2. Auto-creation of public buckets when using SUPABASE_SERVICE_KEY.
3. Automatic MIME-type inference and filename sanitization.
4. Transparent fallback to local filesystem (uploads/<subfolder>/) when Supabase credentials
   are absent or unreachable.
"""

from __future__ import annotations

import mimetypes
import os
import re
import uuid
from pathlib import Path
from typing import Tuple

import httpx

from app.core.config import settings
from app.core.exceptions import BadRequestException
from app.core.logging import get_logger

logger = get_logger(__name__)

# Cache to avoid repeatedly hitting bucket check API
_VERIFIED_BUCKETS: set[str] = set()

# Whitelist of allowed file extensions
ALLOWED_EXTENSIONS: set[str] = {
    # Images
    "png", "jpg", "jpeg", "webp", "gif", "svg",
    # Documents
    "pdf", "csv", "xlsx", "xls", "doc", "docx", "txt", "xml", "json",
    # Archives (quotation packages, CAD files, supplier drawing bundles)
    "zip", "rar", "7z", "tar", "gz",
    # Media
    "mp4", "webm", "mov",
}

# Maximum allowed file size: 50MB
MAX_FILE_SIZE: int = 50 * 1024 * 1024

# Buckets intended for public access; all other buckets default to private/confidential
PUBLIC_BUCKETS: set[str] = {
    "product-images",
    "supplier-media",
    "public-assets",
    "quotations",
    "purchase-bills",
    "yinglima-purchase-bills",
    "yinglima-product-images",
    "yinglima-supplier-media",
    "yinglima-quotations",
}


def is_bucket_public(bucket: str) -> bool:
    """Return True if the bucket is configured as public, False if confidential."""
    b = bucket.lower()
    if b in PUBLIC_BUCKETS:
        return True
    return any(keyword in b for keyword in ("product", "supplier", "media", "asset", "public", "bill", "purchase"))


def validate_file_upload(
    filename: str,
    content: bytes,
    allowed_extensions: set[str] | None = None,
    max_size: int = MAX_FILE_SIZE,
) -> None:
    """
    Validate uploaded file content and extension against whitelisted formats.

    Raises BadRequestException on validation failure.
    """
    if not content:
        raise BadRequestException("File content cannot be empty.")
    if len(content) > max_size:
        raise BadRequestException(f"File size exceeds maximum allowed limit ({max_size // (1024 * 1024)} MB).")

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    valid_exts = allowed_extensions or ALLOWED_EXTENSIONS
    if not ext or ext not in valid_exts:
        raise BadRequestException(
            f"File extension '.{ext}' is not permitted. Allowed extensions: {', '.join(sorted(valid_exts))}."
        )


def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent directory traversal and remove unsupported characters."""
    base_name = os.path.basename(filename).strip()
    if not base_name:
        base_name = "file.bin"
    # Replace non-alphanumeric (except dot, dash, underscore) with underscore
    clean = re.sub(r"[^\w\-.]", "_", base_name)
    # Collapse multiple consecutive underscores
    clean = re.sub(r"_+", "_", clean)
    return clean[:120]


def guess_content_type(filename: str, default: str = "application/octet-stream") -> str:
    """Guess MIME type based on file extension."""
    mime, _ = mimetypes.guess_type(filename)
    if mime:
        return mime
    ext = filename.split(".")[-1].lower() if "." in filename else ""
    extension_map = {
        "pdf": "application/pdf",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "gif": "image/gif",
        "svg": "image/svg+xml",
        "mp4": "video/mp4",
        "webm": "video/webm",
        "mov": "video/quicktime",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls": "application/vnd.ms-excel",
        "csv": "text/csv",
        "doc": "application/msword",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "txt": "text/plain",
        "xml": "application/xml",
        "json": "application/json",
        "zip": "application/zip",
        "rar": "application/x-rar-compressed",
        "7z": "application/x-7z-compressed",
        "tar": "application/x-tar",
        "gz": "application/gzip",
    }
    return extension_map.get(ext, default)


_LAST_SUPABASE_ERROR: str = ""


def get_last_supabase_error() -> str:
    return _LAST_SUPABASE_ERROR


def _get_auth_header_variants(auth_key: str | None) -> list[dict[str, str]]:
    """
    Return header variants to try against Supabase Storage REST API:
    1. If `sb_secret_...` / `sb_publishable_...`: first try `{"apikey": key}` (without
       `Authorization: Bearer sb_...` so Supabase's Kong gateway converts `apikey` into a
       service_role/anon JWT rather than rejecting a 1-part non-JWT), then try with Bearer.
    2. Also try `SUPABASE_ANON_KEY` if distinct from `auth_key`.
    3. If legacy `eyJ...` JWT: try `{"apikey": key, "Authorization": f"Bearer {key}"}`.
    """
    variants: list[dict[str, str]] = []
    keys_to_try: list[str] = []
    for k in (auth_key, settings.SUPABASE_SERVICE_KEY, settings.SUPABASE_ANON_KEY):
        if k and k.strip() and k.strip() not in ("your-supabase-service-key", "your-supabase-anon-key"):
            clean_k = k.strip()
            if clean_k not in keys_to_try:
                keys_to_try.append(clean_k)

    for k in keys_to_try:
        if k.startswith("sb_"):
            variants.append({"apikey": k})
            variants.append({"apikey": k, "Authorization": f"Bearer {k}"})
        else:
            variants.append({"apikey": k, "Authorization": f"Bearer {k}"})
            variants.append({"apikey": k})
    variants.append({})
    return variants


async def ensure_bucket_exists(bucket: str) -> bool:
    """Ensure the specified bucket exists in Supabase Storage with appropriate privacy setting."""
    if bucket in _VERIFIED_BUCKETS:
        return True

    auth_key = settings.supabase_auth_key
    if not auth_key:
        return False

    base_url = settings.supabase_base_url
    bucket_url = f"{base_url}/storage/v1/bucket"
    is_pub = is_bucket_public(bucket)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            for base_headers in _get_auth_header_variants(auth_key):
                if not base_headers:
                    continue
                get_resp = await client.get(f"{bucket_url}/{bucket}", headers=base_headers)
                if get_resp.status_code == 200:
                    _VERIFIED_BUCKETS.add(bucket)
                    return True

                post_resp = await client.post(
                    bucket_url,
                    headers={**base_headers, "Content-Type": "application/json"},
                    json={
                        "id": bucket,
                        "name": bucket,
                        "public": is_pub,
                        "file_size_limit": MAX_FILE_SIZE,
                    },
                )
                if post_resp.status_code in (200, 201, 409):
                    _VERIFIED_BUCKETS.add(bucket)
                    return True
    except Exception as exc:
        logger.debug("Failed to verify/create Supabase bucket '%s': %s", bucket, exc)

    return False


async def create_signed_url(bucket: str, filename: str, expires_in: int = 3600) -> str | None:
    """
    Generate a temporary signed download URL for private Supabase Storage objects.
    """
    auth_key = settings.supabase_auth_key
    if not auth_key:
        return None

    clean_filename = sanitize_filename(filename)
    base_url = settings.supabase_base_url
    sign_url = f"{base_url}/storage/v1/object/sign/{bucket}/{clean_filename}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            for base_headers in _get_auth_header_variants(auth_key):
                if not base_headers:
                    continue
                resp = await client.post(
                    sign_url,
                    headers={**base_headers, "Content-Type": "application/json"},
                    json={"expiresIn": expires_in},
                )
                if resp.status_code in (200, 201):
                    data = resp.json()
                    signed_path = data.get("signedURL")
                    if signed_path:
                        if signed_path.startswith("http://") or signed_path.startswith("https://"):
                            return signed_path
                        return f"{base_url}/storage/v1{signed_path}"
    except Exception as exc:
        logger.debug("Failed to create signed URL for %s/%s: %s", bucket, clean_filename, exc)

    return None


async def upload_to_supabase(
    bucket: str,
    filename: str,
    content: bytes,
    content_type: str | None = None,
) -> str | None:
    """
    Upload a file directly to Supabase Storage.

    Returns the public URL (for public buckets) or a signed URL (for private buckets)
    on success, or None if upload failed or Supabase is not configured.
    """
    auth_key = settings.supabase_auth_key
    clean_filename = sanitize_filename(filename)
    if not content_type:
        content_type = guess_content_type(clean_filename)

    base_url = settings.supabase_base_url
    upload_url = f"{base_url}/storage/v1/object/{bucket}/{clean_filename}"

    await ensure_bucket_exists(bucket)

    last_status = 0
    last_text = ""
    global _LAST_SUPABASE_ERROR
    _LAST_SUPABASE_ERROR = ""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            for base_headers in _get_auth_header_variants(auth_key):
                headers = {
                    **base_headers,
                    "Content-Type": content_type,
                    "x-upsert": "true",
                }
                resp = await client.post(
                    upload_url,
                    content=content,
                    headers=headers,
                )
                if resp.status_code in (200, 201):
                    if is_bucket_public(bucket):
                        return f"{base_url}/storage/v1/object/public/{bucket}/{clean_filename}"
                    signed_url = await create_signed_url(bucket, clean_filename, expires_in=7 * 86400)
                    return signed_url or f"{base_url}/storage/v1/object/authenticated/{bucket}/{clean_filename}"

                last_status = resp.status_code
                last_text = resp.text[:300]

            _LAST_SUPABASE_ERROR = f"HTTP {last_status}: {last_text}"
            logger.warning(
                "Supabase storage rejected upload to %s/%s: HTTP %d: %s",
                bucket,
                clean_filename,
                last_status,
                last_text,
            )
    except Exception as exc:
        _LAST_SUPABASE_ERROR = str(exc)
        logger.warning(
            "Supabase Storage upload error for %s/%s: %s",
            bucket,
            clean_filename,
            exc,
        )

    return None


async def save_uploaded_file(
    content: bytes,
    original_filename: str,
    bucket: str = "yinglima-product-images",
    local_subfolder: str = "products",
    content_type: str | None = None,
) -> Tuple[str, str]:
    """
    Save an uploaded file, attempting Supabase Storage first, falling back to local disk.
    Enforces file extension whitelisting and size boundaries.

    Returns:
        tuple[accessible_url, stored_filename]
    """
    validate_file_upload(original_filename, content)
    clean_name = sanitize_filename(original_filename)
    unique_filename = f"{uuid.uuid4().hex}_{clean_name}"
    mime = content_type or guess_content_type(clean_name)

    # 1. Try Supabase Storage
    supabase_url = await upload_to_supabase(
        bucket=bucket,
        filename=unique_filename,
        content=content,
        content_type=mime,
    )
    if supabase_url:
        return supabase_url, unique_filename

    # 2. Fallback to local disk with public/private boundary
    is_pub = is_bucket_public(bucket)
    if is_pub:
        local_dir = Path("uploads") / local_subfolder
        url_prefix = f"/uploads/{local_subfolder}"
    else:
        local_dir = Path("uploads") / "private" / local_subfolder
        url_prefix = f"/uploads/private/{local_subfolder}"

    local_dir.mkdir(parents=True, exist_ok=True)
    file_path = local_dir / unique_filename

    try:
        with open(file_path, "wb") as f:
            f.write(content)
        logger.info("Saved file locally to %s", str(file_path))
    except Exception as exc:
        logger.error("Failed to write file to local disk %s: %s", str(file_path), exc)
        raise

    return f"{url_prefix}/{unique_filename}", unique_filename
