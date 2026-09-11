import pytest
from httpx import ASGITransport, AsyncClient
import uuid
from app.main import create_application
from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_quotation_documents_allows_product_view():
    """Users with product.view should be authorized to fetch quotation documents for gallery."""
    app = create_application()
    user = CurrentUser(
        id=uuid.uuid4(),
        username="product_viewer",
        permissions={"product.view"},
    )
    app.dependency_overrides[get_current_user] = lambda: user

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        with patch("app.inquiries.repository.QuotationRepository.get_all_quotation_documents", new_callable=AsyncMock) as mock_docs:
            mock_docs.return_value = []
            res = await ac.get("/api/v1/inquiries/quotation-documents")
            assert res.status_code == 200
            assert res.json()["success"] is True
            assert res.json()["data"] == []


@pytest.mark.asyncio
async def test_quotation_documents_allows_productgallery_view():
    """Users with productgallery.view should be authorized to fetch quotation documents for gallery."""
    app = create_application()
    user = CurrentUser(
        id=uuid.uuid4(),
        username="gallery_viewer",
        permissions={"productgallery.view"},
    )
    app.dependency_overrides[get_current_user] = lambda: user

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        with patch("app.inquiries.repository.QuotationRepository.get_all_quotation_documents", new_callable=AsyncMock) as mock_docs:
            mock_docs.return_value = []
            res = await ac.get("/api/v1/inquiries/quotation-documents")
            assert res.status_code == 200
            assert res.json()["success"] is True


@pytest.mark.asyncio
async def test_quotation_documents_allows_inquiry_view():
    """Users with inquiry.view should be authorized to fetch quotation documents for gallery."""
    app = create_application()
    user = CurrentUser(
        id=uuid.uuid4(),
        username="inquiry_viewer",
        permissions={"inquiry.view"},
    )
    app.dependency_overrides[get_current_user] = lambda: user

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        with patch("app.inquiries.repository.QuotationRepository.get_all_quotation_documents", new_callable=AsyncMock) as mock_docs:
            mock_docs.return_value = []
            res = await ac.get("/api/v1/inquiries/quotation-documents")
            assert res.status_code == 200
            assert res.json()["success"] is True


@pytest.mark.asyncio
async def test_quotation_documents_rejects_unauthorized():
    """Users without any of the required permissions should be rejected with 403."""
    app = create_application()
    user = CurrentUser(
        id=uuid.uuid4(),
        username="restricted_user",
        permissions={"user.view"},
    )
    app.dependency_overrides[get_current_user] = lambda: user

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        res = await ac.get("/api/v1/inquiries/quotation-documents")
        assert res.status_code == 403
        body = res.json()
        assert body["success"] is False
        assert "requires one of the following permissions" in body["message"]
