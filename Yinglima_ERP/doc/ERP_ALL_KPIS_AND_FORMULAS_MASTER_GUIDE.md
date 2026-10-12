# Yinglima ERP — Master KPI & Formula Guide

**System:** Yinglima ERP (China Procurement, Export Engine & Supply Chain Logistics)  
**Target Audience:** Operators, Accountants, Sales Managers, Logistics Coordinators, System Admins  
**File Location:** `D:\Downloads\ERP_ALL_KPIS_AND_FORMULAS_MASTER_GUIDE.md`

---

## Table of Contents
1. [Executive Summary & KPI Classification](#1-executive-summary--kpi-classification)
2. [Sale Process Module KPIs (7 Status Cards & 16-Column Export Engine)](#2-sale-process-module-kpis)
3. [Local Purchase Module KPIs (Procurement & Expense Allocation)](#3-local-purchase-module-kpis)
4. [Inquiries & RFQ Module KPIs (Pipeline & Inquiry Summaries)](#4-inquiries--rfq-module-kpis)
5. [Product Prices & Trade History 360° KPIs](#5-product-prices--trade-history-360-kpis)
6. [Shipment Planning & Logistics KPIs (Container Utilization & Math Engine)](#6-shipment-planning--logistics-kpis)
7. [Product Master & Packaging Volume KPIs](#7-product-master--packaging-volume-kpis)
8. [Suppliers & Buyers Master KPIs](#8-suppliers--buyers-master-kpis)
9. [Quick Reference Cheat Sheet of All Formulas](#9-quick-reference-cheat-sheet-of-all-formulas)

---

## 1. Executive Summary & KPI Classification

Every metric and Key Performance Indicator (KPI) in Yinglima ERP is designed to answer three critical operational questions in real time:
1. **Financial Health:** What is our exact profit margin, revenue, and factory payment liability?
2. **Operational Velocity:** Where is an order stuck in the workflow (Pending, Confirmed, Approved, Dispatched)?
3. **Logistics Optimization:** How full is the shipping container, and how are shipping expenses distributed per item?

---

## 2. Sale Process Module KPIs

The Sale Process module features two layers of KPIs:
1. **The 7 Lifecycle Status KPI Cards** on the top of the Sales Order List (`SaleProcessList.tsx`).
2. **The 16-Column Commercial Invoice Financial & Costing KPIs** inside the Sales Order Form (`SaleProcessForm.tsx`).

### 2.1 The 7 Lifecycle Status KPI Cards

These cards follow the **Darsh Impex Pattern**, tracking both **count of orders** and **total monetary value** in real-time.

```
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
│     ALL      │  │   PENDING    │  │ SALES CONFIRMED  │  │  ADMIN APPROVED  │
│  Count & $   │  │  Count & $   │  │    Count & $     │  │    Count & $     │
└──────────────┘  └──────────────┘  └──────────────────┘  └──────────────────┘
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│  DISPATCHED  │  │      LR      │  │    CANCELLED     │
│  Count & $   │  │  Count & $   │  │    Count & $     │
└──────────────┘  └──────────────┘  └──────────────────┘
```

#### KPI 2.1.1: ALL Orders
- **Formula:**
  $$\text{Count}_{\text{ALL}} = \sum \text{All Sales Orders}$$
  $$\text{Amount}_{\text{ALL}} = \sum \text{Total Amount of All Active Orders}$$
- **Example:** $42\text{ Orders}$, Totaling $\$ 584,200.00\text{ USD}$

#### KPI 2.1.2: PENDING
- **Meaning:** Draft orders newly created or awaiting commercial review.
- **Formula:**
  $$\text{Count}_{\text{PENDING}} = \sum \text{Orders with status } \mathbf{'pending'}$$
  $$\text{Amount}_{\text{PENDING}} = \sum_{\text{status}=\mathbf{'pending'}} \text{Order Total Amount}$$

#### KPI 2.1.3: SALES CONFIRMED
- **Meaning:** Buyer has formally accepted the quote, prices locked by sales executive.
- **Formula:**
  $$\text{Count}_{\text{CONFIRMED}} = \sum \text{Orders with status } \mathbf{'sales\_confirmed'}$$

#### KPI 2.1.4: ADMIN APPROVED
- **Meaning:** Finance/Admin verified payment terms and factory costing; green-lit for Local Purchase procurement.
- **Formula:**
  $$\text{Count}_{\text{APPROVED}} = \sum \text{Orders with status } \mathbf{'admin\_approved'}$$

#### KPI 2.1.5: DISPATCHED
- **Meaning:** Cargo has been handed over to freight forwarder or loaded into containers.
- **Formula:**
  $$\text{Count}_{\text{DISPATCHED}} = \sum \text{Orders with status } \mathbf{'dispatched'}$$

#### KPI 2.1.6: LR (Lorry Receipt / Logistics Documentation)
- **Meaning:** Transport receipt generated, container tracking number or airway bill active.
- **Formula:**
  $$\text{Count}_{\text{LR}} = \sum \text{Orders with status } \mathbf{'lr'}$$

#### KPI 2.1.7: CANCELLED
- **Meaning:** Voided or aborted transactions (excluded from active turnover).
- **Formula:**
  $$\text{Count}_{\text{CANCELLED}} = \sum \text{Orders with status } \mathbf{'cancelled'}$$

---

### 2.2 Commercial Invoice 16-Column Export Engine Formulas

This is the exact financial engine defined in `doc/Yinglima_CI_Inhyma_YL-EXP2026-54.xlsx`.

| Column | Name | Mathematical Formula |
| :---: | :--- | :--- |
| **Col 5** | `Quantity` | User input order quantity ($Q$) |
| **Col 8** | `Unit Price (RMB) Incl. VAT` | $\text{Local Purchase Basic Rate} \times (1 + \text{VAT\%} / 100)$ |
| **Col 9** | `Unit Price (RMB) Excl. VAT` | $\text{Col 8} / (1 + \text{Refund VAT\%} / 100)$ |
| **Col 10** | `Including Profit X%` | $\text{Col 9} \times (1 + \text{Profit Margin\%} / 100)$ |
| **Col 11** | `FOB Price (USD)` | $\text{Col 10} / \text{USD Conversion Rate}$ |
| **Col 12** | `Freight, Local charges, COC` | $\left(\frac{\text{Total Container Freight \& Charges}}{\text{Total Container CBM}}\right) \times \left(\frac{\text{Line Total CBM}}{\text{Quantity}}\right)$ |
| **Col 13** | `CFR Price / Unit (USD)` | $\text{ROUNDUP}(\text{Col 11} + \text{Col 12}, 2)$ |
| **Col 6** | `Unit Price (USD)` | In standard export mode: $\text{Col 6} = \text{Col 13}$ |
| **Col 7** | `Total Amount (USD)` | $\text{Col 6} \times \text{Col 5}$ |
| **Col 15** | `Total Line CBM (m³)` | $\text{Packaging Unit CBM} \times \text{CEILING}(Q / \text{PkgQty})$ |
| **Col 16** | `Total Supplier Amount (RMB)`| $\text{Col 8} \times \text{Col 5}$ |

#### KPI 2.2.1: Gross Profit Amount (USD)
$$\text{Gross Profit (USD)} = \sum \text{Col 7 (Total USD Received)} - \left(\frac{\sum \text{Col 16 (Total Factory RMB)}}{\text{USD Conversion Rate}} + \text{Total Freight Incurred}\right)$$

#### KPI 2.2.2: Gross Profit Margin (%)
$$\text{Gross Margin (\%)} = \left(\frac{\text{Gross Profit (USD)}}{\text{Total Sales Revenue (USD)}}\right) \times 100$$
- **Target Benchmark:** Standard export margin is $3.00\% - 8.50\%$.

---

## 3. Local Purchase Module KPIs

The Local Purchase module manages domestic Chinese procurement, factory VAT invoicing (13%), and landing expense distribution.

### 3.1 The 3 Top Stat Cards (`LocalPurchases.tsx`)

#### KPI 3.1.1: Total Domestic Purchases
- **Meaning:** Total count of purchase bills created across all Chinese suppliers.
- **Formula:**
  $$\text{Total Domestic Purchases} = \text{COUNT}(\text{Local Purchase Bills})$$

#### KPI 3.1.2: Current Page Total Landing Value (¥)
- **Meaning:** Total landed cost (Factory goods + domestic logistics + handling) for currently filtered view.
- **Formula:**
  $$\text{Page Landing Value (¥)} = \sum_{\text{page}} \text{Bill Total Landed Amount}$$

#### KPI 3.1.3: Total Expenses Disbursed (¥)
- **Meaning:** Sum of domestic transportation, offloading, and warehouse packaging expenses paid to local Chinese logistics companies.
- **Formula:**
  $$\text{Total Expenses (¥)} = \sum \text{Domestic Freight} + \sum \text{Port Handling} + \sum \text{Customs Clearance Fee}$$

---

### 3.2 Domestic Procurement Math & Allocation Formulas

#### Formula 3.2.1: Domestic Chinese VAT (13%)
$$\text{VAT Amount (¥)} = \text{Basic Total (Excl. VAT)} \times 0.13$$

#### Formula 3.2.2: Total Factory Payable
$$\text{Total Factory Payable (¥)} = \text{Basic Total} + \text{VAT Amount} + \text{Direct Expenses}$$

#### Formula 3.2.3: Perfect Match Verification KPI Banner
The system verifies line-item precision against the physical paper invoice:
$$\text{Difference} = \text{Invoice Header Value with VAT} - \sum (\text{Line Basic} + \text{Line VAT})$$
- If $\text{Difference} == 0.00$: **Banner turns Glowing Green:** `✔ Invoice Total Matches Line Items Perfectly (¥ Total)`
- If $\text{Difference} \ne 0.00$: **Banner turns Red Alert:** `⚠ Discrepancy Detected (¥ Difference)`

#### Formula 3.2.4: Value-Based (VB) Expense Allocation
Distributes domestic shipping costs based on the monetary value of items:
$$\text{Line Expense Share} = \text{Total Expense} \times \left(\frac{\text{Line Basic Total}}{\text{Total Invoice Basic Total}}\right)$$
$$\text{Unit Landing Rate (VB)} = \text{Basic Unit Rate} + \frac{\text{Line Expense Share}}{\text{Line Quantity}}$$

---

## 4. Inquiries & RFQ Module KPIs

Inquiries track customer leads and quotation requests from international buyers.

### 4.1 Company Dashboard: Top 5 Filterable Status Cards (`Inquiries.tsx`)

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│     PENDING      │  │     APPROVED     │  │     ONGOING      │
│   New inquiries  │  │ Quote accepted   │  │ Factory sourcing │
└──────────────────┘  └──────────────────┘  └──────────────────┘
┌──────────────────┐  ┌──────────────────┐
│    COMPLETED     │  │ CONVERSION RATE  │
│  Turned to Sale  │  │ % Deals Closed   │
└──────────────────┘  └──────────────────┘
```

#### KPI 4.1.1: Pending Inquiries Count
$$\text{Pending} = \text{COUNT}(\text{Inquiries awaiting supplier rate or sales response})$$

#### KPI 4.1.2: Approved Inquiries Count
$$\text{Approved} = \text{COUNT}(\text{Inquiries where buyer accepted quotation})$$

#### KPI 4.1.3: Ongoing Inquiries Count
$$\text{Ongoing} = \text{COUNT}(\text{Active inquiries currently in RFQ negotiation})$$

#### KPI 4.1.4: Completed Inquiries Count
$$\text{Completed} = \text{COUNT}(\text{Inquiries converted into Sales Orders})$$

#### KPI 4.1.5: Inquiry-to-Sale Conversion Rate (%)
$$\text{Conversion Rate (\%)} = \left(\frac{\text{Completed Inquiries}}{\text{Total Inquiries Received}}\right) \times 100$$
- **Example:** 120 Inquiries received, 36 converted to sales orders $\implies \mathbf{30.0\%}$ conversion rate.

---

### 4.2 Inquiry Detail: 3 KPI Summary Cards

Inside any active inquiry header, three aggregate summary cards calculate the planned consignment size:

#### KPI 4.2.1: Total Estimated Amount
$$\text{Total Inquiry Value} = \sum (\text{Item Quantity} \times \text{Quoted Unit Price})$$

#### KPI 4.2.2: Total Estimated CBM
$$\text{Total Inquiry CBM (m³)} = \sum \text{Item Line CBM}$$

#### KPI 4.2.3: Total Estimated Gross Weight
$$\text{Total Inquiry Weight (kg)} = \sum (\text{Item Quantity} \times \text{Unit Weight in kg})$$

---

## 5. Product Prices & Trade History 360° KPIs

Located inside the **Product Prices** module and the **Product Trade History Drawer** (`ProductTradeHistoryDrawer.tsx`).

### 5.1 Financial Margins & Price Spread KPIs

#### KPI 5.1.1: Latest Purchase Rate
- Sourced from the most recent confirmed Local Purchase bill (or preferred quote fallback).
- **Notation:** $P_{\text{buy}}$

#### KPI 5.1.2: Latest Sales Rate
- Sourced from the most recent confirmed Sales Order to a buyer.
- **Notation:** $P_{\text{sell}}$

#### KPI 5.1.3: Estimated Unit Gross Profit
$$\text{Unit Profit} = P_{\text{sell}} - P_{\text{buy}}$$

#### KPI 5.1.4: Estimated Gross Margin (%)
$$\text{Gross Margin (\%)} = \left(\frac{P_{\text{sell}} - P_{\text{buy}}}{P_{\text{sell}}}\right) \times 100$$
- **Worked Example:**
  - Latest Sell Rate = $\$ 65.00$
  - Latest Buy Rate = $\$ 40.00$
  - Unit Profit = $\$ 65.00 - \$ 40.00 = \mathbf{\$ 25.00}$
  - Gross Margin = $(\$ 25.00 / \$ 65.00) \times 100 = \mathbf{38.46\%}$

### 5.2 Trade Volume & Velocity KPIs

#### KPI 5.2.1: Total Purchased Volume (All Time)
$$\text{Volume}_{\text{Purchased}} = \sum_{\text{history}} \text{Purchased Quantity}$$

#### KPI 5.2.2: Total Sold Volume (All Time)
$$\text{Volume}_{\text{Sold}} = \sum_{\text{history}} \text{Sold Quantity}$$

#### KPI 5.2.3: Inventory Turnover Ratio
$$\text{Turnover Ratio} = \frac{\text{Volume}_{\text{Sold}}}{\text{Volume}_{\text{Purchased}}}$$
- An indicator of stock velocity: values close to $1.0$ indicate high efficiency (just-in-time trade order fulfillment).

---

## 6. Shipment Planning & Logistics KPIs

Shipment Planning (`Planning.tsx` and `backend/app/planning/formula.py`) manages containerization, cargo packing, and freight allocation.

### 6.1 Container Utilization KPIs

#### KPI 6.1.1: Container Volume Utilization (%)
Calculates how much of the shipping container's interior space is occupied by cargo.

$$\text{Volume Utilization (\%)} = \left(\frac{\sum \text{Line Total CBM}}{\text{Usable Container Capacity (m³)}}\right) \times 100$$

- **Official Standard Container Capacities:**
  - **20GP (General Purpose):** $28.0\text{ m}^3$
  - **40GP (General Purpose):** $58.0\text{ m}^3$
  - **40HQ (High Cube):** $68.0\text{ m}^3$
  - **45HQ (High Cube):** $78.0\text{ m}^3$

- **Color Status Rule:**
  - $\le 90\%$: Blue/Amber (Under-utilized container; space remaining)
  - $90\% - 100\%$: Green (Optimally loaded container)
  - $> 100\%$: Red Alert (Overloaded container; cargo will not fit!)

#### KPI 6.1.2: Container Weight Utilization (%)
$$\text{Weight Utilization (\%)} = \left(\frac{\sum \text{Gross Cargo Weight (kg)}}{\text{Max Container Payload (kg)}}\right) \times 100$$
- **Standard Max Payloads:**
  - 20GP: $\approx 21,700\text{ kg}$
  - 40GP / 40HQ: $\approx 26,500\text{ kg}$

### 6.2 Consignment Packing & Leftover KPIs

#### KPI 6.2.1: Leftover / Balance Order Quantity
Tracks unshipped balance when orders are split across multiple containers:
$$\text{Leftover Qty} = \text{Ordered Quantity} - \sum \text{Shipped in Mum Groups}$$

#### KPI 6.2.2: Total Packages / Cartons per Consignment
$$\text{Total Packages} = \sum_{\text{all rows}} \text{Number of Cartons in Consignment}$$

#### KPI 6.2.3: Freight Cost per CBM Rate ($/m³)
Used in Sale Process Column 12:
$$\text{Freight Rate (\$/m}^3) = \frac{\text{Ocean Freight (\$)} + \text{Local Port Charges \& COC (\$)}}{\text{Total Loaded Container CBM}}$$

---

## 7. Product Master & Packaging Volume KPIs

### Formula 7.1: Packaging Unit CBM (m³)
Converts box dimensions in centimeters into cubic meters:
$$\text{Unit CBM } (m^3) = \frac{\text{Length (cm)} \times \text{Width (cm)} \times \text{Height (cm)}}{1,000,000}$$

- **Example:** $88\text{ cm} \times 42\text{ cm} \times 38\text{ cm} = 140,448 / 1,000,000 = \mathbf{0.140448\text{ m}^3}$

### Formula 7.2: Packaging Carton Boxes
$$\text{Carton Boxes} = \text{CEILING}\left(\frac{\text{Order Quantity}}{\text{Packaging Quantity per Box}}\right)$$

### Formula 7.3: Total Line CBM
$$\text{Total Line CBM} = \text{Carton Boxes} \times \text{Unit CBM}$$

---

## 8. Suppliers & Buyers Master KPIs

### 8.1 Suppliers KPIs
- **Total Suppliers:** Count of registered factories.
- **Active Suppliers Ratio (%):** $(\text{Active Suppliers} / \text{Total Suppliers}) \times 100$
- **Verified Suppliers:** Count of factories with audited licenses and bank verification.
- **Category Coverage:** Number of product categories mapped to active factories.

### 8.2 Buyers KPIs
- **Total Buyers:** Count of registered international clients.
- **Active Buyers Ratio (%):** $(\text{Active Buyers} / \text{Total Buyers}) \times 100$
- **Geographic Spread:** Number of destination countries served.
- **Total Customer Lifetime Value (CLV):** Cumulative USD value of all sales orders per buyer.

---

## 9. Quick Reference Cheat Sheet of All Formulas

| Metric / KPI | Exact Formula | Where Found |
| :--- | :--- | :--- |
| **Packaging Unit CBM** | $(L \times W \times H) / 1,000,000$ | Product Master |
| **Line Cartons** | $\text{CEILING}(Quantity / PkgQty)$ | Product Master / Planning |
| **Line CBM** | $LineCartons \times UnitCBM$ | Commercial Invoice / Planning |
| **Container Utilization %**| $(TotalLoadedCBM / ContainerCapacity) \times 100$ | Shipment Planning |
| **Basic Item Total** | $Quantity \times BasicRate$ | Local Purchase |
| **Domestic VAT (13%)** | $BasicTotal \times 0.13$ | Local Purchase |
| **Total Factory Payable** | $BasicTotal + VATAmount + Expenses$ | Local Purchase |
| **Unit Landing Rate (VB)**| $BasicRate + (TotalExpenses \times BasicTotal / TotalInvoiceBasic) / Qty$ | Local Purchase |
| **Unit Price Incl. VAT** | $BasicRate \times 1.13$ | Sale Process (Col 8) |
| **FOB Price (USD)** | $(BasicRate \times (1 + Profit\%/100)) / USD\_Rate$ | Sale Process (Col 11) |
| **Freight / Unit (USD)** | $(TotalContainerFreight / TotalContainerCBM) \times (LineCBM / Qty)$ | Sale Process (Col 12) |
| **CFR Price / Unit** | $\text{ROUNDUP}(FOB\_USD + Freight\_USD, 2)$ | Sale Process (Col 13) |
| **Gross Margin %** | $((SellRate - BuyRate) / SellRate) \times 100$ | Product Prices / Sale Process |
| **Conversion Rate %** | $(CompletedInquiries / TotalInquiries) \times 100$ | Inquiries Dashboard |
| **Leftover Balance** | $OrderedQty - ShippedQty$ | Shipment Planning |
