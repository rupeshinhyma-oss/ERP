# Module Guide: Shipment Planning & Master Planning Sheet (`planning`)

**System:** Yinglima_ERP  
**Module:** Master Shipment Planning Sheet China to India (`/planning`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-19  

---

## 1. Overview & Purpose

The **Shipment Planning** module replicates, digitizes, and enhances the enterprise Excel "Master Planning Sheet China TO India". It provides an interactive, reactive spreadsheet grid tracking full-container load (FCL) and less-than-container load (LCL) shipments, container numbers, seal numbers, vessels, ETD, ETA, port of discharge, lab test requirements, cargo readiness, and real-time container volume (CBM) utilization.

The module supports dynamic **Multi-Sheet Architecture** allowing separate sheets for each **Operating Organization Branch** (e.g. Inhyma Mumbai, Inhyma Ahmedabad, Inhyma Indore, Inhyma Chennai, Darsh Impex Mumbai, Darsh Impex Chennai, Test Group, One Stop, F&B) and dedicated **Buyer Planning Sheets** (e.g. Om Packaging, Prathamesh Packaging, Darsh Impex Mumbai).

---

## 2. Key Architecture & File Map

### Frontend:
* **Main Planning Sheet Grid:** [`Planning.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Planning.tsx) (Route: `/planning`)
* **Add / Edit Planning Modal:** `PlanningItemModal.tsx`
* **Inline Cell Editor:** `PlanningCellEditor.tsx`
* **Column Filters & View Presets:** `PlanningFilters.tsx`

### Backend:
* **Routes & Endpoints:** [`app/planning/routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/planning/routes.py)
* **Service Engine:** [`app/planning/service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/planning/service.py)
* **Formula Evaluator:** [`app/planning/formula.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/planning/formula.py)
* **Data Models:** [`app/planning/models.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/planning/models.py) (`planning_sheets`, `planning_columns`, `planning_rows`, `planning_cells`)
* **Cell Edit Endpoints:** `PATCH /api/v1/planning/sheets/{sheet_id}/cells`

---

## 3. Master Product Linkage ("Extract From") & Auto-Population

In Shipment Planning, the primary row item represents a product from the central Product Master. When a row is linked to a product, 5 key packaging and supplier columns are automatically populated via live **`LINKED_LOOKUP`**:

| Sheet Column Name | Source Module | Source Field in Product Master | Purpose & Format |
| :--- | :--- | :--- | :--- |
| **`Brand of Supplier`** | `product` | `supplier_name` | Name of the primary manufacturing vendor / supplier |
| **`City` / `Supplier City`** | `product` | `supplier_city` | Origin city of the supplier in China |
| **`PKG QTY`** | `product` | `packaging_quantity` | Units packed per carton/box |
| **`UNIT WEIGHT/PKG (KG)`** | `product` | `packaging_gross_weight` | Gross weight per packed carton in kilograms |
| **`CBM/PKG (KG)`** | `product` | `packaging_unit_cbm` | Volumetric cubic meters per carton ($\text{m}^3$) |

### High-Performance Batch Prefetch & Read-Time Fallback Architecture
- **Zero-Latency Grid Read ([`backend/app/planning/routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/planning/routes.py)):**
  - When a user views any planning sheet (e.g. `Inhyma Mumbai`), the grid endpoint `/api/v1/planning/sheets/{sheet_id}/grid` executes a single optimized batch query prefetching all linked product records (`Product`) along with primary supplier branding.
  - If a cell record for `PKG QTY`, `UNIT WEIGHT/PKG (KG)`, `CBM/PKG (KG)`, `Brand of Supplier`, or `City` is missing from `planning_cells` or has a null/empty value, the backend immediately resolves it from the prefetched Product Master data.
  - **Formula Read Fallback:** If a companion formula cell (`NO. OF PKG <LABEL><N>`, `TOTAL WEIGHT <LABEL><N>`, `TOTAL CBM <LABEL><N>`) has no persisted value, the endpoint evaluates it dynamically on-the-fly using the consignment quantity and packaging dimensions.
  - **UI Value Consistency:** Sets both `display_value` and `value` in the response payload, ensuring that the frontend grid cell renderer never encounters empty packaging fields for valid Product Master items.

