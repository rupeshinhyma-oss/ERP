# Module Guide: Stock Movement (Inward & Outward Register & Live Inventory Ledger)

## 1. Overview
The **Stock Movement** module provides physical warehouse inventory tracking:
- **Inward Receipts (+)**: Incoming goods arriving from domestic vendors via Local Purchase, factory shipments, or warehouse returns.
- **Outward Dispatches (-)**: Shipments leaving the warehouse for buyers via Sale Process orders, sample distributions, or branch transfers.
- **Live Stock Balance Ledger**: Real-time calculated inventory per SKU:
  $$\text{Current In-Stock} = \sum \text{Inward Accepted Qty} - \sum \text{Outward Dispatched Qty}$$
- **Kardex Transaction Ledger**: Chronological transaction history per item showing running balance and linked document references.

---

## 2. 1-Click Extraction System

### A. Inward 1-Click Extract from Local Purchase
1. Executive opens **New Inward Entry** and selects **⚡ 1-Click Extract from Local Purchase**.
2. Selects a confirmed Local Purchase Invoice (e.g., `INV-2026-0045`).
3. System calls `GET /api/v1/stock/extract/purchase/{purchase_id}` and automatically populates:
   - Supplier name and supplier ID.
   - Reference bill number and date.
   - Consignment code.
   - Line items: Product name, product code/SKU, expected quantity, unit rate.
4. Executive enters **Actual Received Qty** and **Damaged Qty**. Accepted net quantity is automatically computed:
   $$\text{Accepted Qty} = \text{Received Qty} - \text{Damaged Qty}$$

### B. Outward 1-Click Extract from Sale Process
1. Executive opens **New Outward Entry** and selects **⚡ 1-Click Extract from Sale Process**.
2. Selects a confirmed Sale Order (e.g., `SO-2026-0012`).
3. System calls `GET /api/v1/stock/extract/sale-order/{sale_order_id}` and automatically populates:
   - Buyer/Customer name and buyer ID.
   - Reference order number and date.
   - Container number, transporter name, LR number.
   - Consignment code.
   - Line items: Product name, SKU, expected quantity, unit rate.
4. Executive confirms or adjusts dispatched quantity and package details (e.g., 20 boxes).

---

## 3. Database Schema

### Table: `stock_movements`
- `id`: UUID (Primary Key)
- `movement_no`: VARCHAR(50), Unique (e.g. `INW-2026-0001`, `OUT-2026-0001`)
- `movement_type`: VARCHAR(20) (`inward` | `outward`)
- `movement_date`: DATE
- `status`: VARCHAR(30) (`confirmed` | `cancelled` | `draft`)
- `source_type`: VARCHAR(30) (`local_purchase` | `sale_process` | `direct`)
- `purchase_id`: UUID, FK to `local_purchases.id` (nullable, ondelete SET NULL)
- `purchase_invoice_no`: VARCHAR(100) (nullable)
- `sale_order_id`: UUID, FK to `sales_orders.id` (nullable, ondelete SET NULL)
- `sale_order_no`: VARCHAR(100) (nullable)
- `supplier_id`: UUID, FK to `suppliers.id` (nullable)
- `supplier_name`: VARCHAR(200) (nullable)
- `buyer_id`: UUID, FK to `buyers.id` (nullable)
- `buyer_name`: VARCHAR(200) (nullable)
- `reference_no`: VARCHAR(100) (Vendor Challan / Gate Pass / LR No)
- `warehouse_location`: VARCHAR(150)
- `vehicle_no`: VARCHAR(100)
- `transporter_name`: VARCHAR(150)
- `container_no`: VARCHAR(100)
- `total_quantity`: NUMERIC(14, 2)
- `total_items_count`: INTEGER
- `remarks`: TEXT
- `created_by_id`: UUID, FK to `users.id`
- `created_by_name`: VARCHAR(150)
- `deleted_at`: TIMESTAMPTZ (Soft delete)
- `created_at`, `updated_at`: TIMESTAMPTZ

