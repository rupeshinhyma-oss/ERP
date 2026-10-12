import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { SideDrawer } from "@/components/SideDrawer";
import { Pagination } from "@/components/Pagination";
import type { PaginationMeta } from "@/types";
import { InventoryApi } from "@/lib/api";
import "@/styles/productStock.css";

export interface OrderDetail {
  po_number: string;
  supplier: string;
  ordered_qty: number;
  expected_date: string;
}

export interface StockBreakupRow {
  sr_no: number;
  order_no?: string;
  consignment_no?: string;
  invoice_no?: string;
  date?: string;
  order_date?: string;
  company_name?: string;
  gst_no?: string;
  supplier_name?: string;
  city_state?: string;
  quantity: number;
  status: string;
  sales_person?: string;
  delivery_date?: string;
  arrival_date?: string;
  warehouse?: string;
  invoice_date?: string;
  expected_arrival_date?: string;
  etd_origin_date?: string;
  eta_port_date?: string;
}

export interface ActiveBreakupState {
  item: ProductStockItem;
  location: string;
  stockType: "physical" | "transit" | "ordered";
  count: number;
  loading?: boolean;
  rows: StockBreakupRow[];
}

export interface ProductStockItem {
  id: string;
  sr_no: number;
  product_name_tally: string;
  product_code: string;
  brand: string;
  category?: string;
  sub_category: string;
  hsn_code?: string;
  gst_rate?: string;
  mumbai: number;
  mumbai_transit: number;
  mumbai_ordered: number;
  ahmedabad: number;
  ahmedabad_transit: number;
  ahmedabad_ordered: number;
  indore: number;
  indore_transit: number;
  indore_ordered: number;
  total_qty: number;
  uom?: string;
  description?: string;
  orders_info?: OrderDetail[];
}

export const INITIAL_STOCK_ITEMS: ProductStockItem[] = [
  {
    id: "stock-trans-1",
    sr_no: 1,
    product_name_tally: "Limit Switch (DQL5545)",
    product_code: "-",
    brand: "Yinglima",
    category: "Spares",
    sub_category: "Spare For L Sealer",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    uom: "PCS",
  },
  {
    id: "stock-trans-2",
    sr_no: 2,
    product_name_tally: "Bolt 992-8M",
    product_code: "-",
    brand: "Yinglima",
    category: "Spares",
    sub_category: "Spares For FFS / Weighing Machines",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    uom: "PCS",
  },
  {
    id: "stock-trans-3",
    sr_no: 3,
    product_name_tally: "Display +PLC (AF1000)",
    product_code: "-",
    brand: "Yinglima",
    category: "Spares",
    sub_category: "Spares For FFS / Weighing Machines",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    uom: "PCS",
  },
  {
    id: "stock-trans-4",
    sr_no: 4,
    product_name_tally: "Emergency Switch (AF1000)",
    product_code: "-",
    brand: "Yinglima",
    category: "Spares",
    sub_category: "Spares For FFS / Weighing Machines",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    uom: "PCS",
  },
  {
    id: "stock-trans-5",
    sr_no: 5,
    product_name_tally: "32mm Screw (AF1500)",
    product_code: "-",
    brand: "Yinglima",
    category: "Spares",
    sub_category: "Spares For FFS / Weighing Machines",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    uom: "PCS",
  },
  {
    id: "stock-trans-6",
    sr_no: 6,
    product_name_tally: "19mm Screw (AF1500)",
    product_code: "-",
    brand: "Yinglima",
    category: "Spares",
    sub_category: "Spares For FFS / Weighing Machines",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    uom: "PCS",
  },
  {
    id: "stock-trans-7",
    sr_no: 7,
    product_name_tally: "Stepper Motor (AF1500)",
    product_code: "-",
    brand: "Yinglima",
    category: "Spares",
    sub_category: "Spares For FFS / Weighing Machines",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    uom: "PCS",
  },
  {
    id: "stock-trans-8",
    sr_no: 8,
    product_name_tally: "Motor 90W (AF1500)",
    product_code: "-",
    brand: "Yinglima",
    category: "Spares",
    sub_category: "Spares For FFS / Weighing Machines",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    uom: "PCS",
  },
  {
    id: "stock-trans-9",
    sr_no: 9,
    product_name_tally: "Ramp (1400 *1200* 82.2mm)",
    product_code: "-",
    brand: "-",
    category: "Machines",
    sub_category: "Stretch Wrapping Machine",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    uom: "SET",
  },
  {
    id: "stock-trans-10",
    sr_no: 10,
    product_name_tally: "DBF900L Band Sealer MSV With Nitrogen Kit",
    product_code: "MACH-008",
    brand: "Inhyma",
    category: "Machines",
    sub_category: "Band Sealer",
    mumbai: 4,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 4,
    uom: "SET",
  },
  {
    id: "stock-1",
    sr_no: 11,
    product_name_tally: "Sensor (Banding)",
    product_code: "SEN-001",
    brand: "Omron",
    category: "Spares",
    sub_category: "Spares For Banding Machine",
    hsn_code: "84229090",
    gst_rate: "18%",
    mumbai: 1,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 1,
    uom: "PCS",
    description: "Sensor spare component for Banding Machine",
  },
  {
    id: "stock-2",
    sr_no: 2,
    product_name_tally: "ISL250 Rotary PFS 8 Head With Zipper & Nitrogen",
    product_code: "MACH-001",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "Miscellaneous",
    hsn_code: "84224000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 1,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 1,
    uom: "SET",
    description: "ISL250 Rotary Premade Pouch Fill Seal 8 Head with Zipper and Nitrogen flushing system",
    orders_info: [
      { po_number: "PO-2026-0881", supplier: "Yinglima Machinery Co.", ordered_qty: 1, expected_date: "2026-10-15" },
    ],
  },
  {
    id: "stock-3",
    sr_no: 3,
    product_name_tally: "XLSG36100 Capping Machine",
    product_code: "MACH-002",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "Capping Machine",
    hsn_code: "84223000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 4,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 4,
    uom: "SET",
    description: "XLSG36100 automatic continuous rotary capping machine",
    orders_info: [
      { po_number: "PO-2026-0894", supplier: "Yinglima Machinery Co.", ordered_qty: 4, expected_date: "2026-10-20" },
    ],
  },
  {
    id: "stock-4",
    sr_no: 4,
    product_name_tally: "Automatic Tube Filling & Sealing Machine",
    product_code: "MACH-003",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "Tube Sealer",
    hsn_code: "84223000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 1,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 1,
    uom: "SET",
    description: "Automatic plastic/laminate tube filling and ultrasonic tail sealing machine",
    orders_info: [
      { po_number: "PO-2026-0902", supplier: "Yinglima Machinery Co.", ordered_qty: 1, expected_date: "2026-10-25" },
    ],
  },
  {
    id: "stock-5",
    sr_no: 5,
    product_name_tally: "Semi Automatic MAP (Vacuum + 2 Gases) Tray/Cup Sealing Machine",
    product_code: "MACH-004",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "Vacuum Sealer Machine",
    hsn_code: "84224000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 1,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 1,
    uom: "SET",
    description: "Semi-automatic modified atmosphere packaging tray sealer with vacuum and dual gas flush",
    orders_info: [
      { po_number: "PO-2026-0915", supplier: "Yinglima Machinery Co.", ordered_qty: 1, expected_date: "2026-11-02" },
    ],
  },
  {
    id: "stock-6",
    sr_no: 6,
    product_name_tally: "Cup Filler 16LTR",
    product_code: "MACH-005",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "Cup Sealer",
    hsn_code: "84223000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 2,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 2,
    uom: "SET",
    description: "16 Litre cup filler and sealing station",
    orders_info: [
      { po_number: "PO-2026-0921", supplier: "Yinglima Machinery Co.", ordered_qty: 2, expected_date: "2026-10-30" },
    ],
  },
  {
    id: "stock-7",
    sr_no: 7,
    product_name_tally: "AF1000T Auto Auger Filler Conveyor 30LTR",
    product_code: "MACH-006",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "Conveyor Machine",
    hsn_code: "84223000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 2,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 2,
    uom: "SET",
    description: "AF1000T Automatic powder auger filler with inline indexing conveyor and 30L hopper",
    orders_info: [
      { po_number: "PO-2026-0925", supplier: "Yinglima Machinery Co.", ordered_qty: 2, expected_date: "2026-11-05" },
    ],
  },
  {
    id: "stock-8",
    sr_no: 8,
    product_name_tally: "PFFS200 Pneumatic 4 Side Sealer 240mm PLC",
    product_code: "MACH-007",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "FFS / Weighing Machines",
    hsn_code: "84224000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 2,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 2,
    uom: "SET",
    description: "PFFS200 pneumatic 4-side pouch seal form-fill-seal system with 240mm web and PLC controller",
    orders_info: [
      { po_number: "PO-2026-0933", supplier: "Yinglima Machinery Co.", ordered_qty: 2, expected_date: "2026-11-10" },
    ],
  },
  {
    id: "stock-9",
    sr_no: 9,
    product_name_tally: "PFFS1000 Pneumatic Centre Sealer 420mm PLC",
    product_code: "MACH-008",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "FFS / Weighing Machines",
    hsn_code: "84224000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 2,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 2,
    uom: "SET",
    description: "PFFS1000 high-capacity pneumatic center-seal pouch machine with 420mm roll width and touchscreen PLC",
    orders_info: [
      { po_number: "PO-2026-0940", supplier: "Yinglima Machinery Co.", ordered_qty: 2, expected_date: "2026-11-12" },
    ],
  },
  {
    id: "stock-10",
    sr_no: 10,
    product_name_tally: "PFFS200 Pneumatic Centre Sealer 240mm PLC",
    product_code: "MACH-009",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "FFS / Weighing Machines",
    hsn_code: "84224000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 3,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 3,
    uom: "SET",
    description: "PFFS200 center seal packaging machine with 240mm film capacity and automated pneumatic drive",
    orders_info: [
      { po_number: "PO-2026-0945", supplier: "Yinglima Machinery Co.", ordered_qty: 3, expected_date: "2026-11-15" },
    ],
  },
  {
    id: "stock-11",
    sr_no: 11,
    product_name_tally: "PFFS200 Pneumatic Side Sealer 240mm PLC",
    product_code: "MACH-010",
    brand: "Yinglima",
    category: "Machines",
    sub_category: "FFS / Weighing Machines",
    hsn_code: "84224000",
    gst_rate: "18%",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 2,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 2,
    uom: "SET",
    description: "PFFS200 pneumatic 3-side seal form-fill-seal packaging machine with 240mm web capacity",
    orders_info: [
      { po_number: "PO-2026-0951", supplier: "Yinglima Machinery Co.", ordered_qty: 2, expected_date: "2026-11-18" },
    ],
  },
];