### Data Isolation & Primary Supplier Guarantee
- **Organization Branch Sheets:** Rows strictly filter products by `organization_id` and `branch_id`. Products only display if they are explicitly assigned to that organization's branch in Product Master.
- **Buyer Sheets:** Products extract master packaging dimensions for that specific buyer's shipment plan.
- **Strict Primary Supplier Rule:** `Brand of Supplier` (`supplier_name`) and `City` (`supplier_city`) strictly resolve only from the primary supplier directly configured in Product Master (`Product.supplier_id`). If a product does not belong to any supplier in Product Master (`supplier_id` is None / empty), it shows a blank entry in Shipment Planning. Even if other suppliers link that product in Supplier Master (`SupplierProductLink`), those secondary links are strictly ignored, ensuring no incorrect or unassigned suppliers leak into planning sheets.

### Unified Sheet Column Layout Specification
Every planning sheet across all organizations (Inhyma Mumbai, Inhyma Ahmedabad, Inhyma Indore, inhyma chennai, Chennai, F&B, One Stop, etc.) and buyers (Om Packaging, Prathamesh Packaging, Darsh Impex, etc.) strictly follows a standard, non-duplicate column structure:
1. **System & Date Headers:** `TEST(Y/N)`, `APPROVAL DATE`.
2. **Consignment Input & Remarks Columns:** For each consignment group $N$ (`<Label> <N>` and `<Label><N> Remarks`). Hyphenated and leading-zero formats (e.g., `MP -06`, `GJ14`, `Mum 48`) are dynamically supported.
3. **Shared Linked Specification Block:** Exactly 5 `LINKED_LOOKUP` columns (`Brand of Supplier`, `City` / `Supplier City`, `PKG QTY`, `UNIT WEIGHT/PKG (KG)`, `CBM/PKG (KG)`). No duplicate manual columns are permitted.
4. **Consignment Companion Formulas:** For every consignment group $N$, exactly 3 computed formulas:
   - `NO. OF PKG <LABEL><N>`
   - `TOTAL WEIGHT <LABEL><N>`
   - `TOTAL CBM <LABEL><N>`
5. **Status Column:** `TALLY ENTRY POSTED (Y/N)`.

---

## 4. Automated Formula Columns & Evaluation

Shipment Planning features a native mathematical formula engine supporting dynamic multi-stage calculation groups (e.g. `MUM`, `MUMDARSH`, `CHEN`, `INHYMA CHENNAI`):

1. **Number of Packages (`NO. OF PKG <GROUP><n>`)**:
   $$\text{NO. OF PKG} = \frac{[\text{Group Qty}]}{[\text{PKG QTY}]}$$
   *Evaluates the total number of cartons required for the shipment quantity.*

2. **Total Gross Weight (`TOTAL WEIGHT <GROUP><n>`)**:
   $$\text{TOTAL WEIGHT} = [\text{NO. OF PKG}] \times [\text{UNIT WEIGHT/PKG (KG)}]$$
   *Evaluates the total weight in kilograms.*

3. **Total Volume (`TOTAL CBM <GROUP><n>`)**:
   $$\text{TOTAL CBM} = [\text{NO. OF PKG}] \times [\text{CBM/PKG (KG)}]$$
   *Evaluates the container volumetric load in cubic meters.*

### Key Engine Features:
- **Dependency Resolution:** Formula engine detects dependencies (`TOTAL WEIGHT` depends on `NO. OF PKG`) and evaluates columns in topological order.
- **Store-on-Write:** Formula results are evaluated and stored in `planning_cells`, while dynamic re-computation runs on read to guarantee instant synchronization.
- **Empty / Null Safety:** If any factor is blank, 0, or missing, the formula safely outputs null/empty without raising `ZeroDivisionError` or invalid `NaN`.

---

## 5. UI Layout, Column Resizing & 80% Zoom Optimization

