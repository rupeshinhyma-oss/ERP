# Yinglima ERP — Master Formula Guide (Human-Readable Format)

**System:** Yinglima ERP (China Procurement & Trade Export Engine)  
**Purpose:** Plain-English explanation of every formula, mathematical calculation, and rounding rule used across the ERP. Designed so any operator, accountant, or manager can verify calculations by hand.

---

## 1. Product Master & Physical Packaging Formulas

### Formula 1.1: Packaging Unit CBM (Cubic Meters)
Converts carton box dimensions measured in centimeters (`cm`) into volume in cubic meters (`m³`).

$$\text{Packaging Unit CBM } (m^3) = \frac{\text{Length (cm)} \times \text{Width (cm)} \times \text{Height (cm)}}{1,000,000}$$

- **Plain English:** Multiply Length by Width by Height in centimeters, then divide by 1,000,000.
- **Worked Example:**
  - Length = $88\text{ cm}$, Width = $42\text{ cm}$, Height = $38\text{ cm}$
  - Calculation: $(88 \times 42 \times 38) / 1,000,000 = 140,448 / 1,000,000 = \mathbf{0.140448\text{ m}^3}$
- **Where Used:** Product Master form, automatically calculated as soon as dimensions are entered.

---

### Formula 1.2: Total Line CBM (Volume for an Order Line)
Works out how much container space a given order quantity will occupy.

$$\text{Carton Boxes} = \text{CEILING}\left(\frac{\text{Quantity Planned}}{\text{Packaging Quantity}}\right)$$

$$\text{Total Line CBM } (m^3) = \text{Carton Boxes} \times \text{Packaging Unit CBM}$$

- **Plain English:** Divide the quantity by how many items fit in one box, and round UP to the nearest whole box. Then multiply the number of boxes by the CBM of one box.
- **Worked Example:**
  - Quantity = $10\text{ pcs}$, Packaging Quantity = $1\text{ pc/box}$, Unit CBM = $0.140448\text{ m}^3$
  - Boxes = $10 / 1 = 10\text{ boxes}$
  - Total Line CBM = $10 \times 0.140448 = \mathbf{1.4045\text{ m}^3}$

---

## 2. Shipment Planning & Container Capacity Formulas

### Formula 2.1: Container Volume Utilization (%)
Calculates how full the shipping container is based on loaded consignments.

$$\text{Container Utilization (\%)} = \left(\frac{\text{Total Planned CBM of All Rows}}{\text{Usable Container Capacity}}\right) \times 100$$

- **Container Capacity Standards:**
  - **20GP Container:** $28.0\text{ m}^3$ usable volume
  - **40GP Container:** $58.0\text{ m}^3$ usable volume
  - **40HQ Container:** $68.0\text{ m}^3$ usable volume
  - **45HQ Container:** $78.0\text{ m}^3$ usable volume
- **Worked Example:**
  - Total CBM loaded into a 40HQ container = $65.45\text{ m}^3$
  - Utilization = $(65.45 / 68.00) \times 100 = \mathbf{96.25\%}$
  - System Indicator: Displays green if $\le 100\%$, turns red if $> 100\%$ (overloaded).

---

## 3. Local Purchase (Domestic China Procurement) Formulas

### Formula 3.1: Basic Item Total (Excluding VAT)
$$\text{Basic Item Total (¥)} = \text{Quantity} \times \text{Unit Rate}$$

- **Note on Unit Rate:** In Local Purchase, the **Unit Rate** is the factory price **before VAT**.
- **Worked Example:**
  - Quantity = $10\text{ units}$, Unit Rate = $713.00\text{ ¥}$
  - Basic Item Total = $10 \times 713.00 = \mathbf{¥ 7,130.00}$

---

### Formula 3.2: Domestic Chinese VAT Amount (13%)
$$\text{Line VAT Amount (¥)} = \text{Basic Item Total} \times \left(\frac{\text{VAT \%}}{100}\right)$$

- **Worked Example:**
  - Basic Item Total = $¥ 7,130.00$, VAT Rate = $13.00\%$
  - VAT Amount = $7,130.00 \times 0.13 = \mathbf{¥ 926.90}$

---

### Formula 3.3: Total Domestic Invoice Value with VAT (Factory Check)
$$\text{Total Factory Payable (¥)} = \text{Basic Items Total} + \text{Total VAT Amount} + \text{Total Landing Expenses}$$

- **Worked Example:**
  - Basic = $¥ 7,130.00$, VAT = $¥ 926.90$, Expenses = $¥ 0.00$
  - Total Payable = $7,130.00 + 926.90 = \mathbf{¥ 8,056.90}$
- **Screen Match Indicator:** When the top box `Invoice Total Value with VAT` equals $¥ 8,056.90$, the system displays the glowing green banner:  
  `✔ Invoice Total Matches Line Items Perfectly (¥ 8,056.90)`.

---

### Formula 3.4: Value-Based (VB) Landing Expense Allocation
Allocates domestic transport, packing, and offloading fees across items based on their value.