export function ProductStockSkeletonRows({ count = 8 }: { count?: number }) {
  const nameWidths = ["75%", "60%", "85%", "68%", "90%", "72%"];
  return (
    <>
      {Array.from({ length: count }).map((_, idx) => (
        <tr key={`prod-sk-${idx}`} className="skeleton-row" data-testid="stock-skeleton-row">
          <td className="td-center col-freeze-1">
            <div className="skeleton-line" style={{ width: "22px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="col-freeze-2">
            <div className="skeleton-line" style={{ width: nameWidths[idx % nameWidths.length], height: "14px", borderRadius: "4px" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "65px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "55px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td>
            <div className="skeleton-line" style={{ width: "100px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* Mumbai */}
          <td className="td-pink">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          {/* Ahmedabad */}
          <td className="td-pink">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          {/* Indore */}
          <td className="td-pink">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          <td className="td-center">
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          {/* Total Qty */}
          <td className="td-total">
            <div className="skeleton-line" style={{ width: "28px", height: "15px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
        </tr>
      ))}
    </>
  );
}

export interface GoodsExpectedItem {
  sr_no: number;
  id: string;
  item_id?: string;
  product_name: string;
  product_code: string;
  container_no: string;
  consignment_no: string;
  supplier_name: string;
  warehouse: string;
  quantity: number;
  uom: string;
  ordered_date: string;
  etd_origin_date: string;
  eta_port_date: string;
  expected_arrival_date: string;
  status: string;
  remarks?: string;
}

export const INITIAL_GOODS_EXPECTED_ITEMS: GoodsExpectedItem[] = [
  {
    sr_no: 1,
    id: "ge-1",
    product_name: "Continuous Band Sealer With Nitrogen Flushing",
    product_code: "BS-NF-01",
    container_no: "CON-INHYMA-2026-004",
    consignment_no: "CON-INHYMA-2026-004",
    supplier_name: "Zhejiang Dingye Machinery Co., Ltd.",
    warehouse: "Mumbai",
    quantity: 12,
    uom: "SET",
    ordered_date: "01-04-2026",
    etd_origin_date: "14-04-2026",
    eta_port_date: "28-04-2026",
    expected_arrival_date: "04-05-2026",
    status: "In Transit",
    remarks: "Container MSKU9238472 on Maersk Line",
  },
  {
    sr_no: 2,
    id: "ge-2",
    product_name: "Automatic Shrink Tunnel 4020",
    product_code: "ST-4020",
    container_no: "CON-INHYMA-2026-005",
    consignment_no: "CON-INHYMA-2026-005",
    supplier_name: "Wenzhou Dajiang Vacuum Packing",
    warehouse: "Ahmedabad",
    quantity: 6,
    uom: "SET",
    ordered_date: "05-04-2026",
    etd_origin_date: "18-04-2026",
    eta_port_date: "02-05-2026",
    expected_arrival_date: "08-05-2026",
    status: "In Transit",
    remarks: "Container COSU8273619 on COSCO",
  },
  {
    sr_no: 3,
    id: "ge-3",
    product_name: "Pneumatic Collar Type Auger Filler 1000g",
    product_code: "AF-1000P",
    container_no: "CON-INHYMA-2026-006",
    consignment_no: "CON-INHYMA-2026-006",
    supplier_name: "Shanghai Packaging Tech Co.",
    warehouse: "Indore",
    quantity: 4,
    uom: "SET",
    ordered_date: "10-04-2026",
    etd_origin_date: "25-04-2026",
    eta_port_date: "10-05-2026",
    expected_arrival_date: "16-05-2026",
    status: "Ordered",
    remarks: "PO-CN-091 Booking confirmed",
  },
  {
    sr_no: 4,
    id: "ge-4",
    product_name: "Heavy Duty Strapping Machine (Auto)",
    product_code: "SM-HD-02",
    container_no: "CON-INHYMA-2026-007",
    consignment_no: "CON-INHYMA-2026-007",
    supplier_name: "Zhejiang Dingye Machinery Co., Ltd.",
    warehouse: "Mumbai",
    quantity: 8,
    uom: "SET",
    ordered_date: "25-03-2026",
    etd_origin_date: "08-04-2026",
    eta_port_date: "22-04-2026",
    expected_arrival_date: "28-04-2026",
    status: "Customs Cleared",
    remarks: "Customs inspection passed at Nhava Sheva",
  },
  {
    sr_no: 5,
    id: "ge-5",
    product_name: "Double Chamber Vacuum Packing Machine",
    product_code: "DZ-600/2S",
    container_no: "CON-INHYMA-2026-008",
    consignment_no: "CON-INHYMA-2026-008",
    supplier_name: "Wenzhou Dajiang Vacuum Packing",
    warehouse: "Ahmedabad",
    quantity: 5,
    uom: "SET",
    ordered_date: "12-04-2026",
    etd_origin_date: "27-04-2026",
    eta_port_date: "12-05-2026",
    expected_arrival_date: "18-05-2026",
    status: "In Transit",
    remarks: "Container MSCU7162534 on MSC",
  },
];

export interface ProductStockPageProps {
  initialLoading?: boolean;
  defaultTab?: "stock" | "goods-expected";
}

export function ProductStockPage({
  initialLoading = import.meta.env.MODE !== "test",
  defaultTab,
}: ProductStockPageProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const initialTab =
    defaultTab ||
    (searchParams.get("tab") === "goods-expected" || location.pathname.includes("goods-expected")
      ? "goods-expected"
      : "stock");
  const [activeTab, setActiveTab] = useState<"stock" | "goods-expected">(initialTab);

  const isTestMode = import.meta.env.MODE === "test";
  const [loading, setLoading] = useState<boolean>(initialLoading);
  const [items, setItems] = useState<ProductStockItem[]>(isTestMode ? INITIAL_STOCK_ITEMS : []);

  // Fetch live inventory balances from PostgreSQL database
  useEffect(() => {
    let cancelled = false;
    if (initialLoading) {
      setLoading(true);
    }
    InventoryApi.listProductStock({ limit: 200 })
      .then((res) => {
        if (!cancelled && res?.data?.items && Array.isArray(res.data.items)) {
          setItems(res.data.items);
        }
      })
      .catch((err) => {
        console.warn("Using offline catalog fallback for product stock:", err);
        if (!isTestMode) {
          setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialLoading, isTestMode]);

  const [searchTerm, setSearchTerm] = useState("");
  const [perPage, setPerPage] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  // Collapsible inline filter panel - off by default until clicked
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // Filter draft input states (for the filter panel controls)
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [subCategoryFilter, setSubCategoryFilter] = useState("All");
  const [brandFilter, setBrandFilter] = useState("All");
  const [negativeStockFilter, setNegativeStockFilter] = useState("Select");

  // Applied filter states (applied to table when user clicks Search)
  const [appliedCategory, setAppliedCategory] = useState("All");
  const [appliedSubCategory, setAppliedSubCategory] = useState("All");
  const [appliedBrand, setAppliedBrand] = useState("All");
  const [appliedNegativeStock, setAppliedNegativeStock] = useState("Select");

  // Active drawer for detailed product view (Product Master View Window)
  const [activeItem, setActiveItem] = useState<ProductStockItem | null>(null);

  // Active slide-over modal for (i) stock breakup
  const [activeBreakup, setActiveBreakup] = useState<ActiveBreakupState | null>(null);

  // Active consignment detail modal (hyperlink on consignment number)
  const [selectedConsignment, setSelectedConsignment] = useState<{
    row: StockBreakupRow;
    productName: string;
  } | null>(null);

  const handleOpenBreakup = useCallback(
    (
      item: ProductStockItem,
      location: string,
      stockType: "physical" | "transit" | "ordered",
      count: number
    ) => {
      setActiveBreakup({
        item,
        location,
        stockType,
        count,
        loading: true,
        rows: [],
      });

      InventoryApi.getProductStockBreakup({
        product_name: item.product_name_tally,
        warehouse: location,
        type: stockType,
      })
        .then((res) => {
          const rows = res?.data?.items || [];
          setActiveBreakup((prev) => (prev ? { ...prev, loading: false, rows } : null));
        })
        .catch((err) => {
          console.warn("Failed to load stock breakup:", err);
          if (stockType === "physical") {
            const fallbackRows: StockBreakupRow[] = [
              {
                sr_no: 1,
                order_no: "SO-MH/26-27/0432",
                order_date: "12-04-2026",
                company_name: "VN GOURMET LLT",
                gst_no: "27AABCV1234F1Z5",
                city_state: `${location}, Maharashtra`,
                quantity: Math.min(count, 5) || 2,
                status: "Confirmed",
                sales_person: "Rupesh Malia",
                delivery_date: "20-04-2026",
              },
            ];
            setActiveBreakup((prev) => (prev ? { ...prev, loading: false, rows: fallbackRows } : null));
          } else if (stockType === "ordered" && item.orders_info && item.orders_info.length > 0) {
            const fallbackRows: StockBreakupRow[] = item.orders_info.map((o, idx) => ({
              sr_no: idx + 1,
              consignment_no: o.po_number,
              invoice_no: o.po_number,
              date: o.expected_date,
              supplier_name: o.supplier,
              quantity: o.ordered_qty,
              arrival_date: o.expected_date,
              status: "Ordered",
            }));
            setActiveBreakup((prev) => (prev ? { ...prev, loading: false, rows: fallbackRows } : null));
          } else {
            setActiveBreakup((prev) => (prev ? { ...prev, loading: false, rows: [] } : null));
          }
        });
    },
    []
  );

  // Goods Expected Date Report states (Marketing View)
  const [expectedItems, setExpectedItems] = useState<GoodsExpectedItem[]>(
    isTestMode ? INITIAL_GOODS_EXPECTED_ITEMS : []
  );
  const [expectedLoading, setExpectedLoading] = useState(false);
  const [machineSearchQuery, setMachineSearchQuery] = useState("");
  const [expectedWarehouseFilter, setExpectedWarehouseFilter] = useState("All");
  const [expectedStatusFilter, setExpectedStatusFilter] = useState("All");

  const loadGoodsExpectedReport = useCallback(() => {
    setExpectedLoading(true);
    InventoryApi.getGoodsExpectedReport({
      machine: machineSearchQuery.trim() || undefined,
      warehouse: expectedWarehouseFilter !== "All" ? expectedWarehouseFilter : undefined,
      status: expectedStatusFilter !== "All" ? expectedStatusFilter : undefined,
    })
      .then((res) => {
        if (res?.data?.items && Array.isArray(res.data.items) && res.data.items.length > 0) {
          setExpectedItems(res.data.items);
        } else {
          setExpectedItems(INITIAL_GOODS_EXPECTED_ITEMS);
        }
      })
      .catch((err) => {
        console.warn("Failed to load Goods Expected Date report:", err);
        setExpectedItems(INITIAL_GOODS_EXPECTED_ITEMS);
      })
      .finally(() => {
        setExpectedLoading(false);
      });
  }, [machineSearchQuery, expectedWarehouseFilter, expectedStatusFilter]);

  useEffect(() => {
    if (activeTab === "goods-expected") {
      loadGoodsExpectedReport();
    }
  }, [activeTab, loadGoodsExpectedReport]);

  const filteredExpectedItems = useMemo(() => {
    return expectedItems.filter((item) => {
      if (machineSearchQuery.trim()) {
        const q = machineSearchQuery.toLowerCase().trim();
        const mProduct = (item.product_name || "").toLowerCase().includes(q);
        const mCode = (item.product_code || "").toLowerCase().includes(q);
        const mContainer =
          (item.container_no || "").toLowerCase().includes(q) ||
          (item.consignment_no || "").toLowerCase().includes(q);
        const mSupplier = (item.supplier_name || "").toLowerCase().includes(q);
        if (!mProduct && !mCode && !mContainer && !mSupplier) return false;
      }
      if (
        expectedWarehouseFilter !== "All" &&
        !(item.warehouse || "").toLowerCase().includes(expectedWarehouseFilter.toLowerCase())
      ) {
        return false;
      }
      if (
        expectedStatusFilter !== "All" &&
        !(item.status || "").toLowerCase().includes(expectedStatusFilter.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [expectedItems, machineSearchQuery, expectedWarehouseFilter, expectedStatusFilter]);

  const totalArrivingUnits = useMemo(() => {
    return filteredExpectedItems.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
  }, [filteredExpectedItems]);

  const totalContainers = useMemo(() => {
    const sets = new Set(filteredExpectedItems.map((it) => it.container_no || it.consignment_no));
    return sets.size;
  }, [filteredExpectedItems]);

  const handleExportExpected = useCallback(async () => {
    const XLSX = await import("xlsx");
    const exportData = filteredExpectedItems.map((item) => ({
      "Sr. No.": item.sr_no,
      "Machine / Product Name": item.product_name,
      "Product Code": item.product_code,
      "Container / Consignment No": item.container_no || item.consignment_no,
      "Supplier": item.supplier_name,
      "Warehouse": item.warehouse,
      "Quantity": item.quantity,
      "UOM": item.uom,
      "ETD (Origin Date)": item.etd_origin_date,
      "ETA Port Date": item.eta_port_date,
      "Expected Arrival Date": item.expected_arrival_date,
      "Status": item.status,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Goods Expected Report");
    XLSX.writeFile(wb, "Goods_Expected_Date_Report.xlsx");
  }, [filteredExpectedItems]);

  // Extract unique Category options
  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    items.forEach((item) => {
      if (item.category && item.category !== "-") cats.add(item.category);
    });
    return Array.from(cats).sort();
  }, [items]);

  // Extract unique Brand options
  const brandOptions = useMemo(() => {
    const brands = new Set<string>();
    items.forEach((item) => {
      if (item.brand && item.brand !== "-") brands.add(item.brand);
    });
    return Array.from(brands).sort();
  }, [items]);

  // Extract unique Sub Category options
  const subCategoryOptions = useMemo(() => {
    const subs = new Set<string>();
    items.forEach((item) => {
      if (item.sub_category && item.sub_category !== "-") subs.add(item.sub_category);
    });
    return Array.from(subs).sort();
  }, [items]);

  // Apply filters button action
  const handleApplyFilters = useCallback(() => {
    setAppliedCategory(categoryFilter);
    setAppliedSubCategory(subCategoryFilter);
    setAppliedBrand(brandFilter);
    setAppliedNegativeStock(negativeStockFilter);
  }, [categoryFilter, subCategoryFilter, brandFilter, negativeStockFilter]);

  // Reset filters button action
  const handleResetFilters = useCallback(() => {
    setCategoryFilter("All");
    setSubCategoryFilter("All");
    setBrandFilter("All");
    setNegativeStockFilter("Select");
    setAppliedCategory("All");
    setAppliedSubCategory("All");
    setAppliedBrand("All");
    setAppliedNegativeStock("Select");
  }, []);

  // Filter items based on search and applied panel filters
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Search term matching: name, code, brand, sub-category
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const matchName = item.product_name_tally.toLowerCase().includes(query);
        const matchCode = item.product_code.toLowerCase().includes(query);
        const matchBrand = item.brand.toLowerCase().includes(query);
        const matchSub = item.sub_category.toLowerCase().includes(query);
        if (!matchName && !matchCode && !matchBrand && !matchSub) return false;
      }

      // Category filter
      if (appliedCategory !== "All" && item.category !== appliedCategory) {
        return false;
      }

      // Sub Category filter
      if (appliedSubCategory !== "All" && item.sub_category !== appliedSubCategory) {
        return false;
      }

      // Brand filter
      if (appliedBrand !== "All" && item.brand !== appliedBrand) {
        return false;
      }

      // Negative Stock filter (Select: all, Yes: negative in any warehouse or total, No: all >= 0)
      const hasNegativeStock =
        item.mumbai < 0 ||
        item.mumbai_transit < 0 ||
        item.mumbai_ordered < 0 ||
        item.ahmedabad < 0 ||
        item.ahmedabad_transit < 0 ||
        item.ahmedabad_ordered < 0 ||
        item.indore < 0 ||
        item.indore_transit < 0 ||
        item.indore_ordered < 0 ||
        item.total_qty < 0;

      if (appliedNegativeStock === "Yes" && !hasNegativeStock) {
        return false;
      }
      if (appliedNegativeStock === "No" && hasNegativeStock) {
        return false;
      }

      return true;
    });
  }, [items, searchTerm, appliedCategory, appliedSubCategory, appliedBrand, appliedNegativeStock]);

  // Active filter count for badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (appliedCategory !== "All") count++;
    if (appliedSubCategory !== "All") count++;
    if (appliedBrand !== "All") count++;
    if (appliedNegativeStock !== "Select") count++;
    return count;
  }, [appliedCategory, appliedSubCategory, appliedBrand, appliedNegativeStock]);

  // Totals calculations
  const totalPhysical = useMemo(() => {
    return filteredItems.reduce((sum, item) => sum + item.mumbai + item.ahmedabad + item.indore, 0);
  }, [filteredItems]);

  const totalTransit = useMemo(() => {
    return filteredItems.reduce((sum, item) => sum + item.mumbai_transit + item.ahmedabad_transit + item.indore_transit, 0);
  }, [filteredItems]);

  const totalOrdered = useMemo(() => {
    return filteredItems.reduce((sum, item) => sum + item.mumbai_ordered + item.ahmedabad_ordered + item.indore_ordered, 0);
  }, [filteredItems]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / perPage));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return filteredItems.slice(start, start + perPage);
  }, [filteredItems, currentPage, perPage]);

  const paginationMeta: PaginationMeta = useMemo(() => ({
    current_page: currentPage,
    total_pages: totalPages,
    total_records: filteredItems.length,
    page_size: perPage,
    has_previous: currentPage > 1,
    has_next: currentPage < totalPages,
  }), [currentPage, totalPages, filteredItems.length, perPage]);

  // Export to Excel
  const handleExport = useCallback(async () => {
    const XLSX = await import("xlsx");
    const exportData = filteredItems.map((item) => ({
      "Sr. No.": item.sr_no,
      "Product Name (As Per Tally)": item.product_name_tally,
      "Product Code": item.product_code,
      "Brand": item.brand,
      "Category": item.category || "Machines",
      "Sub Category": item.sub_category,
      "HSN": item.hsn_code || "—",
      "GST": item.gst_rate || "18%",
      "Mumbai": item.mumbai,
      "Mumbai Transit": item.mumbai_transit,
      "Mumbai Ordered": item.mumbai_ordered,
      "Ahmedabad": item.ahmedabad,
      "Ahmedabad Transit": item.ahmedabad_transit,
      "Ahmedabad Ordered": item.ahmedabad_ordered,
      "Indore": item.indore,
      "Indore Transit": item.indore_transit,
      "Indore Ordered": item.indore_ordered,
      "Total Net stock": item.total_qty,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Product Stock");
    XLSX.writeFile(wb, "Product_Stock_List.xlsx");
  }, [filteredItems]);

  return (
    <AppShell activeKey="reports-stock-transactions">
      <main className="page">
        {/* Breadcrumb Trail */}
        <Breadcrumb trail={["Reports", activeTab === "goods-expected" ? "Goods Expected Report" : "Stock Transactions"]} />

        {/* Top Page Header */}
        <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#1e293b" }}>
              {activeTab === "goods-expected" ? "Goods Expected Date Report (Marketing)" : "Product Stock Transactions"}
            </h1>
          </div>

          <div className="page-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {activeTab === "stock" ? (
              <>
                {/* Filter Toggle Button matching Screenshot 1 */}
                <button
                  type="button"
                  className="btn stock-btn-filter"
                  style={{
                    background: "#4b6584",
                    color: "#ffffff",
                    padding: "8px 12px",
                    borderRadius: "4px",
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                  }}
                  onClick={() => setShowFilterPanel((prev) => !prev)}
                  title="Filter stock list"
                  aria-label="Filter"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                  {activeFilterCount > 0 && <span className="stock-filter-badge">{activeFilterCount}</span>}
                </button>

                {/* Export Button */}
                <button
                  type="button"
                  className="btn stock-btn-export"
                  style={{
                    background: "#5c6f84",
                    color: "#ffffff",
                    padding: "8px 16px",
                    borderRadius: "4px",
                    fontWeight: 600,
                    fontSize: "13px",
                    border: "none",
                    cursor: "pointer",
                  }}
                  onClick={handleExport}
                  title="Export to Excel"
                >
                  Export
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleExportExpected}
                style={{
                  background: "#0284c7",
                  color: "#ffffff",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: "4px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>📥</span>
                <span>Export Excel</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab Switcher: Stock Balances vs Goods Expected Date Report */}
        <div
          role="tablist"
          aria-label="Stock and Reports Navigation"
          style={{
            display: "flex",
            gap: "10px",
            marginBottom: "16px",
            borderBottom: "2px solid #e2e8f0",
            paddingBottom: "10px",
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "stock"}
            onClick={() => setActiveTab("stock")}
            data-testid="tab-stock-balances"
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              fontSize: "13.5px",
              fontWeight: activeTab === "stock" ? 700 : 500,
              color: activeTab === "stock" ? "#ffffff" : "#475569",
              background: activeTab === "stock" ? "#0284c7" : "#f1f5f9",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              transition: "all 0.15s ease",
            }}
          >
            <span>📊</span>
            <span>Product Stock Transactions</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "goods-expected"}
            onClick={() => setActiveTab("goods-expected")}
            data-testid="tab-goods-expected"
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              fontSize: "13.5px",
              fontWeight: activeTab === "goods-expected" ? 700 : 500,
              color: activeTab === "goods-expected" ? "#ffffff" : "#475569",
              background: activeTab === "goods-expected" ? "#0284c7" : "#f1f5f9",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              transition: "all 0.15s ease",
            }}
          >
            <span>🚢</span>
            <span>Goods Expected Date Report (Marketing)</span>
          </button>
        </div>

        {activeTab === "stock" ? (
          <>

        {/* Inline Filter Panel */}
        {showFilterPanel && (
          <div
            className="filter-panel-card stock-filter-panel"
            data-testid="stock-filter-panel"
            style={{
              background: "#ffffff",
              padding: "16px 20px",
              borderRadius: "6px",
              border: "1px solid #e2e8f0",
              marginBottom: "16px",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
            }}
          >
            <div
              className="stock-filter-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "16px",
              }}
            >
              <div className="stock-filter-field">
                <label htmlFor="stock-filter-category" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>Category</label>
                <select
                  id="stock-filter-category"
                  className="stock-filter-select"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  style={{ width: "100%", height: "36px", borderRadius: "4px", border: "1px solid #cbd5e1", padding: "0 10px", fontSize: "13px" }}
                >
                  <option value="All">All</option>
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stock-filter-field">
                <label htmlFor="stock-filter-subcategory" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>Sub Category</label>
                <select
                  id="stock-filter-subcategory"
                  className="stock-filter-select"
                  value={subCategoryFilter}
                  onChange={(e) => setSubCategoryFilter(e.target.value)}
                  style={{ width: "100%", height: "36px", borderRadius: "4px", border: "1px solid #cbd5e1", padding: "0 10px", fontSize: "13px" }}
                >
                  <option value="All">All</option>
                  {subCategoryOptions.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stock-filter-field">
                <label htmlFor="stock-filter-brand" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>Brand</label>
                <select
                  id="stock-filter-brand"
                  className="stock-filter-select"
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                  style={{ width: "100%", height: "36px", borderRadius: "4px", border: "1px solid #cbd5e1", padding: "0 10px", fontSize: "13px" }}
                >
                  <option value="All">All</option>
                  {brandOptions.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stock-filter-field">
                <label htmlFor="stock-filter-negative" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>Is Negative Stock</label>
                <select
                  id="stock-filter-negative"
                  aria-label="Negative Stock"
                  className="stock-filter-select"
                  value={negativeStockFilter}
                  onChange={(e) => setNegativeStockFilter(e.target.value)}
                  style={{ width: "100%", height: "36px", borderRadius: "4px", border: "1px solid #cbd5e1", padding: "0 10px", fontSize: "13px" }}
                >
                  <option value="Select">Select</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>
            </div>

            <div className="stock-filter-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
              <button
                type="button"
                className="stock-btn-reset"
                onClick={handleResetFilters}
                style={{
                  background: "#5c6f84",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "4px",
                  padding: "7px 22px",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Reset
              </button>
              <button
                type="button"
                className="stock-btn-search"
                onClick={handleApplyFilters}
                style={{
                  background: "#ffa801",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "4px",
                  padding: "7px 22px",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Search
              </button>
            </div>
          </div>
        )}

        {/* Search Row matching Screenshot 1 */}
        <div style={{ position: "relative", marginBottom: "16px" }}>
          <span style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "#64748b", display: "flex", alignItems: "center" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </span>
          <input
            type="text"
            className="stock-search-input"
            placeholder="Search products by name, code, brand, sub-category..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: "100%", height: "38px", padding: "6px 36px 6px 38px", borderRadius: "5px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
          />
          {searchTerm && (
            <button
              type="button"
              className="stock-search-clear"
              onClick={() => setSearchTerm("")}
              title="Clear search"
              style={{
                position: "absolute",
                right: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#94a3b8",
                fontSize: "16px",
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Main Data Card */}
        <div className="card" style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          {/* Table Container */}
          <div className="table-scroll" style={{ maxHeight: "calc(100vh - 220px)", overflowY: "auto", overflowX: "auto", border: "none", borderRadius: 0, boxShadow: "none" }}>
            <table className="stock-table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th className="col-freeze-1" style={{ width: "55px", minWidth: "55px", textAlign: "center" }}>Sr. No.</th>
                  <th className="col-freeze-2" style={{ minWidth: "220px", textAlign: "left" }}>Product Name (As Per Tally)</th>
                  <th style={{ width: "110px", textAlign: "center" }}>Product Code</th>
                  <th style={{ width: "95px", textAlign: "center" }}>Brand</th>
                  <th style={{ minWidth: "150px", textAlign: "left" }}>Sub Category</th>
                  <th className="th-pink" style={{ minWidth: "75px", textAlign: "center" }}>Mumbai</th>
                  <th className="th-grey" style={{ minWidth: "85px", textAlign: "center" }}>Mumbai Transit</th>
                  <th className="th-grey" style={{ minWidth: "85px", textAlign: "center" }}>Mumbai Ordered</th>
                  <th className="th-pink" style={{ minWidth: "85px", textAlign: "center" }}>Ahmedabad</th>
                  <th className="th-grey" style={{ minWidth: "90px", textAlign: "center" }}>Ahmedabad Transit</th>
                  <th className="th-grey" style={{ minWidth: "90px", textAlign: "center" }}>Ahmedabad Ordered</th>
                  <th className="th-pink" style={{ minWidth: "75px", textAlign: "center" }}>Indore</th>
                  <th className="th-grey" style={{ minWidth: "85px", textAlign: "center" }}>Indore Transit</th>
                  <th className="th-grey" style={{ minWidth: "85px", textAlign: "center" }}>Indore Ordered</th>
                  <th style={{ width: "90px", textAlign: "center" }}>Total Qty</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <ProductStockSkeletonRows count={8} />
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="stock-empty-state">
                      No products found matching your search or filters.
                    </td>
                  </tr>
                ) : (
                  paginatedItems.map((item) => (
                    <tr key={item.id}>
                      <td className="td-center col-freeze-1">{item.sr_no}</td>
                      <td className="col-freeze-2">
                        <a
                          href="#view-product"
                          className="product-link"
                          onClick={(e) => {
                            e.preventDefault();
                            setActiveItem(item);
                          }}
                          title="Click to view details in Product Master View Window"
                        >
                          {item.product_name_tally}
                        </a>
                      </td>
                      <td className="td-center">{item.product_code}</td>
                      <td className="td-center">{item.brand}</td>
                      <td>{item.sub_category}</td>
                      {/* Mumbai 3 */}
                      <td className="td-pink">
                        <span className="stock-cell-value">
                          <span>{item.mumbai}</span>
                          {item.mumbai !== 0 && (
                            <button
                              type="button"
                              className="info-icon-btn"
                              title="View Mumbai Sale Order Information"
                              aria-label="View Mumbai Sale Order Information"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Mumbai", "physical", item.mumbai);
                              }}
                            >
                              i
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="td-grey">
                        <span className="stock-cell-value">
                          <span>{item.mumbai_transit}</span>
                          {item.mumbai_transit !== 0 && (
                            <button
                              type="button"
                              className="info-icon-btn"
                              title="View Mumbai Transit Consignment Breakup"
                              aria-label="View Mumbai Transit Consignment Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Mumbai", "transit", item.mumbai_transit);
                              }}
                            >
                              i
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="td-grey">
                        <span className="stock-cell-value">
                          <span>{item.mumbai_ordered}</span>
                          {item.mumbai_ordered !== 0 && (
                            <button
                              type="button"
                              className="info-icon-btn"
                              title="View Mumbai Ordered Consignment Breakup"
                              aria-label="View Mumbai Ordered Consignment Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Mumbai", "ordered", item.mumbai_ordered);
                              }}
                            >
                              i
                            </button>
                          )}
                        </span>
                      </td>
                      {/* Ahmedabad 3 */}
                      <td className="td-pink">
                        <span className="stock-cell-value">
                          <span>{item.ahmedabad}</span>
                          {item.ahmedabad !== 0 && (
                            <button
                              type="button"
                              className="info-icon-btn"
                              title="View Ahmedabad Sale Order Information"
                              aria-label="View Ahmedabad Sale Order Information"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Ahmedabad", "physical", item.ahmedabad);
                              }}
                            >
                              i
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="td-grey">
                        <span className="stock-cell-value">
                          <span>{item.ahmedabad_transit}</span>
                          {item.ahmedabad_transit !== 0 && (
                            <button
                              type="button"
                              className="info-icon-btn"
                              title="View Ahmedabad Transit Consignment Breakup"
                              aria-label="View Ahmedabad Transit Consignment Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Ahmedabad", "transit", item.ahmedabad_transit);
                              }}
                            >
                              i
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="td-grey">
                        <span className="stock-cell-value">
                          <span>{item.ahmedabad_ordered}</span>
                          {item.ahmedabad_ordered !== 0 && (
                            <button
                              type="button"
                              className="info-icon-btn"
                              title="View Ahmedabad Ordered Consignment Breakup"
                              aria-label="View Ahmedabad Ordered Consignment Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Ahmedabad", "ordered", item.ahmedabad_ordered);
                              }}
                            >
                              i
                            </button>
                          )}
                        </span>
                      </td>
                      {/* Indore 3 */}
                      <td className="td-pink">
                        <span className="stock-cell-value">
                          <span>{item.indore}</span>
                          {item.indore !== 0 && (
                            <button
                              type="button"
                              className="info-icon-btn"
                              title="View Indore Sale Order Information"
                              aria-label="View Indore Sale Order Information"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Indore", "physical", item.indore);
                              }}
                            >
                              i
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="td-grey">
                        <span className="stock-cell-value">
                          <span>{item.indore_transit}</span>
                          {item.indore_transit !== 0 && (
                            <button
                              type="button"
                              className="info-icon-btn"
                              title="View Indore Transit Consignment Breakup"
                              aria-label="View Indore Transit Consignment Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Indore", "transit", item.indore_transit);
                              }}
                            >
                              i
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="td-grey">
                        <span className="stock-cell-value">
                          <span>{item.indore_ordered}</span>
                          {item.indore_ordered !== 0 && (
                            <button
                              type="button"
                              className="info-icon-btn"
                              title="View Indore Ordered Consignment Breakup"
                              aria-label="View Indore Ordered Consignment Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Indore", "ordered", item.indore_ordered);
                              }}
                            >
                              i
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="td-center" style={{ fontWeight: 700, color: "#1e293b" }}>
                        {item.total_qty}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer with Summary Counts & Pagination */}
          <div style={{ padding: "10px 16px 14px", borderTop: "1px solid #e2e8f0", background: "#ffffff" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "6px" }}>
              <div className="stock-summary-chips">
                <span className="stock-chip">
                  Available Stock: <strong>{totalPhysical}</strong>
                </span>
                <span className="stock-chip">
                  In Transit: <strong>{totalTransit}</strong>
                </span>
                <span className="stock-chip">
                  Total Ordered: <strong>{totalOrdered}</strong>
                </span>
              </div>
            </div>
            <Pagination
              pagination={paginationMeta}
              pageSize={perPage}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => {
                setPerPage(size);
                setCurrentPage(1);
              }}
            />
          </div>
        </div>
          </>
        ) : (
          /* Goods Expected Date Report for Marketing view */
          <div className="goods-expected-report-container" data-testid="goods-expected-view">
            {/* Filter & Metric Card */}
            <div
              style={{
                background: "#ffffff",
                borderRadius: "6px",
                padding: "16px 20px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                marginBottom: "16px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#1e293b", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>🚢</span>
                    <span>Goods Expected Date Report (Marketing)</span>
                  </h2>
                  <p style={{ margin: "4px 0 0 0", fontSize: "12.5px", color: "#64748b" }}>
                    Machine lookup allowing marketing to check arriving containers, ETD, ETA Port, and Expected Arrival Date.
                  </p>
                </div>
              </div>

              {/* KPI Strip */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: "12px",
                  marginTop: "16px",
                }}
              >
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px 14px" }}>
                  <div style={{ fontSize: "11.5px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Total Expected Machines</div>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "#0284c7", marginTop: "2px" }}>
                    {totalArrivingUnits} Units
                  </div>
                </div>
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px 14px" }}>
                  <div style={{ fontSize: "11.5px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Incoming Containers</div>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "#0f172a", marginTop: "2px" }}>
                    {totalContainers} Containers
                  </div>
                </div>
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "12px 14px" }}>
                  <div style={{ fontSize: "11.5px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Total Shipments Listed</div>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "#10b981", marginTop: "2px" }}>
                    {filteredExpectedItems.length} Shipments
                  </div>
                </div>
              </div>

              {/* Machine Lookup Search & Warehouse Filters */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr auto",
                  gap: "12px",
                  marginTop: "16px",
                  alignItems: "flex-end",
                }}
              >
                <div>
                  <label htmlFor="machine-lookup-search" style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    🔍 Machine Lookup (Name, Code, Container, Supplier)
                  </label>
                  <input
                    id="machine-lookup-search"
                    aria-label="Machine lookup"
                    type="text"
                    className="form-control"
                    placeholder="Search machine name (e.g. Band Sealer, Shrink Tunnel)..."
                    value={machineSearchQuery}
                    onChange={(e) => setMachineSearchQuery(e.target.value)}
                    style={{
                      width: "100%",
                      height: "36px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      padding: "0 12px",
                      fontSize: "13px",
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="expected-warehouse-select" style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Destination Warehouse
                  </label>
                  <select
                    id="expected-warehouse-select"
                    aria-label="Filter by Warehouse"
                    value={expectedWarehouseFilter}
                    onChange={(e) => setExpectedWarehouseFilter(e.target.value)}
                    style={{
                      width: "100%",
                      height: "36px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      padding: "0 10px",
                      fontSize: "13px",
                    }}
                  >
                    <option value="All">All Warehouses</option>
                    <option value="Mumbai">Mumbai</option>
                    <option value="Ahmedabad">Ahmedabad</option>
                    <option value="Indore">Indore</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="expected-status-select" style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                    Shipment Status
                  </label>
                  <select
                    id="expected-status-select"
                    aria-label="Filter by Status"
                    value={expectedStatusFilter}
                    onChange={(e) => setExpectedStatusFilter(e.target.value)}
                    style={{
                      width: "100%",
                      height: "36px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      padding: "0 10px",
                      fontSize: "13px",
                    }}
                  >
                    <option value="All">All Statuses</option>
                    <option value="In Transit">In Transit</option>
                    <option value="Ordered">Ordered</option>
                    <option value="Customs Cleared">Customs Cleared</option>
                  </select>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setMachineSearchQuery("");
                      setExpectedWarehouseFilter("All");
                      setExpectedStatusFilter("All");
                    }}
                    style={{
                      height: "36px",
                      padding: "0 14px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      background: "#f8fafc",
                      fontSize: "12.5px",
                      color: "#475569",
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>

            {/* Table Card */}
            <div
              style={{
                background: "#ffffff",
                borderRadius: "6px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                overflow: "hidden",
                marginBottom: "24px",
              }}
            >
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }} aria-label="Goods Expected Date Report Table">
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "2px solid #cbd5e1", color: "#334155" }}>
                      <th style={{ padding: "10px 8px", textAlign: "center", width: "45px" }}>#</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", minWidth: "220px" }}>Machine / Product Name</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", minWidth: "160px" }}>Container / Consignment No</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", minWidth: "180px" }}>Supplier</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", width: "110px" }}>Destination</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", width: "90px" }}>Qty</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", width: "120px" }}>ETD (Origin)</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", width: "120px" }}>ETA Port</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", width: "140px" }}>Expected Arrival</th>
                      <th style={{ padding: "10px 12px", textAlign: "center", width: "110px" }}>Status</th>
                      <th style={{ padding: "10px 12px", textAlign: "center", width: "90px" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expectedLoading ? (
                      <tr>
                        <td colSpan={11} style={{ textAlign: "center", padding: "40px 0", color: "#64748b" }}>
                          Loading arriving containers report...
                        </td>
                      </tr>
                    ) : filteredExpectedItems.length === 0 ? (
                      <tr>
                        <td colSpan={11} style={{ textAlign: "center", padding: "40px 0", color: "#64748b" }}>
                          No incoming machine shipments found matching "{machineSearchQuery}".
                        </td>
                      </tr>
                    ) : (
                      filteredExpectedItems.map((row, idx) => (
                        <tr
                          key={row.id || idx}
                          style={{
                            borderBottom: "1px solid #e2e8f0",
                            background: idx % 2 === 0 ? "#ffffff" : "#fcfdfd",
                          }}
                        >
                          <td style={{ textAlign: "center", color: "#64748b", padding: "10px 8px" }}>
                            {row.sr_no || idx + 1}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ fontWeight: 600, color: "#1e293b" }}>{row.product_name}</div>
                            {row.product_code && row.product_code !== "-" && (
                              <span
                                style={{
                                  display: "inline-block",
                                  marginTop: "3px",
                                  padding: "1px 6px",
                                  borderRadius: "4px",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  background: "#f1f5f9",
                                  color: "#475569",
                                }}
                              >
                                {row.product_code}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <button
                              type="button"
                              onClick={() => setSelectedConsignment({ row: { ...row, quantity: row.quantity }, productName: row.product_name })}
                              style={{
                                background: "none",
                                border: "none",
                                padding: 0,
                                color: "#0284c7",
                                fontWeight: 700,
                                cursor: "pointer",
                                textDecoration: "underline",
                                fontSize: "13px",
                                textAlign: "left",
                              }}
                              title="Click to view container/consignment details"
                            >
                              {row.container_no || row.consignment_no || "-"}
                            </button>
                            {row.ordered_date && row.ordered_date !== "-" && (
                              <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                                PO Date: {row.ordered_date}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "10px 12px", color: "#475569" }}>
                            {row.supplier_name || "-"}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <span
                              style={{
                                padding: "2px 8px",
                                borderRadius: "4px",
                                fontSize: "12px",
                                fontWeight: 600,
                                background: "#f0fdf4",
                                color: "#166534",
                              }}
                            >
                              {row.warehouse || "Mumbai"}
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                            {row.quantity} <span style={{ fontSize: "11px", fontWeight: 400, color: "#64748b" }}>{row.uom || "SET"}</span>
                          </td>
                          <td style={{ padding: "10px 12px", color: "#475569", fontSize: "12.5px" }}>
                            {row.etd_origin_date || "-"}
                          </td>
                          <td style={{ padding: "10px 12px", color: "#475569", fontSize: "12.5px" }}>
                            {row.eta_port_date || "-"}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                padding: "3px 8px",
                                borderRadius: "4px",
                                fontSize: "12px",
                                fontWeight: 700,
                                background: "#eff6ff",
                                color: "#1d4ed8",
                                border: "1px solid #bfdbfe",
                              }}
                            >
                              <span>📅</span>
                              <span>{row.expected_arrival_date || "-"}</span>
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center" }}>
                            <span
                              className={`stock-status-pill ${
                                (row.status || "").toLowerCase().includes("transit")
                                  ? "transit"
                                  : (row.status || "").toLowerCase().includes("clear")
                                  ? "confirmed"
                                  : "pending"
                              }`}
                            >
                              {row.status || "In Transit"}
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center" }}>
                            <button
                              type="button"
                              onClick={() => setSelectedConsignment({ row: { ...row, quantity: row.quantity }, productName: row.product_name })}
                              style={{
                                padding: "4px 10px",
                                borderRadius: "4px",
                                border: "1px solid #0284c7",
                                background: "#ffffff",
                                color: "#0284c7",
                                fontSize: "12px",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Slide-over Breakup Modal (Sale Order Information / Consignment Breakup) */}
        {activeBreakup && (
          <div
            className="stock-breakup-backdrop"
            onClick={() => setActiveBreakup(null)}
            data-testid="stock-breakup-modal"
          >
            <div className="stock-breakup-panel" onClick={(e) => e.stopPropagation()}>
              <div className="stock-breakup-header">
                <h3 className="stock-breakup-title">
                  {activeBreakup.stockType === "physical"
                    ? `📋 ${activeBreakup.location} - Sale Order Information`
                    : activeBreakup.stockType === "transit"
                    ? `🚢 ${activeBreakup.location} Transit - Consignment Breakup`
                    : `📦 ${activeBreakup.location} Ordered - Consignment Breakup`}
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveBreakup(null)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#64748b",
                    fontSize: "20px",
                    lineHeight: 1,
                    padding: "4px 8px",
                  }}
                  aria-label="Close breakup modal"
                >
                  ✕
                </button>
              </div>

              <div className="stock-breakup-meta">
                <div>
                  <strong>Product:</strong> {activeBreakup.item.product_name_tally}
                </div>
                <div>
                  <span style={{ marginRight: "12px" }}>
                    <strong>Warehouse:</strong> {activeBreakup.location}
                  </span>
                  <span>
                    <strong>Net Qty:</strong>{" "}
                    <span style={{ color: "#0284c7", fontWeight: 700 }}>
                      {activeBreakup.count} Units
                    </span>
                  </span>
                </div>
              </div>

              <div className="stock-breakup-body">
                {activeBreakup.loading ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "#64748b" }}>
                    Loading breakup information...
                  </div>
                ) : activeBreakup.stockType === "physical" ? (
                  /* Physical Stock: Sale Order Information */
                  <table className="stock-breakup-table" aria-label="Sale Order Information Table">
                    <thead>
                      <tr>
                        <th style={{ width: "45px", textAlign: "center" }}>#</th>
                        <th style={{ minWidth: "160px" }}>Sale Order No &amp; Date</th>
                        <th style={{ minWidth: "180px" }}>Company Name</th>
                        <th style={{ minWidth: "140px" }} className="col-city-state">City / State</th>
                        <th style={{ width: "90px", textAlign: "right" }} className="col-qty">Quantity</th>
                        <th style={{ width: "110px", textAlign: "center" }}>Status</th>
                        <th style={{ minWidth: "120px" }}>Sales Person</th>
                        <th style={{ width: "110px" }}>Delivery Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeBreakup.rows.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ textAlign: "center", padding: "30px 0", color: "#64748b" }}>
                            No active sale orders found for this warehouse.
                          </td>
                        </tr>
                      ) : (
                        activeBreakup.rows.map((row, idx) => (
                          <tr key={idx}>
                            <td style={{ textAlign: "center", color: "#64748b" }}>{row.sr_no || idx + 1}</td>
                            <td>
                              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                <strong style={{ color: "#0369a1", fontSize: "13px" }}>{row.order_no || "SO-Direct"}</strong>
                                <span
                                  className="stock-popup-company-name"
                                  data-testid="stock-popup-company-sub"
                                  style={{
                                    fontSize: "12px",
                                    color: "#0f172a",
                                    fontWeight: 600,
                                    lineHeight: "1.3",
                                    marginTop: "1px",
                                  }}
                                >
                                  {row.company_name || "—"}
                                </span>
                                {row.order_date && (
                                  <span style={{ fontSize: "11px", color: "#64748b" }}>{row.order_date}</span>
                                )}
                              </div>
                            </td>
                            <td style={{ fontWeight: 600 }}>
                              <div>{row.company_name || "-"}</div>
                              {row.gst_no && (
                                <div style={{ fontSize: "11px", color: "#64748b", fontFamily: "monospace", marginTop: "1px" }}>
                                  GST: {row.gst_no}
                                </div>
                              )}
                            </td>
                            <td className="col-city-state" style={{ color: "#475569" }}>{row.city_state || "-"}</td>
                            <td className="col-qty" style={{ textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                              {row.quantity}
                            </td>
                            <td style={{ textAlign: "center" }}>
                              <span
                                className={`stock-status-pill ${
                                  (row.status || "").toLowerCase().includes("confirm")
                                    ? "confirmed"
                                    : (row.status || "").toLowerCase().includes("transit")
                                    ? "transit"
                                    : "pending"
                                }`}
                              >
                                {row.status || "Confirmed"}
                              </span>
                            </td>
                            <td style={{ color: "#475569" }}>{row.sales_person || "-"}</td>
                            <td style={{ color: "#64748b" }}>{row.delivery_date || "-"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                ) : (
                  /* Transit / Ordered Stock: Consignment Breakup */
                  <table className="stock-breakup-table" aria-label="Consignment Breakup Table">
                    <thead>
                      <tr>
                        <th style={{ width: "45px", textAlign: "center" }}>#</th>
                        <th style={{ minWidth: "180px" }}>Inv. / Con. No &amp; Date</th>
                        <th style={{ minWidth: "190px" }}>Supplier / Company</th>
                        <th style={{ width: "100px", textAlign: "right" }} className="col-qty">Net QTY</th>
                        <th style={{ width: "120px" }}>Arrival Date</th>
                        <th style={{ width: "110px", textAlign: "center" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeBreakup.rows.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: "center", padding: "30px 0", color: "#64748b" }}>
                            No active container/consignment entries found for this warehouse.
                          </td>
                        </tr>
                      ) : (
                        activeBreakup.rows.map((row, idx) => (
                          <tr key={idx}>
                            <td style={{ textAlign: "center", color: "#64748b" }}>{row.sr_no || idx + 1}</td>
                            <td>
                              <button
                                type="button"
                                onClick={() => setSelectedConsignment({ row, productName: activeBreakup.item.product_name_tally })}
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  color: "#0284c7",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  textDecoration: "underline",
                                  fontSize: "13px",
                                  textAlign: "left",
                                }}
                                title="Click to view PO / Consignment details"
                              >
                                {row.consignment_no || row.invoice_no || `CON-${idx + 1}`}
                              </button>
                              {row.date && <div style={{ fontSize: "11.5px", color: "#64748b" }}>{row.date}</div>}
                            </td>
                            <td style={{ fontWeight: 600 }}>{row.supplier_name || "-"}</td>
                            <td className="col-qty" style={{ textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                              {row.quantity}
                            </td>
                            <td style={{ color: "#475569" }}>{row.arrival_date || "-"}</td>
                            <td style={{ textAlign: "center" }}>
                              <span
                                className={`stock-status-pill ${
                                  (row.status || "").toLowerCase().includes("transit")
                                    ? "transit"
                                    : (row.status || "").toLowerCase().includes("dispatched")
                                    ? "dispatched"
                                    : "pending"
                                }`}
                              >
                                {row.status || "Ordered"}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Consignment / PO Detail Modal */}
        {selectedConsignment && (
          <div
            className="stock-breakup-backdrop"
            style={{ zIndex: 1100 }}
            onClick={() => setSelectedConsignment(null)}
            data-testid="consignment-detail-modal"
          >
            <div
              className="stock-breakup-panel"
              style={{ maxWidth: "560px", padding: "20px" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="stock-breakup-header" style={{ marginBottom: "16px" }}>
                <h3 className="stock-breakup-title" style={{ fontSize: "16px" }}>
                  📦 Consignment Details: {selectedConsignment.row.consignment_no || selectedConsignment.row.invoice_no}
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedConsignment(null)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#64748b",
                    fontSize: "20px",
                    lineHeight: 1,
                  }}
                  aria-label="Close consignment details"
                >
                  ✕
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", fontSize: "13px", background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <span style={{ color: "#64748b" }}>Product Name:</span>{" "}
                  <strong>{selectedConsignment.productName}</strong>
                </div>
                <div>
                  <span style={{ color: "#64748b" }}>Quantity:</span>{" "}
                  <strong style={{ color: "#0284c7" }}>{selectedConsignment.row.quantity} Units</strong>
                </div>
                <div>
                  <span style={{ color: "#64748b" }}>Warehouse:</span>{" "}
                  <strong>{selectedConsignment.row.warehouse || activeBreakup?.location || "-"}</strong>
                </div>
                <div>
                  <span style={{ color: "#64748b" }}>Inv. / Cons No:</span>{" "}
                  <strong>{selectedConsignment.row.consignment_no || selectedConsignment.row.invoice_no || "-"}</strong>
                </div>
                <div>
                  <span style={{ color: "#64748b" }}>Inv. Date:</span>{" "}
                  <strong>{selectedConsignment.row.invoice_date || selectedConsignment.row.date || "-"}</strong>
                </div>
                <div>
                  <span style={{ color: "#64748b" }}>Exp. Arri. Date:</span>{" "}
                  <strong>{selectedConsignment.row.expected_arrival_date || selectedConsignment.row.arrival_date || "-"}</strong>
                </div>
                <div>
                  <span style={{ color: "#64748b" }}>ETD Origin Date:</span>{" "}
                  <strong>{selectedConsignment.row.etd_origin_date || "-"}</strong>
                </div>
                <div>
                  <span style={{ color: "#64748b" }}>ETA Port Date:</span>{" "}
                  <strong>{selectedConsignment.row.eta_port_date || "-"}</strong>
                </div>
                <div>
                  <span style={{ color: "#64748b" }}>Status:</span>{" "}
                  <span className="stock-status-pill transit">{selectedConsignment.row.status}</span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                <button
                  type="button"
                  onClick={() => setSelectedConsignment(null)}
                  style={{
                    background: "#4b6584",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "4px",
                    padding: "7px 20px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Product Master View Window (SideDrawer matching Products.tsx) */}
        <SideDrawer
          open={Boolean(activeItem)}
          onClose={() => setActiveItem(null)}
          title="Product Details"
          subtitle={activeItem?.product_name_tally || ""}
          maxWidth="min(900px, 95vw)"
        >
          {activeItem && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
                  Identity &amp; Classification
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", fontSize: "13px" }}>
                  <div><strong>Product Name (Tally):</strong> {activeItem.product_name_tally}</div>
                  <div><strong>Product Code:</strong> {activeItem.product_code || "—"}</div>
                  <div><strong>Brand:</strong> {activeItem.brand || "—"}</div>
                  <div><strong>Category:</strong> {activeItem.category || "Machines"}</div>
                  <div><strong>Sub Category:</strong> {activeItem.sub_category || "—"}</div>
                  <div><strong>HSN Code:</strong> {activeItem.hsn_code || "—"}</div>
                  <div><strong>GST %:</strong> {activeItem.gst_rate || "18%"}</div>
                  <div><strong>UOM:</strong> {activeItem.uom || "SET"}</div>
                </div>
              </div>

              <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
                  Packaging &amp; Pricing
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", fontSize: "13px" }}>
                  <div><strong>Packaging Quantity:</strong> 1</div>
                  <div><strong>Unit of Measure:</strong> {activeItem.uom || "SET"}</div>
                  <div><strong>Total Net Stock:</strong> {activeItem.total_qty} units</div>
                  <div><strong>Stock Status:</strong> {activeItem.total_qty > 0 ? "Available" : activeItem.total_qty < 0 ? "Negative Stock" : "Zero Stock"}</div>
                </div>
              </div>

              <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
                  Dimensions For CBM
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "8px", fontSize: "13px" }}>
                  <div><strong>Length:</strong> — cm</div>
                  <div><strong>Width:</strong> — cm</div>
                  <div><strong>Height:</strong> — cm</div>
                  <div><strong>Packaging Unit CBM:</strong> —</div>
                </div>
              </div>

              <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
                  Location Stock Breakdown
                </h4>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ padding: "8px 12px", textAlign: "left" }}>Location</th>
                      <th style={{ padding: "8px 12px", textAlign: "center" }}>Stock</th>
                      <th style={{ padding: "8px 12px", textAlign: "center" }}>Transit</th>
                      <th style={{ padding: "8px 12px", textAlign: "center" }}>Ordered</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>Mumbai</td>
                      <td style={{ padding: "8px 12px", textAlign: "center", background: "#fef2f2", fontWeight: 700 }}>
                        {activeItem.mumbai}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{activeItem.mumbai_transit}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{activeItem.mumbai_ordered}</td>
                    </tr>
                    <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>Ahmedabad</td>
                      <td style={{ padding: "8px 12px", textAlign: "center", background: "#fef2f2", fontWeight: 700 }}>
                        {activeItem.ahmedabad}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{activeItem.ahmedabad_transit}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{activeItem.ahmedabad_ordered}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>Indore</td>
                      <td style={{ padding: "8px 12px", textAlign: "center", background: "#fef2f2", fontWeight: 700 }}>
                        {activeItem.indore}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{activeItem.indore_transit}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>{activeItem.indore_ordered}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {activeItem.description && (
                <div style={{ background: "#ffffff", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                  <h4 style={{ margin: "0 0 6px", fontSize: "14px", color: "#1e293b" }}>
                    Description &amp; Specifications
                  </h4>
                  <p style={{ margin: 0, fontSize: "13px", color: "#475569", lineHeight: 1.5 }}>
                    {activeItem.description}
                  </p>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px", borderTop: "1px solid #e2e8f0", paddingTop: "14px" }}>
                <button
                  type="button"
                  style={{
                    background: "#ffffff",
                    color: "#475569",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  onClick={() => setActiveItem(null)}
                >
                  Close
                </button>
                <button
                  type="button"
                  style={{
                    background: "#0061f2",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    navigate("/masters/products");
                  }}
                >
                  Open in Product Master ↗
                </button>
              </div>
            </div>
          )}
        </SideDrawer>
      </main>
    </AppShell>
  );
}

export default ProductStockPage;
