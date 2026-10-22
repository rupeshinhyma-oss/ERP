import uuid
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_import_bill_file_endpoint_unauthorized(client: AsyncClient):
    fake_id = uuid.uuid4()
    res = await client.get(f"/api/v1/purchase/import-orders/{fake_id}/bill-file")
    assert res.status_code == 401
