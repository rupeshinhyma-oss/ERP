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

from datetime import datetime, timezone
import hashlib
import hmac
import io
import mimetypes
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, Tuple
from urllib.parse import unquote, urlparse

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
    "png", "jpg", "jpeg", "webp", "gif", "heic",
    # Documents
    "pdf", "csv", "xlsx", "xls", "doc", "docx", "txt",
    # Media
    "mp4", "webm", "mov", "avi", "mkv", "m4v",
}

# Maximum allowed file size: 50MB (10MB strict cap for confidential expense receipts)
MAX_FILE_SIZE: int = 50 * 1024 * 1024
MAX_RECEIPT_SIZE: int = 10 * 1024 * 1024

RECEIPT_ALLOWED_EXTENSIONS: set[str] = {"pdf", "jpg", "jpeg", "png", "webp"}

RECEIPT_EXTENSION_TO_MIMES: dict[str, set[str]] = {
    "pdf": {"application/pdf"},
    "jpg": {"image/jpeg", "image/jpg"},
    "jpeg": {"image/jpeg", "image/jpg"},
    "png": {"image/png"},
    "webp": {"image/webp"},
}

RECEIPT_CANONICAL_MIME: dict[str, str] = {
    "pdf": "application/pdf",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}

_DANGEROUS_BINARY_PREFIXES: tuple[bytes, ...] = (
    b"MZ",                  # Windows PE / EXE / DLL
    b"\x7fELF",             # Linux ELF binary
    b"\xfe\xed\xfa\xce",    # Mach-O 32-bit
    b"\xce\xfa\xed\xfe",    # Mach-O 32-bit LE
    b"\xfe\xed\xfa\xcf",    # Mach-O 64-bit
    b"\xcf\xfa\xed\xfe",    # Mach-O 64-bit LE
    b"\xca\xfe\xba\xbe",    # Java class / Universal Mach-O
    b"#!",                  # Shell / script shebang
    b"PK\x03\x04",          # ZIP / JAR / APK / Office macro container
)

_DANGEROUS_TEXT_MARKERS: tuple[bytes, ...] = (
    b"<!doctype",
    b"<html",
    b"<script",
    b"<svg",
    b"<?php",
    b"<iframe",
    b"<object",
    b"<embed",
    b"javascript:",
    b"onerror=",
    b"onload=",
)

# Buckets intended for public access; all other buckets (including expense-receipts) are private/confidential
PUBLIC_BUCKETS: set[str] = {"product-images", "supplier-media", "public-assets"}


def is_bucket_public(bucket: str) -> bool:
    """Return True if the bucket is configured as public, False if confidential."""
    return bucket.lower() in PUBLIC_BUCKETS


