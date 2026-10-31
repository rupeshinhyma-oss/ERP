import io
import uuid
from decimal import Decimal
import pytest
from pypdf import PdfReader
from PIL import Image
from unittest.mock import MagicMock

from app.crm.quotation_pdf import (
    generate_crm_quotation_pdf_bytes,
    NumberedCanvas,
    ClickableThumbnail,
    PlaceholderThumbnail,
    resolve_product_image_flowable,
)
from app.crm.quotation_service import CrmQuotationService


def _make_sample_base64_image(width=100, height=100, color="blue") -> str:
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=color)
    img.save(buf, format="PNG")
    import base64
    b64_str = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64_str}"


def test_resolve_image_flowable_with_valid_base64():
    """Verify that a valid base64 data URI resolves to a ClickableThumbnail scaled to target ~150x110 pt."""
    b64_data = _make_sample_base64_image(800, 600, "green")  # 4:3 aspect
    flowable = resolve_product_image_flowable(b64_data, max_w=150.0, max_h=110.0, box_w=154.0, box_h=114.0)
    assert isinstance(flowable, ClickableThumbnail)
    assert flowable.width == 154.0
    assert flowable.height == 114.0
    assert flowable.img_w <= 150.0
    assert flowable.img_h <= 110.0
    # 4:3 aspect: target_aspect = 150/110 ~ 1.3636. 4/3 ~ 1.3333 < 1.3636 -> h=110, w=110 * 4/3 ~ 146.67
    assert abs(flowable.img_h - 110.0) < 0.1
    assert abs(flowable.img_w - (110.0 * 4 / 3)) < 0.1
    # Verify aspect ratio matches original exactly (no distortion)
    assert abs((flowable.img_w / flowable.img_h) - (800 / 600)) < 0.001


def test_resolve_image_flowable_aspect_ratios_no_distortion():
    """Verify landscape (16:9), square (1:1), and portrait (3:4) preserve exact aspect ratio within 150x110."""
    # 1. Landscape 16:9 (1920x1080)
    b64_land = _make_sample_base64_image(1920, 1080, "red")
    f_land = resolve_product_image_flowable(b64_land, max_w=150.0, max_h=110.0)
    assert isinstance(f_land, ClickableThumbnail)
    assert f_land.img_w == 150.0
    assert abs(f_land.img_h - (150.0 / (16 / 9))) < 0.1
    assert abs((f_land.img_w / f_land.img_h) - (16 / 9)) < 0.001

    # 2. Square 1:1 (500x500)
    b64_sq = _make_sample_base64_image(500, 500, "blue")
    f_sq = resolve_product_image_flowable(b64_sq, max_w=150.0, max_h=110.0)
    assert isinstance(f_sq, ClickableThumbnail)
    assert f_sq.img_h == 110.0
    assert f_sq.img_w == 110.0
    assert abs((f_sq.img_w / f_sq.img_h) - 1.0) < 0.001

    # 3. Portrait 3:4 (600x800)
    b64_port = _make_sample_base64_image(600, 800, "yellow")
    f_port = resolve_product_image_flowable(b64_port, max_w=150.0, max_h=110.0)
    assert isinstance(f_port, ClickableThumbnail)
    assert f_port.img_h == 110.0
    assert abs(f_port.img_w - (110.0 * 0.75)) < 0.1
    assert abs((f_port.img_w / f_port.img_h) - 0.75) < 0.001


def test_resolve_image_flowable_with_none_or_empty():
    """Verify that None, empty string, or whitespace returns None (no broken placeholder), unless requested."""
    # Default behavior: returns None so quotation shows clean '-' and no broken placeholder box
    assert resolve_product_image_flowable(None) is None
    assert resolve_product_image_flowable("") is None
    assert resolve_product_image_flowable("   ") is None

    # When explicitly requested fallback:
    f_none_fb = resolve_product_image_flowable(None, fallback_to_placeholder=True)
    assert isinstance(f_none_fb, PlaceholderThumbnail)


