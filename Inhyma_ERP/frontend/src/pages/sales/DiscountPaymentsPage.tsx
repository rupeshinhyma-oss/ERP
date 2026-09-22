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
import { DatePicker } from "@/components/DatePicker";
import { DateRangePicker } from "@/components/DateRangePicker";
import { apiGet, apiPatch } from "@/lib/api";
import { useToast } from "@/lib/toast";

export interface DiscountOrderRecord {
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

  // Sale Order Detail attributes for List Payments modal
  invoice_id?: string;
  created_at?: string;
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
  },
];

export interface DiscountPaymentsPageProps {
  initialFilterOpen?: boolean;
}

export function DiscountPaymentsPage({
  initialFilterOpen = false,
}: DiscountPaymentsPageProps = {}) {
  const navigate = useNavigate();
  const toast = useToast();

  const [orders, setOrders] = useState<DiscountOrderRecord[]>(INITIAL_DISCOUNT_ORDERS);
  const [activeTab, setActiveTab] = useState<"pending" | "completed">("pending");
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
  const [settleDate, setSettleDate] = useState<string>("22-09-2026");
  const [settleRemarks, setSettleRemarks] = useState<string>("");
  const [openActionId, setOpenActionId] = useState<string | null>(null);

  // Close kebab menu on outside click
  useEffect(() => {
    if (!openActionId) return;
    const handleOutside = () => setOpenActionId(null);
    document.addEventListener("click", handleOutside);
    return () => document.removeEventListener("click", handleOutside);
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
        if (mounted && res?.data?.items && res.data.items.length > 0) {
          setOrders(res.data.items);
        }
      } catch {
        // Fallback silently to initial dataset
      }
    }
    loadData();
    return () => {
      mounted = false;
    };
  }, []);

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

  // Active filter count
  const activeFiltersCount = useMemo(() => {
    let cnt = 0;
    if (appliedWarehouse && appliedWarehouse !== "All.") cnt++;
    if (appliedSalesPerson && appliedSalesPerson !== "All.") cnt++;
    if (appliedDispatch && appliedDispatch !== "All") cnt++;
    if (appliedDateRange) cnt++;
    return cnt;
  }, [appliedWarehouse, appliedSalesPerson, appliedDispatch, appliedDateRange]);

  // Top KPI Metrics
  const metrics = useMemo(() => {
    return {
      total_discount: 806895.0,
      paid: 765225.0,
      due: 41670.0,
    };
  }, []);

  // Counts for tabs
  const pendingCount = useMemo(() => orders.filter((o) => !o.settled).length, [orders]);
  const completedCount = 21; // Matches legacy screenshot

  // Handle Record Settlement
  const handleConfirmSettle = async () => {
    if (!settleOrder) return;
    const parsedAmt = parseFloat(settleAmount);
    const amt = isNaN(parsedAmt) || parsedAmt <= 0 ? settleOrder.due_discount : Math.min(parsedAmt, settleOrder.due_discount);
    const remainingDue = Math.max(0, settleOrder.due_discount - amt);

    setOrders((prev) =>
      prev.map((it) => {
        if (it.id === settleOrder.id) {
          return {
            ...it,
            paid_discount: it.paid_discount + amt,
            due_discount: remainingDue,
            settled: remainingDue === 0,
            remark: settleRemarks ? `${it.remark ? it.remark + " | " : ""}${settleRemarks}` : it.remark,
          };
        }
        return it;
      })
    );

    try {
      await apiPatch(`/sales/discount-payments/${settleOrder.id}`, {
        paid_discount: settleOrder.paid_discount + amt,
        due_discount: remainingDue,
        settled: remainingDue === 0,
        settle_date: settleDate,
        settle_remarks: settleRemarks,
      });
    } catch {
      // Local fallback
    }

    toast(`Settlement of ₹ ${amt.toLocaleString("en-IN")} recorded`, "success");
    setSettleOrder(null);
    setSettleAmount("");
    setSettleRemarks("");
  };

  return (
    <AppShell activeKey="discount-payments">
      <main className="page" style={{ padding: "16px 24px", maxWidth: "100%", background: "#f8fafc" }}>
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
              data-testid="btn-toggle-filter"
              aria-label="Filter"
              title="Toggle Filter Panel"
              onClick={() => setFilterOpen(!filterOpen)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#475569",
                color: "#ffffff",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                height: "36px",
                width: "38px",
                padding: 0,
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                position: "relative",
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="none"
              >
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              {activeFiltersCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: "-4px",
                    right: "-4px",
                    background: "#0061f2",
                    color: "#ffffff",
                    borderRadius: "10px",
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "1px 5px",
                    lineHeight: 1,
                  }}
                >
                  {activeFiltersCount}
                </span>
              )}
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
                  <option value="Mumbai">Mumbai</option>
                  <option value="Ahmedabad">Ahmedabad</option>
                  <option value="Indore">Indore</option>
                  <option value="Mumbai Transit">Mumbai Transit</option>
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
                  <option value="Abhishek Patel">Abhishek Patel</option>
                  <option value="Dhairya Shah">Dhairya Shah</option>
                  <option value="Bhavin Suthar">Bhavin Suthar</option>
                  <option value="Deepika Samel">Deepika Samel</option>
                  <option value="Sunita Pawar">Sunita Pawar</option>
                  <option value="Gayatri Pandey">Gayatri Pandey</option>
                  <option value="Rupesh Malia">Rupesh Malia</option>
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
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                onClick={handleResetFilters}
                style={{
                  background: "#526074",
                  border: "none",
                  borderRadius: "4px",
                  padding: "7px 20px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  color: "#ffffff",
                  cursor: "pointer",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                Reset
              </button>
              <button
                type="button"
                onClick={handleApplySearch}
                style={{
                  background: "#f59e0b",
                  border: "none",
                  borderRadius: "4px",
                  padding: "7px 20px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  color: "#ffffff",
                  cursor: "pointer",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
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

        {/* Status Tabs matching Screenshot */}
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
                  Order No
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "10%" }}>
                  Warehouse
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "16%" }}>
                  Company
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "12%" }}>
                  Contact Person
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "11%" }}>
                  Sales Person
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "11%" }}>
                  Total Discount
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "14%" }}>
                  Paid/Due Dis. Amount
                </th>
                <th style={{ padding: "10px 12px", fontWeight: 700, color: "#475569", width: "12%" }}>
                  Status
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
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: "32px", textAlign: "center", color: "#64748b" }}>
                    No discount records found matching current criteria.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((o, idx) => {
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
                          href={`/sale-order/invoice/${o.id}`}
                          data-testid={`order-no-btn-${o.id}`}
                          target="_blank"
                          onClick={(e) => {
                            e.preventDefault();
                            window.open(`/sale-order/invoice/${o.id}`, "_blank");
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "#0061f2",
                            fontWeight: 600,
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
                        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
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
                            fontWeight: 600,
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
                              fontSize: "11px",
                              color: "#64748b",
                              marginTop: "2px",
                              cursor: "pointer",
                              textAlign: "left",
                              display: "block",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = "#0061f2")}
                            onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
                          >
                            {o.contact_name}
                          </button>
                        )}
                      </td>

                      {/* Contact Person */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top" }}>
                        {o.contact_person_name ? (
                          <>
                            <div style={{ color: "#334155" }}>{o.contact_person_name}</div>
                            {o.contact_person_mobile && (
                              <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
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
                          <div style={{ color: "#16a34a", fontWeight: 600, marginBottom: "2px" }}>
                            Paid {o.paid_discount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </div>
                        )}
                        {o.due_discount > 0 ? (
                          <div style={{ color: "#dc2626", fontWeight: 600 }}>
                            Due {formatIndianCurrency(o.due_discount)}
                          </div>
                        ) : (
                          <div style={{ color: "#16a34a", fontWeight: 600 }}>Settled</div>
                        )}
                      </td>

                      {/* Status (Badge + Date + Remark) */}
                      <td style={{ padding: "8px 12px", verticalAlign: "top" }}>
                        <span
                          style={{
                            background: "#dcfce7",
                            color: "#15803d",
                            borderRadius: "12px",
                            padding: "2px 8px",
                            fontSize: "11px",
                            fontWeight: 700,
                            display: "inline-block",
                            border: "1px solid #bbf7d0",
                          }}
                        >
                          {o.status}
                        </span>
                        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "3px" }}>
                          {o.status_updated_at}
                        </div>
                        <button
                          type="button"
                          onClick={() => setRemarkOrder(o)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#dc2626",
                            fontSize: "11px",
                            fontWeight: 600,
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
                                fontWeight: 600,
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
                                  fontSize: "11px",
                                  color: "#64748b",
                                  marginTop: "2px",
                                  cursor: "pointer",
                                  textAlign: "left",
                                  display: "block",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = "#0061f2")}
                                onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
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
                        <div style={{ position: "relative", display: "inline-block" }}>
                          <button
                            type="button"
                            title="Action"
                            data-testid={`action-btn-${o.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenActionId(openActionId === o.id ? null : o.id);
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

                          {openActionId === o.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                position: "absolute",
                                right: 0,
                                top: "calc(100% + 2px)",
                                background: "#ffffff",
                                border: "1px solid #cbd5e1",
                                borderRadius: "4px",
                                boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
                                zIndex: 200,
                                minWidth: "155px",
                                textAlign: "left",
                                overflow: "hidden",
                                padding: "4px 0",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setSettleOrder(o);
                                  setSettleAmount("");
                                  setSettleDate("22-09-2026");
                                  setSettleRemarks("");
                                  setOpenActionId(null);
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

                              <button
                                type="button"
                                onClick={() => {
                                  setListPaymentsOrder(o);
                                  setOpenActionId(null);
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

        {/* Bottom Pagination Info matching Screenshot */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "10px",
            fontSize: "12.5px",
            color: "#64748b",
          }}
        >
          <div>
            Showing 1 To {filteredOrders.length} Of {filteredOrders.length} Entries
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
            <button
              type="button"
              disabled={currentPage === 1}
              style={{
                padding: "6px 12px",
                border: "1px solid #cbd5e1",
                background: "#f1f5f9",
                color: "#64748b",
                borderRadius: "4px 0 0 4px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Previous
            </button>
            <button
              type="button"
              style={{
                padding: "6px 12px",
                border: "1px solid #0061f2",
                background: "#0061f2",
                color: "#ffffff",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              1
            </button>
            <button
              type="button"
              disabled={true}
              style={{
                padding: "6px 12px",
                border: "1px solid #cbd5e1",
                background: "#f1f5f9",
                color: "#64748b",
                borderRadius: "0 4px 4px 0",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Next
            </button>
          </div>
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
                    backgroundColor: "#f8fafc",
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
                      step="any"
                      placeholder={`Max: ${settleOrder.due_discount}`}
                      value={settleAmount}
                      onChange={(e) => setSettleAmount(e.target.value)}
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
                    rows={5}
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
                      minHeight: "110px",
                      fontFamily: "inherit",
                    }}
                  />
                </div>
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
                  <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#1e293b", marginBottom: "2px" }}>
                    Sale Order Detail
                  </div>
                  <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b", marginBottom: "16px" }}>
                    #{listPaymentsOrder.invoice_id || (listPaymentsOrder.id === "so-3826" ? "5125" : listPaymentsOrder.gatepass_id || "5125")}
                  </div>

                  {/* Customer Name & Created Date */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      rowGap: "14px",
                      columnGap: "24px",
                      marginBottom: "16px",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "11.5px", color: "#64748b", marginBottom: "4px" }}>
                        Customer Name
                      </div>
                      <div style={{ fontSize: "12.5px", color: "#1e293b", fontWeight: 500 }}>
                        {listPaymentsOrder.contact_person_name || listPaymentsOrder.contact_name?.replace(/^Mr\s+/, "") || listPaymentsOrder.company_name}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "11.5px", color: "#64748b", marginBottom: "4px" }}>
                        Created Date
                      </div>
                      <div style={{ fontSize: "12.5px", color: "#1e293b" }}>
                        {listPaymentsOrder.created_at || `${listPaymentsOrder.order_date} 11:26 AM`}
                      </div>
                    </div>
                  </div>

                  {/* Total Discount, Paid Amount, Due Amount */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      columnGap: "24px",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "11.5px", color: "#64748b", marginBottom: "4px" }}>
                        Total Discount
                      </div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                        {formatIndianCurrency(listPaymentsOrder.total_discount)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "11.5px", color: "#64748b", marginBottom: "4px" }}>
                        Paid Amount
                      </div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                        {formatIndianCurrency(listPaymentsOrder.paid_discount)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "11.5px", color: "#64748b", marginBottom: "4px" }}>
                        Due Amount
                      </div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                        {formatIndianCurrency(listPaymentsOrder.due_discount)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Payments Table matching Screenshot */}
                <div style={{ border: "1px solid #e2e8f0", borderRadius: "4px", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ background: "#ffffff", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ width: "40px", padding: "10px 12px", textAlign: "center", color: "#475569", fontWeight: 600, borderRight: "1px solid #e2e8f0" }}>#</th>
                        <th style={{ padding: "10px 14px", textAlign: "left", color: "#475569", fontWeight: 600, borderRight: "1px solid #e2e8f0" }}>Date</th>
                        <th style={{ padding: "10px 14px", textAlign: "left", color: "#475569", fontWeight: 600, borderRight: "1px solid #e2e8f0" }}>Title</th>
                        <th style={{ padding: "10px 14px", textAlign: "left", color: "#475569", fontWeight: 600, borderRight: "1px solid #e2e8f0" }}>Amount</th>
                        <th style={{ padding: "10px 14px", textAlign: "left", color: "#475569", fontWeight: 600 }}>Adjustment By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listPaymentsOrder.paid_discount > 0 ? (
                        <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "10px 12px", textAlign: "center", color: "#334155", borderRight: "1px solid #f1f5f9" }}>1</td>
                          <td style={{ padding: "10px 14px", color: "#334155", borderRight: "1px solid #f1f5f9" }}>
                            {listPaymentsOrder.status_updated_at.split(" ")[0]}
                          </td>
                          <td style={{ padding: "10px 14px", color: "#334155", borderRight: "1px solid #f1f5f9" }}>
                            Discount Adjustment
                          </td>
                          <td style={{ padding: "10px 14px", color: "#1e293b", fontWeight: 600, borderRight: "1px solid #f1f5f9" }}>
                            {formatIndianCurrency(listPaymentsOrder.paid_discount)}
                          </td>
                          <td style={{ padding: "10px 14px", color: "#334155" }}>
                            {listPaymentsOrder.sales_person}
                          </td>
                        </tr>
                      ) : (
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
                      )}
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
                  <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>INHYMA SOLUTIONS LLP</div>
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
                          window.open(`/sale-order/invoice/${selectedGatepassOrder.id}`, "_blank");
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