$$\text{Line Expense Share (¥)} = \text{Total Domestic Expenses} \times \left(\frac{\text{Line Basic Item Total}}{\text{Total Basic Value of All Items}}\right)$$

$$\text{Expense Per Unit (¥)} = \frac{\text{Line Expense Share}}{\text{Line Quantity}}$$

$$\text{Unit Landing Rate (VB) (¥)} = \text{Line Unit Rate} + \text{Expense Per Unit}$$

$$\text{Total Landing Rate (VB) (¥)} = \text{Line Quantity} \times \text{Unit Landing Rate}$$

- **Plain English:** More expensive machines bear a proportionally larger share of domestic transport and warehouse labor than cheap spare parts.
- **Worked Example:**
  - Total Transport Expense = $¥ 500.00$
  - Product A Basic Value = $¥ 7,130.00$; Total Invoice Basic Value = $¥ 10,000.00$; Quantity = $10$
  - Expense Share for Product A = $500 \times (7,130 / 10,000) = ¥ 356.50$
  - Expense per Unit = $356.50 / 10 = ¥ 35.65$
  - Unit Landing Rate = $713.00 + 35.65 = \mathbf{¥ 748.65\text{ per unit}}$

---

## 4. Sale Process & Official Commercial Invoice (16-Column Formulas)

This is the official Yinglima export spreadsheet engine (`doc/Yinglima_CI_Inhyma_YL-EXP2026-54.xlsx`, Row 14).

### Summary Table of All 16 Columns

| Col # | Header | Exact Human-Readable Formula |
| :---: | :--- | :--- |
| **Col 1** | `Sr.No` | `1, 2, 3...` (Row Number) |
| **Col 2** | `Description` | Product Name & Code from Product Master |
| **Col 3** | `HS CODE AS PER CHINA` | China Customs Export HS Code (e.g. `8422.30.00`) |
| **Col 4** | `UOM` | Unit of Measurement (e.g. `NOS`, `PCS`, `SET`) |
| **Col 5** | `Quantity` | Export Order Quantity ($Q$) |
| **Col 6** | `Unit Price (USD)` | $= \text{Col 13 (CFR Price/Unit)}$ *(overridable when currency is USD)* |
| **Col 7** | `Total Amount (USD)` | $= \text{Col 6} \times \text{Col 5}$ |
| **Col 8** | `Unit Price(RMB) Including VAT` | **Auto-sourced from Confirmed Local Purchase:** $= \text{LP Unit Rate} \times (1 + \text{LP VAT\%} / 100)$ |
| **Col 9** | `Unit Price(RMB) Excluding VAT` | $= \text{Col 8} / (1 + \text{Refund VAT\%} / 100)$ *(Equals LP Unit Rate!)* |
| **Col 10** | `Including Profit X%` | $= \text{Col 9} \times (1 + \text{Profit\%} / 100)$ |
| **Col 11** | `FOB PRICE (USD @rate)` | $= \text{Col 10} / \text{USD Conversion Rate}$ |
| **Col 12** | `Freight, Local charges, COC` | $= \left(\frac{\text{Total Container Shipping Expenses}}{\text{Total Container CBM}}\right) \times \left(\frac{\text{Line Total CBM}}{\text{Quantity}}\right)$ |
| **Col 13** | `CFR Price/Unit` | $= \text{ROUNDUP}(\text{Col 11} + \text{Col 12}, 2)$ |
| **Col 14** | `Supplier` | Chinese Factory Name (Auto-sourced from Confirmed Local Purchase) |
| **Col 15** | `Total CBM` | $= \text{Line Unit CBM} \times \text{Boxes}$ |
| **Col 16** | `Total Supplier Amount (RMB)` | $= \text{Col 8} \times \text{Col 5}$ |

---

### Step-by-Step Breakdown of the 16 Columns

#### Column 8: Unit Price(RMB) Including VAT
$$\text{Col 8} = \text{Local Purchase Basic Unit Rate} \times \left(1 + \frac{\text{VAT \%}}{100}\right)$$
- Sourced directly from the latest Confirmed Local Purchase.
- **Example:** $713.00 \times 1.13 = \mathbf{¥ 805.69}$

#### Column 9: Unit Price(RMB) Excluding VAT
$$\text{Col 9} = \frac{\text{Col 8}}{1 + \frac{\text{Refund VAT \%}}{100}}$$
- Strips Chinese domestic VAT because exported goods receive a 13% export VAT refund from Chinese tax authorities.
- **Example:** $805.69 / 1.13 = \mathbf{¥ 713.00}$ *(exactly equal to what factory charged before tax)*.

#### Column 10: Including Profit X%
$$\text{Col 10} = \text{Col 9} \times \left(1 + \frac{\text{Profit Margin \%}}{100}\right)$$
- Adds the company's export trading markup (default: $3\%$).
- **Example:** $713.00 \times (1 + 3/100) = 713.00 \times 1.03 = \mathbf{¥ 734.39}$

