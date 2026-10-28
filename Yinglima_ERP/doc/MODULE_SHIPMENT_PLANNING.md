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

---

## 9. Entity Selection & Sheet Creation Architecture (Release 2026-10-27)

### Problem Addressed
Previously, selecting a Buyer or Organization in the top **Entity** filter dropdown that had no existing planning sheets caused the interface to get stuck on the previous entity's sheet. The previous sheet's ID and URL parameter (`?sheet=...`) remained active, causing URL synchronization effects to repeatedly revert the Entity dropdown back to the previous entity.

### Solution Implemented
1. **Dynamic Entity & URL Clearing (`handleEntityChange`):**
   - Selecting any Buyer or Organization without existing sheets immediately clears `activeSheetId` to `null`, wipes `grid` to `null`, and clears `sheet` and `sheet_id` URL query parameters.
   - Preserves `?buyer=<id>` or `?org=<name>` in the URL, enabling reliable deep-linking and browser refreshes without reverting.
2. **Dedicated Empty State Card with 1-Click Sheet Creation:**
   - When the selected entity has 0 planning sheets, the interface renders a prominent empty state card:
     - Header: *"No Planning Sheet Found for [Buyer / Organization Name]"*
     - Clear description explaining that no planning sheets exist yet for this logistics entity.
     - Action button: **`[ + Create Planning Sheet for [Entity Name] ]`**.
3. **Pre-filled Sheet Creation Modal (`handleOpenAddSheet`):**
   - Clicking either the top `+ Sheet` button or the card's `+ Create Planning Sheet for [Entity Name]` button opens the **Add Sheet (Branch Tab)** modal with the entity type (Buyer Profile vs. Internal Organization) and target ID already pre-selected.
   - For buyers, the branch name field is pre-filled with `"Main"` by default, allowing 1-click creation without tedious manual selection.

---

## 10. Status Picker Double-Click Protection & History Deduplication (Release 2026-10-27)

### Problem Addressed
When changing a cell's status tag (e.g. from Blue to Red Requirement), rapid double-clicking on the status option in the popover sent two concurrent mutation requests within milliseconds (~58ms apart). Both backend transactions evaluated `old_status != new_status` as true simultaneously before commit, inserting two duplicate `CELL_STATUS_CHANGED` records into `planning_change_log` and causing identical consecutive tags to appear in the Cell History popover.

### Multi-Tier Safeguard Solution
1. **Frontend Fast-Lock & Synchronous Dismiss (`Planning.tsx`):**
   - `StatusPicker` component tracks `submitting` state: upon first click, all status buttons are immediately disabled.
   - The popover closes synchronously (`setStatusPicker(null)`) on the initial click event.
   - `pendingStatusCellsRef` guard tracks in-flight requests per `${rowId}:${columnId}` cell, ignoring any duplicate triggers.
2. **Backend No-Op Return & Debounce Window (`app/planning/service.py`):**
   - `set_cell_status` verifies if `old_status == new_status` and `old_custom_tag == new_custom_tag`; if identical, it immediately returns without performing any database write, log insertion, or notification dispatch.
   - Before writing to `planning_change_log`, the service inspects the cell's recent change logs: if an identical status change occurred within the past 3.0 seconds, duplicate logging is suppressed.
3. **History Deduplication (`get_mum_column_status_history_for_row` & `MumHistoryPopover`):**
   - Backend `get_mum_column_status_history_for_row` maintains `last_seen_by_col` tracking: consecutive identical status or value events for the same column are deduplicated before payload transmission.
   - Frontend `groupedEntries` filters out any consecutive changes on the same column with matching status/value occurring within a 5-second interval.
   - Historical duplicate records in PostgreSQL have been purged.

