import uuid
import pytest
from unittest.mock import AsyncMock
from app.planning.models import PlanningSheet
from app.planning.service import PlanningService


@pytest.mark.asyncio
async def test_set_item_column_width_persists_and_clamps():
    sheet_id = uuid.uuid4()
    mock_sheet = PlanningSheet(
        id=sheet_id,
        name="Mumbai Sheet",
        item_width_px=None,
    )

    mock_sheet_repo = AsyncMock()
    mock_sheet_repo.get_by_id.return_value = mock_sheet
    mock_sheet_repo.update = AsyncMock(side_effect=lambda sheet, **kwargs: setattr(sheet, "item_width_px", kwargs.get("item_width_px")) or sheet)

    service = PlanningService(
        sheet_repository=mock_sheet_repo,
        row_repository=AsyncMock(),
        column_repository=AsyncMock(),
        cell_repository=AsyncMock(),
        status_tag_repository=AsyncMock(),
        change_log_repository=AsyncMock(),
        audit_service=AsyncMock(),
        column_role_lock_repository=AsyncMock(),
    )

    # 1. Set valid width
    updated = await service.set_item_column_width(sheet_id, width_px=350)
    assert updated.item_width_px == 350
    mock_sheet_repo.update.assert_called_with(mock_sheet, item_width_px=350)

    # 2. Clamped when too high (>800)
    updated_clamped = await service.set_item_column_width(sheet_id, width_px=1200)
    assert updated_clamped.item_width_px == 800

    # 3. Clamped when too low (<40)
    updated_low = await service.set_item_column_width(sheet_id, width_px=10)
    assert updated_low.item_width_px == 40

    # 4. Clear width (reset to None)
    cleared = await service.set_item_column_width(sheet_id, width_px=None)
    assert cleared.item_width_px is None