def test_resolve_image_flowable_with_broken_image():
    """Verify that corrupt or invalid data returns None (no broken placeholder) by default."""
    assert resolve_product_image_flowable("data:image/png;base64,invalidbase64content!!!") is None
    assert resolve_product_image_flowable("/nonexistent/local/path/image.jpg") is None

    # When explicitly requested fallback:
    f_corrupt_fb = resolve_product_image_flowable("data:image/png;base64,invalidbase64content!!!", fallback_to_placeholder=True)
    assert isinstance(f_corrupt_fb, PlaceholderThumbnail)


def test_single_product_with_image_pdf_generation():
    """Generate a quotation PDF with 1 product having a larger 150x110 image."""
    b64_img = _make_sample_base64_image(800, 600, "red")

    snapshot = {
        "quotation_number": "SQ-202610-SINGLE",
        "version": 1,
        "status": "draft",
        "quotation_date": "2026-10-31T10:00:00Z",
        "currency": "INR",
        "customer_name_snapshot": "Rupesh Malla",
        "company_name_snapshot": "Inhyma Test Org",
        "subtotal": 10000.0,
        "discount_total": 0.0,
        "tax_total": 2800.0,
        "total_amount": 12800.0,
        "items": [
            {
                "position": 1,
                "product_name": "Carton boxes for band sealer without thermocol",
                "product_code": "PROD-MUM-0002",
                "description": "Heavy-duty corrugated packaging boxes tailored for band sealers.",
                "specification": "5-Ply corrugated kraft paper | 150 GSM | Bursting strength: 14 kg/cm²",
                "uom": "BAG",
                "quantity": 1,
                "unit_price": 10000.0,
                "unit_discount": 0.0,
                "tax_rate": 28.0,
                "taxable_amount": 10000.0,
                "tax_amount": 2800.0,
                "total_amount": 12800.0,
                "include_images": True,
                "selected_image_url": b64_img,
                "include_specifications": True,
            }
        ],
    }

    pdf_bytes = generate_crm_quotation_pdf_bytes(snapshot)
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 2000

    reader = PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) >= 1
    text = reader.pages[0].extract_text()
    assert "SQ-202610-SINGLE" in text
    assert "Carton boxes for band sealer" in text
    assert "without thermocol" in text
    assert "PROD-MUM-0002" in text
    assert "Rs. 12,800.00" in text
    assert "Authorized Signatory" in text


def test_three_products_with_images_pdf_generation():
    """Generate a quotation PDF with 3 products with images, verifying consistent sizing and row heights."""
    img1 = _make_sample_base64_image(640, 480, "blue")
    img2 = _make_sample_base64_image(800, 600, "teal")
    img3 = _make_sample_base64_image(1024, 768, "purple")

    snapshot = {
        "quotation_number": "SQ-202610-THREE",
        "version": 1,
        "status": "approved",
        "quotation_date": "2026-10-31T10:00:00Z",
        "currency": "INR",
        "customer_name_snapshot": "Aditi Roy",
        "company_name_snapshot": "Zenith Global Industries Ltd",
        "subtotal": 60000.0,
        "discount_total": 0.0,
        "tax_total": 10800.0,
        "total_amount": 70800.0,
        "items": [
            {
                "position": 1,
                "product_name": "Automatic Band Sealer Vertical",
                "product_code": "BS-VERT-01",
                "description": "Continuous vertical band sealing machine.",
                "specification": "Power: 650W | Sealing speed: 0-12m/min",
                "uom": "Unit",
                "quantity": 1,
                "unit_price": 25000.0,
                "tax_rate": 18.0,
                "total_amount": 29500.0,
                "include_images": True,
                "selected_image_url": img1,
            },
            {
                "position": 2,
                "product_name": "Horizontal Continuous Sealer",
                "product_code": "BS-HORIZ-02",
                "description": "Benchtop horizontal band sealer.",
                "specification": "Power: 500W | Conveyor load: 5kg",
                "uom": "Unit",
                "quantity": 1,
                "unit_price": 20000.0,
                "tax_rate": 18.0,
                "total_amount": 23600.0,
                "include_images": True,
                "selected_image_url": img2,
            },
            {
                "position": 3,
                "product_name": "Heavy Duty Nitrogen Flushing Sealer",
                "product_code": "BS-NITRO-03",
                "description": "Modified atmosphere nitrogen gas flush sealer.",
                "specification": "Gas pressure: 0.4-0.6 MPa | Vacuum speed: 20L/min",
                "uom": "Unit",
                "quantity": 1,
                "unit_price": 15000.0,
                "tax_rate": 18.0,
                "total_amount": 17700.0,
                "include_images": True,
                "selected_image_url": img3,
            },
        ],
    }

    pdf_bytes = generate_crm_quotation_pdf_bytes(snapshot)
    reader = PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) >= 1
    text = reader.pages[0].extract_text()
    assert "SQ-202610-THREE" in text
    assert "BS-VERT-01" in text
    assert "BS-HORIZ-02" in text
    assert "BS-NITRO-03" in text


