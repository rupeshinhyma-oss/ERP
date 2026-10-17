# Module Guide: Shipment Planning & Master Planning Sheet (`planning`)

**System:** Yinglima_ERP  
**Module:** Master Shipment Planning Sheet China to India (`/planning`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-12  

---

## 1. Overview & Purpose

The **Shipment Planning** module replicates and enhances the enterprise Excel "Master Planning Sheet China TO India". It tracks full-container load (FCL) and less-than-container load (LCL) shipments, container numbers, seal numbers, vessels, ETD, ETA, port of discharge, lab test requirements, approval dates, cargo readiness, and real-time container volume (CBM) utilization.

---

## 2. Key Architecture & File Map

### Frontend:
* **Main Planning Sheet Grid:** `Planning.tsx` (Route: `/planning`)
* **Add / Edit Planning Modal:** `PlanningItemModal.tsx`
* **Inline Editable Cells:** `PlanningCellEditor.tsx`
* **Column Filters & View Presets:** `PlanningFilters.tsx`

### Backend:
* **Routes:** `app/planning/routes.py`
* **Service:** `app/planning/service.py`
* **Cell Edit Endpoints:** `PATCH /api/v1/planning/items/{id}/cell`
* **Models:** `app/planning/models.py` (`planning_sheets`, `planning_items`)

---

## 3. Dynamic Container Status & Column Permissions

Shipment Planning features fine-grained column-level and color-level permissions:

| Permission Code | Purpose & Action |
| :--- | :--- |
| `planning.view` | View the planning grid and container summaries |
| `planning.create` | Add a new shipment planning line item |
| `planning.update` | General line item editing (dates, container numbers, vessel) |
| `planning.textyn.edit` | Specifically toggle the `TEST(Y/N)` lab certification flag |
| `planning.approvaldate.edit` | Specifically modify the shipment `APPROVAL DATE` column |
| `planning.colorstatusred.edit` | Set shipment alert status to **RED** (Delayed / Quality Issue) |
| `planning.colorstatusgreen.edit` | Set shipment status to **GREEN** (Cleared for Loading / Released) |

---

## 4. What Needs to Be Verified (Testing Checklist)

- [ ] **Real-Time Recalculation on Quantity Change:**
  - When changing `Qty`, the grid must immediately recalculate:
    - $\text{Total Cartons} = \text{Qty} / \text{Pkg Ratio}$
    - $\text{Total Gross Weight} = \text{Total Cartons} \times \text{Weight per Carton}$
    - $\text{Total CBM} = \text{Total Cartons} \times \text{CBM per Carton}$
- [ ] **Container Capacity Limits:**
  - 20ft Container target: ~28–30 CBM
  - 40ft High Cube (40HQ) target: ~65–68 CBM
  - Verify container summary card updates total loaded CBM as items are assigned.
- [ ] **Column-Level Permission Gating:**
  - A user with only `planning.view` cannot edit cells.
  - A user without `planning.colorstatusred.edit` cannot change status color to Red.

---

## 5. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict rules to observe when modifying Shipment Planning:**

1. **Inline Patch Endpoint Granularity:**
   - When updating a single cell (e.g. `TEST(Y/N)`), the frontend calls `PATCH /api/v1/planning/items/{id}/cell`. Do not replace this with a full-row overwrite, as other logistics coordinators may be simultaneously updating container numbers or ETD.
2. **Formula Rounding Integrity:**
   - Package quantities (cartons) must evaluate to exact decimals or whole units without truncating fractional cartons.
3. **Date Formats:**
   - ETD, ETA, and Approval Dates must strictly follow ISO `YYYY-MM-DD` format across API requests to prevent timezone off-by-one errors.
