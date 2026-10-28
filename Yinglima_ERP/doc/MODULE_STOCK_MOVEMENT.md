# Module Guide: Stock Movement (Inward & Outward Register & Live Inventory Ledger)

## 1. Overview
The **Stock Movement** module provides physical warehouse inventory tracking:
- **Inward Receipts (+)**: Incoming goods arriving from domestic vendors via Local Purchase, factory shipments, or warehouse returns.
- **Outward Dispatches (-)**: Shipments leaving the warehouse for buyers via Sale Process orders, sample distributions, or branch transfers.
- **Live Stock Balance Ledger**: Real-time calculated inventory per SKU:
  $$\text{Current In-Stock} = \sum \text{Inward Accepted Qty} - \sum \text{Outward Dispatched Qty}$$
- **Kardex Transaction Ledger**: Chronological transaction history per item showing running balance and linked document references.

---

## 2. Inward & Outward Workflow Architecture

### A. Inward Automation Directly from Local Purchase (Updated 2026-10-24)
> [!IMPORTANT]
> **Manual Inward Button Removed from Stock Movement Page:**
> To eliminate duplicate manual entries and phantom warehouse inventory, the manual `+ New Inward Entry` button in `/inventory/stock-movements` has been removed. All physical inward stock receipts are now initiated strictly from confirmed domestic purchase orders in **Local Purchase** (`/purchases/local`).

1. **Procurement/Warehouse Executive opens Local Purchases** (`/purchases/local`).
2. Locates the confirmed domestic purchase bill (status: `Confirmed`).
3. Clicks **`[📦 Inward Stock]`** directly in the Status column (or selects `📦 Inward to Warehouse` from the `⋮` action menu).
4. System opens the **Local Purchase Inward Modal** (`LocalPurchaseInwardModal.tsx`), pre-populated with:
   - Supplier name and supplier ID.
   - Reference invoice number and date.
   - Warehouse location (defaults to `"Main Godown"`).
   - Goods line items: Product name, expected quantity, default 100% accepted quantity, and unit rates.
5. Executive verifies received quantities, enters any damaged units (`accepted = received - damaged`), transporter name, and vehicle number, then clicks **Confirm Inward Receipt**.
6. The system executes `POST /api/v1/purchases/local/{purchase_id}/inward`, automatically:
   - Creating an official `StockMovement` (type `inward`, slip `INW-YYYY-XXXX`).
   - Crediting warehouse inventory balances on the live ledger.
   - Transitioning Local Purchase status to `Inwarded`.
   - Recording `stock_movement_id` and `stock_movement_number` on the purchase bill.
   - Displaying an emerald `● Inwarded` badge with direct link to the voucher.

### B. Outward Automation Directly from Sales Process (Updated 2026-10-26)
> [!IMPORTANT]
> **Manual Outward Button Removed from Stock Movement Page:**
> In accordance with the system design where Stock Movement acts strictly as a centralized audit ledger, the manual `+ New Outward Entry` button has been removed from `/inventory/stock-movements`. All outward inventory dispatches are now initiated strictly from **Sales Process** (`/sale/process`).

1. **Sales/Warehouse Executive opens Sales Process** (`/sale/process`).
2. Locates an approved export order (status: `admin_approved` or `sales_confirmed`).
3. Clicks **`[📤 Outward / Dispatch Stock]`** directly in the Status column (or selects `📤 Outward / Dispatch Stock` from the `⋮` action menu).
4. System opens the **Sale Process Outward Modal** (`SaleProcessOutwardModal.tsx`), displaying:
   - Buyer name, order number, currency.
   - Movement date (defaults to today) and warehouse location (defaults to `"Main Godown"`).
   - Vehicle number, transporter name, container number.
   - Goods line items: Product name, SKU, requested dispatch quantity, unit rate.
5. Executive clicks **Confirm Outward & Dispatch**.
6. The system executes `POST /api/v1/sales/orders/{id}/dispatch`:
   - **Strict Stock Availability Validation**: Checks available warehouse inventory for each SKU ($\sum \text{Inward} - \sum \text{Outward}$). If any line item exceeds available inventory, dispatch is **strictly blocked** with an immediate error:
     $$\text{"Insufficient stock in warehouse (Available: X, Requested: Y) for 'Product Name (SKU)'. Outward dispatch blocked to prevent negative inventory."}$$
   - **Automated Voucher Generation**: If inventory is sufficient, automatically creates a `StockMovement` (type `outward`, voucher `OUT-YYYY-XXXX`).
   - **Atomic Stock Deduction**: Automatically deducts quantities from the warehouse stock ledger.
   - **Order Lifecycle Update**: Marks Sale Order status as `dispatched` and saves `stock_movement_id` and `stock_movement_number`.
   - **Visual Tracking**: Displays an official purple `● DISPATCHED` badge and clickable link to the outward voucher.


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
    - **Inward Register Tab**: Manual `+ New Inward Entry` button removed; replaced with an automated workflow banner: *"Inward Stock movements are now automatically generated directly from Local Purchases. To inward incoming goods, open Local Purchase and click [📦 Inward Stock]."* and a direct link button **`[📦 Inward from Local Purchase →]`**.
    - **Outward Register Tab**: Retains `+ New Outward Entry` for order dispatches.
  - `StockMovementModal.tsx`: Creation modal for outward movements with 1-click SO extractor and dynamic items grid.
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