### Table: `stock_movement_items`
- `id`: UUID (Primary Key)
- `movement_id`: UUID, FK to `stock_movements.id` (ondelete CASCADE)
- `product_id`: UUID, FK to `products.id` (nullable, ondelete SET NULL)
- `product_name`: VARCHAR(255)
- `product_code`: VARCHAR(100)
- `expected_quantity`: NUMERIC(12, 2)
- `quantity`: NUMERIC(12, 2) (Actual received or dispatched)
- `damaged_quantity`: NUMERIC(12, 2) (Defective in transit)
- `accepted_quantity`: NUMERIC(12, 2) (Net inventory effect = `quantity - damaged_quantity`)
- `unit_rate`: NUMERIC(15, 2)
- `package_details`: VARCHAR(150)
- `remarks`: TEXT
- `created_at`, `updated_at`: TIMESTAMPTZ

---

## 4. API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/stock/metrics` | Dashboard KPI summary (Inward units, Outward units, Net stock) |
| `GET` | `/api/v1/stock/movements` | List Inward or Outward movements with search, date range, pagination |
| `POST` | `/api/v1/stock/movements` | Create a confirmed Inward or Outward stock movement |
| `GET` | `/api/v1/stock/movements/{id}` | Full movement details with line items |
| `POST` | `/api/v1/stock/movements/{id}/cancel` | Cancel movement and reverse inventory balance |
| `GET` | `/api/v1/stock/extract/purchase/{id}` | 1-Click extract from Local Purchase order |
| `GET` | `/api/v1/stock/extract/sale-order/{id}` | 1-Click extract from Sale Process order |
| `GET` | `/api/v1/stock/balances` | Live stock balances grouped by product/SKU |
| `GET` | `/api/v1/stock/kardex` | Chronological transaction ledger for a specific item |

---

## 5. Frontend Navigation & Pages
- **Sidebar Route**: `INVENTORY` $\rightarrow$ `Stock Movement` (`/inventory/stock-movements`)
- **Components**:
  - `StockMovements.tsx`: Master tabbed view (Inward Register, Outward Register, Current Stock Ledger) + KPI metrics.
  - `StockMovementModal.tsx`: Creation modal with 1-click PO/SO extractor and dynamic items grid.
  - `StockMovementDetailModal.tsx`: Read-only receipt and dispatch voucher inspection.
  - `ProductKardexModal.tsx`: Running balance history drawer for any inventory item.

---

## 6. Ergonomic Modal Layout & High-Visibility Table Scrollbar
- **Live Searchable Combobox**: Replaced native HTML `<select>` with an instantaneous search combobox. Operators can search across dozens of orders by typing purchase bill #, vendor name, sale order #, buyer name, or container number.
- **Compact 4-Column Header Grid**: Metadata fields (`Date`, `Party Name`, `Challan/LR No`, `Warehouse`, `Vehicle No`, `Transporter`, `Container`, `Remarks`) are condensed into a sleek 2-row, 4-column layout saving over 150px of vertical height.
- **High-Visibility Custom Scrollbar & Stable Gutter**: Both the modal body and the Goods Line Items table incorporate custom styled high-contrast slate scrollbars (`.stock-modal-scroll`, `.stock-table-scroll` with `#94a3b8` thumb and `#f1f5f9` track) with `scrollbar-gutter: stable`, ensuring scrollbars are always visually prominent on Windows/Chrome.
- **Streamlined 8+ Item Direct Viewport**:
  - Removed duplicate inner total footer from Card 2, leaving the single pinned bottom modal bar as the clean source of truth.
  - Streamlined table cell padding (`6px 8px` cell padding, `5px 8px` inputs) and sticky table header (`thead sticky`), allowing 8 to 10 product items to fit directly on screen on standard desktop/laptop displays without cutoff, with buttery smooth scrolling when handling dozens of items.
- **Fixed Modal Footer**: Bottom actions (`Cancel`, `Total Qty Counter`, `Confirm & Record Movement`) are pinned at the bottom of the modal window, preventing them from scrolling out of sight.

---

## 7. Strict Outward Inventory Blocking (Anti-Negative Stock Safeguard)

