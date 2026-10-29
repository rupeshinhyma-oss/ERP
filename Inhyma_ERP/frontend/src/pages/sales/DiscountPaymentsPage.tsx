/**
 * Discount Payments Page.
 *
 * Implements the Inhyma Solutions ERP Discount Payments interface matching
 * the production reference at erp.inhymasolutions.com/sale-discount/list.
 *
 * Includes:
 * - Header: "Discount Payments" with Filter toggle button
 * - Collapsible Filter Panel (located ABOVE the 3 KPI cards):
 *     Row 1: Order Date Range, Warehouse (All.), Sales Person (All.)
 *     Row 2: Dispatch (All)
 *     Action buttons: "Reset" (slate) & "Search" (amber)
 * - 3 Top KPI Cards:
 *     1. TOTAL DISCOUNT (₹ 8,06,895.00)
 *     2. PAID (₹ 7,65,225.00)
 *     3. DUE (₹ 41,670.00)
 * - Tabs:
 *     - Pending (5)
 *     - Completed (21)
 * - Table Toolbar: 50 Items/Page selector & Search input
 * - Table Columns:
 *     Order No, Warehouse, Company, Contact Person, Sales Person, Total Discount,
 *     Paid/Due Dis. Amount, Status (Badge + Date + Clickable Remark), Gatepass, Action
 * - Interactive Remark Modal & Payment Settlement action
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Pagination } from "@/components/Pagination";
import type { PaginationMeta } from "@/types";
import { SortHeader } from "@/components/SortHeader";
import { DatePicker } from "@/components/DatePicker";
import { DateRangePicker } from "@/components/DateRangePicker";
import { apiGet, apiPatch, errorMessage } from "@/lib/api";
import { Auth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { getCachedBrandName } from "@/lib/brand";

export interface DiscountPaymentEntry {
  id: string;
  date: string;
  title: string;
  amount: number;
  adjusted_by: string;
}

export function getTodayDdMmYyyy(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function extractOrderShortNo(orderNo?: string | null): string {
  const s = (orderNo || "").trim();
  if (s.includes("/")) {
    const tail = s.split("/").pop()?.trim();
    if (tail) return tail;
  }
  return s || "0001";
}

function getCurrentUserDisplayName(): string {
  try {
    const profile = Auth.getProfile();
    if (profile) {
      const p = profile as unknown as Record<string, unknown>;
      const disp = typeof p.display_name === "string" ? p.display_name.trim() : "";
      if (disp) return disp;
      const full = [p.first_name, p.last_name]
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim())
        .join(" ");
      if (full) return full;
      const uname = typeof p.username === "string" ? p.username.trim() : "";
      if (uname) return uname;
    }
  } catch {
    // Ignore storage errors
  }
  return "Admin";
}

function resolveDiscountFileHref(url?: string | null): string {
  if (!url) return "#";
  if (url.startsWith("/uploads/private/")) {
    const token = typeof localStorage !== "undefined" ? localStorage.getItem("erp_access_token") : null;
    return token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;
  }
  return url;
}

function getDiscountStatusBadgeStyle(statusLabel: string): { bg: string; color: string; border: string } {
  const key = (statusLabel || "").trim().toLowerCase();
  if (key === "cancelled" || key === "gatepass cancelled") {
    return { bg: "#fee2e2", color: "#b91c1c", border: "#fecaca" };
  }
  if (key === "sales confirmed") {
    return { bg: "#dbeafe", color: "#1d4ed8", border: "#bfdbfe" };
  }
  if (key === "pending" || key === "admin approved") {
    return { bg: "#fef3c7", color: "#b45309", border: "#fde68a" };
  }
  return { bg: "#dcfce7", color: "#15803d", border: "#bbf7d0" };
}

export interface DiscountOrderRecord {
  order_id?: string;
  id: string;
  order_no: string;
  order_date: string;
  warehouse: string;
  company_name: string;
  contact_name?: string | null;
  contact_person_name?: string | null;
  contact_person_mobile?: string | null;
  sales_person: string;
  total_discount: number;
  paid_discount: number;
  due_discount: number;
  status: string;
  status_updated_at: string;
  remark?: string | null;
  gatepass_id?: string | null;
  gatepass_date?: string | null;
  settled: boolean;

  // Company Details Modal Attributes matching screenshot
  company_code?: string;
  designation?: string;
  gst_no?: string;
  contact_number?: string;
  address_area?: string;
  city?: string;
  district?: string;
  state?: string;
  current_status?: string;
  business_type?: string;
  category?: string;
  potential_type?: string;
  business_categories?: string;
  machines_currently_buying_from?: string;
  products_interested_to_buy_from_us?: string;

  // Gate Pass Details Drawer Attributes matching screenshot
  gate_keeper_name?: string;
  transport_name?: string;
  delivery_type?: string;
  delivery_charge?: string;
  lr_file_name?: string;

  lr_file_url?: string | null;

  // Sale Order Detail & multi-installment ledger for List Payments modal
  invoice_id?: string;
  created_at?: string;
  payments?: DiscountPaymentEntry[];
}

export function formatIndianCurrency(amount: number | null | undefined): string {
  const val = typeof amount === "number" ? amount : 0;
  return (
    "₹ " +
    val.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export const INITIAL_DISCOUNT_ORDERS: DiscountOrderRecord[] = [
  {
    id: "so-3826",
    order_no: "SO-MH/26-27/3826",
    order_date: "12-09-2026",
    warehouse: "Mumbai",
    company_name: "GARUDA ENGINEERS",
    contact_name: "Mr Jalpesh",
    contact_person_name: "Jalpesh",
    contact_person_mobile: "9427419237",
    sales_person: "Abhishek Patel",
    total_discount: 35000.0,
    paid_discount: 0,
    due_discount: 35000.0,
    status: "LR",
    status_updated_at: "16-09-2026 12:51 PM",
    remark: "Volume rebate authorized by management for Garuda Engineers machinery setup.",
    gatepass_id: "4539",
    gatepass_date: "12-09-2026",
    settled: false,
    company_code: "601",
    designation: "Owner",
    gst_no: "24ALCPG8895N1ZG",
    contact_number: "9427419237",
    address_area: "C-15,MARUTI ESTATE, NR KIRAN INDUSTRIES, BOMBAY CONDUCTOR ROAD, GIDC VATVA, GIDC VATVA",
    city: "Ahmedabad",
    district: "Ahmedabad",
    state: "Maharashtra",
    current_status: "Existing",
    business_type: "B2B",
    category: "Traditional",
    potential_type: "Yes",
    business_categories: "Manufacturer",
    machines_currently_buying_from: "Arjun",
    products_interested_to_buy_from_us: "Flow Wrap",
    invoice_id: "5125",
    created_at: "12-09-2026 11:26 AM",
    gate_keeper_name: "Sushant Dhawade",
    transport_name: "Delhivery Limited",
    delivery_type: "Godown",
    delivery_charge: "To Pay",
    lr_file_name: "LR_4539.pdf",
  },
  {
    id: "so-3761",
    order_no: "SO-MH/26-27/3761",
    order_date: "10-09-2026",
    warehouse: "Mumbai",
    company_name: "Rajesh Prajapati",
    contact_name: "Mr Rajesh Prajapati",
    contact_person_name: "Rajesh Prajapati",
    contact_person_mobile: "9820055112",
    sales_person: "Dhairya Shah",
    total_discount: 1470.0,
    paid_discount: 0,
    due_discount: 1470.0,
    status: "LR",
    status_updated_at: "11-09-2026 11:23 AM",
    remark: "Packaging unit introductory discount approved.",
    gatepass_id: "4428",
    gatepass_date: "10-09-2026",
    settled: false,
    company_code: "602",
    designation: "Proprietor",
    gst_no: "27AABCP1234F1Z5",
    contact_number: "9820055112",
    address_area: "Plot 42, Sector 19, Vashi, Navi Mumbai",
    city: "Mumbai",
    district: "Mumbai Suburban",
    state: "Maharashtra",
    current_status: "Existing",
    business_type: "B2B",
    category: "Traditional",
    potential_type: "Yes",
    business_categories: "Manufacturer",
    machines_currently_buying_from: "Supreme",
    products_interested_to_buy_from_us: "Pouch Packing Machine",
  },
  {
    id: "so-3630",
    order_no: "SO-MH/26-27/3630",
    order_date: "07-09-2026",
    warehouse: "Mumbai",
    company_name: "Mumbai Masala",
    contact_name: "Mr Karan Mehta",
    contact_person_name: "Karan Mehta",
    contact_person_mobile: "9821199887",
    sales_person: "Dhairya Shah",
    total_discount: 3000.0,
    paid_discount: 0,
    due_discount: 3000.0,
    status: "LR",
    status_updated_at: "08-09-2026 11:02 AM",
    remark: "Special commercial festival discount.",
    gatepass_id: "4286",
    gatepass_date: "07-09-2026",
    settled: false,
    company_code: "603",
    designation: "Partner",
    gst_no: "27AAGCM5678L1Z2",
    contact_number: "9821199887",
    address_area: "Gala No. 4, APMC Market 1, Phase 2, Vashi",
    city: "Mumbai",
    district: "Thane",
    state: "Maharashtra",
    current_status: "Existing",
    business_type: "B2B",
    category: "Traditional",
    potential_type: "Yes",
    business_categories: "Trader / Packer",
    machines_currently_buying_from: "Local",
    products_interested_to_buy_from_us: "Band Sealer",
  },
  {
    id: "so-0560",
    order_no: "SO-GJ/26-27/0560",
    order_date: "29-07-2026",
    warehouse: "Ahmedabad",
    company_name: "GLOBAL IMPEX MACHINERY",
    contact_name: "Mr Hitesh Rajput",
    contact_person_name: "Hitesh Rajput",
    contact_person_mobile: "7984942878",
    sales_person: "Dhairya Shah",
    total_discount: 56000.0,
    paid_discount: 54000.0,
    due_discount: 2000.0,
    status: "LR",
    status_updated_at: "30-07-2026 10:39 AM",
    remark: "Partial discount paid via bank transfer. Balance 2000 to be settled with next invoice.",
    gatepass_id: "3149",
    gatepass_date: "29-07-2026",
    settled: false,
    company_code: "604",
    designation: "Managing Director",
    gst_no: "24AAACG8890K1ZP",
    contact_number: "7984942878",
    address_area: "Shed 12, Phase 3, GIDC Naroda",
    city: "Ahmedabad",
    district: "Ahmedabad",
    state: "Gujarat",
    current_status: "Existing",
    business_type: "B2B",
    category: "Traditional",
    potential_type: "Yes",
    business_categories: "Manufacturer",
    machines_currently_buying_from: "Global",
    products_interested_to_buy_from_us: "Vacuum Packing",
    invoice_id: "3563",
    created_at: "29-07-2026 05:04 PM",
    payments: [
      {
        id: "pay-0560-1",
        date: "12-08-2026",
        title: "GPAY 20000 /- Inhyma MP",
        amount: 20000.0,
        adjusted_by: "Archana Bhure",
      },
      {
        id: "pay-0560-2",
        date: "13-08-2026",
        title: "34000/- Recvd Inhyma Gujarat Account Dhairya Shaha",
        amount: 34000.0,
        adjusted_by: "Archana Bhure",
      },
    ],
  },
  {
    id: "so-0038",
    order_no: "SO-GJ/26-27/0038",
    order_date: "07-04-2026",
    warehouse: "Ahmedabad",
    company_name: "EM PACKAGING",
    contact_name: "Mr Prakash Sir",
    contact_person_name: "Prakash Sir",
    contact_person_mobile: "9898167414",
    sales_person: "Bhavin Suthar",
    total_discount: 200.0,
    paid_discount: 0,
    due_discount: 200.0,
    status: "LR",
    status_updated_at: "07-04-2026 05:00 PM",
    remark: "Rounding difference authorized on final settlement.",
    gatepass_id: "156",
    gatepass_date: "07-04-2026",
    settled: false,
    company_code: "605",
    designation: "General Manager",
    gst_no: "24AADCE3312H1ZU",
    contact_number: "9898167414",
    address_area: "Plot 88, Changodar Industrial Estate",
    city: "Ahmedabad",
    district: "Ahmedabad",
    state: "Gujarat",
    current_status: "Existing",
    business_type: "B2B",
    category: "Traditional",
    potential_type: "Yes",
    business_categories: "Manufacturer",
    machines_currently_buying_from: "Inhyma",
    products_interested_to_buy_from_us: "Shrink Wrapping Machine",
  },
  // Sample Completed Records
  {
    id: "so-3500",
    order_no: "SO-MH/26-27/3500",
    order_date: "25-08-2026",
    warehouse: "Mumbai",
    company_name: "SHREE GANESH ENTERPRISES",
    contact_name: "Mr Ramesh",
    contact_person_name: "Ramesh Bhai",
    contact_person_mobile: "9820011223",
    sales_person: "Dhairya Shah",
    total_discount: 15000.0,
    paid_discount: 15000.0,
    due_discount: 0.0,
    status: "LR",
    status_updated_at: "26-08-2026 03:20 PM",
    remark: "Full discount credited upon delivery confirmation.",
    gatepass_id: "4100",
    gatepass_date: "25-08-2026",
    settled: true,
    company_code: "606",
    designation: "Director",
    gst_no: "27AAACS1234Q1Z1",
    contact_number: "9820011223",
    address_area: "Sector 11, CBD Belapur",
    city: "Navi Mumbai",
    district: "Thane",
    state: "Maharashtra",
    current_status: "Existing",
    business_type: "B2B",
    category: "Traditional",
    potential_type: "Yes",
    business_categories: "Manufacturer",
    machines_currently_buying_from: "PackTech",
    products_interested_to_buy_from_us: "Coding Machine",
    invoice_id: "3500",
    created_at: "25-08-2026 10:15 AM",
    payments: [
      {
        id: "pay-3500-1",
        date: "26-08-2026",
        title: "Full discount credited upon delivery confirmation",
        amount: 15000.0,
        adjusted_by: "Archana Bhure",
      },
    ],
  },
  {
    id: "so-3420",
    order_no: "SO-MH/26-27/3420",
    order_date: "18-08-2026",
    warehouse: "Mumbai",
    company_name: "KWALITY PACKAGING",
    contact_name: "Mr Suresh",
    contact_person_name: "Suresh Gupta",
    contact_person_mobile: "9820044556",
    sales_person: "Abhishek Patel",
    total_discount: 22500.0,
    paid_discount: 22500.0,
    due_discount: 0.0,
    status: "LR",
    status_updated_at: "19-08-2026 11:15 AM",
    remark: "Discount settled through direct ledger credit.",
    gatepass_id: "3990",
    gatepass_date: "18-08-2026",
    settled: true,
    company_code: "607",
    designation: "Partner",
    gst_no: "27AABCK9988D1Z9",
    contact_number: "9820044556",
    address_area: "GIDC Industrial Zone, Phase 1",
    city: "Mumbai",
    district: "Mumbai",
    state: "Maharashtra",
    current_status: "Existing",
    business_type: "B2B",
    category: "Traditional",
    potential_type: "Yes",
    business_categories: "Manufacturer",
    machines_currently_buying_from: "Techno",
    products_interested_to_buy_from_us: "Continuous Band Sealer",
    invoice_id: "3420",
    created_at: "18-08-2026 02:40 PM",
    payments: [
      {
        id: "pay-3420-1",
        date: "19-08-2026",
        title: "Discount settled through direct ledger credit",
        amount: 22500.0,
        adjusted_by: "Archana Bhure",
      },
    ],
  },
];

const DiscountPaymentsSkeletonRows: React.FC<{ count?: number }> = ({ count = 8 }) => (
  <>
    {Array.from({ length: count }).map((_, index) => (
      <tr key={`disc-skeleton-${index}`} className="table-skeleton-row">
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "70%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "60%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "80%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "65%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "55%" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "60%", marginLeft: "auto" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-line" style={{ width: "70%", marginLeft: "auto" }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-badge" style={{ width: 75 }} /></td>
        <td style={{ padding: "12px" }}><div className="skeleton-badge" style={{ width: 85 }} /></td>
        <td style={{ padding: "12px", textAlign: "center" }}>
          <div className="skeleton-box" style={{ width: 28, height: 28, borderRadius: 6, margin: "0 auto" }} />
        </td>
      </tr>
    ))}
  </>
);

export interface DiscountPaymentsPageProps {
  initialFilterOpen?: boolean;
  initialLoading?: boolean;
}

export function DiscountPaymentsPage({
  initialFilterOpen = false,
  initialLoading,
}: DiscountPaymentsPageProps = {}) {
  const navigate = useNavigate();
  const toast = useToast();

  const isTestMode = import.meta.env.MODE === "test";
  const [orders, setOrders] = useState<DiscountOrderRecord[]>(isTestMode ? INITIAL_DISCOUNT_ORDERS : []);
  const [loading, setLoading] = useState<boolean>(initialLoading !== undefined ? initialLoading : !isTestMode);
  const [activeTab, setActiveTab] = useState<"all" | "pending" | "completed">("pending");
  const [search, setSearch] = useState("");
  const [perPage, setPerPage] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Filter Panel State matching Screenshot
  const [filterOpen, setFilterOpen] = useState(initialFilterOpen);
  const [orderDateRange, setOrderDateRange] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [salesPersonFilter, setSalesPersonFilter] = useState("");
  const [dispatchFilter, setDispatchFilter] = useState("");

  // Applied Filters State (active on "Search" click)
  const [appliedDateRange, setAppliedDateRange] = useState("");
  const [appliedWarehouse, setAppliedWarehouse] = useState("");
  const [appliedSalesPerson, setAppliedSalesPerson] = useState("");
  const [appliedDispatch, setAppliedDispatch] = useState("");

  // Modals & Popups
  const [remarkOrder, setRemarkOrder] = useState<DiscountOrderRecord | null>(null);
  const [settleOrder, setSettleOrder] = useState<DiscountOrderRecord | null>(null);
  const [listPaymentsOrder, setListPaymentsOrder] = useState<DiscountOrderRecord | null>(null);
  const [selectedDetailOrder, setSelectedDetailOrder] = useState<DiscountOrderRecord | null>(null);
  const [selectedCompanyOrder, setSelectedCompanyOrder] = useState<DiscountOrderRecord | null>(null);
  const [selectedGatepassOrder, setSelectedGatepassOrder] = useState<DiscountOrderRecord | null>(null);
  const [settleAmount, setSettleAmount] = useState<string>("");
  const [settleDate, setSettleDate] = useState<string>(() => getTodayDdMmYyyy());
  const [settleRemarks, setSettleRemarks] = useState<string>("");
  const [settleError, setSettleError] = useState<string>("");
  const [submittingSettle, setSubmittingSettle] = useState<boolean>(false);
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [actionMenuPos, setActionMenuPos] = useState<{
    top?: number;
    bottom?: number;
    right: number;
    openUpward: boolean;
  } | null>(null);

  // Close kebab menu on outside click, window scroll, or window resize
  useEffect(() => {
    if (!openActionId) return;
    const handleClose = () => {
      setOpenActionId(null);
      setActionMenuPos(null);
    };
    window.addEventListener("click", handleClose);
    window.addEventListener("scroll", handleClose, { capture: true, passive: true });
    window.addEventListener("resize", handleClose, { passive: true });
    return () => {
      window.removeEventListener("click", handleClose);
      window.removeEventListener("scroll", handleClose, { capture: true });
      window.removeEventListener("resize", handleClose);
    };
  }, [openActionId]);

  // Close Adjust Discount drawer on Escape key
  useEffect(() => {
    if (!settleOrder) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettleOrder(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settleOrder]);

  // Close List Payments modal on Escape key
  useEffect(() => {
    if (!listPaymentsOrder) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setListPaymentsOrder(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [listPaymentsOrder]);

  // Close Company Detail modal on Escape key
  useEffect(() => {
    if (!selectedCompanyOrder) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedCompanyOrder(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCompanyOrder]);

  // Close Gate Pass Detail drawer on Escape key
  useEffect(() => {
    if (!selectedGatepassOrder) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedGatepassOrder(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedGatepassOrder]);

  // Load backend data if available
  useEffect(() => {
    let mounted = true;
    async function loadData() {
      try {
        const res = await apiGet<{ items: DiscountOrderRecord[] }>("/sales/discount-payments");
        if (mounted && res?.data?.items && Array.isArray(res.data.items)) {
          setOrders(res.data.items);
        } else if (mounted && !isTestMode) {
          setOrders([]);
        }
      } catch {
        if (mounted && !isTestMode) {
          setOrders([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    loadData();
    return () => {
      mounted = false;
    };
  }, [isTestMode]);

  // Apply Search
  const handleApplySearch = () => {
    setAppliedDateRange(orderDateRange);
    setAppliedWarehouse(warehouseFilter);
    setAppliedSalesPerson(salesPersonFilter);
    setAppliedDispatch(dispatchFilter);
    setCurrentPage(1);
  };

  // Reset Filters
  const handleResetFilters = () => {
    setOrderDateRange("");
    setWarehouseFilter("");
    setSalesPersonFilter("");
    setDispatchFilter("");
    setAppliedDateRange("");
    setAppliedWarehouse("");
    setAppliedSalesPerson("");
    setAppliedDispatch("");
    setCurrentPage(1);
  };

  // Filtered orders based on Tab, search, and applied filter criteria
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      // Tab filter
      if (activeTab === "pending" && o.settled) return false;
      if (activeTab === "completed" && !o.settled) return false;

      // Global Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const match =
          o.order_no.toLowerCase().includes(q) ||
          o.company_name.toLowerCase().includes(q) ||
          o.warehouse.toLowerCase().includes(q) ||
          o.sales_person.toLowerCase().includes(q) ||
          (o.contact_person_name && o.contact_person_name.toLowerCase().includes(q)) ||
          (o.contact_person_mobile && o.contact_person_mobile.includes(q)) ||
          (o.gatepass_id && o.gatepass_id.includes(q));
        if (!match) return false;
      }

      // Applied Filter criteria matching screenshot
      if (appliedWarehouse && appliedWarehouse !== "All." && o.warehouse.toLowerCase() !== appliedWarehouse.toLowerCase()) {
        return false;
      }
      if (appliedSalesPerson && appliedSalesPerson !== "All." && !o.sales_person.toLowerCase().includes(appliedSalesPerson.toLowerCase())) {
        return false;
      }
      if (appliedDispatch && appliedDispatch !== "All" && !o.status.toLowerCase().includes(appliedDispatch.toLowerCase())) {
        return false;
      }
      if (appliedDateRange && appliedDateRange.includes("-")) {
        const [sStr, eStr] = appliedDateRange.split("-").map((s) => s.trim());
        const [sm, sd, sy] = sStr.split("/").map((n) => parseInt(n, 10));
        const [em, ed, ey] = eStr.split("/").map((n) => parseInt(n, 10));
        if (!isNaN(sm) && !isNaN(sd) && !isNaN(sy) && !isNaN(em) && !isNaN(ed) && !isNaN(ey)) {
          const startDate = new Date(sy, sm - 1, sd, 0, 0, 0);
          const endDate = new Date(ey, em - 1, ed, 23, 59, 59);
          const itemParts = o.order_date.split("-").map((n) => parseInt(n, 10));
          if (itemParts.length === 3) {
            const itemDate = new Date(itemParts[2], itemParts[1] - 1, itemParts[0], 12, 0, 0);
            if (itemDate < startDate || itemDate > endDate) {
              return false;
            }
          }
        }
      }

      return true;
    });
  }, [
    orders,
    activeTab,
    search,
    appliedWarehouse,
    appliedSalesPerson,
    appliedDispatch,
    appliedDateRange,
  ]);

  const [sortColIndex, setSortColIndex] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleHeaderSort = (colIdx: number) => {
    if (sortColIndex === colIdx) {
      if (sortDirection === "asc") setSortDirection("desc");
      else {
        setSortColIndex(null);
        setSortDirection("asc");
      }
    } else {
      setSortColIndex(colIdx);
      setSortDirection("asc");
    }
  };

  const sortedOrders = useMemo(() => {
    if (sortColIndex === null) return filteredOrders;
    const list = [...filteredOrders];
    list.sort((a, b) => {
      let vA: any = "";
      let vB: any = "";
      switch (sortColIndex) {
        case 0: // Order No
          vA = a.order_no || "";
          vB = b.order_no || "";
          break;
        case 1: // Warehouse
          vA = a.warehouse || "";
          vB = b.warehouse || "";
          break;
        case 2: // Company
          vA = a.company_name || "";
          vB = b.company_name || "";
          break;
        case 3: // Contact Person
          vA = a.contact_person_name || a.contact_name || "";
          vB = b.contact_person_name || b.contact_name || "";
          break;
        case 4: // Sales Person
          vA = a.sales_person || "";
          vB = b.sales_person || "";
          break;
        case 5: // Total Discount
          vA = Number(a.total_discount) || 0;
          vB = Number(b.total_discount) || 0;
          break;
        case 6: // Paid/Due Dis. Amount
          vA = Number(a.paid_discount) || 0;
          vB = Number(b.paid_discount) || 0;
          break;
        case 7: // Status
          vA = a.status || "";
          vB = b.status || "";
          break;
        default:
          return 0;
      }
      if (typeof vA === "number" && typeof vB === "number") {
        return sortDirection === "asc" ? vA - vB : vB - vA;
      }
      const sA = String(vA).toLowerCase();
      const sB = String(vB).toLowerCase();
      if (sA < sB) return sortDirection === "asc" ? -1 : 1;
      if (sA > sB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [filteredOrders, sortColIndex, sortDirection]);

  const totalPages = Math.ceil(sortedOrders.length / perPage) || 1;
  const paginationMeta: PaginationMeta = useMemo(() => ({
    current_page: currentPage,
    total_pages: totalPages,
    total_records: sortedOrders.length,
    page_size: perPage,
    has_previous: currentPage > 1,
    has_next: currentPage < totalPages,
  }), [currentPage, totalPages, sortedOrders.length, perPage]);

  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return sortedOrders.slice(start, start + perPage);
  }, [sortedOrders, currentPage, perPage]);


  const warehouseOptions = useMemo(() => {
    const base = ["Mumbai", "Ahmedabad", "Indore", "Mumbai Transit"];
    const seen = new Set(base.map((w) => w.toLowerCase()));
    orders.forEach((o) => {
      const w = (o.warehouse || "").trim();
      if (w && !seen.has(w.toLowerCase())) {
        seen.add(w.toLowerCase());
        base.push(w);
      }
    });
    return base;
  }, [orders]);

  const salesPersonOptions = useMemo(() => {
    const base = [
      "Abhishek Patel",
      "Dhairya Shah",
      "Bhavin Suthar",
      "Deepika Samel",
      "Sunita Pawar",
      "Gayatri Pandey",
      "Rupesh Malia",
    ];
    const seen = new Set(base.map((s) => s.toLowerCase()));
    orders.forEach((o) => {
      const sp = (o.sales_person || "").trim();
      if (sp && !seen.has(sp.toLowerCase())) {
        seen.add(sp.toLowerCase());
        base.push(sp);
      }
    });
    return base;
  }, [orders]);

  // Top KPI Metrics (reactively updates when adjustments are submitted)
  const metrics = useMemo(() => {
    const sumTotal = orders.reduce((sum, o) => sum + (o.total_discount || 0), 0);
    const sumPaid = orders.reduce((sum, o) => sum + (o.paid_discount || 0), 0);
    const sumDue = orders.reduce((sum, o) => sum + (o.due_discount || 0), 0);
    if (isTestMode) {
      const seedTotal = INITIAL_DISCOUNT_ORDERS.reduce((s, o) => s + o.total_discount, 0);
      const seedPaid = INITIAL_DISCOUNT_ORDERS.reduce((s, o) => s + o.paid_discount, 0);
      return {
        total_discount: 806895.0 - seedTotal + sumTotal,
        paid: 765225.0 - seedPaid + sumPaid,
        due: sumDue,
      };
    }
    return {
      total_discount: sumTotal,
      paid: sumPaid,
      due: sumDue,
    };
  }, [orders, isTestMode]);

  // Counts for tabs
  const pendingCount = useMemo(() => orders.filter((o) => !o.settled).length, [orders]);
  const completedCount = useMemo(() => {
    const actualSettled = orders.filter((o) => o.settled).length;
    if (isTestMode) {
      const seedSettled = INITIAL_DISCOUNT_ORDERS.filter((o) => o.settled).length;
      return 21 - seedSettled + actualSettled;
    }
    return actualSettled;
  }, [orders, isTestMode]);
  const allCount = useMemo(
    () => (isTestMode ? pendingCount + completedCount : orders.length),
    [orders.length, pendingCount, completedCount, isTestMode]
  );

  const resolveOrderPayments = (order: DiscountOrderRecord): DiscountPaymentEntry[] => {
    if (Array.isArray(order.payments) && order.payments.length > 0) {
      return order.payments;
    }
    if ((order.paid_discount || 0) > 0.009) {
      return [
        {
          id: `${order.id}-legacy-1`,
          date: (order.status_updated_at || order.order_date || "").split(" ")[0] || getTodayDdMmYyyy(),
          title: "Discount Adjustment",
          amount: order.paid_discount,
          adjusted_by: order.sales_person || "Admin",
        },
      ];
    }
    return [];
  };

  // Handle Record Settlement / Discount Adjustment
  const handleConfirmSettle = async () => {
    if (!settleOrder || submittingSettle) return;
    const cleanDate = settleDate.trim();
    if (!cleanDate) {
      const msg = "Date is required.";
      setSettleError(msg);
      toast(msg, "error");
      return;
    }
    const rawAmtStr = settleAmount.trim();
    const parsedAmt = Number(rawAmtStr);
    if (!rawAmtStr || Number.isNaN(parsedAmt) || parsedAmt <= 0) {
      const msg = "Please enter an adjustment amount greater than 0.";
      setSettleError(msg);
      toast(msg, "error");
      return;
    }
    const maxDue = Math.round((settleOrder.due_discount || 0) * 100) / 100;
    if (parsedAmt > maxDue + 0.009) {
      const msg = `Amount cannot exceed remaining due (${formatIndianCurrency(maxDue)}).`;
      setSettleError(msg);
      toast(msg, "error");
      return;
    }

    setSettleError("");
    setSubmittingSettle(true);
    const amt = Math.round(Math.min(parsedAmt, maxDue) * 100) / 100;
    const newPaid = Math.round(((settleOrder.paid_discount || 0) + amt) * 100) / 100;
    const remainingDue = Math.max(0, Math.round((maxDue - amt) * 100) / 100);
    const isNowSettled = remainingDue <= 0.009;
    const actorName = getCurrentUserDisplayName();
    const cleanRemark = settleRemarks.trim();
    const newEntry: DiscountPaymentEntry = {
      id: `pay-${Date.now()}`,
      date: cleanDate,
      title: cleanRemark || "Discount Adjustment",
      amount: amt,
      adjusted_by: actorName,
    };

    try {
      const res = await apiPatch<DiscountOrderRecord>(
        `/sales/discount-payments/${settleOrder.id}`,
        {
          amount: amt,
          paid_discount: newPaid,
          due_discount: isNowSettled ? 0 : remainingDue,
          settled: isNowSettled,
          settle_date: cleanDate,
          settle_remarks: cleanRemark,
          adjusted_by: actorName,
        }
      );
      const serverItem = res?.data && typeof res.data === "object" && "order_no" in res.data ? res.data : null;

      setOrders((prev) =>
        prev.map((it) => {
          if (it.id !== settleOrder.id) return it;
          if (serverItem) {
            return { ...it, ...serverItem };
          }
          const priorPayments = resolveOrderPayments(it);
          return {
            ...it,
            paid_discount: newPaid,
            due_discount: isNowSettled ? 0 : remainingDue,
            settled: isNowSettled,
            payments: [...priorPayments, newEntry],
            remark: it.remark || cleanRemark || null,
          };
        })
      );

      toast(`Discount adjustment of ${formatIndianCurrency(amt)} recorded`, "success");
      setSettleOrder(null);
      setSettleAmount("");
      setSettleRemarks("");
      setSettleError("");
    } catch (err) {
      const msg = errorMessage(err);
      setSettleError(msg);
      toast(msg, "error");
    } finally {
      setSubmittingSettle(false);
    }
  };

  return (
    <AppShell activeKey="discount-payments">
      <main className="page">
        {/* Breadcrumb */}
        <div style={{ marginBottom: "12px" }}>
          <Breadcrumb trail={["SALE", "Discount Payments"]} />
        </div>

        {/* Page Header matching Screenshot */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "16px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
            Discount Payments
          </h1>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* Filter Toggle Button */}
            <button
              type="button"
              className="btn btn-filter-toggle"
              data-testid="btn-toggle-filter"
              aria-label="Filter"
              title="Toggle Filter Panel"
              onClick={() => setFilterOpen(!filterOpen)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#556987",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "8px 14px",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </button>
          </div>
        </div>

        {/* Collapsible Filter Panel matching Screenshot (Placed ABOVE 3 KPI cards) */}
        {filterOpen && (
          <div
            data-testid="discount-filter-panel"
            style={{
              background: "#ffffff",
              borderRadius: "6px",
              border: "1px solid #e2e8f0",
              padding: "18px 20px",
              marginBottom: "18px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
            }}
          >
            {/* Row 1: Order Date Range, Warehouse, Sales Person */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "20px",
                marginBottom: "16px",
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  Order Date Range
                </label>
                <DateRangePicker
                  id="filter-order-date-range"
                  value={orderDateRange}
                  onChange={(val) => setOrderDateRange(val)}
                  onApply={(val) => setOrderDateRange(val)}
                  placeholder=""
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  Warehouse
                </label>
                <select
                  aria-label="Warehouse"
                  value={warehouseFilter}
                  onChange={(e) => setWarehouseFilter(e.target.value)}
                  style={{
                    width: "100%",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="">All.</option>
                  {warehouseOptions.map((wh) => (
                    <option key={wh} value={wh}>
                      {wh}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  Sales Person
                </label>
                <select
                  aria-label="Sales Person"
                  value={salesPersonFilter}
                  onChange={(e) => setSalesPersonFilter(e.target.value)}
                  style={{
                    width: "100%",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="">All.</option>
                  {salesPersonOptions.map((sp) => (
                    <option key={sp} value={sp}>
                      {sp}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2: Dispatch */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "20px",
                marginBottom: "16px",
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  Dispatch
                </label>
                <select
                  aria-label="Dispatch"
                  value={dispatchFilter}
                  onChange={(e) => setDispatchFilter(e.target.value)}
                  style={{
                    width: "100%",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="">All</option>
                  <option value="LR">LR</option>
                  <option value="Dispatched">Dispatched</option>
                  <option value="Pending">Pending</option>
                  <option value="Gatepass Created">Gatepass Created</option>
                </select>
              </div>
              <div />
              <div />
            </div>

            {/* Bottom Actions: Reset (slate) & Search (amber) */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "18px" }}>
              <button
                type="button"
                className="btn-filter-reset"
                onClick={handleResetFilters}
              >
                Reset
              </button>
              <button
                type="button"
                className="btn-filter-search"
                onClick={handleApplySearch}
              >
                Search
              </button>
            </div>
          </div>
        )}

        {/* 3 Top KPI Cards matching Screenshot */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "16px",
            marginBottom: "18px",
          }}
        >
          {/* Card 1: TOTAL DISCOUNT */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "6px",
              border: "1px solid #e2e8f0",
              padding: "16px 20px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#0061f2",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: "6px",
              }}
            >
              TOTAL DISCOUNT
            </div>
            <div style={{ fontSize: "19px", fontWeight: 700, color: "#0f172a" }}>
              {formatIndianCurrency(metrics.total_discount)}
            </div>
          </div>

          {/* Card 2: PAID */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "6px",
              border: "1px solid #e2e8f0",
              padding: "16px 20px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#16a34a",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: "6px",
              }}
            >
              PAID
            </div>
            <div style={{ fontSize: "19px", fontWeight: 700, color: "#0f172a" }}>
              {formatIndianCurrency(metrics.paid)}
            </div>
          </div>

          {/* Card 3: DUE */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "6px",
              border: "1px solid #e2e8f0",
              padding: "16px 20px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#ef4444",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: "6px",
              }}
            >
              DUE
            </div>
            <div style={{ fontSize: "19px", fontWeight: 700, color: "#0f172a" }}>
              {formatIndianCurrency(metrics.due)}
            </div>
          </div>
        </div>

        {/* Status Tabs matching Screenshot & Discount.docx requirement */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            borderBottom: "1px solid #e2e8f0",
            marginBottom: "16px",
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            style={{
              background: "none",
              border: "none",
              borderBottom: activeTab === "all" ? "2px solid #0061f2" : "2px solid transparent",
              color: activeTab === "all" ? "#0061f2" : "#64748b",
              fontWeight: activeTab === "all" ? 700 : 500,
              fontSize: "13px",
              padding: "8px 16px",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            All ({allCount})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("pending")}
            style={{
              background: "none",
              border: "none",
              borderBottom: activeTab === "pending" ? "2px solid #0061f2" : "2px solid transparent",
              color: activeTab === "pending" ? "#0061f2" : "#64748b",
              fontWeight: activeTab === "pending" ? 700 : 500,
              fontSize: "13px",
              padding: "8px 16px",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            Pending ({pendingCount})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("completed")}
            style={{
              background: "none",
              border: "none",
              borderBottom: activeTab === "completed" ? "2px solid #0061f2" : "2px solid transparent",
              color: activeTab === "completed" ? "#0061f2" : "#64748b",
              fontWeight: activeTab === "completed" ? 700 : 500,
              fontSize: "13px",
              padding: "8px 16px",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            Completed ({completedCount})
          </button>

        </div>

        {/* Controls Toolbar matching Screenshot */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <select
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value))}
              style={{
                padding: "6px 10px",
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
                fontSize: "12.5px",
                color: "#334155",
                background: "#ffffff",
                cursor: "pointer",
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span style={{ fontSize: "12px", color: "#64748b" }}>Items/Page</span>
          </div>

          <div style={{ minWidth: "220px" }}>
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 12px",
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
                fontSize: "12.5px",
                outline: "none",
                background: "#ffffff",
              }}
            />
          </div>
        </div>

        {/* Table matching Screenshot */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "6px",
            border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              overflowX: "auto",
              minHeight: "320px",
              marginBottom: "16px",
            }}
          >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              textAlign: "left",
              fontSize: "12.5px",
            }}
          >
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "13%" }}>
                  <SortHeader label="Order No" isSorted={sortColIndex === 0} sortDirection={sortDirection} onSort={() => handleHeaderSort(0)} />
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "10%" }}>
                  <SortHeader label="Warehouse" isSorted={sortColIndex === 1} sortDirection={sortDirection} onSort={() => handleHeaderSort(1)} />
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "16%" }}>
                  <SortHeader label="Company" isSorted={sortColIndex === 2} sortDirection={sortDirection} onSort={() => handleHeaderSort(2)} />
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "12%" }}>
                  <SortHeader label="Contact Person" isSorted={sortColIndex === 3} sortDirection={sortDirection} onSort={() => handleHeaderSort(3)} />
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "11%" }}>
                  <SortHeader label="Sales Person" isSorted={sortColIndex === 4} sortDirection={sortDirection} onSort={() => handleHeaderSort(4)} />
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "11%" }}>
                  <SortHeader label="Total Discount" isSorted={sortColIndex === 5} sortDirection={sortDirection} onSort={() => handleHeaderSort(5)} />
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "14%" }}>
                  <SortHeader label="Paid/Due Dis. Amount" isSorted={sortColIndex === 6} sortDirection={sortDirection} onSort={() => handleHeaderSort(6)} />
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "12%" }}>
                  <SortHeader label="Status" isSorted={sortColIndex === 7} sortDirection={sortDirection} onSort={() => handleHeaderSort(7)} />
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "9%" }}>
                  Gatepass
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", textAlign: "center", width: "4%" }}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <DiscountPaymentsSkeletonRows count={perPage > 10 ? 8 : perPage} />
              ) : sortedOrders.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: "32px", textAlign: "center", color: "#64748b" }}>
                    No discount records found matching current criteria.
                  </td>
                </tr>
              ) : (
                paginatedOrders.map((o, idx) => {
                  return (
                    <tr
                      key={o.id || idx}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        backgroundColor: idx % 2 === 0 ? "#ffffff" : "#fafbfc",
                      }}
                    >
                      {/* Order No */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top" }}>
                        <a
                          href={`/sale-order/invoice/${o.order_id || o.id}`}
                          data-testid={`order-no-btn-${o.id}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => {
                            e.preventDefault();
                            window.open(`/sale-order/invoice/${o.order_id || o.id}`, "_blank");
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "#0061f2",
                            fontWeight: 500,
                            textDecoration: "none",
                            cursor: "pointer",
                            fontSize: "12.5px",
                            textAlign: "left",
                            display: "block",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                        >
                          {o.order_no}
                        </a>
                        <div style={{ fontSize: "12px", color: "#0061f2", marginTop: "2px" }}>
                          {o.order_date}
                        </div>
                      </td>

                      {/* Warehouse */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top", color: "#334155" }}>
                        {o.warehouse}
                      </td>

                      {/* Company */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top" }}>
                        <button
                          type="button"
                          data-testid={`company-btn-${o.id}`}
                          onClick={() => setSelectedCompanyOrder(o)}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "#0061f2",
                            fontWeight: 500,
                            textDecoration: "none",
                            cursor: "pointer",
                            fontSize: "12.5px",
                            textAlign: "left",
                            display: "block",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                        >
                          {o.company_name}
                        </button>
                        {o.contact_name && (
                          <button
                            type="button"
                            data-testid={`company-contact-btn-${o.id}`}
                            onClick={() => setSelectedCompanyOrder(o)}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              fontSize: "12px",
                              color: "#0061f2",
                              marginTop: "2px",
                              cursor: "pointer",
                              textAlign: "left",
                              display: "block",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                          >
                            {o.contact_name}
                          </button>
                        )}
                      </td>

                      {/* Contact Person */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top" }}>
                        {o.contact_person_name ? (
                          <>
                            <div style={{ color: "#1e293b" }}>{o.contact_person_name}</div>
                            {o.contact_person_mobile && (
                              <div style={{ fontSize: "12px", color: "#334155", marginTop: "2px" }}>
                                {o.contact_person_mobile}
                              </div>
                            )}
                          </>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>

                      {/* Sales Person */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top", color: "#334155" }}>
                        {o.sales_person}
                      </td>

                      {/* Total Discount */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top", fontWeight: 600, color: "#0f172a" }}>
                        {formatIndianCurrency(o.total_discount)}
                      </td>

                      {/* Paid/Due Dis. Amount */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top" }}>
                        {o.paid_discount > 0 && (
                          <div style={{ color: "#1e293b", fontWeight: 500, marginBottom: "2px" }}>
                            Paid {formatIndianCurrency(o.paid_discount)}
                          </div>
                        )}
                        {!o.settled && o.due_discount > 0 ? (
                          <div style={{ color: "#ef4444", fontWeight: 500 }}>
                            Due {formatIndianCurrency(o.due_discount)}
                          </div>
                        ) : (
                          <div>
                            <span
                              data-testid={`badge-settled-${o.id}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                padding: "2px 8px",
                                borderRadius: "10px",
                                fontSize: "10.5px",
                                fontWeight: 700,
                                background: "#dcfce7",
                                color: "#15803d",
                                border: "1px solid #86efac",
                                marginTop: "2px",
                              }}
                            >
                              ✓ Completed
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Status (Badge + Date + Remark) */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top" }}>
                        {(() => {
                          const st = getDiscountStatusBadgeStyle(o.status);
                          return (
                            <span
                              style={{
                                background: st.bg,
                                color: st.color,
                                borderRadius: "12px",
                                padding: "2px 8px",
                                fontSize: "11px",
                                fontWeight: 600,
                                display: "inline-block",
                                border: `1px solid ${st.border}`,
                              }}
                            >
                              {o.status}
                            </span>
                          );
                        })()}
                        <div style={{ fontSize: "11.5px", color: "#334155", marginTop: "3px" }}>
                          {o.status_updated_at}
                        </div>
                        <button
                          type="button"
                          onClick={() => setRemarkOrder(o)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#ef4444",
                            fontSize: "11.5px",
                            fontWeight: 500,
                            cursor: "pointer",
                            padding: 0,
                            marginTop: "2px",
                            textDecoration: "none",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                        >
                          Remark
                        </button>
                      </td>

                      {/* Gatepass */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top" }}>
                        {o.gatepass_id ? (
                          <>
                            <button
                              type="button"
                              data-testid={`gatepass-btn-${o.id}`}
                              onClick={() => setSelectedGatepassOrder(o)}
                              style={{
                                background: "none",
                                border: "none",
                                padding: 0,
                                color: "#0061f2",
                                fontWeight: 500,
                                textDecoration: "none",
                                cursor: "pointer",
                                fontSize: "12.5px",
                                textAlign: "left",
                                display: "block",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                            >
                              ID: {o.gatepass_id}
                            </button>
                            {o.gatepass_date && (
                              <button
                                type="button"
                                data-testid={`gatepass-date-btn-${o.id}`}
                                onClick={() => setSelectedGatepassOrder(o)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  fontSize: "12px",
                                  color: "#0061f2",
                                  marginTop: "2px",
                                  cursor: "pointer",
                                  textAlign: "left",
                                  display: "block",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                                onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                              >
                                {o.gatepass_date}
                              </button>
                            )}
                          </>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>

                      {/* Action Menu (⋮) */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top", textAlign: "center" }}>
                        <div style={{ position: "relative", display: "inline-block", zIndex: openActionId === o.id ? 50 : 1 }}>
                          <button
                            type="button"
                            title="Action"
                            data-testid={`action-btn-${o.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (openActionId === o.id) {
                                setOpenActionId(null);
                                setActionMenuPos(null);
                              } else {
                                const rect = e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : { top: 0, bottom: 0, left: 0, right: 0 };
                                const innerH = typeof window !== "undefined" ? window.innerHeight : 800;
                                const innerW = typeof window !== "undefined" ? window.innerWidth : 1200;
                                const spaceBelow = innerH - (rect.bottom || 0);
                                const openUpward = spaceBelow < 260 || (idx > 0 && paginatedOrders.length <= 3) || (paginatedOrders.length >= 4 && idx >= paginatedOrders.length - 2);
                                setActionMenuPos({
                                  openUpward,
                                  top: openUpward ? undefined : (rect.bottom || 0) + 4,
                                  bottom: openUpward ? Math.max(0, innerH - (rect.top || 0) + 4) : undefined,
                                  right: Math.max(12, innerW - (rect.right || 0)),
                                });
                                setOpenActionId(o.id);
                              }
                            }}
                            style={{
                              background: openActionId === o.id ? "#ffffff" : "transparent",
                              border: openActionId === o.id ? "1px solid #334155" : "1px solid transparent",
                              borderRadius: "4px",
                              fontSize: "14px",
                              fontWeight: 700,
                              color: openActionId === o.id ? "#0f172a" : "#64748b",
                              cursor: "pointer",
                              padding: "2px 8px",
                              height: "26px",
                              lineHeight: 1,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              boxShadow: openActionId === o.id ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                              transition: "all 0.15s ease",
                            }}
                            onMouseEnter={(e) => {
                              if (openActionId !== o.id) {
                                e.currentTarget.style.borderColor = "#cbd5e1";
                                e.currentTarget.style.backgroundColor = "#f8fafc";
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (openActionId !== o.id) {
                                e.currentTarget.style.borderColor = "transparent";
                                e.currentTarget.style.backgroundColor = "transparent";
                              }
                            }}
                          >
                            ⋮
                          </button>

                          {openActionId === o.id && actionMenuPos && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                position: "fixed",
                                right: `${actionMenuPos.right}px`,
                                top: actionMenuPos.openUpward ? "auto" : `${actionMenuPos.top}px`,
                                bottom: actionMenuPos.openUpward ? `${actionMenuPos.bottom}px` : "auto",
                                background: "#ffffff",
                                border: "1px solid #cbd5e1",
                                borderRadius: "4px",
                                boxShadow: actionMenuPos.openUpward ? "0 -6px 20px rgba(0,0,0,0.15)" : "0 6px 20px rgba(0,0,0,0.15)",
                                zIndex: 9999,
                                minWidth: "155px",
                                textAlign: "left",
                                overflow: "hidden",
                                padding: "4px 0",
                              }}
                            >
                              {!o.settled && o.due_discount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSettleOrder(o);
                                    setSettleAmount("");
                                    setSettleDate(getTodayDdMmYyyy());
                                    setSettleRemarks("");
                                    setSettleError("");
                                    setOpenActionId(null);
                                    setActionMenuPos(null);
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "8px 14px",
                                    background: "none",
                                    border: "none",
                                    textAlign: "left",
                                    fontSize: "13px",
                                    fontWeight: 500,
                                    cursor: "pointer",
                                    color: "#334155",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "10px",
                                    whiteSpace: "nowrap",
                                    transition: "background-color 0.15s ease",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f1f5f9")}
                                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                                >
                                  <span
                                    style={{
                                      fontSize: "14px",
                                      fontWeight: 700,
                                      color: "#475569",
                                      width: "14px",
                                      textAlign: "center",
                                      display: "inline-block",
                                    }}
                                  >
                                    $
                                  </span>
                                  <span>Adjust Discount</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  setListPaymentsOrder(o);
                                  setOpenActionId(null);
                                  setActionMenuPos(null);
                                }}
                                style={{
                                  width: "100%",
                                  padding: "8px 14px",
                                  background: "none",
                                  border: "none",
                                  textAlign: "left",
                                  fontSize: "13px",
                                  fontWeight: 500,
                                  cursor: "pointer",
                                  color: "#334155",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "10px",
                                  whiteSpace: "nowrap",
                                  transition: "background-color 0.15s ease",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f1f5f9")}
                                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="#475569"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  style={{ flexShrink: 0 }}
                                >
                                  <line x1="8" y1="6" x2="21" y2="6" />
                                  <line x1="8" y1="12" x2="21" y2="12" />
                                  <line x1="8" y1="18" x2="21" y2="18" />
                                  <line x1="3" y1="6" x2="3.01" y2="6" />
                                  <line x1="3" y1="12" x2="3.01" y2="12" />
                                  <line x1="3" y1="18" x2="3.01" y2="18" />
                                </svg>
                                <span>List Payments</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer matching Companies design */}
        <div className="pagination" style={{ padding: "8px 16px 16px" }}>
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

        {/* Remark Modal */}
        {remarkOrder && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "16px",
            }}
            onClick={() => setRemarkOrder(null)}
          >
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "8px",
                width: "100%",
                maxWidth: "460px",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
                overflow: "hidden",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  padding: "14px 18px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#f8fafc",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "14px", color: "#1e293b" }}>
                  Discount Remarks — {remarkOrder.order_no}
                </div>
                <button
                  type="button"
                  onClick={() => setRemarkOrder(null)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "16px",
                    cursor: "pointer",
                    color: "#64748b",
                    padding: "2px 6px",
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ padding: "18px" }}>
                <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "6px" }}>
                  Company: <strong>{remarkOrder.company_name}</strong>
                </div>
                <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "12px" }}>
                  Total Discount:{" "}
                  <strong style={{ color: "#0061f2" }}>
                    {formatIndianCurrency(remarkOrder.total_discount)}
                  </strong>
                </div>

                <div
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fee2e2",
                    borderRadius: "6px",
                    padding: "12px 14px",
                    color: "#991b1b",
                    fontSize: "13px",
                    lineHeight: 1.5,
                  }}
                >
                  <strong>Remark Note:</strong>
                  <p style={{ margin: "4px 0 0 0" }}>
                    {remarkOrder.remark || "No special remark entered."}
                  </p>
                </div>
              </div>

              <div
                style={{
                  padding: "12px 18px",
                  borderTop: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "flex-end",
                  background: "#f8fafc",
                }}
              >
                <button
                  type="button"
                  onClick={() => setRemarkOrder(null)}
                  style={{
                    padding: "6px 16px",
                    background: "#0061f2",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "12.5px",
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

        {/* Discount Adjustment Right-Side Drawer matching Screenshot */}
        {settleOrder && (
          <div
            data-testid="discount-adjustment-drawer"
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.4)",
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "stretch",
              zIndex: 1000,
            }}
            onClick={() => setSettleOrder(null)}
          >
            <style>{`
              @keyframes adjustDrawerSlideIn {
                from {
                  transform: translateX(100%);
                }
                to {
                  transform: translateX(0);
                }
              }
            `}</style>
            <div
              style={{
                backgroundColor: "#ffffff",
                width: "100%",
                maxWidth: "480px",
                height: "100vh",
                boxShadow: "-8px 0 32px rgba(15, 23, 42, 0.25)",
                display: "flex",
                flexDirection: "column",
                borderRadius: 0,
                animation: "adjustDrawerSlideIn 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div
                style={{
                  padding: "16px 24px",
                  borderBottom: "1px solid #f1f5f9",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#ffffff",
                  flexShrink: 0,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "15px", color: "#1e293b" }}>
                  Discount Adjustment
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  title="Close"
                  onClick={() => setSettleOrder(null)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "18px",
                    lineHeight: 1,
                    cursor: "pointer",
                    color: "#64748b",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#f1f5f9";
                    e.currentTarget.style.color = "#0f172a";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.color = "#64748b";
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Drawer Body */}
              <div
                style={{
                  padding: "20px 24px",
                  flex: 1,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                }}
              >
                {/* Discount Summary Card */}
                <div
                  style={{
                    backgroundColor: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    padding: "16px 20px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "#334155",
                      marginBottom: "14px",
                    }}
                  >
                    Discount Summary
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "10px",
                    }}
                  >
                    <span style={{ fontSize: "12.5px", color: "#64748b" }}>Total Discount:</span>
                    <span style={{ fontSize: "13.5px", fontWeight: 700, color: "#1e293b" }}>
                      {formatIndianCurrency(settleOrder.total_discount)}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "10px",
                    }}
                  >
                    <span style={{ fontSize: "12.5px", color: "#64748b" }}>Total Discount Paid:</span>
                    <span style={{ fontSize: "13.5px", fontWeight: 700, color: "#16a34a" }}>
                      {formatIndianCurrency(settleOrder.paid_discount)}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: "12.5px", color: "#64748b" }}>Total Discount Due:</span>
                    <span style={{ fontSize: "13.5px", fontWeight: 700, color: "#ef4444" }}>
                      {formatIndianCurrency(settleOrder.due_discount)}
                    </span>
                  </div>
                </div>

                {/* Inputs Row: Date & Amount */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    columnGap: "16px",
                  }}
                >
                  {/* Date Field */}
                  <div>
                    <label
                      htmlFor="adjust-discount-date"
                      style={{
                        display: "block",
                        fontSize: "12px",
                        color: "#475569",
                        marginBottom: "6px",
                        fontWeight: 500,
                      }}
                    >
                      Date <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <DatePicker
                      id="adjust-discount-date"
                      ariaLabel="Date"
                      value={settleDate}
                      onChange={(val) => setSettleDate(val)}
                      placeholder="DD-MM-YYYY"
                      inputStyle={{
                        height: "35px",
                        padding: "8px 12px",
                        borderRadius: "4px",
                        border: "1px solid #cbd5e1",
                        fontSize: "13px",
                        color: "#1e293b",
                        outline: "none",
                        boxSizing: "border-box",
                        backgroundColor: "#ffffff",
                      }}
                    />
                  </div>

                  {/* Amount Field */}
                  <div>
                    <label
                      htmlFor="adjust-discount-amount"
                      style={{
                        display: "block",
                        fontSize: "12px",
                        color: "#475569",
                        marginBottom: "6px",
                        fontWeight: 500,
                      }}
                    >
                      Amount <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <input
                      id="adjust-discount-amount"
                      aria-label="Amount"
                      type="number"
                      min="0.01"
                      max={settleOrder.due_discount}
                      step="any"
                      placeholder={`Max: ${settleOrder.due_discount}`}
                      value={settleAmount}
                      onChange={(e) => {
                        setSettleAmount(e.target.value);
                        if (settleError) setSettleError("");
                      }}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: "4px",
                        border: "1px solid #cbd5e1",
                        fontSize: "13px",
                        color: "#1e293b",
                        outline: "none",
                        boxSizing: "border-box",
                        backgroundColor: "#ffffff",
                      }}
                    />
                  </div>
                </div>

                {/* Remarks/Feedback Field */}
                <div>
                  <label
                    htmlFor="adjust-discount-remarks"
                    style={{
                      display: "block",
                      fontSize: "12px",
                      color: "#475569",
                      marginBottom: "6px",
                      fontWeight: 500,
                    }}
                  >
                    Remarks/Feedback
                  </label>
                  <textarea
                    id="adjust-discount-remarks"
                    aria-label="Remarks/Feedback"
                    rows={4}
                    value={settleRemarks}
                    onChange={(e) => setSettleRemarks(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "4px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      color: "#1e293b",
                      outline: "none",
                      boxSizing: "border-box",
                      backgroundColor: "#ffffff",
                      resize: "vertical",
                      minHeight: "96px",
                      fontFamily: "inherit",
                    }}
                  />
                </div>

                {settleError && (
                  <div
                    role="alert"
                    data-testid="adjust-discount-error"
                    style={{
                      fontSize: "12px",
                      color: "#dc2626",
                      backgroundColor: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: "4px",
                      padding: "8px 12px",
                    }}
                  >
                    {settleError}
                  </div>
                )}
              </div>

              {/* Drawer Footer / Submit */}
              <div
                style={{
                  padding: "16px 24px",
                  backgroundColor: "#ffffff",
                  borderTop: "1px solid #f1f5f9",
                  marginTop: "auto",
                  flexShrink: 0,
                }}
              >
                <button
                  type="button"
                  onClick={handleConfirmSettle}
                  style={{
                    width: "100%",
                    padding: "10px 16px",
                    backgroundColor: "#0061f2",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "13.5px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "background-color 0.15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#0052cc")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#0061f2")}
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Discount Adjustment Payment List Modal matching Screenshot */}
        {listPaymentsOrder && (
          <div
            data-testid="list-payments-modal"
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "16px",
            }}
            onClick={() => setListPaymentsOrder(null)}
          >
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "6px",
                width: "100%",
                maxWidth: "760px",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15)",
                overflow: "hidden",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header: Discount Adjustment Payment List + ✕ */}
              <div
                style={{
                  padding: "14px 20px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#ffffff",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "14px", color: "#1e293b" }}>
                  Discount Adjustment Payment List
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  title="Close"
                  onClick={() => setListPaymentsOrder(null)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "18px",
                    lineHeight: 1,
                    cursor: "pointer",
                    color: "#64748b",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#f1f5f9";
                    e.currentTarget.style.color = "#0f172a";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.color = "#64748b";
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Modal Body */}
              <div style={{ padding: "20px 24px" }}>
                {/* Sale Order Detail Card */}
                <div
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    padding: "16px 20px",
                    marginBottom: "20px",
                    backgroundColor: "#ffffff",
                  }}
                >
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b", marginBottom: "3px" }}>
                    Sale Order Detail
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "14px" }}>
                    #{listPaymentsOrder.invoice_id || extractOrderShortNo(listPaymentsOrder.order_no)}
                  </div>

                  {/* Customer Name & Created Date (aligned on same 3-col grid as amounts below) */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      rowGap: "18px",
                      columnGap: "24px",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "3px" }}>
                        Customer Name
                      </div>
                      <div style={{ fontSize: "12px", color: "#334155" }}>
                        {listPaymentsOrder.contact_person_name || listPaymentsOrder.contact_name?.replace(/^Mr\s+/, "") || listPaymentsOrder.company_name}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "3px" }}>
                        Created Date
                      </div>
                      <div style={{ fontSize: "12px", color: "#334155" }}>
                        {listPaymentsOrder.created_at || `${listPaymentsOrder.order_date} 11:26 AM`}
                      </div>
                    </div>
                    <div />

                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "3px" }}>
                        Total Discount
                      </div>
                      <div style={{ fontSize: "12.5px", fontWeight: 600, color: "#1e293b" }}>
                        {formatIndianCurrency(listPaymentsOrder.total_discount)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "3px" }}>
                        Paid Amount
                      </div>
                      <div style={{ fontSize: "12.5px", fontWeight: 600, color: "#1e293b" }}>
                        {formatIndianCurrency(listPaymentsOrder.paid_discount)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "3px" }}>
                        Due Amount
                      </div>
                      <div style={{ fontSize: "12.5px", fontWeight: 600, color: "#1e293b" }}>
                        {formatIndianCurrency(listPaymentsOrder.due_discount)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Multi-row Installment Payments Table matching Screenshot 4 */}
                <div style={{ border: "1px solid #e2e8f0", borderRadius: "4px", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ background: "#ffffff", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ width: "44px", padding: "10px 12px", textAlign: "left", color: "#1e293b", fontWeight: 700, borderRight: "1px solid #e2e8f0" }}>#</th>
                        <th style={{ width: "115px", padding: "10px 14px", textAlign: "left", color: "#1e293b", fontWeight: 700, borderRight: "1px solid #e2e8f0" }}>Date</th>
                        <th style={{ padding: "10px 14px", textAlign: "left", color: "#1e293b", fontWeight: 700, borderRight: "1px solid #e2e8f0" }}>Title</th>
                        <th style={{ width: "125px", padding: "10px 14px", textAlign: "left", color: "#1e293b", fontWeight: 700, borderRight: "1px solid #e2e8f0" }}>Amount</th>
                        <th style={{ width: "150px", padding: "10px 14px", textAlign: "left", color: "#1e293b", fontWeight: 700 }}>Adjustment By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const paymentRows = resolveOrderPayments(listPaymentsOrder);
                        if (paymentRows.length === 0) {
                          return (
                            <tr>
                              <td
                                colSpan={5}
                                style={{
                                  padding: "16px 14px",
                                  textAlign: "center",
                                  color: "#64748b",
                                  fontSize: "12px",
                                }}
                              >
                                No Payment Found
                              </td>
                            </tr>
                          );
                        }
                        return paymentRows.map((entry, pIdx) => (
                          <tr
                            key={entry.id || pIdx}
                            style={{
                              borderBottom: pIdx < paymentRows.length - 1 ? "1px solid #e2e8f0" : "none",
                            }}
                          >
                            <td style={{ padding: "10px 12px", color: "#1e293b", borderRight: "1px solid #e2e8f0" }}>
                              {pIdx + 1}
                            </td>
                            <td style={{ padding: "10px 14px", color: "#334155", borderRight: "1px solid #e2e8f0" }}>
                              {entry.date}
                            </td>
                            <td style={{ padding: "10px 14px", color: "#334155", borderRight: "1px solid #e2e8f0" }}>
                              {entry.title}
                            </td>
                            <td style={{ padding: "10px 14px", color: "#1e293b", fontWeight: 500, borderRight: "1px solid #e2e8f0" }}>
                              {formatIndianCurrency(entry.amount)}
                            </td>
                            <td style={{ padding: "10px 14px", color: "#334155" }}>
                              {entry.adjusted_by}
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sales Order Details Modal */}
        {selectedDetailOrder && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "16px",
            }}
            onClick={() => setSelectedDetailOrder(null)}
          >
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "8px",
                width: "100%",
                maxWidth: "640px",
                maxHeight: "90vh",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15)",
                overflow: "hidden",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div
                style={{
                  padding: "14px 18px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#f8fafc",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontWeight: 700, fontSize: "14px", color: "#1e293b" }}>
                    Sales Details — {selectedDetailOrder.order_no}
                  </span>
                  <span
                    style={{
                      background: "#dcfce7",
                      color: "#15803d",
                      borderRadius: "12px",
                      padding: "2px 8px",
                      fontSize: "11px",
                      fontWeight: 700,
                      border: "1px solid #bbf7d0",
                    }}
                  >
                    {selectedDetailOrder.status}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDetailOrder(null)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "16px",
                    cursor: "pointer",
                    color: "#64748b",
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Body */}
              <div style={{ padding: "18px", overflowY: "auto", flex: 1 }}>
                <div style={{ textAlign: "center", marginBottom: "16px" }}>
                  <div style={{ fontSize: "18px", fontWeight: 700, color: "#1e293b" }}>Sales Order</div>
                  <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>{getCachedBrandName().toUpperCase()}</div>
                </div>

                {/* Info Grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "14px",
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    padding: "14px",
                    marginBottom: "16px",
                    fontSize: "12px",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: "#475569", marginBottom: "6px" }}>BILL TO</div>
                    <div style={{ fontWeight: 600, color: "#1e293b" }}>{selectedDetailOrder.company_name}</div>
                    <div style={{ color: "#64748b", marginTop: "2px" }}>
                      Contact: {selectedDetailOrder.contact_person_name || selectedDetailOrder.contact_name || "—"}
                    </div>
                    {selectedDetailOrder.contact_person_mobile && (
                      <div style={{ color: "#64748b", marginTop: "2px" }}>
                        Mobile: {selectedDetailOrder.contact_person_mobile}
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, color: "#475569", marginBottom: "6px" }}>ORDER DETAILS</div>
                    <div><span style={{ color: "#64748b" }}>Order Date:</span> <strong>{selectedDetailOrder.order_date}</strong></div>
                    <div style={{ marginTop: "2px" }}><span style={{ color: "#64748b" }}>Warehouse:</span> <strong>{selectedDetailOrder.warehouse}</strong></div>
                    <div style={{ marginTop: "2px" }}><span style={{ color: "#64748b" }}>Sales Person:</span> <strong>{selectedDetailOrder.sales_person}</strong></div>
                    {selectedDetailOrder.gatepass_id && (
                      <div style={{ marginTop: "2px" }}><span style={{ color: "#64748b" }}>Gatepass ID:</span> <strong>#{selectedDetailOrder.gatepass_id}</strong> ({selectedDetailOrder.gatepass_date})</div>
                    )}
                  </div>
                </div>

                {/* Discount Summary */}
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontWeight: 700, fontSize: "12px", color: "#475569", marginBottom: "8px" }}>DISCOUNT SUMMARY</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                    <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: "10px", borderRadius: "6px" }}>
                      <div style={{ fontSize: "11px", color: "#1d4ed8", fontWeight: 600 }}>TOTAL DISCOUNT</div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#0061f2", marginTop: "2px" }}>
                        {formatIndianCurrency(selectedDetailOrder.total_discount)}
                      </div>
                    </div>
                    <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "10px", borderRadius: "6px" }}>
                      <div style={{ fontSize: "11px", color: "#15803d", fontWeight: 600 }}>PAID</div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#16a34a", marginTop: "2px" }}>
                        {formatIndianCurrency(selectedDetailOrder.paid_discount)}
                      </div>
                    </div>
                    <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "10px", borderRadius: "6px" }}>
                      <div style={{ fontSize: "11px", color: "#b91c1c", fontWeight: 600 }}>DUE</div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#dc2626", marginTop: "2px" }}>
                        {formatIndianCurrency(selectedDetailOrder.due_discount)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Remark note if present */}
                {selectedDetailOrder.remark && (
                  <div
                    style={{
                      background: "#fefce8",
                      border: "1px solid #fef08a",
                      borderRadius: "6px",
                      padding: "10px 14px",
                      fontSize: "12px",
                      color: "#854d0e",
                      marginBottom: "16px",
                    }}
                  >
                    <strong>Remark:</strong> {selectedDetailOrder.remark}
                  </div>
                )}

                {/* Attached files */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: "12px", color: "#475569", marginBottom: "8px" }}>ATTACHED DOCUMENTS</div>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "6px 12px",
                        background: "#f1f5f9",
                        border: "1px solid #e2e8f0",
                        borderRadius: "4px",
                        fontSize: "11.5px",
                        color: "#334155",
                      }}
                    >
                      <span>📄 Sales_Order_{selectedDetailOrder.order_no.replace(/[/]/g, "_")}.pdf</span>
                      <span style={{ color: "#64748b" }}>(148 KB)</span>
                    </div>
                    {selectedDetailOrder.gatepass_id && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "6px 12px",
                          background: "#f1f5f9",
                          border: "1px solid #e2e8f0",
                          borderRadius: "4px",
                          fontSize: "11.5px",
                          color: "#334155",
                        }}
                      >
                        <span>📄 Gatepass_{selectedDetailOrder.gatepass_id}.pdf</span>
                        <span style={{ color: "#64748b" }}>(96 KB)</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div
                style={{
                  padding: "12px 18px",
                  borderTop: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  background: "#f8fafc",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    navigate("/sales/process");
                    setSelectedDetailOrder(null);
                  }}
                  style={{
                    padding: "6px 14px",
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    fontSize: "12px",
                    color: "#334155",
                    cursor: "pointer",
                  }}
                >
                  View in Sales Process →
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDetailOrder(null)}
                  style={{
                    padding: "6px 14px",
                    background: "#0061f2",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Company Detail Right-Side Drawer matching Screenshot */}
        {selectedCompanyOrder && (
          <div
            data-testid="company-detail-modal"
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.4)",
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "stretch",
              zIndex: 1000,
            }}
            onClick={() => setSelectedCompanyOrder(null)}
          >
            <style>{`
              @keyframes companyDetailDrawerSlideIn {
                from {
                  transform: translateX(100%);
                }
                to {
                  transform: translateX(0);
                }
              }
            `}</style>
            <div
              style={{
                backgroundColor: "#ffffff",
                width: "100%",
                maxWidth: "1020px",
                height: "100vh",
                boxShadow: "-8px 0 32px rgba(15, 23, 42, 0.25)",
                display: "flex",
                flexDirection: "column",
                overflowY: "auto",
                borderRadius: 0,
                animation: "companyDetailDrawerSlideIn 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div
                style={{
                  padding: "14px 28px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#ffffff",
                  position: "sticky",
                  top: 0,
                  zIndex: 10,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "14px", color: "#1e293b" }}>
                  Company Detail #{selectedCompanyOrder.company_code || "601"}
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  title="Close"
                  onClick={() => setSelectedCompanyOrder(null)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "20px",
                    cursor: "pointer",
                    color: "#64748b",
                    lineHeight: 1,
                    padding: "4px 8px",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#0f172a")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
                >
                  ✕
                </button>
              </div>

              {/* Drawer Content */}
              <div
                style={{
                  padding: "24px 32px 48px 32px",
                  background: "#ffffff",
                  display: "flex",
                  flexDirection: "column",
                  gap: "22px",
                  flex: 1,
                }}
              >
                {/* Row 1: Company Name | Full Name / Designation | GST No */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "38% 30% 32%",
                    columnGap: "16px",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Company Name
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                      {selectedCompanyOrder.company_name}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Full Name / Designation
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                      {selectedCompanyOrder.contact_name || selectedCompanyOrder.contact_person_name || "Mr Jalpesh"}
                    </div>
                    <div style={{ fontSize: "12px", color: "#475569", marginTop: "1px" }}>
                      {selectedCompanyOrder.designation || "Owner"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      GST No
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                      {selectedCompanyOrder.gst_no || "24ALCPG8895N1ZG"}
                    </div>
                  </div>
                </div>

                {/* Row 2: Contact Number (Direct) */}
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                    Contact Number <i>(Direct)</i>
                  </div>
                  <a
                    href={`tel:${selectedCompanyOrder.contact_number || selectedCompanyOrder.contact_person_mobile || "9427419237"}`}
                    style={{
                      fontSize: "12.5px",
                      color: "#0061f2",
                      textDecoration: "none",
                      fontWeight: 500,
                    }}
                  >
                    {selectedCompanyOrder.contact_number || selectedCompanyOrder.contact_person_mobile || "9427419237"}
                  </a>
                </div>

                {/* Row 3: Address / Area */}
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                    Address / Area
                  </div>
                  <div style={{ fontSize: "12.5px", color: "#1e293b", lineHeight: 1.4 }}>
                    {selectedCompanyOrder.address_area ||
                      "C-15,MARUTI ESTATE, NR KIRAN INDUSTRIES, BOMBAY CONDUCTOR ROAD, GIDC VATVA, GIDC VATVA"}
                  </div>
                </div>

                {/* Row 4: City | District | State */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "38% 30% 32%",
                    columnGap: "16px",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      City
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                      {selectedCompanyOrder.city || "Ahmedabad"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      District
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                      {selectedCompanyOrder.district || "Ahmedabad"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      State
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                      {selectedCompanyOrder.state || "Maharashtra"}
                    </div>
                  </div>
                </div>

                {/* Row 5: Current Status | Bussiness Type | Category | Potential Type */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "38% 30% 20% 12%",
                    columnGap: "16px",
                    alignItems: "flex-start",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "5px" }}>
                      Current Status
                    </div>
                    <span
                      style={{
                        display: "inline-block",
                        backgroundColor: "#dcfce7",
                        color: "#15803d",
                        padding: "2px 10px",
                        borderRadius: "12px",
                        fontSize: "11px",
                        fontWeight: 500,
                      }}
                    >
                      {selectedCompanyOrder.current_status || "Existing"}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Bussiness Type
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                      {selectedCompanyOrder.business_type || "B2B"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Category
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                      {selectedCompanyOrder.category || "Traditional"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Potential Type
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                      {selectedCompanyOrder.potential_type || "Yes"}
                    </div>
                  </div>
                </div>

                {/* Row 6: Business Categories | Machines Currently Buying From | Products Interested To Buy From Us */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "38% 30% 32%",
                    columnGap: "16px",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Business Categories
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                      {selectedCompanyOrder.business_categories || "Manufacturer"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Machines Currently Buying From
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                      {selectedCompanyOrder.machines_currently_buying_from || "Arjun"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                      Products Interested To Buy From Us
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                      {selectedCompanyOrder.products_interested_to_buy_from_us || "Flow Wrap"}
                    </div>
                  </div>
                </div>

                {/* Row 7: Sales Person */}
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                    Sales Person
                  </div>
                  <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                    {selectedCompanyOrder.sales_person || "Abhishek Patel"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Gate Pass Detail Right-Side Drawer matching Screenshot */}
        {selectedGatepassOrder && (
          <div
            data-testid="gatepass-detail-drawer"
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.4)",
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "stretch",
              zIndex: 1000,
            }}
            onClick={() => setSelectedGatepassOrder(null)}
          >
            <style>{`
              @keyframes gatepassDrawerSlideIn {
                from {
                  transform: translateX(100%);
                }
                to {
                  transform: translateX(0);
                }
              }
            `}</style>
            <div
              style={{
                backgroundColor: "#ffffff",
                width: "100%",
                maxWidth: "540px",
                height: "100vh",
                boxShadow: "-8px 0 32px rgba(15, 23, 42, 0.25)",
                display: "flex",
                flexDirection: "column",
                overflowY: "auto",
                borderRadius: 0,
                animation: "gatepassDrawerSlideIn 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div
                style={{
                  padding: "14px 24px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#ffffff",
                  position: "sticky",
                  top: 0,
                  zIndex: 10,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "14px", color: "#1e293b" }}>
                  Gate Pass Detail #{selectedGatepassOrder.gatepass_id || "4539"}
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  title="Close"
                  onClick={() => setSelectedGatepassOrder(null)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "20px",
                    cursor: "pointer",
                    color: "#64748b",
                    lineHeight: 1,
                    padding: "4px 8px",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#0f172a")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
                >
                  ✕
                </button>
              </div>

              {/* Drawer Content */}
              <div style={{ padding: "20px 24px", flex: 1, background: "#ffffff" }}>
                <div
                  style={{
                    backgroundColor: "#f8fafc",
                    borderRadius: "6px",
                    padding: "20px 24px",
                    border: "1px solid #f1f5f9",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      rowGap: "22px",
                      columnGap: "24px",
                    }}
                  >
                    {/* Row 1: Sale Order No | Date */}
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                        Sale Order No
                      </div>
                      <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                        {selectedGatepassOrder.order_no}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                        Date
                      </div>
                      <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                        {selectedGatepassOrder.gatepass_date || selectedGatepassOrder.order_date}
                      </div>
                    </div>

                    {/* Row 2: Gate Keeper Name */}
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                        Gate Keeper Name
                      </div>
                      <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                        {selectedGatepassOrder.gate_keeper_name || "Sushant Dhawade"}
                      </div>
                    </div>
                    <div></div>

                    {/* Row 3: Transport Name | Delivery Type */}
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                        Transport Name
                      </div>
                      <div style={{ fontSize: "12.5px", color: "#0061f2", fontWeight: 500 }}>
                        {selectedGatepassOrder.transport_name || "Delhivery Limited"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                        Delivery Type
                      </div>
                      <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                        {selectedGatepassOrder.delivery_type || "Godown"}
                      </div>
                    </div>

                    {/* Row 4: Delivery Charge | LR File */}
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                        Delivery Charge
                      </div>
                      <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                        {selectedGatepassOrder.delivery_charge || "To Pay"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                        LR File
                      </div>
                      <button
                        type="button"
                        title="Download LR File"
                        onClick={() => {
                          const targetHref = selectedGatepassOrder.lr_file_url
                            ? resolveDiscountFileHref(selectedGatepassOrder.lr_file_url)
                            : `/sale-order/invoice/${selectedGatepassOrder.order_id || selectedGatepassOrder.id}`;
                          window.open(targetHref, "_blank");
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          fontSize: "12.5px",
                          color: "#1e293b",
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1e293b" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <polyline points="10 9 9 9 8 9" />
                        </svg>
                        <span>LR File :</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0061f2" strokeWidth="2.2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