def test_product_without_image_pdf_generation():
    """Verify that a product without an image displays clean '-' without broken placeholder box."""
    snapshot = {
        "quotation_number": "SQ-202610-NOIMG",
        "version": 1,
        "status": "sent",
        "quotation_date": "2026-10-31T10:00:00Z",
        "currency": "INR",
        "customer_name_snapshot": "Test Customer",
        "company_name_snapshot": "Apex Engineering Enterprise",
        "subtotal": 5000.0,
        "tax_total": 900.0,
        "total_amount": 5900.0,
        "items": [
            {
                "position": 1,
                "product_name": "Teflon Sealing Belts",
                "product_code": "TEF-BELT-10",
                "description": "Spare high-temp belts pack.",
                "uom": "Pack",
                "quantity": 5,
                "unit_price": 1000.0,
                "tax_rate": 18.0,
                "total_amount": 5900.0,
                "include_images": False,
                "selected_image_url": None,
            }
        ],
    }

    pdf_bytes = generate_crm_quotation_pdf_bytes(snapshot)
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = reader.pages[0].extract_text()
    assert "SQ-202610-NOIMG" in text
    assert "Teflon Sealing Belts" in text
    # Verify "No Image" placeholder text was NOT rendered into document
    assert "No Image" not in text


def test_multi_page_quotation_pdf_table_header_repetition():
    """Verify that quotations with many line items render across multiple pages cleanly."""
    sample_img = _make_sample_base64_image(800, 600, "orange")

    # Generate 15 items to force multi-page layout
    items = []
    for i in range(1, 16):
        items.append({
            "position": i,
            "product_name": f"Heavy Industrial Packaging Module #{i}",
            "product_code": f"IND-MOD-{i:03d}",
            "description": f"Extended production specification and technical description for module #{i}.",
            "specification": f"Voltage: 415V 3-Phase | Frequency: 50Hz | Rating: IP65 | Duty: Continuous",
            "uom": "Set",
            "quantity": i,
            "unit_price": 15000.0 + (i * 200),
            "unit_discount": 100.0 * i,
            "tax_rate": 18.0,
            "taxable_amount": (15000.0 + (i * 100)) * i,
            "tax_amount": ((15000.0 + (i * 100)) * i) * 0.18,
            "total_amount": ((15000.0 + (i * 100)) * i) * 1.18,
            "include_images": True,
            "selected_image_url": sample_img if i % 2 == 1 else None,
            "include_specifications": True,
        })

    snapshot = {
        "quotation_number": "SQ-202610-MULTI",
        "version": 2,
        "status": "sent",
        "quotation_date": "2026-10-31T12:00:00Z",
        "valid_until": "2026-11-30T12:00:00Z",
        "currency": "INR",
        "customer_name_snapshot": "Vikram Singhania",
        "company_name_snapshot": "Singhania Heavy Engineering Corp",
        "customer_phone_snapshot": "+91 98200 11223",
        "customer_email_snapshot": "vikram@singhaniaeng.com",
        "billing_address_snapshot": "Industrial Corridor, Sanand GIDC, Gujarat - 382170",
        "customer_gstin_snapshot": "24AAACS5432B1Z2",
        "subtotal": 500000.0,
        "discount_total": 15000.0,
        "tax_total": 87300.0,
        "total_amount": 572300.0,
        "payment_terms": "40% advance, 60% against delivery dispatch.",
        "delivery_terms": "4 weeks from PO confirmation.",
        "notes": "Testing multi-page table wrapping and repetition.",
        "terms_and_conditions": "1. Standard terms.\n2. Taxes extra as applicable.",
        "created_by_name": "Pooja Varma",
        "items": items,
    }

    pdf_bytes = generate_crm_quotation_pdf_bytes(snapshot)
    reader = PdfReader(io.BytesIO(pdf_bytes))
    num_pages = len(reader.pages)
    assert num_pages > 1, f"Expected multi-page PDF, got {num_pages} page(s)"

    # Verify header and footer on each page
    for idx, page in enumerate(reader.pages):
        page_text = page.extract_text()
        assert f"Page {idx + 1} of {num_pages}" in page_text
        assert "INHYMA SOLUTIONS LLP" in page_text