### A. Business Rule: Zero Tolerance for Negative Inventory
In physical manufacturing, machinery assembly, and trade distribution, negative stock (e.g. `-9` or `-10` units) is an operational impossibility. To ensure inventory integrity, financial accounting accuracy, and prevent erroneous client dispatches:
1. **Server-Side Enforcement**: `POST /api/v1/stock/movements` strictly checks current available stock for every line item before allowing an outward dispatch:
   $$\text{Available Stock} = \sum \text{Inward Accepted Qty} - \sum \text{Outward Dispatched Qty}$$
   Across all confirmed, non-deleted movements. If $\text{Requested Outward Qty} > \text{Available Stock}$, the API immediately blocks the movement with a `400 Bad Request`:
   > *"Insufficient Stock for '<Product Name>'. Available stock in warehouse is X units, but requested outward dispatch is Y units. Outward dispatch blocked to prevent negative inventory."*
2. **Multi-Line Aggregation Check**: If the same product is listed multiple times across different line items in a single dispatch voucher, the quantities are aggregated first before validating against warehouse balance.
3. **Inward Cancellation & Deletion Safeguard**:
   - When attempting to cancel (`POST /movements/{id}/cancel`) or delete (`DELETE /movements/{id}`) an inward receipt, the system verifies that current warehouse stock is greater than or equal to the inward accepted quantity.
   - If stock has already been dispatched against those inward units, cancellation/deletion is blocked to prevent driving stock into the negative.
4. **Permanent Delete Action**:
   - `DELETE /api/v1/stock/movements/{id}` allows authorized users to permanently remove erroneous or test movements.
   - Added a red **Delete** action button in the Inward & Outward registers with a confirmation dialog.
5. **Real-Time Client-Side Feedback**:
   - When preparing an Outward dispatch in `StockMovementModal`, each product displays a live badge: `In-Stock: X units`.
   - If the user types a quantity exceeding available stock, the input immediately turns red (`1.5px solid #ef4444` with light pink background), displays `⚠️ Blocked: Exceeds warehouse stock!`, and locks the submit button to `🚫 Blocked: Insufficient Stock`.

---

## 8. Complete Cascading Reset, 0-Item Clean Empty-State & Modal Lifecycle
- **Unmount-on-Close & Auto-Reset on Open**: The creation modal is conditionally mounted in `StockMovements.tsx` (`{isModalOpen && <StockMovementModal ... />}`) and executes `resetForm()` upon opening, closing, or cancelling. This guarantees the modal opens 100% blank and fresh every time, eliminating leftover data from previous entries.
- **Initial 0-Item Clean State (No Ghost Rows)**:
  - In **⚡ 1-Click Extract** mode (for both Inward and Outward), `items` defaults to an empty list (`[]`).
  - Section 2 displays **`2. GOODS LINE ITEMS (0 items)`** with a centered empty-state banner:
    > *"No purchase bill [or sale order] selected yet. Search and select a confirmed purchase bill above to auto-extract line items, or click '+ Add Item' above to add products manually."*
  - This eliminates the confusion of displaying a blank ghost row (`(1 ITEMS)`) before an order has even been selected.
- **Cascading Reset on Order Clear (✕)**:
  - In the 1-Click extraction search bar, clicking the `✕` clear button immediately executes `handleClearSelectedOrder()`, wiping the selected purchase bill/sale order ID, clearing party/challan/logistics fields, and resetting the line items table back to **0 items** (`items = []`).
- **Entry Mode Switching**:
  - Toggling from 1-Click Extract to **✍️ Direct Manual Entry** clears any linked order and automatically prepares **1 clean blank item row** (`items = [createEmptyItem()]`) so the user can begin typing immediately.
  - Toggling back to 1-Click Extract resets the selection and returns `items` to **0 items**.
- **Item Removal & Submit Lock**:
  - All rows can be individually removed using the row `✕` button. Removing all rows safely displays the empty-state banner.
  - The submit button is strictly disabled with a grayed-out state (`#94a3b8`) and `cursor: not-allowed` whenever `items.length === 0`, completely preventing accidental submission of empty movements.
- **Reset on Submit**: Upon successful creation of an Inward or Outward voucher, all form state is immediately wiped clean prior to closing the modal.
