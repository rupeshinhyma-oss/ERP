# Module Guide: Inquiries, RFQs & Quotations (`inquiries`)

**System:** Yinglima_ERP  
**Module:** Inquiries & Quotation Lifecycle (`/inquiries`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-12  

---

## 1. Overview & Purpose

The **Inquiries** module governs the customer quoting lifecycle: receiving buyer RFQs, comparing multi-vendor factory quotes, running AI bill/quote extraction, generating proforma invoices, manager approval workflows, and sending finalized quotations to buyers via Email or WeChat.

---

## 2. Key Architecture & File Map

### Frontend:
* **List Page:** `Inquiries.tsx` (Route: `/inquiries`)
* **Detail & Quotation Builder:** `InquiryDetail.tsx` (Route: `/inquiries/:id`)
* **RFQ Comparison Modal:** `RfqComparisonModal.tsx`
* **AI Quote Extractor Widget:** `AiQuotationExtractor.tsx`

### Backend:
* **Routes:** `app/inquiries/routes.py`
* **Service:** `app/inquiries/service.py`
* **AI Extraction Worker:** `app/inquiries/extractor.py` (LLM-driven parser)
* **Models:** `app/inquiries/models.py` (`inquiries`, `inquiry_items`, `inquiry_vendor_quotes`)

---

## 3. The Inquiry & RFQ Lifecycle

```
[Buyer RFQ Created] ──> [Vendor Quotes Logged] ──> [AI Extraction / Comparison]
                                                           │
[Email / WeChat Sent] <── [Manager Approval] <── [Profit Margins Calculated]
```

---

## 4. What Needs to Be Verified (Testing Checklist)

- [ ] **Creation & Item Entry:**
  - Create an Inquiry for an active Buyer. Add 3 target products with required quantities.
- [ ] **Vendor Quote Comparison:**
  - Enter quotes from 2 different suppliers for the same inquiry item. Verify comparison matrix highlights lowest unit cost.
- [ ] **Approval Workflow Gate:**
  - Verify that only users with `inquiry.approve` permission can click the **Approve Quotation** button.
  - Non-approvers must see the button disabled or hidden.
- [ ] **Quotation Dispatch:**
  - Gated by `inquiry.send_message`. Verify PDF generation and email/wechat dialog.

---

## 5. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict rules to observe when modifying Inquiries:**

1. **Permission Separation:**
   - Standard sales reps can create and edit inquiries (`inquiry.create`, `inquiry.update`), but only managers can approve quotes (`inquiry.approve`). Never combine these two into a single permission.
2. **Approved Status Lock:**
   - Once an inquiry is marked `APPROVED`, line items and pricing must be locked from accidental editing unless an administrator explicitly resets status to `DRAFT`.
3. **Currency Conversion Consistency:**
   - Always record the exchange rate used at quote creation time so historical quotes remain mathematically immutable when current market rates fluctuate.
