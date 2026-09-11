"""
Storage utility module for Supabase Storage with graceful local disk fallback.

Handles:
1. Direct file upload to Supabase Storage buckets (e.g. product-images, supplier-media, quotations).
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
    "png", "jpg", "jpeg", "webp", "gif",
    # Documents
    "pdf", "csv", "xlsx", "xls", "doc", "docx", "txt",
    # Media
    "mp4", "webm", "mov",
}

# Maximum allowed file size: 50MB
MAX_FILE_SIZE: int = 50 * 1024 * 1024

# Buckets intended for public access; all other buckets default to private/confidential
PUBLIC_BUCKETS: set[str] = {"product-images", "supplier-media", "public-assets"}


def is_bucket_public(bucket: str) -> bool:
    """Return True if the bucket is configured as public, False if confidential."""
    return bucket.lower() in PUBLIC_BUCKETS


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
    }
    return extension_map.get(ext, default)


async def ensure_bucket_exists(bucket: str) -> bool:
    """Ensure the specified bucket exists in Supabase Storage with appropriate privacy setting."""
    if bucket in _VERIFIED_BUCKETS:
        return True

    auth_key = settings.supabase_auth_key
    if not auth_key:
        return False

    base_url = settings.supabase_base_url
    bucket_url = f"{base_url}/storage/v1/bucket"

    headers = {
        "apikey": auth_key,
        "Authorization": f"Bearer {auth_key}",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Check if bucket exists
            get_resp = await client.get(
                f"{bucket_url}/{bucket}",
                headers=headers,
            )
            if get_resp.status_code == 200:
                _VERIFIED_BUCKETS.add(bucket)
                return True

            # If not found or service key has permission, create the bucket
            is_pub = is_bucket_public(bucket)
            post_resp = await client.post(
                bucket_url,
                headers={
                    **headers,
                    "Content-Type": "application/json",
                },
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
            logger.warning(
                "Supabase bucket creation failed for %s: %s (HTTP %d)",
                bucket,
                post_resp.text[:300],
                post_resp.status_code,
            )
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

    base_url = settings.supabase_base_url
    sign_url = f"{base_url}/storage/v1/object/sign/{bucket}/{filename}"
    headers = {
        "apikey": auth_key,
        "Authorization": f"Bearer {auth_key}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                sign_url,
                headers=headers,
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
        logger.debug("Failed to create signed URL for %s/%s: %s", bucket, filename, exc)

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
    if not auth_key:
        return None

    if not content_type:
        content_type = guess_content_type(filename)

    base_url = settings.supabase_base_url
    upload_url = f"{base_url}/storage/v1/object/{bucket}/{filename}"

    headers = {
        "apikey": auth_key,
        "Authorization": f"Bearer {auth_key}",
        "Content-Type": content_type,
        "x-upsert": "true",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                upload_url,
                content=content,
                headers=headers,
            )

            # If bucket didn't exist, try creating it and retrying once
            if resp.status_code in (400, 404) and "not found" in resp.text.lower():
                created = await ensure_bucket_exists(bucket)
                if created:
                    resp = await client.post(
                        upload_url,
                        content=content,
                        headers=headers,
                    )

            if resp.status_code in (200, 201):
                if is_bucket_public(bucket):
                    return f"{base_url}/storage/v1/object/public/{bucket}/{filename}"
                signed_url = await create_signed_url(bucket, filename, expires_in=7 * 86400)
                return signed_url or f"{base_url}/storage/v1/object/authenticated/{bucket}/{filename}"

            logger.warning(
                "Supabase storage rejected upload to %s/%s: HTTP %d: %s",
                bucket,
                filename,
                resp.status_code,
                resp.text[:300],
            )
    except Exception as exc:
        logger.warning(
            "Supabase Storage upload error for %s/%s: %s",
            bucket,
            filename,
            exc,
        )

    return None


async def save_uploaded_file(
    content: bytes,
    original_filename: str,
    bucket: str = "product-images",
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