#### Column 11: FOB Price (USD Conversion @rate)
$$\text{Col 11} = \frac{\text{Col 10}}{\text{USD Conversion Rate}}$$
- Converts the RMB factory price (with profit) into US Dollars. Standard exchange rate is $6.70\text{ RMB} = 1\text{ USD}$.
- **Example:** $734.39 / 6.70 = \mathbf{\$ 109.610\text{ USD}}$

#### Column 12: Freight, Local Charges, COC ($/Unit)
Allocates total container shipping expenses to this specific item based on the volume (CBM) it occupies.

$$\text{Total Shipping Expenses (\$) } = \text{Ocean Freight (\$)} + \text{Local Charges \& COC (\$)}$$

$$\text{Freight Allocation Rate (\$/m}^3) = \frac{\text{Total Shipping Expenses}}{\text{Total Container CBM}}$$

$$\text{Col 12 (Freight/Unit \$)} = \text{Freight Allocation Rate} \times \left(\frac{\text{Line Total CBM}}{\text{Quantity}}\right)$$

- **Worked Example:**
  - Ocean Freight = $\$ 1,000.00$, Local Charges = $\$ 65.00 \implies \text{Total Freight} = \$ 1,065.00$
  - Total Container CBM = $0.637\text{ m}^3$
  - Freight Allocation Rate = $1,065.00 / 0.637 = \$ 1,671.90\text{ per m}^3$
  - Line CBM for 10 units = $0.12\text{ m}^3 \implies \text{CBM per unit} = 0.012\text{ m}^3$
  - Col 12 Freight/Unit = $1,671.90 \times 0.012 = \mathbf{\$ 20.063\text{ USD/unit}}$

#### Column 13: CFR Price/Unit (USD)
$$\text{Col 13} = \text{ROUNDUP}(\text{Col 11 (FOB Price)} + \text{Col 12 (Freight/Unit)}, 2)$$
- Combines FOB price and Freight per unit, rounded **UP** to 2 decimal places (so no fractional cents are lost).
- **Example:**
  - Raw sum = $\$ 109.610 + \$ 20.063 = \$ 129.673$
  - Rounded up = $\mathbf{\$ 129.68\text{ USD}}$

#### Column 6: Unit Price (USD)
- In standard mode, $\text{Col 6} = \text{Col 13} = \mathbf{\$ 129.68}$.
- If the order currency is set to USD, the user can type a negotiated selling price (e.g. $\$ 130.00$).

#### Column 7: Total Amount (USD)
$$\text{Col 7} = \text{Col 6 (Unit Price USD)} \times \text{Col 5 (Quantity)}$$
- **Example:** $\$ 129.68 \times 10 = \mathbf{\$ 1,296.80\text{ USD}}$

#### Column 16: Total Supplier Amount (RMB)
$$\text{Col 16} = \text{Col 8 (Unit Price RMB Incl. VAT)} \times \text{Col 5 (Quantity)}$$
- The total RMB payment due to the Chinese factory.
- **Example:** $805.69 \times 10 = \mathbf{¥ 8,056.90\text{ RMB}}$ *(exactly matches the factory invoice total!)*.

---

## 5. Master End-to-End Walkthrough Example

Here is a full real-world transaction showing how the formulas connect across modules:

### Scenario:
- **Product:** FR900 Band Sealer MSH (Code `INH-01039`)
- **Quantity:** $10\text{ units}$
- **Factory:** Zhejiang Dingye Machinery Co., Ltd.
- **Local Purchase (Domestic China):** Factory charges $¥ 713.00$ basic per unit with $13\%$ VAT.
- **Container Freight:** Ocean freight is $\$ 1,000$, local port COC charges are $\$ 65$, total container volume loaded is $0.637\text{ m}^3$.
- **Exchange Rate:** $6.70\text{ RMB} = 1\text{ USD}$.
- **Profit Margin:** $3\%$.

### Step-by-Step Result:
1. **Local Purchase Bill:**
   - Basic Total = $10 \times 713.00 = ¥ 7,130.00$
   - Domestic 13% VAT = $7,130 \times 0.13 = ¥ 926.90$
   - Factory Bill Total = $7,130.00 + 926.90 = \mathbf{¥ 8,056.90}$
2. **Sale Process Costing:**
   - Col 8 (Incl. VAT) = $713 \times 1.13 = \mathbf{¥ 805.69}$
   - Col 9 (Excl. VAT) = $805.69 / 1.13 = \mathbf{¥ 713.00}$
   - Col 10 (With 3% Profit) = $713 \times 1.03 = \mathbf{¥ 734.39}$
   - Col 11 (FOB USD @6.70) = $734.39 / 6.70 = \mathbf{\$ 109.610}$
   - Col 12 (Freight/Unit USD) = $(1065 / 0.637) \times (0.12 / 10) = \mathbf{\$ 20.063}$
   - Col 13 (CFR Price/Unit) = $\text{ROUNDUP}(109.610 + 20.063) = \mathbf{\$ 129.68}$
   - Col 7 (Total USD to Buyer) = $10 \times 129.68 = \mathbf{\$ 1,296.80}$
   - Col 16 (Total RMB to Factory) = $10 \times 805.69 = \mathbf{¥ 8,056.90}$
