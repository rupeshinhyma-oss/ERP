# Module Guide: Agents & Buyers (`buyers`)

**System:** Yinglima_ERP  
**Module:** Customer & Overseas Buyer Management (`/buyers`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-12  

---

## 1. Overview & Purpose

The **Buyers** module tracks international importers, buying agents, and corporate clients (primarily in India, UAE, and overseas markets). It maintains client profiles, shipping addresses, credit limits, VIP grades (Grade A, B, C), business potential, and historical inquiries.

---

## 2. Key Architecture & File Map

### Frontend:
* **List Page:** [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx) (Route: `/buyers`)
* **Detail Modal / Drawer:** `BuyerDetailModal.tsx`
* **Form Modal:** `BuyerFormModal.tsx` (Create & Edit)
* **Lookups:** `useBuyersLookup()` in `src/lib/lookups.ts`

### Backend:
* **Routes:** [`app/buyers/routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/routes.py)
* **Service:** [`app/buyers/service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/service.py)
* **Schemas:** `app/buyers/schemas.py`
* **Models:** `app/buyers/models.py` (`buyers`, `buyer_contacts`, `buyer_shipping_addresses`)

---

## 3. Data Flow & Cross-Module Dependencies

```
[Buyer Master]
       │
       ├──> Inquiries & Quotations: Buyer receives formal RFQ quotation
       ├──> Sales Process: Buyer is assigned to sales orders and CI sheets
       └──> Shipment Planning: Consignee name and destination port (e.g. Mumbai, Nhava Sheva)
```

---

## 4. What Needs to Be Verified (Testing Checklist)

- [ ] **Buyer Creation:**
  - Create buyer with Company Name, Country (e.g. India), Contact Person, Phone, Email.
- [ ] **Client Grade & Potential:**
  - Check that updating Client Grade (A, B, C) or Potential requires appropriate permissions (`buyer.clientgrade`, `buyer.potential`).
- [ ] **Multiple Shipping Addresses:**
  - Verify adding secondary discharge ports / warehouse delivery addresses.
- [ ] **Soft-Delete Protection:**
  - Verify soft-delete leaves associated historical inquiries and planning rows intact.

---

## 5. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict rules to observe when modifying the Buyers module:**

1. **Permission Chokepoints:**
   - Viewing requires `buyer.view`.
   - Editing special fields (Grade, Potential, Status) is gated by individual fine-grained permissions (`buyer.clientgrade`, `buyer.potential`, `buyer.currentstatus`).
2. **Consignee Consistency:**
   - In Sales Process and Shipment Planning, changing buyer contact details must not retroactively corrupt historical, closed shipment documents.
