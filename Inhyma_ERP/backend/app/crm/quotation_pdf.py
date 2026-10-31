"""
CRM Sales Quotation PDF Generation Engine.

Produces clean, professional, multi-page ERP Quotation documents using ReportLab.
- Exact snapshot preservation (never recalculates from live Product Master).
- Multi-page layout with repeating table headers and 'Page X of Y' pagination.
- Clean typography and auto-wrapping to prevent clipping or overlapping.
- Official Inhyma ERP company details, logo asset, GSTIN, and saved commercial terms.
- Authoritative Customer/Company resolution (no internal labels or invented warranties).
"""

from __future__ import annotations

import base64
import io
import os
from datetime import datetime
from decimal import Decimal
from typing import Any
from urllib.parse import unquote
from xml.sax.saxutils import escape as xml_escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable,
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


class NumberedCanvas(canvas.Canvas):
    """
    Two-pass canvas to dynamically compute and print total page count ('Page X of Y')
    along with standard ERP running footer notices and quotation reference.
    """

    current_quotation_number: str | None = None
    current_company_name: str | None = "INHYMA SOLUTIONS LLP"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict[str, Any]] = []

    def showPage(self) -> None:
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count: int) -> None:
        self.saveState()
        self.setFont("Helvetica", 7.5)
        self.setFillColor(colors.HexColor("#64748b"))

        # Footer divider line (margins: 36 to 595.27 - 36)
        self.setStrokeColor(colors.HexColor("#cbd5e1"))
        self.setLineWidth(0.5)
        self.line(36, 30, 595.27 - 36, 30)

        # Left footer notice with dynamic company name from ERP Settings
        comp_title = getattr(self, "company_name", None) or NumberedCanvas.current_company_name or "INHYMA SOLUTIONS LLP"
        self.drawString(
            36,
            18,
            f"{comp_title.upper()} — Official Sales Quotation",
        )

        # Center quotation reference
        q_ref = getattr(self, "quotation_number", None) or NumberedCanvas.current_quotation_number
        if q_ref:
            self.drawCentredString(595.27 / 2, 18, f"Quotation Ref: {q_ref}")

        # Right page number: Page X of Y
        page_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(595.27 - 36, 18, page_text)

        self.restoreState()


def _format_currency(amount: Any) -> str:
    try:
        val = Decimal(str(amount or 0))
        return f"Rs. {val:,.2f}"
    except Exception:
        return f"Rs. {amount}"


def _format_date(dt_val: Any) -> str:
    if not dt_val:
        return "—"
    if isinstance(dt_val, str):
        try:
            parsed = datetime.fromisoformat(dt_val.replace("Z", "+00:00"))
            return parsed.strftime("%d-%b-%Y")
        except Exception:
            return dt_val[:10]
    if isinstance(dt_val, datetime):
        return dt_val.strftime("%d-%b-%Y")
    return str(dt_val)


def _is_internal_placeholder(val: str | None) -> bool:
    if not val:
        return True
    s = val.strip().lower()
    if s in {"", "-", "—", "n/a", "na", "none", "null", "undefined", "unassigned", "system", "no company", "customer"}:
        return True
    internal_keywords = [
        "open lead only",
        "open lead",
        "unmatched legacy",
        "unmatched",
        "legacy lead",
        "new lead",
        "test lead",
        "dummy",
        "sample lead",
        "nonexistent entity",
        "nonexistent",
        "unknown entity",
        "unknown",
    ]
    if any(k in s for k in internal_keywords):
        return True
    if s.startswith("crm-") or s.startswith("ld-") or s.startswith("lead-"):
        return True
    return False


def get_inhyma_logo_flowable() -> Image | None:
    """Load the official Inhyma company logo from ERP assets."""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(current_dir, "assets", "logo.png"),
        os.path.abspath(os.path.join(current_dir, "..", "..", "..", "frontend", "public", "logo.png")),
        os.path.abspath(os.path.join(current_dir, "..", "assets", "logo.png")),
    ]
    for p in candidates:
        if os.path.isfile(p):
            try:
                # Logo aspect ratio 179 x 123 (~ 1.455:1)
                img = Image(p, width=64, height=44)
                img.hAlign = "LEFT"
                return img
            except Exception:
                pass
    return None


