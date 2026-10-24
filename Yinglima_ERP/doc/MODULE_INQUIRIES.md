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
* **Inbound Email Poller:** `app/inquiries/email_inbound_worker.py` (Background IMAP worker)
* **Models:** `app/inquiries/models.py` (`inquiries`, `inquiry_items`, `inquiry_vendor_quotes`, `email_inbound_processed`)

---

## 3. The Inquiry & RFQ Lifecycle

```
[Buyer RFQ Created] ──> [Vendor Quotes Logged] ──> [AI Extraction / Comparison]
                                                           │
[Email / WeChat Sent] <── [Manager Approval] <── [Profit Margins Calculated]
```

---

## 4. Inbound Email Poller & Atomic Database Deduplication

To eliminate duplicate AI quotation extraction and double-billing of OpenAI/Gemini tokens during server restarts or concurrent worker loops:

1. **Relational Deduplication Ledger (`email_inbound_processed`):**
   - Stores processed message IDs, UIDs, and timestamps in PostgreSQL.
   - Guarded by unique constraint on `(message_id, uid, inquiry_id, supplier_id)`.
2. **Deduplication Check Cycle:**
   - Before downloading attachments or sending text to the LLM extraction prompt, the worker queries `SELECT 1 FROM email_inbound_processed WHERE message_id = :mid`.
   - If found, the message is skipped immediately with zero LLM API cost.
3. **Atomic Transaction Insertion:**
   - Insertion into `email_inbound_processed` is committed inside the same transaction that creates the quotation row, preventing race conditions.
4. **30-Minute Historical Baseline:**
   - Upon poller startup, a 30-minute window cutoff (`utcnow() - 30m`) stamps older historical inbox emails into the deduplication ledger so only fresh incoming supplier replies trigger extraction.
5. **Zero-Cost Follow-up Conversations:**
   - First valid supplier quote reply triggers AI parsing (`QT-AUTO-01`).
   - All subsequent replies, delivery discussions, and negotiation emails append to the thread timeline with **0 OpenAI API calls**.

---

## 5. Automated Event Notifications

Whenever a buyer submits or an operator logs a new inquiry:
* **Event Hook:** `inquiry_created`
* **Trigger Payload:** `{ "inquiry_id": inquiry.id, "inquiry_code": inquiry.inquiry_code, "buyer_name": buyer.company_name, "buyer_id": buyer.id }`
* **Notification Delivery:** Real-time in-app notification delivered to sales and procurement coordinators configured in Notification Settings.
* **Direct Navigation:** Clicking the topbar alert navigates directly to `/inquiries/{inquiry_id}`.

---

## 6. What Needs to Be Verified (Testing Checklist)

- [ ] **Creation & Item Entry:**
  - Create an Inquiry for an active Buyer. Add 3 target products with required quantities.
- [ ] **Vendor Quote Comparison:**
  - Enter quotes from 2 different suppliers for the same inquiry item. Verify comparison matrix highlights lowest unit cost.
- [ ] **Approval Workflow Gate:**
  - Verify that only users with `inquiry.approve` permission can click the **Approve Quotation** button.
  - Non-approvers must see the button disabled or hidden.
- [ ] **Quotation Dispatch:**
  - Gated by `inquiry.send_message`. Verify PDF generation and email/wechat dialog.
- [ ] **Email Deduplication Verification:**
  - Restart the backend and verify that `email_inbound_processed` prevents re-extracting previously processed supplier quotes.

---

## 7. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict rules to observe when modifying Inquiries:**

1. **Permission Separation:**
   - Standard sales reps can create and edit inquiries (`inquiry.create`, `inquiry.update`), but only managers can approve quotes (`inquiry.approve`). Never combine these two into a single permission.
2. **Approved Status Lock:**
   - Once an inquiry is marked `APPROVED`, line items and pricing must be locked from accidental editing unless an administrator explicitly resets status to `DRAFT`.
3. **Currency Conversion Consistency:**
   - Always record the exchange rate used at quote creation time so historical quotes remain mathematically immutable when current market rates fluctuate.
4. **Deduplication Integrity:**
   - Never bypass the `email_inbound_processed` lookup; doing so will cause repeated OpenAI GPT calls on every poller loop iteration.

---

## 8. Type-Ahead & Product Master Search Specifications

### Smart Focus Dropdown Handling:
- Product dropdowns format items as `Product Name (Product Code)` (e.g. `FR400 Band Sealer MSH (DAR-00063)`).
- When a user places cursor/focus or clicks on an already-selected product item (`inputValue === label`), the dropdown automatically queries with `""` to display all active master products, highlighting the currently selected product with a green checkmark (`✓`).
- When a user types or pastes a query into the field, the input switches to active search mode (`isUserTyping = true`).
- `productFetcher` automatically detects and strips composite parentheses `(CODE)` or dashes (`CODE — Name`), querying the database by product code or name so pasted labels resolve immediately without "No matches." errors.