def validate_receipt_upload(
    filename: str,
    content: bytes,
    declared_content_type: str | None = None,
    max_size: int = MAX_RECEIPT_SIZE,
) -> str:
    """
    Strictly validate an expense receipt independently of browser-supplied MIME/filename.
    Verifies non-empty payload, size cap, allowed extension, executable/HTML/script rejection,
    MIME/extension consistency, and actual file magic bytes + structural integrity.

    Returns the verified canonical MIME type.
    Raises BadRequestException (HTTP 400) on any validation failure.
    """
    if not content:
        raise BadRequestException("Receipt file cannot be empty.")
    if len(content) > max_size:
        raise BadRequestException(
            f"Receipt file exceeds maximum allowed size ({max_size // (1024 * 1024)} MB)."
        )

    ext = filename.rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    if not ext or ext not in RECEIPT_ALLOWED_EXTENSIONS:
        raise BadRequestException(
            f"Unsupported receipt format '.{ext}'. Allowed formats: {', '.join(sorted(RECEIPT_ALLOWED_EXTENSIONS))}."
        )

    # Reject MIME/extension mismatches when client supplies a Content-Type header
    if declared_content_type:
        norm_mime = declared_content_type.split(";", 1)[0].strip().lower()
        if norm_mime and norm_mime not in RECEIPT_EXTENSION_TO_MIMES[ext]:
            raise BadRequestException(
                f"Receipt MIME type '{norm_mime}' does not match file extension '.{ext}'."
            )

    # Unconditionally block executables, scripts, archives, and HTML/SVG/XSS payloads
    head = content[:4096]
    head_stripped = head.lstrip()
    for prefix in _DANGEROUS_BINARY_PREFIXES:
        if content.startswith(prefix) or head_stripped.startswith(prefix):
            raise BadRequestException("Executable or unsafe binary content is not permitted for receipts.")

    head_lower = head_stripped.lower()
    for marker in _DANGEROUS_TEXT_MARKERS:
        if marker in head_lower:
            raise BadRequestException("HTML, SVG, or script content is not permitted for receipts.")

    # Verify authentic file format independently via magic bytes + parser
    if ext == "pdf":
        if not content.startswith(b"%PDF-") or b"%%EOF" not in content[-2048:] or len(content) < 20:
            raise BadRequestException("Invalid or corrupted PDF receipt file.")
        return "application/pdf"

    if ext in ("jpg", "jpeg"):
        if not content.startswith(b"\xff\xd8\xff"):
            raise BadRequestException("Invalid or corrupted JPEG receipt file.")
        expected_pil_fmt = "JPEG"
    elif ext == "png":
        if not content.startswith(b"\x89PNG\r\n\x1a\n") or b"IHDR" not in content[:64] or b"IEND" not in content[-64:]:
            raise BadRequestException("Invalid or corrupted PNG receipt file.")
        expected_pil_fmt = "PNG"
    elif ext == "webp":
        if len(content) < 12 or content[:4] != b"RIFF" or content[8:12] != b"WEBP":
            raise BadRequestException("Invalid or corrupted WebP receipt file.")
        expected_pil_fmt = "WEBP"
    else:
        raise BadRequestException(f"Unsupported receipt format '.{ext}'.")

    # Structural image integrity verification via Pillow when available
    try:
        from PIL import Image

        with Image.open(io.BytesIO(content)) as img:
            if (img.format or "").upper() != expected_pil_fmt:
                raise BadRequestException("Image file content does not match its declared extension.")
            img.verify()
    except BadRequestException:
        raise
    except Exception:
        raise BadRequestException(f"Corrupted or unreadable {ext.upper()} receipt image.")

    return RECEIPT_CANONICAL_MIME[ext]


def _receipt_signing_key() -> bytes:
    secret = (
        getattr(settings, "JWT_SECRET_KEY", None)
        or getattr(settings, "SECRET_KEY", None)
        or "inhyma-receipt-signing-fallback"
    )
    return str(secret).encode("utf-8")


def create_receipt_signature(expense_id: str, expires_at: int) -> str:
    """Create an HMAC-SHA256 signature binding an expense_id and expiration Unix timestamp."""
    msg = f"expense-receipt:{expense_id}:{expires_at}".encode("utf-8")
    return hmac.new(_receipt_signing_key(), msg, hashlib.sha256).hexdigest()


def verify_receipt_signature(expense_id: str, expires_at: int, signature: str) -> bool:
    """Verify an HMAC-SHA256 receipt signature and ensure it has not expired."""
    if not signature or expires_at < int(time.time()):
        return False
    expected = create_receipt_signature(expense_id, expires_at)
    return hmac.compare_digest(expected, signature)