To support high-density logistics dashboards with 20+ columns:
1. **Excel-Style Drag-to-Resize on All Columns:**
   - **Regular Columns:** Users drag the right-border handle on any column header (`ColumnHeader`) to expand or shrink width, clamped between 64px and 320px (persisted to `planning_columns.width_px`).
   - **First Column ("ITEM" / Product Identity Column):**
     - Fully resizable via right-edge drag handle with live visual feedback (`col-resize` cursor, active blue highlight).
     - Driven by dynamic CSS variable `--item-col-width` applied across table wrapper, `EditableItemHeader`, `EditableRowLabel`, and skeleton rows for instantaneous 0-lag resizing.
     - Automatically recalculates `stickyLeft` offsets for subsequent frozen columns (`TEST(Y/N)`, `APPROVAL DATE`, user-pinned columns) so they slide in lockstep without overlap.
     - Persists server-side via `planning_sheets.item_width_px` (`PATCH /api/v1/planning/sheets/{sheet_id}/item-width`) clamped between 64px and 800px (defaults to 240px when uncustomized).
     - Broadcasts live WebSocket event `item_width_changed` so multi-user sessions stay synchronized without page refreshes.
2. **Auto-Fit Container Width:** Table wrapper uses fluid `width: "100%"`, `maxWidth: "100%"`, and `overflowX: "auto"`.
3. **Action Column Visibility:** The right-hand Action column is locked and pinned with flexible auto-fit so that at 80% or 100% zoom levels, Edit and Delete action buttons remain fully visible and never clip outside the viewport.
4. **Wrap-Text Headers:** Header titles use `whiteSpace: "normal"` and responsive column widths, preventing text truncation or header overflow.

---

## 6. Dynamic Column Permissions

| Permission Code | Purpose & Action |
| :--- | :--- |
| `planning.view` | View the planning grid and container summaries |
| `planning.column.manage` | Add, delete, rename, reorder, or resize columns (including ITEM column drag-to-resize) |
| `planning.create` | Add a new sheet or shipment line item |
| `planning.update` | General line item editing (quantities, dates, container numbers) |
| `planning.textyn.edit` | Specifically toggle the `TEST(Y/N)` lab certification flag |
| `planning.approvaldate.edit` | Specifically modify the shipment `APPROVAL DATE` column |
| `planning.colorstatusred.edit` | Set shipment alert status to **RED** (Delayed / Quality Issue) |
| `planning.colorstatusgreen.edit` | Set shipment status to **GREEN** (Cleared for Loading / Released) |

---

## 7. What Needs to Be Verified (Testing Checklist)

- [ ] **First Column ("ITEM") Drag-to-Resize:**
  - Hover over the right edge of the first column ("ITEM") header.
  - Verify cursor turns into `col-resize` with a 5px grab handle.
  - Click and drag horizontally to widen or narrow the column.
  - Verify all row cells and skeleton placeholders resize smoothly in real-time.
  - Verify subsequent frozen columns (`TEST(Y/N)`, `APPROVAL DATE`) adjust their sticky left positions smoothly without jumping.
  - Refresh the browser; verify the resized width persists accurately from `planning_sheets.item_width_px`.
- [ ] **Real-Time Recalculation on Quantity Change:**
  - Change input quantity on a group column (e.g. `Mum 48`).
  - Verify `NO. OF PKG MUM48`, `TOTAL WEIGHT MUM48`, and `TOTAL CBM MUM48` immediately update.
- [ ] **Linked Lookup Auto-Population:**
  - Add a product to a sheet.
  - Verify Brand of Supplier, City, PKG QTY, Unit Weight, and CBM auto-populate from Product Master.
- [ ] **Zoom & Responsiveness:**
  - Zoom browser to 80%.
  - Verify table fits cleanly with horizontal scrolling and Action buttons remain inside the table frame.
- [ ] **Event Triggering:**
  - Create or update an urgent requirement. Verify notification rule `shipment_requirement_raised` fires to configured recipients.

---

## 8. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict rules to observe when modifying Shipment Planning:**

1. **Inline Patch Endpoint Granularity:**
   - Always update cells via cell-level endpoints (`PATCH /sheets/{id}/cells`). Never overwrite entire sheets or rows, as multiple operators concurrently edit logistics data.
2. **Formula Rounding Integrity:**
   - Package quantities must evaluate to exact decimals without truncating fractional cartons.
3. **Product Master Isolation:**
   - Do not break the foreign key or name link to `Product`; linked lookup columns depend on `Product.product_name` and `Product.id`.