def get_logo_flowable(
    logo_data: str | None = None,
    logo_url: str | None = None,
    max_height: float = 50.0,
    max_width: float = 180.0,
) -> Image | None:
    """
    Load company logo from ERP Settings base64 data URI or stored image file,
    preserving exact aspect ratio without stretching or distortion.
    Returns None if no logo is configured in ERP Settings.
    """
    if logo_data and logo_data.startswith("data:"):
        try:
            _, encoded = logo_data.split(",", 1)
            raw_bytes = base64.b64decode(encoded)
            try:
                from PIL import Image as PILImage

                pil_img = PILImage.open(io.BytesIO(raw_bytes))
                orig_w, orig_h = pil_img.size
                if orig_h > 0 and orig_w > 0:
                    aspect = orig_w / orig_h
                    h = max_height
                    w = h * aspect
                    if w > max_width:
                        w = max_width
                        h = w / aspect
                    img = Image(io.BytesIO(raw_bytes), width=w, height=h)
                    img.hAlign = "LEFT"
                    return img
            except Exception:
                img = Image(io.BytesIO(raw_bytes), width=64, height=38)
                img.hAlign = "LEFT"
                return img
        except Exception:
            pass

    if logo_url:
        clean_url = logo_url.split("?")[0]
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        possible_paths = [
            os.path.join(base_dir, clean_url.lstrip("/\\")),
            os.path.join(base_dir, "backend", clean_url.lstrip("/\\")),
            os.path.join(base_dir, "..", clean_url.lstrip("/\\")),
        ]
        for p in possible_paths:
            if os.path.isfile(p):
                try:
                    from PIL import Image as PILImage

                    pil_img = PILImage.open(p)
                    orig_w, orig_h = pil_img.size
                    if orig_w > 0 and orig_w > 0:
                        aspect = orig_w / orig_h
                        h = max_height
                        w = h * aspect
                        if w > max_width:
                            w = max_width
                            h = w / aspect
                        img = Image(p, width=w, height=h)
                        img.hAlign = "LEFT"
                        return img
                except Exception:
                    pass

    return None


