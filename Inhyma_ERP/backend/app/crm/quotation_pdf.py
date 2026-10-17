"""
CRM Sales Quotation PDF Generation Engine.

Produces clean, professional, multi-page ERP Quotation documents using ReportLab.
- Exact snapshot preservation (never recalculates from live Product Master).
- Multi-page layout with repeating table headers and 'Page X of Y' pagination.
- Clean typography and auto-wrapping to prevent clipping or overlapping.
- Official Inhyma ERP company details, GSTIN, and commercial terms.
"""

from __future__ import annotations

import base64
import io
from datetime import datetime
from decimal import Decimal
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable,
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
    along with standard ERP running footer notices.
    """

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
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748b"))

        # Footer divider line
        self.setStrokeColor(colors.HexColor("#cbd5e1"))
        self.setLineWidth(0.5)
        self.line(36, 32, 595.27 - 36, 32)

        # Left footer notice
        self.drawString(
            36,
            22,
            "INHYMA SOLUTIONS LLP — Computer-Generated Official Sales Quotation",
        )

        # Right page number
        page_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(595.27 - 36, 22, page_text)

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


def generate_crm_quotation_pdf_bytes(snapshot_data: dict[str, Any]) -> bytes:
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
        topMargin=36,
        bottomMargin=45,
    )

    styles = getSampleStyleSheet()

    # Base typography styles
    style_brand = ParagraphStyle(
        "BrandTitle",
        fontName="Helvetica-Bold",
        fontSize=16,
        leading=19,
        textColor=colors.HexColor("#0061f2"),
    )
    style_tagline = ParagraphStyle(
        "BrandTagline",
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=9,
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
    style_doc_title = ParagraphStyle(
        "DocTitle",
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        textColor=colors.HexColor("#0f172a"),
        alignment=TA_CENTER,
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
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#0f172a"),
    )
    style_box_val_bold = ParagraphStyle(
        "BoxValBold",
        fontName="Helvetica-Bold",
        fontSize=8.5,
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
    style_td_spec = ParagraphStyle(
        "TableSpec",
        fontName="Helvetica-Oblique",
        fontSize=7,
        leading=9,
        textColor=colors.HexColor("#475569"),
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
    # 1. Company Header Block
    # -------------------------------------------------------------------------
    header_data = [
        [
            [
                Paragraph("INHYMA SOLUTIONS LLP", style_brand),
                Spacer(1, 2),
                Paragraph("YOUR INDUSTRIAL HYPER MARKET", style_tagline),
            ],
            [
                Paragraph("<b>INHYMA SOLUTIONS LLP</b>", style_company_info),
                Paragraph("Office No 421, Supremus-II, Road No-22, Wagle Estate", style_company_info),
                Paragraph("Thane, Maharashtra - 400604", style_company_info),
                Paragraph("Email: payment.darsh@gmail.com | Phone: 9653261742", style_company_info),
                Paragraph("<b>GSTIN: 27AAKFI9869H1ZL</b>", style_company_info),
            ],
        ]
    ]

    header_table = Table(header_data, colWidths=[200, 323.27])
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
    story.append(Spacer(1, 6))

    # Document Banner
    banner_table = Table(
        [[Paragraph("COMMERCIAL SALES QUOTATION", style_doc_title)]],
        colWidths=[523.27],
    )
    banner_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f1f5f9")),
            ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#cbd5e1")),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ])
    )
    story.append(banner_table)
    story.append(Spacer(1, 8))

    # -------------------------------------------------------------------------
    # 2. Quotation Metadata & Customer Snapshot Box (2 Columns)
    # -------------------------------------------------------------------------
    q_num = snapshot_data.get("quotation_number", "—")
    q_ver = snapshot_data.get("version", 1)
    q_date = _format_date(snapshot_data.get("quotation_date"))
    q_valid = _format_date(snapshot_data.get("valid_until"))
    q_curr = snapshot_data.get("currency", "INR")
    q_status = (snapshot_data.get("status") or "draft").capitalize()

    cust_name = snapshot_data.get("customer_name_snapshot") or "—"
    comp_name = snapshot_data.get("company_name_snapshot") or "—"
    cust_phone = snapshot_data.get("customer_phone_snapshot") or "—"
    cust_email = snapshot_data.get("customer_email_snapshot") or "—"

    meta_content_left = [
        [Paragraph("Quotation No:", style_box_label), Paragraph(f"<b>{q_num}</b>", style_box_val_bold)],
        [Paragraph("Version / Revision:", style_box_label), Paragraph(f"v{q_ver} ({q_status})", style_box_val)],
        [Paragraph("Date Issued:", style_box_label), Paragraph(q_date, style_box_val)],
        [Paragraph("Valid Until:", style_box_label), Paragraph(q_valid, style_box_val)],
        [Paragraph("Currency:", style_box_label), Paragraph(q_curr, style_box_val)],
    ]

    meta_content_right = [
        [Paragraph("Customer Name:", style_box_label), Paragraph(f"<b>{cust_name}</b>", style_box_val_bold)],
        [Paragraph("Company Name:", style_box_label), Paragraph(comp_name, style_box_val)],
        [Paragraph("Contact Phone:", style_box_label), Paragraph(cust_phone, style_box_val)],
        [Paragraph("Contact Email:", style_box_label), Paragraph(cust_email, style_box_val)],
        [Paragraph("Prepared By:", style_box_label), Paragraph(snapshot_data.get("created_by_name") or "Inhyma Sales", style_box_val)],
    ]

    t_left = Table(meta_content_left, colWidths=[90, 165])
    t_left.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))

    t_right = Table(meta_content_right, colWidths=[90, 165])
    t_right.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))

    meta_wrapper = Table([[t_left, t_right]], colWidths=[260, 263.27])
    meta_wrapper.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#cbd5e1")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(meta_wrapper)
    story.append(Spacer(1, 10))

    # -------------------------------------------------------------------------
    # 3. Product & Line Items Table (with Repeating Header for Multi-Page)
    # -------------------------------------------------------------------------
    # Widths sum = 24 + 195 + 46 + 68 + 48 + 44 + 98 = 523 pt
    col_widths = [24, 195, 46, 68, 48, 44, 98.27]

    table_rows: list[list[Any]] = [
        [
            Paragraph("Sr.", style_th),
            Paragraph("Item Description & Specifications", style_th),
            Paragraph("Qty", style_th_r),
            Paragraph("Unit Price", style_th_r),
            Paragraph("Discount", style_th_r),
            Paragraph("Tax", style_th_r),
            Paragraph("Line Total", style_th_r),
        ]
    ]

    raw_items = snapshot_data.get("items") or []
    for idx, it in enumerate(raw_items, start=1):
        item_paragraphs: list[Any] = []
        p_name = it.get("product_name") or "Product"
        p_code = it.get("product_code")
        header_text = f"<b>{p_name}</b>" + (f" ({p_code})" if p_code else "")
        item_paragraphs.append(Paragraph(header_text, style_td_bold))

        desc = it.get("description")
        if desc:
            item_paragraphs.append(Paragraph(desc, style_td))

        include_specs = it.get("include_specifications", True)
        spec = it.get("specification")
        if include_specs and spec:
            item_paragraphs.append(Spacer(1, 2))
            item_paragraphs.append(Paragraph(f"<b>Specs:</b> {spec}", style_td_spec))

        demo_link = it.get("demo_link")
        if demo_link:
            item_paragraphs.append(Spacer(1, 1))
            item_paragraphs.append(Paragraph(f"<b>Demo / Ref:</b> {demo_link}", style_td_spec))

        qty_str = f"{it.get('quantity', 1)} {it.get('uom', 'Nos')}"
        u_price_str = _format_currency(it.get("unit_price", 0))
        u_disc_str = _format_currency(it.get("unit_discount", 0))
        tax_str = f"{it.get('tax_rate', 0)}%"
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
    items_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 8))

    # -------------------------------------------------------------------------
    # 4. Commercial Summary Totals
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
        [Paragraph("Total GST / Tax:", style_box_label), Paragraph(_format_currency(tax_total), style_td_r)],
        [Paragraph("<b>GRAND TOTAL:</b>", style_box_val_bold), Paragraph(f"<b>{_format_currency(grand_total)}</b>", style_td_r)],
    ])

    summary_table = Table(summary_rows, colWidths=[120, 110])
    summary_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#eff6ff")),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))

    # Align summary to the right
    outer_summary = Table([["", summary_table]], colWidths=[293.27, 230])
    outer_summary.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(KeepTogether(outer_summary))
    story.append(Spacer(1, 10))

    # -------------------------------------------------------------------------
    # 5. Terms & Conditions Section (KeepTogether to prevent orphaned footer)
    # -------------------------------------------------------------------------
    terms_paragraphs: list[Any] = [
        Paragraph("<b>Commercial Terms & Notes</b>", style_box_val_bold),
        Spacer(1, 3),
    ]

    p_terms = snapshot_data.get("payment_terms")
    if p_terms:
        terms_paragraphs.append(Paragraph(f"<b>Payment Terms:</b> {p_terms}", style_notes))
    d_terms = snapshot_data.get("delivery_terms")
    if d_terms:
        terms_paragraphs.append(Paragraph(f"<b>Delivery Terms:</b> {d_terms}", style_notes))
    notes = snapshot_data.get("notes")
    if notes:
        terms_paragraphs.append(Paragraph(f"<b>Notes:</b> {notes}", style_notes))
    tc = snapshot_data.get("terms_and_conditions")
    if tc:
        terms_paragraphs.append(Paragraph(f"<b>Standard Terms:</b> {tc}", style_notes))
    else:
        terms_paragraphs.append(
            Paragraph(
                "1. Goods once sold will not be taken back without prior written approval.<br/>"
                "2. Standard manufacturer warranty applies against manufacturing defects.<br/>"
                "3. Any disputes are subject to Thane / Mumbai jurisdiction.",
                style_notes,
            )
        )

    terms_box = Table([[terms_paragraphs]], colWidths=[523.27])
    terms_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(KeepTogether(terms_box))

    # Build document
    doc.build(story, canvasmaker=NumberedCanvas)
    return buffer.getvalue()