async def read_private_file_bytes(bucket: str, local_subfolder: str, stored_name: str) -> bytes | None:
    """Read a confidential file from local private storage (or private Supabase bucket if configured)."""
    clean_file = sanitize_filename(stored_name)
    base_dir = (Path("uploads") / "private" / sanitize_filename(local_subfolder)).resolve()
    target = (base_dir / clean_file).resolve()
    if str(target).startswith(str(base_dir)) and target.is_file():
        return target.read_bytes()

    # Fallback to authenticated Supabase Storage object fetch (never logs credentials or signed URLs)
    auth_key = settings.supabase_auth_key
    base_url = settings.supabase_base_url
    if auth_key and base_url:
        obj_url = f"{base_url}/storage/v1/object/authenticated/{bucket}/{clean_file}"
        headers = {
            "apikey": auth_key,
            "Authorization": f"Bearer {auth_key}",
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(obj_url, headers=headers)
                if resp.status_code == 200:
                    return resp.content
        except Exception:
            logger.warning("Private Supabase storage fetch failed for bucket '%s'.", bucket)

    return None


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
                if bucket.lower() == "expense-receipts":
                    return f"private://{bucket}/{filename}"
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


# In-memory retryable storage cleanup queue for transient failures
_PENDING_CLEANUP_QUEUE: list[dict[str, Any]] = []


def enqueue_storage_cleanup(file_url: str, bucket: str = "task-attachments", reason: str = "") -> None:
    """Enqueue a failed physical storage cleanup for subsequent retry."""
    _PENDING_CLEANUP_QUEUE.append({
        "file_url": file_url,
        "bucket": bucket,
        "reason": reason,
        "enqueued_at": datetime.now(timezone.utc).isoformat(),
        "attempts": 0,
    })


def get_pending_cleanups() -> list[dict[str, Any]]:
    """Return a copy of currently pending storage cleanups."""
    return list(_PENDING_CLEANUP_QUEUE)


def clear_pending_cleanups() -> None:
    """Clear pending storage cleanups (primarily for test teardown)."""
    global _PENDING_CLEANUP_QUEUE
    _PENDING_CLEANUP_QUEUE.clear()


async def retry_pending_storage_cleanups() -> dict[str, int]:
    """
    Process pending physical storage deletions in the retry queue.
    Retries each item up to 5 times before logging a critical error.
    """
    global _PENDING_CLEANUP_QUEUE
    if not _PENDING_CLEANUP_QUEUE:
        return {"processed": 0, "succeeded": 0, "failed": 0}

    remaining: list[dict[str, Any]] = []
    succeeded = 0
    failed = 0

    for item in _PENDING_CLEANUP_QUEUE:
        item["attempts"] += 1
        ok = await delete_stored_file(
            file_url=item["file_url"],
            allowed_buckets={item["bucket"]},
        )
        if ok:
            succeeded += 1
        else:
            failed += 1
            if item["attempts"] < 5:
                remaining.append(item)
            else:
                logger.error(
                    "Permanent storage cleanup failure for %s after %d attempts: %s",
                    item["file_url"],
                    item["attempts"],
                    item["reason"],
                )

    _PENDING_CLEANUP_QUEUE = remaining
    return {"processed": succeeded + failed, "succeeded": succeeded, "failed": failed}


async def delete_from_supabase(bucket: str, filename: str) -> bool:
    """
    Delete an object from Supabase Storage.

    Returns True on success or if the object was already absent (HTTP 404 - idempotent).
    Returns False on unexpected failure or network issues.
    """
    auth_key = settings.supabase_auth_key
    base_url = settings.supabase_base_url
    if not auth_key or not base_url:
        return False

    headers = {
        "apikey": auth_key,
        "Authorization": f"Bearer {auth_key}",
    }
    delete_url = f"{base_url}/storage/v1/object/{bucket}/{filename}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.delete(delete_url, headers=headers)
            if resp.status_code in (200, 204, 404):
                logger.info("Deleted Supabase object %s/%s (HTTP %d)", bucket, filename, resp.status_code)
                return True

            # Also attempt prefixes deletion endpoint supported by Supabase Storage
            batch_url = f"{base_url}/storage/v1/object/{bucket}"
            resp_batch = await client.request(
                "DELETE",
                batch_url,
                headers={**headers, "Content-Type": "application/json"},
                json={"prefixes": [filename]},
            )
            if resp_batch.status_code in (200, 204, 404):
                logger.info("Deleted Supabase object %s/%s via batch API (HTTP %d)", bucket, filename, resp_batch.status_code)
                return True

            logger.warning(
                "Supabase Storage deletion failed for %s/%s: HTTP %d: %s",
                bucket,
                filename,
                resp.status_code,
                resp.text[:200],
            )
            return False
    except Exception as exc:
        logger.warning("Supabase Storage delete exception for %s/%s: %s", bucket, filename, exc)
        return False


async def delete_stored_file(
    file_url: str,
    allowed_buckets: set[str] | None = None,
    allowed_local_subfolders: set[str] | None = None,
) -> bool:
    """
    Safely delete a stored file from local filesystem or Supabase Storage.

    Security & Guardrails:
    - Rejects path traversal characters ('..', absolute escapes, drive letters).
    - Whitelists permissible buckets and local subfolders.
    - Verifies local paths remain strictly confined inside the base 'uploads' directory.
    - Treats missing files idempotently as True.
    - Enqueues to retry queue if physical deletion fails.
    """
    if not file_url or not isinstance(file_url, str):
        return True

    effective_buckets = allowed_buckets or {
        "task-attachments",
        "product-images",
        "supplier-media",
        "public-assets",
        "expense-receipts",
    }
    effective_subfolders = allowed_local_subfolders or {"tasks", "products", "receipts", "media"}

    parsed = urlparse(file_url)
    clean_path = unquote(parsed.path)

    # 1. Local Filesystem path (/uploads/... or uploads/...)
    if clean_path.startswith("/uploads/") or clean_path.startswith("uploads/"):
        rel_str = clean_path.lstrip("/")
        if rel_str.startswith("uploads/"):
            rel_str = rel_str[len("uploads/"):]

        # Path traversal & injection guard
        if ".." in rel_str or rel_str.startswith("/") or rel_str.startswith("\\") or ":" in rel_str:
            logger.warning("Security violation: path traversal attempt in storage deletion: %s", file_url)
            return False

        parts = Path(rel_str).parts
        if not parts:
            return False

        # Validate subfolder whitelist
        subfolder = parts[1] if parts[0] == "private" and len(parts) > 1 else parts[0]
        if subfolder not in effective_subfolders:
            logger.warning("Disallowed subfolder '%s' in file_url: %s", subfolder, file_url)
            return False

        base_uploads = Path("uploads").resolve()
        target_path = (base_uploads / rel_str).resolve()

        if not target_path.is_relative_to(base_uploads):
            logger.warning("Security violation: resolved path %s escapes base uploads directory", target_path)
            return False

        try:
            if target_path.is_file():
                target_path.unlink()
                logger.info("Deleted local stored file: %s", str(target_path))
            return True
        except Exception as exc:
            logger.error("Failed to delete local file %s: %s", str(target_path), exc)
            enqueue_storage_cleanup(file_url, bucket="local", reason=str(exc))
            return False

    # 2. Supabase Storage URL
    # Matches /storage/v1/object/(public|authenticated|sign)/<bucket>/<filename>
    m = re.search(r"/storage/v1/object/(?:public|authenticated|sign)/([^/]+)/(.+)$", clean_path)
    if m:
        bucket = m.group(1)
        filename = m.group(2)

        if bucket not in effective_buckets:
            logger.warning("Disallowed Supabase bucket '%s' for deletion: %s", bucket, file_url)
            return False
        if ".." in filename:
            logger.warning("Security violation: path traversal in Supabase object name: %s", filename)
            return False

        ok = await delete_from_supabase(bucket, filename)
        if not ok:
            enqueue_storage_cleanup(file_url, bucket=bucket, reason="supabase_api_failure")
        return ok

    logger.warning("Unrecognized storage URL pattern for deletion: %s", file_url)
    return False