def test_clickable_hyperlink_on_external_url():
    """Verify that when a public http/https image URL is provided, link is configured."""
    img_url = "https://cdn.example.com/products/sealer-photo-hi-res.jpg"
    thumb = ClickableThumbnail(
        img_source=_make_sample_base64_image(50, 50),
        width=150,
        height=110,
        box_width=154,
        box_height=114,
        link_url=img_url,
    )
    assert thumb.link_url == img_url


# =========================================================================
# Image Normalization & Resolution Tests (Bug Remediation Verification)
# =========================================================================

def test_normalize_image_reference_for_large_base64():
    """Ensure large base64 strings (>1000 chars) are mapped to photo:0 or matching index."""
    mock_product = MagicMock()
    img0 = _make_sample_base64_image(200, 200, "purple")  # ~1500 chars
    img1 = _make_sample_base64_image(200, 200, "yellow")
    mock_product.images = [img0, img1]

    # Test exact match on second image
    ref1 = CrmQuotationService._normalize_image_reference(img1, mock_product)
    assert ref1 == "photo:1"
    assert len(ref1) <= 1000

    # Test exact match on first image
    ref0 = CrmQuotationService._normalize_image_reference(img0, mock_product)
    assert ref0 == "photo:0"
    assert len(ref0) <= 1000

    # Test fallback when empty
    ref_empty = CrmQuotationService._normalize_image_reference(None, mock_product)
    assert ref_empty == "photo:0"


def test_normalize_image_reference_for_short_urls():
    """Ensure short URLs and storage paths (<= 1000 chars) remain unchanged."""
    mock_product = MagicMock()
    mock_product.images = ["/uploads/products/sample.png"]

    url = "https://cdn.example.com/box.png"
    norm_url = CrmQuotationService._normalize_image_reference(url, mock_product)
    assert norm_url == url

    local_path = "/uploads/products/sample.png"
    norm_path = CrmQuotationService._normalize_image_reference(local_path, mock_product)
    assert norm_path == local_path


def test_resolve_image_reference():
    """Ensure photo:index resolves back to the full image URI."""
    mock_product = MagicMock()
    img0 = "data:image/jpeg;base64,samplephotozero"
    img1 = "data:image/jpeg;base64,samplephotoone"
    mock_product.images = [img0, img1]

    assert CrmQuotationService._resolve_image_reference("photo:0", mock_product) == img0
    assert CrmQuotationService._resolve_image_reference("photo:1", mock_product) == img1
    assert CrmQuotationService._resolve_image_reference("photo:99", mock_product) is None
    assert CrmQuotationService._resolve_image_reference("https://example.com/img.png", mock_product) == "https://example.com/img.png"
    assert CrmQuotationService._resolve_image_reference(None, mock_product) is None