def generate_crm_quotation_pdf_bytes(
    snapshot_data: dict[str, Any],
    company_branding: dict[str, Any] | None = None,
) -> bytes:
    """
    Generate an official Inhyma CRM Sales Quotation PDF from a saved quotation or revision snapshot.

    Args:
        snapshot_data: Serialized quotation dictionary containing header fields and line items.

    Returns:
        bytes: Raw PDF document content.
    """
    buffer = io.BytesIO()

    # Document Geometry: A4 (595.27 x 841.89 pt), Margins 36 pt (0.5 in)
    # Usable width: 595.27 - 72 = 523.27 pt
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=36,
        rightMargin=36,
        topMargin=32,
        bottomMargin=42,
    )

    styles = getSampleStyleSheet()

    # Base typography styles
    style_brand = ParagraphStyle(
        "BrandTitle",
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=14,
        textColor=colors.HexColor("#0061f2"),
    )
    style_tagline = ParagraphStyle(
        "BrandTagline",
        fontName="Helvetica-Bold",
        fontSize=6.5,
        leading=8,
        textColor=colors.HexColor("#dc2626"),
    )
    style_company_info = ParagraphStyle(
        "CompanyInfo",
        fontName="Helvetica",
        fontSize=7.5,
        leading=10.5,
        textColor=colors.HexColor("#334155"),
        alignment=TA_RIGHT,
    )
    style_company_name_hdr = ParagraphStyle(
        "CompanyNameHeader",
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=13,
        textColor=colors.HexColor("#0f172a"),
        alignment=TA_RIGHT,
    )
    style_doc_title = ParagraphStyle(
        "DocTitle",
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        textColor=colors.white,
        alignment=TA_CENTER,
    )
    style_box_section_hdr = ParagraphStyle(
        "BoxSectionHdr",
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#1e293b"),
    )
    style_box_label = ParagraphStyle(
        "BoxLabel",
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=10,
        textColor=colors.HexColor("#475569"),
    )
    style_box_val = ParagraphStyle(
        "BoxVal",
        fontName="Helvetica",
        fontSize=7.5,
        leading=10.5,
        textColor=colors.HexColor("#0f172a"),
    )
    style_box_val_bold = ParagraphStyle(
        "BoxValBold",
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#0f172a"),
    )
    style_th = ParagraphStyle(
        "TableHeader",
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=10,
        textColor=colors.white,
    )
    style_th_r = ParagraphStyle(
        "TableHeaderR",
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=10,
        textColor=colors.white,
        alignment=TA_RIGHT,
    )
    style_td = ParagraphStyle(
        "TableBody",
        fontName="Helvetica",
        fontSize=7.5,
        leading=10,
        textColor=colors.HexColor("#0f172a"),
    )
    style_td_bold = ParagraphStyle(
        "TableBodyBold",
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10.5,
        textColor=colors.HexColor("#0f172a"),
    )
    style_td_r = ParagraphStyle(
        "TableBodyR",
        fontName="Helvetica",
        fontSize=7.5,
        leading=10,
        textColor=colors.HexColor("#0f172a"),
        alignment=TA_RIGHT,
    )
    style_grand_total = ParagraphStyle(
        "GrandTotal",
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#1d4ed8"),
        alignment=TA_RIGHT,
    )
    style_td_spec = ParagraphStyle(
        "TableSpec",
        fontName="Helvetica-Oblique",
        fontSize=7,
        leading=9,
        textColor=colors.HexColor("#475569"),
    )
    style_td_link = ParagraphStyle(
        "TableSpecLink",
        fontName="Helvetica",
        fontSize=7,
        leading=9.5,
        textColor=colors.HexColor("#0061f2"),
        wordWrap="CJK",
    )
    style_notes = ParagraphStyle(
        "NotesBody",
        fontName="Helvetica",
        fontSize=7.5,
        leading=10.5,
        textColor=colors.HexColor("#334155"),
    )

    story: list[Any] = []

    # -------------------------------------------------------------------------
    # 1. Company Header Block (Official Branding & Details from ERP Settings)
    # -------------------------------------------------------------------------
    branding = company_branding or snapshot_data.get("company_branding") or {}
    org_comp_name = (branding.get("company_name") or "Inhyma Solutions LLP").strip()
    org_legal_name = (branding.get("legal_name") or "").strip()
    org_logo_data = branding.get("logo_data")
    org_logo_url = branding.get("logo_url")
    org_email = (branding.get("email") or "").strip()
    org_phone = (branding.get("phone") or "").strip()
    org_web = (branding.get("website") or "").strip()
    org_gst = (branding.get("gst_number") or "").strip()
    org_pan = (branding.get("pan_number") or "").strip()
    org_address = (branding.get("address") or "").strip()
    org_city = (branding.get("city") or "").strip()
    org_state = (branding.get("state") or "").strip()
    org_postal = (branding.get("postal_code") or "").strip()
    org_country = (branding.get("country") or "").strip()

    NumberedCanvas.current_company_name = org_comp_name

    logo_flowable = get_logo_flowable(logo_data=org_logo_data, logo_url=org_logo_url, max_height=50.0, max_width=180.0)

    left_header_items: list[Any] = []
    right_header_items: list[Any] = []

    if logo_flowable:
        # Exactly ONE company logo rendered on left; no duplicate brand text beneath it
        left_header_items.append(logo_flowable)
        # Render exactly ONE company name at the top of the details column
        right_header_items.append(Paragraph(f"<b>{org_comp_name.upper()}</b>", style_company_name_hdr))
        if org_legal_name and org_legal_name.lower() != org_comp_name.lower():
            right_header_items.append(Paragraph(f"<font color='#64748b'>({org_legal_name})</font>", style_company_info))
    else:
        # No logo configured: render company name on left
        left_header_items.append(Paragraph(f"<b>{org_comp_name.upper()}</b>", style_brand))
        if org_legal_name and org_legal_name.lower() != org_comp_name.lower():
            left_header_items.append(Paragraph(f"<font color='#64748b'>({org_legal_name})</font>", style_tagline))
        # Do not repeat company name on right when already on left

    addr_parts = [p for p in [org_address, org_city] if p]
    if addr_parts:
        right_header_items.append(Paragraph(", ".join(addr_parts), style_company_info))

    state_parts = []
    if org_state and org_postal:
        state_parts.append(f"{org_state} - {org_postal}")
    elif org_state:
        state_parts.append(org_state)
    elif org_postal:
        state_parts.append(org_postal)
    if org_country:
        state_parts.append(org_country)
    if state_parts:
        right_header_items.append(Paragraph(", ".join(state_parts), style_company_info))

    contact_parts = []
    if org_email:
        contact_parts.append(f"Email: {org_email}")
    if org_phone:
        contact_parts.append(f"Phone: {org_phone}")
    if org_web:
        contact_parts.append(f"Web: {org_web}")
    if contact_parts:
        right_header_items.append(Paragraph(" | ".join(contact_parts), style_company_info))

    tax_parts = []
    if org_gst:
        tax_parts.append(f"<b>GSTIN: {org_gst}</b>")
    if org_pan:
        tax_parts.append(f"<b>PAN: {org_pan}</b>")
    if tax_parts:
        right_header_items.append(Paragraph(" | ".join(tax_parts), style_company_info))

    header_table = Table([[left_header_items, right_header_items]], colWidths=[200, 323.27])
    header_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ])
    )
    story.append(header_table)
    story.append(Spacer(1, 5))

    # -------------------------------------------------------------------------
    # 2. Document Title Banner
    # -------------------------------------------------------------------------
    banner_table = Table(
        [[Paragraph("SALES QUOTATION", style_doc_title)]],
        colWidths=[523.27],
    )
    banner_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#0f172a")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#0f172a")),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ])
    )
    story.append(banner_table)
    story.append(Spacer(1, 6))

    # -------------------------------------------------------------------------
    # 3. Quotation Details & Customer / Bill To Box (2 Columns)
    # -------------------------------------------------------------------------
    hdr = snapshot_data.get("header") if isinstance(snapshot_data.get("header"), dict) else {}
    q_num = snapshot_data.get("quotation_number") or hdr.get("quotation_number") or "—"
    NumberedCanvas.current_quotation_number = q_num
    q_ver = snapshot_data.get("version") or hdr.get("version") or 1
    q_date = _format_date(snapshot_data.get("quotation_date") or hdr.get("quotation_date"))
    raw_valid = snapshot_data.get("valid_until") or hdr.get("valid_until")
    q_valid = _format_date(raw_valid) if raw_valid else None
    q_curr = snapshot_data.get("currency") or hdr.get("currency") or "INR"
    q_status = (snapshot_data.get("status") or hdr.get("status") or "draft").capitalize()

    cust_name = snapshot_data.get("customer_name_snapshot") or hdr.get("customer_name_snapshot")
    comp_name = snapshot_data.get("company_name_snapshot") or hdr.get("company_name_snapshot")
    cust_phone = snapshot_data.get("customer_phone_snapshot") or hdr.get("customer_phone_snapshot")
    cust_email = snapshot_data.get("customer_email_snapshot") or hdr.get("customer_email_snapshot")
    cust_desig = snapshot_data.get("customer_designation_snapshot") or hdr.get("customer_designation_snapshot")
    cust_addr = snapshot_data.get("billing_address_snapshot") or hdr.get("billing_address_snapshot")
    cust_gstin = snapshot_data.get("customer_gstin_snapshot") or hdr.get("customer_gstin_snapshot")

    # Left Column: Quotation Metadata
    meta_content_left: list[list[Any]] = [
        [Paragraph("<b>QUOTATION DETAILS</b>", style_box_section_hdr), ""],
        [Paragraph("Quotation No:", style_box_label), Paragraph(f"<b>{q_num}</b>", style_box_val_bold)],
        [Paragraph("Version / Status:", style_box_label), Paragraph(f"v{q_ver} ({q_status})", style_box_val)],
        [Paragraph("Quotation Date:", style_box_label), Paragraph(q_date, style_box_val)],
    ]
    # Include Validity Date ONLY when provided
    if q_valid and q_valid != "—":
        meta_content_left.append([Paragraph("Valid Until:", style_box_label), Paragraph(q_valid, style_box_val)])
    meta_content_left.append([Paragraph("Currency:", style_box_label), Paragraph(q_curr, style_box_val)])
    prepared_by = snapshot_data.get("created_by_name") or hdr.get("created_by_name") or "Inhyma Sales"
    meta_content_left.append([Paragraph("Prepared By:", style_box_label), Paragraph(prepared_by, style_box_val)])

    # Right Column: CUSTOMER / BILL TO
    meta_content_right: list[list[Any]] = [
        [Paragraph("<b>CUSTOMER / BILL TO</b>", style_box_section_hdr), ""],
    ]

    has_company = comp_name and comp_name != "—" and not _is_internal_placeholder(comp_name)

    if has_company:
        meta_content_right.append([Paragraph("Company Name:", style_box_label), Paragraph(f"<b>{comp_name}</b>", style_box_val_bold)])

        if cust_name and cust_name != "—" and not _is_internal_placeholder(cust_name):
            desig_part = f" ({cust_desig})" if cust_desig else ""
            meta_content_right.append([Paragraph("Contact Person:", style_box_label), Paragraph(f"{cust_name}{desig_part}", style_box_val)])
        elif cust_desig:
            meta_content_right.append([Paragraph("Designation:", style_box_label), Paragraph(cust_desig, style_box_val)])

        if cust_addr and cust_addr != "—":
            meta_content_right.append([Paragraph("Billing Address:", style_box_label), Paragraph(cust_addr, style_box_val)])

        if cust_gstin and cust_gstin != "—":
            meta_content_right.append([Paragraph("GSTIN:", style_box_label), Paragraph(f"<b>{cust_gstin}</b>", style_box_val)])

        if cust_phone and cust_phone != "—":
            meta_content_right.append([Paragraph("Contact Phone:", style_box_label), Paragraph(cust_phone, style_box_val)])

        if cust_email and cust_email != "—":
            meta_content_right.append([Paragraph("Contact Email:", style_box_label), Paragraph(cust_email, style_box_val)])
    else:
        # Lead not linked to a company: display actual contact as customer, omit company section
        clean_cust_name = cust_name if (cust_name and cust_name != "—" and not _is_internal_placeholder(cust_name)) else "—"
        meta_content_right.append([Paragraph("Customer Name:", style_box_label), Paragraph(f"<b>{clean_cust_name}</b>", style_box_val_bold)])

        if cust_addr and cust_addr != "—":
            meta_content_right.append([Paragraph("Billing Address:", style_box_label), Paragraph(cust_addr, style_box_val)])

        if cust_gstin and cust_gstin != "—":
            meta_content_right.append([Paragraph("GSTIN:", style_box_label), Paragraph(f"<b>{cust_gstin}</b>", style_box_val)])

        if cust_phone and cust_phone != "—":
            meta_content_right.append([Paragraph("Contact Phone:", style_box_label), Paragraph(cust_phone, style_box_val)])

        if cust_email and cust_email != "—":
            meta_content_right.append([Paragraph("Contact Email:", style_box_label), Paragraph(cust_email, style_box_val)])

    t_left = Table(meta_content_left, colWidths=[85, 165])
    t_left.setStyle(
        TableStyle([
            ("SPAN", (0, 0), (1, 0)),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 1.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
            ("LEFTPADDING", (0, 0), (-1, -1), 2),
            ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ])
    )

    t_right = Table(meta_content_right, colWidths=[85, 175])
    t_right.setStyle(
        TableStyle([
            ("SPAN", (0, 0), (1, 0)),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 1.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
            ("LEFTPADDING", (0, 0), (-1, -1), 2),
            ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ])
    )

    meta_wrapper = Table([[t_left, t_right]], colWidths=[256, 267.27])
    meta_wrapper.setStyle(
        TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#cbd5e1")),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ])
    )
    story.append(meta_wrapper)
    story.append(Spacer(1, 8))

    # -------------------------------------------------------------------------
    # 4. Product & Line Items Table (with Repeating Header for Multi-Page)
    # -------------------------------------------------------------------------
    # Widths sum = 24 + 200 + 46 + 68 + 48 + 44 + 93.27 = 523.27 pt
    col_widths = [24, 200, 46, 68, 48, 44, 93.27]

    table_rows: list[list[Any]] = [
        [
            Paragraph("Sr.", style_th),
            Paragraph("Product Description & Specifications", style_th),
            Paragraph("Qty", style_th_r),
            Paragraph("Unit Price", style_th_r),
            Paragraph("Discount", style_th_r),
            Paragraph("Tax Rate", style_th_r),
            Paragraph("Line Total", style_th_r),
        ]
    ]

    raw_items = snapshot_data.get("items") or []
    for idx, it in enumerate(raw_items, start=1):
        item_paragraphs: list[Any] = []
        p_name = it.get("product_name") or "Product"
        p_code = it.get("product_code")
        header_text = f"<b>{xml_escape(str(p_name))}</b>" + (f" <font color='#475569'>({xml_escape(str(p_code))})</font>" if p_code else "")
        item_paragraphs.append(Paragraph(header_text, style_td_bold))

        desc = it.get("description")
        if desc and desc.strip() and desc.strip() != p_name.strip():
            item_paragraphs.append(Paragraph(xml_escape(desc.strip()), style_td))

        include_specs = it.get("include_specifications", True)
        spec = it.get("specification")
        if include_specs and spec and spec.strip():
            item_paragraphs.append(Spacer(1, 1.5))
            clean_spec = spec.strip()
            is_spec_link = (
                clean_spec.startswith("http://")
                or clean_spec.startswith("https://")
                or clean_spec.startswith("/api/")
            )
            if is_spec_link:
                doc_label = (it.get("specification_doc_name") or "").strip()
                if not doc_label:
                    tail = unquote(clean_spec.split("?", 1)[0].rsplit("/", 1)[-1]).strip()
                    doc_label = tail if tail else "Specification.pdf"
                safe_href = xml_escape(clean_spec, {'"': "&quot;"})
                safe_label = xml_escape(doc_label)
                safe_url_text = xml_escape(clean_spec)
                is_pdf_doc = doc_label.lower().endswith(".pdf") or clean_spec.lower().split("?", 1)[0].endswith(".pdf")
                spec_heading = "Specification PDF:" if is_pdf_doc else "Specification Document:"
                item_paragraphs.append(
                    Paragraph(
                        f'<b>{spec_heading}</b> <a href="{safe_href}" color="#0061f2"><u>{safe_label}</u></a>',
                        style_td_spec,
                    )
                )
                item_paragraphs.append(
                    Paragraph(
                        f'<a href="{safe_href}" color="#0061f2"><u>{safe_url_text}</u></a>',
                        style_td_link,
                    )
                )
            else:
                item_paragraphs.append(Paragraph(f"<b>Specs:</b> {xml_escape(clean_spec)}", style_td_spec))

        demo_link = it.get("demo_link")
        if demo_link and demo_link.strip():
            item_paragraphs.append(Spacer(1, 1))
            clean_demo = demo_link.strip()
            safe_demo = xml_escape(clean_demo, {'"': "&quot;"})
            if clean_demo.startswith("http://") or clean_demo.startswith("https://"):
                item_paragraphs.append(
                    Paragraph(f'<b>Ref / Demo:</b> <a href="{safe_demo}" color="#0061f2"><u>{xml_escape(clean_demo)}</u></a>', style_td_link)
                )
            else:
                item_paragraphs.append(Paragraph(f"<b>Ref / Demo:</b> {xml_escape(clean_demo)}", style_td_spec))

        qty_val = it.get("quantity", 1)
        uom_val = it.get("uom", "Nos")
        try:
            q_dec = Decimal(str(qty_val))
            qty_str = f"{int(q_dec) if q_dec == int(q_dec) else q_dec} {uom_val}"
        except Exception:
            qty_str = f"{qty_val} {uom_val}"

        u_price_str = _format_currency(it.get("unit_price", 0))
        u_disc = Decimal(str(it.get("unit_discount", 0) or 0))
        u_disc_str = _format_currency(u_disc) if u_disc > 0 else "—"
        tax_pct = Decimal(str(it.get("tax_rate", 0) or 0))
        tax_str = f"{tax_pct}%" if tax_pct > 0 else "0%"
        total_str = _format_currency(it.get("total_amount", 0))

        table_rows.append([
            Paragraph(str(idx), style_td),
            item_paragraphs,
            Paragraph(qty_str, style_td_r),
            Paragraph(u_price_str, style_td_r),
            Paragraph(u_disc_str, style_td_r),
            Paragraph(tax_str, style_td_r),
            Paragraph(f"<b>{total_str}</b>", style_td_r),
        ])

    items_table = Table(table_rows, colWidths=col_widths, repeatRows=1)
    items_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ])
    )
    story.append(items_table)
    story.append(Spacer(1, 8))

    # -------------------------------------------------------------------------
    # 5. Commercial Summary Totals (Subtotal, Discount, Tax, Grand Total)
    # -------------------------------------------------------------------------
    subtotal = snapshot_data.get("subtotal", 0)
    disc_total = snapshot_data.get("discount_total", 0)
    tax_total = snapshot_data.get("tax_total", 0)
    grand_total = snapshot_data.get("total_amount", 0)

    summary_rows = [
        [Paragraph("Subtotal (Taxable):", style_box_label), Paragraph(_format_currency(subtotal), style_td_r)],
    ]
    if Decimal(str(disc_total or 0)) > 0:
        summary_rows.append([Paragraph("Total Discount:", style_box_label), Paragraph(_format_currency(disc_total), style_td_r)])
    summary_rows.extend([
        [Paragraph("Tax Breakdown (GST):", style_box_label), Paragraph(_format_currency(tax_total), style_td_r)],
        [Paragraph("<b>GRAND TOTAL:</b>", style_box_val_bold), Paragraph(f"<b>{_format_currency(grand_total)}</b>", style_grand_total)],
    ])

    summary_table = Table(summary_rows, colWidths=[125, 115])
    summary_table.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#eff6ff")),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ])
    )

    # Align summary box to the right
    outer_summary = Table([["", summary_table]], colWidths=[283.27, 240])
    outer_summary.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ])
    )
    story.append(KeepTogether(outer_summary))
    story.append(Spacer(1, 8))

    # -------------------------------------------------------------------------
    # 6. Commercial Terms & Notes (Include ONLY Saved Content — No Invented Terms)
    # -------------------------------------------------------------------------
    terms_paragraphs: list[Any] = []

    p_terms = snapshot_data.get("payment_terms")
    if p_terms and str(p_terms).strip():
        terms_paragraphs.append(Paragraph(f"<b>Payment Terms:</b> {str(p_terms).strip()}", style_notes))

    d_terms = snapshot_data.get("delivery_terms")
    if d_terms and str(d_terms).strip():
        terms_paragraphs.append(Paragraph(f"<b>Delivery Terms:</b> {str(d_terms).strip()}", style_notes))

    notes = snapshot_data.get("notes")
    if notes and str(notes).strip():
        terms_paragraphs.append(Paragraph(f"<b>Notes & Remarks:</b> {str(notes).strip()}", style_notes))

    tc = snapshot_data.get("terms_and_conditions")
    if tc and str(tc).strip():
        terms_paragraphs.append(Paragraph(f"<b>Commercial Terms:</b> {str(tc).strip()}", style_notes))

    # Display terms box ONLY if user-entered or saved terms exist
    if terms_paragraphs:
        box_content: list[Any] = [
            Paragraph("<b>TERMS & CONDITIONS / NOTES</b>", style_box_section_hdr),
            Spacer(1, 2),
        ] + terms_paragraphs

        terms_box = Table([[box_content]], colWidths=[523.27])
        terms_box.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ])
        )
        story.append(KeepTogether(terms_box))

    # Build PDF with dynamic NumberedCanvas
    doc.build(story, canvasmaker=NumberedCanvas)
    return buffer.getvalue()
