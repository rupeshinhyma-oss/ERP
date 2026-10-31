"""Tests for Product Master Specification Document DB storage & CRM Quotation PDF link embedding."""

from __future__ import annotations

import io
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from pypdf import PdfReader

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.crm.quotation_pdf import generate_crm_quotation_pdf_bytes
from app.crm.quotation_service import _resolve_product_spec_pdf_link
from app.database.session import get_db_session
from app.main import create_application
from app.masters.products.models import Product, ProductSpecificationDocument


@pytest.mark.asyncio
async def test_upload_docx_and_pdf_specification_documents_stored_in_db():
    """Verify both non-PDF (.docx) and PDF (.pdf) documents are stored in DB and served back accurately."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: ProductSpecificationDocument.metadata.create_all(
                sync_conn, tables=[Product.__table__, ProductSpecificationDocument.__table__]
            )
        )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _override_db():
        async with session_factory() as session:
            yield session

    app = create_application()
    fake_user = CurrentUser(
        id=str(uuid.uuid4()),
        username="admin",
        permissions={"product.create", "product.update", "product.read"},
    )
    app.dependency_overrides[get_db_session] = _override_db
    app.dependency_overrides[get_current_user] = lambda: fake_user

    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
            # 1. Upload a non-PDF Word document (.docx) -> stored in DB, pdf_link is None
            docx_bytes = b"PK\x03\x04 sample word specification content"
            res_docx = await ac.post(
                "/api/v1/masters/products/specification-document",
                files={
                    "file": (
                        "AFM500_Manual.docx",
                        docx_bytes,
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    )
                },
            )
            assert res_docx.status_code in (200, 201), res_docx.text
            docx_data = res_docx.json()["data"]
            assert docx_data["filename"] == "AFM500_Manual.docx"
            assert docx_data["is_pdf"] is False
            assert docx_data["pdf_link"] is None
            assert docx_data["file_size"] == len(docx_bytes)

            # Public retrieval without auth headers streams exact bytes back as attachment
            del app.dependency_overrides[get_current_user]
            dl_docx = await ac.get(
                f"/api/v1/masters/products/specification-documents/{docx_data['doc_id']}/{docx_data['clean_filename']}"
            )
            assert dl_docx.status_code == 200
            assert dl_docx.content == docx_bytes
            assert "attachment" in dl_docx.headers.get("content-disposition", "")

            # 2. Upload a PDF document (.pdf) -> stored in DB AND pdf_link auto-created
            app.dependency_overrides[get_current_user] = lambda: fake_user
            pdf_bytes = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF"
            res_pdf = await ac.post(
                "/api/v1/masters/products/specification-document",
                files={"file": ("AFM500_Technical_Spec.pdf", pdf_bytes, "application/pdf")},
            )
            assert res_pdf.status_code in (200, 201), res_pdf.text
            pdf_data = res_pdf.json()["data"]
            assert pdf_data["filename"] == "AFM500_Technical_Spec.pdf"
            assert pdf_data["is_pdf"] is True
            assert pdf_data["pdf_link"] == pdf_data["url"]
            assert pdf_data["url"].endswith("/AFM500_Technical_Spec.pdf")

            # Public retrieval without auth headers streams PDF inline so Quotation PDF readers open it directly
            del app.dependency_overrides[get_current_user]
            dl_pdf = await ac.get(
                f"/api/v1/masters/products/specification-documents/{pdf_data['doc_id']}/{pdf_data['clean_filename']}"
            )
            assert dl_pdf.status_code == 200
            assert dl_pdf.content == pdf_bytes
            assert dl_pdf.headers.get("content-type", "").startswith("application/pdf")
            assert "inline" in dl_pdf.headers.get("content-disposition", "")
    finally:
        await engine.dispose()


def test_resolve_product_spec_link_for_uploaded_documents_and_plain_text():
    """Verify _resolve_product_spec_pdf_link returns saved DB link for any uploaded document and None for plain text."""
    pdf_prod = Product(
        product_name_tally="AFM-500",
        specification_doc_name="AFM500_Spec.pdf",
        specification_doc_mime="application/pdf",
        specification_doc_url="http://localhost:8002/api/v1/masters/products/specification-documents/abc/AFM500_Spec.pdf",
    )
    assert (
        _resolve_product_spec_pdf_link(pdf_prod)
        == "http://localhost:8002/api/v1/masters/products/specification-documents/abc/AFM500_Spec.pdf"
    )

    docx_prod = Product(
        product_name_tally="AFM-500",
        specification_doc_name="AFM500_Spec.docx",
        specification_doc_mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        specification_doc_url="http://localhost:8002/api/v1/masters/products/specification-documents/abc/AFM500_Spec.docx",
    )
    assert (
        _resolve_product_spec_pdf_link(docx_prod)
        == "http://localhost:8002/api/v1/masters/products/specification-documents/abc/AFM500_Spec.docx"
    )

    plain_prod = Product(
        product_name_tally="AFM-500",
        specification="Legacy plain text specification",
    )
    assert _resolve_product_spec_pdf_link(plain_prod) is None


def test_quotation_pdf_embeds_clickable_specification_pdf_hyperlink():
    """Verify Quotation PDF embeds a clickable URI annotation pointing to the DB-stored Specification PDF."""
    spec_pdf_url = (
        "http://localhost:8002/api/v1/masters/products/specification-documents/"
        "11111111-1111-4111-8111-111111111111/AFM500_Spec.pdf"
    )
    snapshot = {
        "quotation_number": "SQ-202610-0001",
        "version": 1,
        "status": "draft",
        "quotation_date": "2026-10-31",
        "currency": "INR",
        "customer_name_snapshot": "Rupesh Malla",
        "subtotal": 75000.0,
        "discount_total": 0.0,
        "tax_total": 13500.0,
        "total_amount": 88500.0,
        "items": [
            {
                "position": 1,
                "product_name": "AFM-500 Auger & Weigher <PLC>",
                "product_code": "AFM-500",
                "description": "High speed servo filler & sealer",
                "specification": spec_pdf_url,
                "include_specifications": True,
                "uom": "NOS-01",
                "quantity": 1,
                "unit_price": 75000.0,
                "unit_discount": 0.0,
                "tax_rate": 18.0,
                "taxable_amount": 75000.0,
                "tax_amount": 13500.0,
                "total_amount": 88500.0,
            }
        ],
    }

    pdf_bytes = generate_crm_quotation_pdf_bytes(snapshot)
    assert pdf_bytes.startswith(b"%PDF")

    reader = PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) >= 1
    extracted_text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "Specification PDF: AFM500_Spec.pdf" in extracted_text

    uris: list[str] = []
    for page in reader.pages:
        annots = page.get("/Annots") or []
        for annot_ref in annots:
            annot = annot_ref.get_object()
            action = annot.get("/A")
            if action and action.get("/URI"):
                uris.append(str(action.get("/URI")))

    assert spec_pdf_url in uris


def test_synthetic_test_image_urls_are_filtered_out():
    """Verify synthetic *.test / *.invalid / *.example image URLs are stripped so browsers never hit ERR_NAME_NOT_RESOLVED."""
    from app.crm.quotation_service import _sanitize_crm_image_url
    from app.masters.products.schemas import _sanitize_product_image_urls

    cleaned = _sanitize_product_image_urls(
        [
            "https://storage.inhyma.test/products/afm500-front.jpg",
            "https://cdn.example/sample.png",
            "/uploads/products/real-photo.jpg",
            "data:image/png;base64,iVBORw0KGgo=",
        ]
    )
    assert cleaned == [
        "/uploads/products/real-photo.jpg",
        "data:image/png;base64,iVBORw0KGgo=",
    ]
    assert _sanitize_crm_image_url("https://storage.inhyma.test/products/afm500-front.jpg") is None
    assert _sanitize_crm_image_url("/uploads/products/real-photo.jpg") == "/uploads/products/real-photo.jpg"

