import os
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch
import pytest
import pytest_asyncio
import httpx

from app.common.storage import (
    delete_stored_file,
    delete_from_supabase,
    enqueue_storage_cleanup,
    get_pending_cleanups,
    clear_pending_cleanups,
    retry_pending_storage_cleanups,
)
from app.tasks.models import Task, TaskAttachment, TaskVoiceNote, TaskStatus, TaskPriority
from app.tasks.service import TaskService
from app.core.exceptions import ForbiddenException
from app.auth.service import CurrentUser


@pytest.fixture(autouse=True)
def cleanup_storage_test_state():
    clear_pending_cleanups()
    yield
    clear_pending_cleanups()


@pytest.mark.asyncio
async def test_local_file_deletion_and_idempotency(tmp_path: Path):
    """Verify local file deletion cleans up existing file and handles missing file idempotently."""
    base_uploads = Path("uploads") / "private" / "tasks"
    base_uploads.mkdir(parents=True, exist_ok=True)
    
    unique_name = f"test_delete_{uuid.uuid4().hex}.txt"
    test_file = base_uploads / unique_name
    test_file.write_text("sample attachment content")
    assert test_file.exists()

    rel_url = f"/uploads/private/tasks/{unique_name}"

    # 1. Existing file deletion
    res = await delete_stored_file(
        rel_url,
        allowed_buckets={"task-attachments"},
        allowed_local_subfolders={"tasks"},
    )
    assert res is True
    assert not test_file.exists()

    # 2. Idempotent deletion on already-missing file
    res_repeat = await delete_stored_file(
        rel_url,
        allowed_buckets={"task-attachments"},
        allowed_local_subfolders={"tasks"},
    )
    assert res_repeat is True


@pytest.mark.asyncio
async def test_supabase_object_mapping_and_signed_url():
    """Verify Supabase URL parsing handles public and signed URLs with query tokens."""
    with patch("app.common.storage.settings") as mock_settings:
        mock_settings.supabase_auth_key = "test-key"
        mock_settings.supabase_base_url = "https://test.supabase.co"

        with patch("httpx.AsyncClient.delete") as mock_delete:
            mock_delete.return_value = httpx.Response(200, request=httpx.Request("DELETE", "http://test"))

            # Public URL
            public_url = "https://test.supabase.co/storage/v1/object/public/task-attachments/doc1.pdf"
            ok = await delete_stored_file(public_url, allowed_buckets={"task-attachments"})
            assert ok is True
            assert mock_delete.call_args[0][0] == "https://test.supabase.co/storage/v1/object/task-attachments/doc1.pdf"

            # Signed URL with token query params
            signed_url = "https://test.supabase.co/storage/v1/object/sign/task-attachments/audio.webm?token=abc123xyz"
            ok_signed = await delete_stored_file(signed_url, allowed_buckets={"task-attachments"})
            assert ok_signed is True
            assert mock_delete.call_args[0][0] == "https://test.supabase.co/storage/v1/object/task-attachments/audio.webm"


@pytest.mark.asyncio
async def test_storage_path_traversal_and_disallowed_subfolder_rejection():
    """Verify path traversal attempts and unapproved subfolders are strictly rejected."""
    # Path traversal with ..
    assert await delete_stored_file("/uploads/../../etc/passwd") is False
    assert await delete_stored_file("/uploads/private/tasks/../../../secrets.txt") is False

    # Disallowed subfolder
    assert await delete_stored_file(
        "/uploads/private/financials/ledger.xlsx",
        allowed_local_subfolders={"tasks"},
    ) is False

    # Disallowed Supabase bucket
    assert await delete_stored_file(
        "https://test.supabase.co/storage/v1/object/public/unapproved-bucket/data.bin",
        allowed_buckets={"task-attachments"},
    ) is False

    # Invalid URL / absolute OS path
    assert await delete_stored_file("C:\\Windows\\System32\\cmd.exe") is False


@pytest.mark.asyncio
async def test_storage_failure_enqueue_and_retry():
    """Verify storage failures enqueue to retry queue and retry helper processes them."""
    with patch("app.common.storage.settings") as mock_settings:
        mock_settings.supabase_auth_key = "test-key"
        mock_settings.supabase_base_url = "https://test.supabase.co"

        with patch("httpx.AsyncClient.delete") as mock_delete:
            mock_delete.return_value = httpx.Response(500, text="Internal Server Error", request=httpx.Request("DELETE", "http://test"))
            with patch("httpx.AsyncClient.request") as mock_batch:
                mock_batch.return_value = httpx.Response(500, text="Internal Server Error", request=httpx.Request("DELETE", "http://test"))

                fail_url = "https://test.supabase.co/storage/v1/object/public/task-attachments/retry_test.png"
                ok = await delete_stored_file(fail_url, allowed_buckets={"task-attachments"})
                assert ok is False

                pending = get_pending_cleanups()
                assert len(pending) == 1
                assert pending[0]["file_url"] == fail_url

            # Now simulate recovery and run retry
            mock_delete.return_value = httpx.Response(204, request=httpx.Request("DELETE", "http://test"))
            retry_stats = await retry_pending_storage_cleanups()
            assert retry_stats["succeeded"] == 1
            assert len(get_pending_cleanups()) == 0


@pytest.mark.asyncio
async def test_shared_file_deletion_protection():
    """Verify that when multiple records reference the same physical file, the file is NOT deleted."""
    mock_repo = AsyncMock()
    mock_audit = AsyncMock()
    mock_notif = AsyncMock()
    service = TaskService(repository=mock_repo, audit_service=mock_audit, notification_service=mock_notif)

    user_id = uuid.uuid4()
    current_user = CurrentUser(id=user_id, username="uploader", permissions={"task.manage"})

    shared_url = "/uploads/private/tasks/shared_doc.pdf"
    target_attach_id = uuid.uuid4()
    other_attach_id = uuid.uuid4()

    attachment = TaskAttachment(
        id=target_attach_id,
        task_id=uuid.uuid4(),
        uploaded_by=user_id,
        file_name="shared_doc.pdf",
        file_url=shared_url,
        file_type="application/pdf",
    )

    mock_repo.get_attachment_by_id = AsyncMock(return_value=attachment)
    task_mock = Task(
        id=attachment.task_id,
        title="Test Task",
        created_by=user_id,
        status=TaskStatus.TODO,
        priority=TaskPriority.MEDIUM,
    )
    service.get_task = AsyncMock(return_value=task_mock)

    from unittest.mock import MagicMock

    # Simulate another attachment referencing the exact same file_url
    mock_res_other = MagicMock()
    mock_res_other.first.return_value = (other_attach_id,)

    mock_res_empty = MagicMock()
    mock_res_empty.first.return_value = None

    # First query finds other attachment sharing the url
    mock_repo.session.execute = AsyncMock(side_effect=[mock_res_other, mock_res_empty, mock_res_empty])

    with patch("app.common.storage.delete_stored_file") as mock_delete_file:
        await service.delete_attachment(target_attach_id, current_user=current_user)
        # DB deletion must be executed
        mock_repo.delete_attachment.assert_called_once_with(attachment)
        mock_repo.session.commit.assert_called_once()
        # Physical file deletion must be SKIPPED because it is shared
        mock_delete_file.assert_not_called()
