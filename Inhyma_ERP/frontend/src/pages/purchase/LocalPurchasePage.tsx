import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { DatePicker } from "@/components/DatePicker";
import { useToast } from "@/lib/toast";
import { apiPost } from "@/lib/api";

export interface LocalPurchaseItem {
  id: string;
  product_name: string;
  quantity: number | "";
  unit_rate: number | "";
  item_total: number;
  expense_per_unit: number;
  unit_landing_rate: number;
  total_landing_rate: number;
}

export interface PurchaseOrderRecord {
  id: string;
  invoice_no: string;
  invoice_date: string;
  supplier_name: string;
  supplier_address?: string;
  supplier_email?: string;
  supplier_phone?: string;
  supplier_gst?: string;
  to_name?: string;
  to_address?: string;
  to_email?: string;
  to_phone?: string;
  to_gst?: string;
  created_at_time?: string;
  warehouse: string;
  basic_amount?: number;
  invoice_total: number;
  bill_file?: string;
  created_by: string;
  added_on: string;
  status: "Pending" | "Confirmed";
  packing_forwarding?: number;
  transport_expense?: number;
  offloading_expense?: number;
  total_expenses?: number;
  loading_expense_percent?: number;
  remarks?: string | null;
  items?: LocalPurchaseItem[];
}

const SAMPLE_PRODUCTS = [
  { product_name: "G43 Online Printer TIJ 4.3", hsn: "84433200", rate: 6400 },
  { product_name: "XF12.7 Handy Printer Fiber Body 12.7mm", hsn: "84433200", rate: 3450 },
  { product_name: "Continuous Band Sealer", hsn: "84223000", rate: 25000 },
  { product_name: "Induction Cap Sealing Machine", hsn: "84223000", rate: 72203 },
  { product_name: "Shrink Wrapping Machine", hsn: "84224000", rate: 45000 },
  { product_name: "Carton Sealer Machine", hsn: "84223000", rate: 38000 },
  { product_name: "Vacuum Packaging Machine", hsn: "84224000", rate: 65000 },
  { product_name: "Pouch Packing Machine", hsn: "84223000", rate: 120000 },
  { product_name: "Automatic Liquid Filling Machine", hsn: "84223000", rate: 185000 },
  { product_name: "Semi-Automatic Strapping Machine", hsn: "84224000", rate: 28000 },
  { product_name: "ISL150 Rotary PFS 4 Stations", hsn: "84223000", rate: 1850000 },
  { product_name: "DZ800 Double Face Shaping Vacuum Machine 10Kgs", hsn: "84224000", rate: 271400 },
  { product_name: "Sensor (Banding)", hsn: "84229090", rate: 15000 },
  { product_name: "Industrial Thermal Inkjet Cartridge (Black)", hsn: "84433200", rate: 4500 },
];

const WAREHOUSE_OPTIONS = ["Select", "Mumbai", "Ahmedabad", "Delhi", "Surat"];

const SUPPLIER_OPTIONS = [
  "Select",
  "S B Inks & Packaging Co.",
  "Darsh Impex India LLP Mumbai",
  "GLOBAL IMPEX MACHINERY",
  "GENIUS PACK MACHINERY",
  "WELCOME ELECTRICALS SOLUTION",
  "Apex Industrial Supplies Ltd",
  "Kavitsu Robotronix Pvt Ltd",
  "Prasad Koch Glass LLP",
];

export const INITIAL_PURCHASE_ORDERS: PurchaseOrderRecord[] = [
  {
    id: "po-1",
    invoice_no: "2026-27/SO/1534",
    invoice_date: "19-09-2026",
    supplier_name: "S B Inks & Packaging Co.",
    warehouse: "Mumbai",
    basic_amount: 423500.0,
    invoice_total: 499730.0,
    created_by: "Akshata Wadekar",
    added_on: "21-09-2026",
    created_at_time: "21-09-2026 10:49 AM",
    status: "Pending",
    packing_forwarding: 0,
    transport_expense: 0,
    offloading_expense: 0,
    total_expenses: 0,
    loading_expense_percent: 0,
    supplier_address:
      "6/7, Ripal Shopping Complex, Near Cosmo Vila Row House, Premchand Nagar Road, Bodakdev\nAhmedabad 380015",
    supplier_email: "8799513908",
    supplier_phone: "",
    supplier_gst: "24ACSF51727J1ZB",
    to_name: "INHYMA SOLUTIONS LLP (M)",
    to_address:
      "4th Floor, Office No 421, Supremus - [I, Road No- 22, Near Passport Office, Wagle Estate",
    to_email: "Payment.Darsh@Gmail.Com",
    to_phone: "9653261742",
    to_gst: "27AAKFI9869H1ZL",
    items: [
      {
        id: "poi-1",
        product_name: "G43 Online Printer TIJ 4.3",
        quantity: 50,
        unit_rate: 6400,
        item_total: 320000,
        expense_per_unit: 0,
        unit_landing_rate: 6400,
        total_landing_rate: 320000,
      },
      {
        id: "poi-2",
        product_name: "XF12.7 Handy Printer Fiber Body 12.7mm",
        quantity: 30,
        unit_rate: 3450,
        item_total: 103500,
        expense_per_unit: 0,
        unit_landing_rate: 3450,
        total_landing_rate: 103500,
      },
    ],
  },
  {
    id: "po-2",
    invoice_no: "752/26-27",
    invoice_date: "17-09-2026",
    supplier_name: "Darsh Impex India LLP Mumbai",
    warehouse: "Mumbai",
    basic_amount: 5260.0,
    invoice_total: 6207.0,
    created_by: "Akshata Wadekar",
    added_on: "17-09-2026",
    status: "Confirmed",
  },
  {
    id: "po-3",
    invoice_no: "748/26-27",
    invoice_date: "17-09-2026",
    supplier_name: "Darsh Impex India LLP Mumbai",
    warehouse: "Mumbai",
    basic_amount: 22899.0,
    invoice_total: 27022.0,
    created_by: "Akshata Wadekar",
    added_on: "17-09-2026",
    status: "Confirmed",
  },
  {
    id: "po-4",
    invoice_no: "GST-436/26-27",
    invoice_date: "17-09-2026",
    supplier_name: "GLOBAL IMPEX MACHINERY",
    warehouse: "Ahmedabad",
    basic_amount: 1960.0,
    invoice_total: 2313.0,
    created_by: "Akshata Wadekar",
    added_on: "17-09-2026",
    status: "Confirmed",
  },
  {
    id: "po-5",
    invoice_no: "506/26-27",
    invoice_date: "20-08-2026",
    supplier_name: "Darsh Impex India LLP Mumbai",
    warehouse: "Mumbai",
    basic_amount: 720.0,
    invoice_total: 850.0,
    created_by: "Akshata Wadekar",
    added_on: "16-09-2026",
    status: "Confirmed",
  },
  {
    id: "po-6",
    invoice_no: "26-27/GPM-262",
    invoice_date: "15-09-2026",
    supplier_name: "GENIUS PACK MACHINERY",
    warehouse: "Mumbai",
    basic_amount: 62500.0,
    invoice_total: 73750.0,
    created_by: "Akshata Wadekar",
    added_on: "15-09-2026",
    status: "Confirmed",
  },
  {
    id: "po-7",
    invoice_no: "Wes/4361/2026-27",
    invoice_date: "12-09-2026",
    supplier_name: "WELCOME ELECTRICALS SOLUTION",
    warehouse: "Mumbai",
    basic_amount: 3300.0,
    invoice_total: 3894.0,
    created_by: "Akshata Wadekar",
    added_on: "15-09-2026",
    status: "Confirmed",
  },
  {
    id: "po-8",
    invoice_no: "GST-422/26-27",
    invoice_date: "11-09-2026",
    supplier_name: "GLOBAL IMPEX MACHINERY",
    warehouse: "Ahmedabad",
    basic_amount: 3500.0,
    invoice_total: 4130.0,
    created_by: "Akshata Wadekar",
    added_on: "11-09-2026",
    status: "Confirmed",
  },
  {
    id: "po-9",
    invoice_no: "419/26-27",
    invoice_date: "08-08-2026",
    supplier_name: "Darsh Impex India LLP Mumbai",
    warehouse: "Mumbai",
    basic_amount: 874.0,
    invoice_total: 1031.0,
    created_by: "Akshata Wadekar",
    added_on: "11-09-2026",
    status: "Confirmed",
  },
  {
    id: "po-10",
    invoice_no: "507/26-27",
    invoice_date: "20-08-2026",
    supplier_name: "Darsh Impex India LLP Mumbai",
    warehouse: "Mumbai",
    basic_amount: 52188.0,
    invoice_total: 61582.0,
    created_by: "Akshata Wadekar",
    added_on: "11-09-2026",
    status: "Confirmed",
  },
  {
    id: "po-11",
    invoice_no: "GST-403/26-27",
    invoice_date: "07-09-2026",
    supplier_name: "GLOBAL IMPEX MACHINERY",
    warehouse: "Mumbai",
    basic_amount: 5420.0,
    invoice_total: 6396.0,
    created_by: "Akshata Wadekar",
    added_on: "07-09-2026",
    status: "Confirmed",
  },
  {
    id: "po-12",
    invoice_no: "2026-27/SO/1394",
    invoice_date: "01-09-2026",
    supplier_name: "S B Inks & Packaging Co.",
    warehouse: "Mumbai",
    basic_amount: 207700.0,
    invoice_total: 245086.0,
    created_by: "Inhyma Admin",
    added_on: "01-09-2026",
    status: "Confirmed",
  },
];

function formatIndianCurrency(amount: number): string {
  return "₹ " + (amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getOrderDisplayDetails(order: PurchaseOrderRecord) {
  const isSbInks = order.supplier_name.includes("S B Inks");
  const isDarsh = order.supplier_name.includes("Darsh Impex");
  const isGlobal = order.supplier_name.includes("GLOBAL IMPEX");
  const isGenius = order.supplier_name.includes("GENIUS PACK");
  const isWelcome = order.supplier_name.includes("WELCOME");

  const supplierAddress =
    order.supplier_address ||
    (isSbInks
      ? "6/7, Ripal Shopping Complex, Near Cosmo Vila Row House, Premchand Nagar Road, Bodakdev\nAhmedabad 380015"
      : isDarsh
      ? "Shop No. 12, Ground Floor, Industrial Estate, Kanjurmarg West\nMumbai 400078"
      : isGlobal
      ? "Plot No. 44, GIDC Industrial Area, Phase 2, Vatva\nAhmedabad 382445"
      : isGenius
      ? "Unit 102, Shanti Industrial Park, Waliv, Vasai East\nPalghar 401208"
      : isWelcome
      ? "Gala No. 5, Electric Market, Lamington Road, Grant Road\nMumbai 400007"
      : "Industrial Area, Phase 1, GIDC\nAhmedabad 380001");

  const supplierEmail =
    order.supplier_email ||
    (isSbInks
      ? "8799513908"
      : isDarsh
      ? "darsh.impex@gmail.com"
      : isGlobal
      ? "contact@globalimpex.in"
      : "supplier@example.com");

  const supplierPhone = order.supplier_phone || "";

  const supplierGst =
    order.supplier_gst ||
    (isSbInks
      ? "24ACSF51727J1ZB"
      : isDarsh
      ? "27AABCD1234E1Z5"
      : isGlobal
      ? "24AABCG5566K1Z9"
      : "27AAECK9988P1Z4");

  const toName = order.to_name || "INHYMA SOLUTIONS LLP (M)";
  const toAddress =
    order.to_address ||
    "4th Floor, Office No 421, Supremus - [I, Road No- 22, Near Passport Office, Wagle Estate";
  const toEmail = order.to_email || "Payment.Darsh@Gmail.Com";
  const toPhone = order.to_phone || "9653261742";
  const toGst = order.to_gst || "27AAKFI9869H1ZL";

  const createdAt = order.created_at_time || `${order.added_on} 10:49 AM`;

  const items =
    order.items && order.items.length > 0
      ? order.items
      : [
          {
            id: `${order.id}-item-1`,
            product_name: "G43 Online Printer TIJ 4.3",
            quantity: 1,
            unit_rate: order.basic_amount || Math.round((order.invoice_total / 1.18) * 100) / 100,
            item_total: order.basic_amount || Math.round((order.invoice_total / 1.18) * 100) / 100,
            expense_per_unit: 0,
            unit_landing_rate:
              order.basic_amount || Math.round((order.invoice_total / 1.18) * 100) / 100,
            total_landing_rate:
              order.basic_amount || Math.round((order.invoice_total / 1.18) * 100) / 100,
          },
        ];

  return {
    supplierAddress,
    supplierEmail,
    supplierPhone,
    supplierGst,
    toName,
    toAddress,
    toEmail,
    toPhone,
    toGst,
    createdAt,
    items,
  };
}

export function LocalPurchasePage({ defaultAdd = false }: { defaultAdd?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAddRoute =
    location.pathname.includes("/purchase-order/add") ||
    location.pathname.includes("/purchase/local/add");
  const isListRoute =
    location.pathname.includes("/purchase-order/list") ||
    location.pathname.includes("/purchase/local/list");

  const [isFormOpen, setIsFormOpen] = useState(
    isAddRoute || (Boolean(defaultAdd) && !isListRoute)
  );

  useEffect(() => {
    if (isListRoute) {
      setIsFormOpen(false);
    } else if (isAddRoute) {
      setIsFormOpen(true);
    }
  }, [location.pathname, isListRoute, isAddRoute]);

  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrderRecord | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedOrder(null);
      }
    };
    if (selectedOrder) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedOrder]);

  const { id: routeOrderId } = useParams<{ id: string }>();
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

  const [orders, setOrders] = useState<PurchaseOrderRecord[]>(() => {
    try {
      const saved = localStorage.getItem("inhyma_local_purchase_orders");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {}
    return INITIAL_PURCHASE_ORDERS;
  });

  useEffect(() => {
    try {
      localStorage.setItem("inhyma_local_purchase_orders", JSON.stringify(orders));
    } catch {}
  }, [orders]);

  const [searchTerm, setSearchTerm] = useState("");
  const [perPage, setPerPage] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-action-menu-container]")) {
        setActiveMenuId(null);
      }
    };
    if (activeMenuId) {
      document.addEventListener("mousedown", handleDocumentClick);
    }
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, [activeMenuId]);

  // Sorting
  const [sortField, setSortField] = useState<"invoice_no" | "invoice_date" | "supplier_name" | "warehouse" | "invoice_total" | "added_on" | "status">("status");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // ==========================================
  // Add Form State (matching screenshot media_1790063052113.png)
  // ==========================================
  // Card 1: General Details
  const [formWarehouse, setFormWarehouse] = useState("Select");
  const [formSupplier, setFormSupplier] = useState("Select");
  const [formInvoiceNo, setFormInvoiceNo] = useState("");
  const [formInvoiceDate, setFormInvoiceDate] = useState("22-09-2026");
  const [formBasicValue, setFormBasicValue] = useState("");
  const [formTotalValueWithGst, setFormTotalValueWithGst] = useState("");
  const [billFileName, setBillFileName] = useState<string>("");

  // Card 2: Expenses
  const [packingForwarding, setPackingForwarding] = useState<string>("");
  const [transportExpense, setTransportExpense] = useState<string>("");
  const [offloadingExpense, setOffloadingExpense] = useState<string>("");

  // Section 3 & 4: Products
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productSearchMatches, setProductSearchMatches] = useState<typeof SAMPLE_PRODUCTS>([]);
  const [formLineItems, setFormLineItems] = useState<LocalPurchaseItem[]>([]);
  const [formRemarks, setFormRemarks] = useState("Make all cheque payable to USER");
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});

  // Calculations for Expenses
  const totalExpenses = useMemo(() => {
    const pf = parseFloat(packingForwarding) || 0;
    const tr = parseFloat(transportExpense) || 0;
    const off = parseFloat(offloadingExpense) || 0;
    return pf + tr + off;
  }, [packingForwarding, transportExpense, offloadingExpense]);

  const loadingExpensePercent = useMemo(() => {
    const basic = parseFloat(formBasicValue) || 0;
    if (basic <= 0) return 0;
    return (totalExpenses / basic) * 100;
  }, [totalExpenses, formBasicValue]);

  // Recalculate line items landing rates when expenses or items change
  const computedLineItems = useMemo(() => {
    const factor = loadingExpensePercent / 100;

    return formLineItems.map((item) => {
      const q = typeof item.quantity === "number" ? item.quantity : parseFloat(String(item.quantity)) || 0;
      const r = typeof item.unit_rate === "number" ? item.unit_rate : parseFloat(String(item.unit_rate)) || 0;
      const itemTot = Math.round(q * r * 100) / 100;
      const expPerUnit = Math.round(r * factor * 100) / 100;
      const landingUnit = Math.round((r + expPerUnit) * 100) / 100;
      const landingTotal = Math.round(q * landingUnit * 100) / 100;

      return {
        ...item,
        item_total: itemTot,
        expense_per_unit: expPerUnit,
        unit_landing_rate: landingUnit,
        total_landing_rate: landingTotal,
      };
    });
  }, [formLineItems, loadingExpensePercent]);

  // Grand totals
  const grandTotals = useMemo(() => {
    let totalQty = 0;
    let totalLanding = 0;

    for (const it of computedLineItems) {
      totalQty += parseFloat(String(it.quantity)) || 0;
      totalLanding += it.total_landing_rate || 0;
    }

    return {
      totalQty,
      totalLandingRate: Math.round(totalLanding * 100) / 100,
    };
  }, [computedLineItems]);

  // Filtering and Sorting for List View
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (!searchTerm.trim()) return true;
      const q = searchTerm.toLowerCase();
      return (
        o.invoice_no.toLowerCase().includes(q) ||
        o.supplier_name.toLowerCase().includes(q) ||
        o.warehouse.toLowerCase().includes(q) ||
        o.created_by.toLowerCase().includes(q) ||
        o.status.toLowerCase().includes(q) ||
        o.invoice_date.toLowerCase().includes(q) ||
        o.added_on.toLowerCase().includes(q)
      );
    });
  }, [orders, searchTerm]);

  const sortedOrders = useMemo(() => {
    return [...filteredOrders].sort((a, b) => {
      let aVal: any = a[sortField] || "";
      let bVal: any = b[sortField] || "";

      if (sortField === "invoice_total") {
        aVal = a.invoice_total;
        bVal = b.invoice_total;
      }

      if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
      if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredOrders, sortField, sortOrder]);

  const totalPages = Math.ceil(sortedOrders.length / perPage) || 1;
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return sortedOrders.slice(start, start + perPage);
  }, [sortedOrders, currentPage, perPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, perPage]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const handleExport = () => {
    const headers = [
      "Invoice No",
      "Invoice Date",
      "Supplier",
      "Warehouse",
      "Invoice Total Value (INR)",
      "Created By",
      "Added On",
      "Status",
    ];
    const rows = sortedOrders.map((o) => [
      o.invoice_no,
      o.invoice_date,
      o.supplier_name,
      o.warehouse,
      o.invoice_total,
      o.created_by,
      o.added_on,
      o.status,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.map((val) => `"${val}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `local_purchase_list_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenCreate = () => {
    setEditingOrderId(null);
    setFormWarehouse("Select");
    setFormSupplier("Select");
    setFormInvoiceNo("");
    setFormInvoiceDate("22-09-2026");
    setFormBasicValue("");
    setFormTotalValueWithGst("");
    setBillFileName("");
    setPackingForwarding("");
    setTransportExpense("");
    setOffloadingExpense("");
    setFormRemarks("Make all cheque payable to USER");
    setFormLineItems([]);
    setFormErrors({});
    setIsFormOpen(true);
    navigate("/purchase-order/addedit");
  };

  const handleOpenEdit = (order: PurchaseOrderRecord) => {
    setEditingOrderId(order.id);
    setFormWarehouse(order.warehouse || "Select");
    setFormSupplier(order.supplier_name || "Select");
    setFormInvoiceNo(order.invoice_no || "");
    setFormInvoiceDate(order.invoice_date || "22-09-2026");
    setFormBasicValue(order.basic_amount ? String(order.basic_amount) : "");
    setFormTotalValueWithGst(order.invoice_total ? String(order.invoice_total) : "");
    setBillFileName(order.bill_file || "");
    setPackingForwarding(order.packing_forwarding ? String(order.packing_forwarding) : "");
    setTransportExpense(order.transport_expense ? String(order.transport_expense) : "");
    setOffloadingExpense(order.offloading_expense ? String(order.offloading_expense) : "");
    setFormRemarks(order.remarks || "Make all cheque payable to USER");
    setFormLineItems(order.items && order.items.length > 0 ? [...order.items] : []);
    setFormErrors({});
    setIsFormOpen(true);
    navigate(`/purchase-order/addedit/${order.id}`);
  };

  const handleConfirmOrder = (order: PurchaseOrderRecord) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === order.id ? { ...o, status: "Confirmed" as const } : o))
    );
    apiPost(`/purchase/orders/${order.id}/confirm`, { status: "Confirmed" }).catch(() => {});
    toast(`Purchase order ${order.invoice_no} confirmed successfully`, "success");
  };

  const handleDeleteOrder = (order: PurchaseOrderRecord) => {
    if (window.confirm(`Are you sure you want to delete purchase order ${order.invoice_no}?`)) {
      setOrders((prev) => {
        const updated = prev.filter((o) => o.id !== order.id);
        try {
          localStorage.setItem("inhyma_local_purchase_orders", JSON.stringify(updated));
        } catch {}
        return updated;
      });
      apiPost(`/purchase/orders/${order.id}/delete`, {}).catch(() => {});
      toast(`Purchase order ${order.invoice_no} deleted successfully`, "success");
    }
  };

  useEffect(() => {
    if (routeOrderId && location.pathname.includes("/purchase-order/addedit/")) {
      const found = orders.find(
        (o) => o.id === routeOrderId || o.invoice_no === decodeURIComponent(routeOrderId)
      );
      if (found && editingOrderId !== found.id) {
        setEditingOrderId(found.id);
        setFormWarehouse(found.warehouse || "Select");
        setFormSupplier(found.supplier_name || "Select");
        setFormInvoiceNo(found.invoice_no || "");
        setFormInvoiceDate(found.invoice_date || "22-09-2026");
        setFormBasicValue(found.basic_amount ? String(found.basic_amount) : "");
        setFormTotalValueWithGst(found.invoice_total ? String(found.invoice_total) : "");
        setBillFileName(found.bill_file || "");
        setPackingForwarding(found.packing_forwarding ? String(found.packing_forwarding) : "");
        setTransportExpense(found.transport_expense ? String(found.transport_expense) : "");
        setOffloadingExpense(found.offloading_expense ? String(found.offloading_expense) : "");
        setFormRemarks(found.remarks || "Make all cheque payable to USER");
        setFormLineItems(found.items && found.items.length > 0 ? [...found.items] : []);
      }
    }
  }, [routeOrderId, orders, editingOrderId, location.pathname]);

  const handleBack = () => {
    setEditingOrderId(null);
    setIsFormOpen(false);
    navigate("/purchase-order/list");
  };

  const handleOpenBillPdf = (order: PurchaseOrderRecord) => {
    const targetId = order.invoice_no ? encodeURIComponent(order.invoice_no) : order.id;
    window.open(`/purchase-order/bill-file/${targetId}`, "_blank");
  };

  // Product Search autocomplete
  const handleProductSearchChange = (val: string) => {
    setProductSearchQuery(val);
    if (!val.trim()) {
      setProductSearchMatches([]);
      return;
    }
    const q = val.toLowerCase().replace(/[-_]/g, " ");
    const matches = SAMPLE_PRODUCTS.filter(
      (p) =>
        p.product_name.toLowerCase().replace(/[-_]/g, " ").includes(q) ||
        p.product_name.toLowerCase().includes(val.toLowerCase())
    );
    setProductSearchMatches(matches);
  };

  const handleSelectProductMatch = (prod: (typeof SAMPLE_PRODUCTS)[0]) => {
    const newItem: LocalPurchaseItem = {
      id: "prod-" + Date.now() + Math.random().toString(36).substring(2, 5),
      product_name: prod.product_name,
      quantity: 1,
      unit_rate: prod.rate,
      item_total: prod.rate,
      expense_per_unit: 0,
      unit_landing_rate: prod.rate,
      total_landing_rate: prod.rate,
    };
    setFormLineItems((prev) => [...prev, newItem]);
    setProductSearchQuery("");
    setProductSearchMatches([]);
  };

  const handleAddProductItem = () => {
    const newItem: LocalPurchaseItem = {
      id: "prod-" + Date.now() + Math.random().toString(36).substring(2, 5),
      product_name: "",
      quantity: 1,
      unit_rate: 0,
      item_total: 0,
      expense_per_unit: 0,
      unit_landing_rate: 0,
      total_landing_rate: 0,
    };
    setFormLineItems((prev) => [...prev, newItem]);
  };

  const handleUpdateLineItem = (idx: number, field: keyof LocalPurchaseItem, val: any) => {
    setFormLineItems((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: val };
      return copy;
    });
  };

  const handleDeleteLineItem = (idx: number) => {
    setFormLineItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSavePurchaseOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { [key: string]: string } = {};

    if (formWarehouse === "Select") {
      errs.warehouse = "Warehouse is required.";
    }
    if (formSupplier === "Select") {
      errs.supplier = "Supplier is required.";
    }
    if (!formInvoiceNo.trim()) {
      errs.invoice_no = "Invoice No. is required.";
    }
    if (!formInvoiceDate.trim()) {
      errs.invoice_date = "Invoice Date is required.";
    }
    if (!formBasicValue) {
      errs.basic_amount = "Invoice Basic Value is required.";
    }
    if (!formTotalValueWithGst) {
      errs.invoice_total = "Invoice Total Value (Including GST) is required.";
    }

    const validItems = computedLineItems.filter((it) => it.product_name.trim());
    if (validItems.length === 0) {
      errs.items = "Please add at least one product item.";
    }

    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }
    setFormErrors({});

    const totalVal = parseFloat(formTotalValueWithGst) || 0;
    const basicVal = parseFloat(formBasicValue) || 0;

    if (editingOrderId) {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === editingOrderId
            ? {
                ...o,
                invoice_no: formInvoiceNo.trim(),
                invoice_date: formInvoiceDate.trim() || "22-09-2026",
                supplier_name: formSupplier,
                warehouse: formWarehouse,
                basic_amount: basicVal,
                invoice_total: totalVal,
                bill_file: billFileName || o.bill_file,
                packing_forwarding: parseFloat(packingForwarding) || 0,
                transport_expense: parseFloat(transportExpense) || 0,
                offloading_expense: parseFloat(offloadingExpense) || 0,
                total_expenses: totalExpenses,
                loading_expense_percent: loadingExpensePercent,
                remarks: formRemarks.trim() || undefined,
                items: validItems,
              }
            : o
        )
      );
      apiPost(`/purchase/orders/${editingOrderId}`, {
        invoice_no: formInvoiceNo.trim(),
        invoice_date: formInvoiceDate.trim(),
        supplier_name: formSupplier,
        warehouse: formWarehouse,
        basic_amount: basicVal,
        invoice_total: totalVal,
        items: validItems,
      }).catch(() => {});
      toast("Local purchase order updated successfully", "success");
      setEditingOrderId(null);
      setIsFormOpen(false);
      navigate("/purchase-order/list");
      return;
    }

    const newOrder: PurchaseOrderRecord = {
      id: `po-${Date.now()}`,
      invoice_no: formInvoiceNo.trim(),
      invoice_date: formInvoiceDate.trim() || "22-09-2026",
      supplier_name: formSupplier,
      warehouse: formWarehouse,
      basic_amount: basicVal,
      invoice_total: totalVal,
      bill_file: billFileName || undefined,
      created_by: "Akshata Wadekar",
      added_on: "22-09-2026",
      status: "Confirmed",
      packing_forwarding: parseFloat(packingForwarding) || 0,
      transport_expense: parseFloat(transportExpense) || 0,
      offloading_expense: parseFloat(offloadingExpense) || 0,
      total_expenses: totalExpenses,
      loading_expense_percent: loadingExpensePercent,
      remarks: formRemarks.trim() || undefined,
      items: validItems,
    };

    setOrders([newOrder, ...orders]);
    apiPost("/purchase/orders", newOrder).catch(() => {});
    toast("Local purchase order created successfully", "success");
    setIsFormOpen(false);
    navigate("/purchase-order/list");
  };

  // ==========================================
  // VIEW 1: Add Local Purchase View (exact match to media_1790063052113.png)
  // ==========================================
  if (isFormOpen) {
    return (
      <AppShell activeKey="local-purchases">
        <main className="page" style={{ padding: "16px 24px 60px", maxWidth: "100%", background: "#f8fafc" }}>
          {/* Header matching Screenshot: Add Local Purchase + BACK button */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
              Add Local Purchase
            </h1>
            <button
              type="button"
              onClick={handleBack}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                borderRadius: "4px",
                padding: "6px 14px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#334155",
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              ← BACK
            </button>
          </div>

          <form onSubmit={handleSavePurchaseOrder}>
            {/* Top Card: General Details */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                padding: "16px 20px",
                marginBottom: "16px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
                position: "relative",
                zIndex: 10,
              }}
            >
              {/* Row 1: Warehouse, Supplier, Invoice No, Invoice Date */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "16px",
                  marginBottom: "16px",
                }}
              >
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Warehouse <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <select
                    value={formWarehouse}
                    onChange={(e) => setFormWarehouse(e.target.value)}
                    style={{
                      width: "100%",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "0 8px",
                      fontSize: "13px",
                      background: "#ffffff",
                      color: formWarehouse === "Select" ? "#94a3b8" : "#334155",
                      outline: "none",
                    }}
                  >
                    {WAREHOUSE_OPTIONS.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                  {formErrors.warehouse && (
                    <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                      {formErrors.warehouse}
                    </span>
                  )}
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Supplier <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <select
                    value={formSupplier}
                    onChange={(e) => setFormSupplier(e.target.value)}
                    style={{
                      width: "100%",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "0 8px",
                      fontSize: "13px",
                      background: "#ffffff",
                      color: formSupplier === "Select" ? "#94a3b8" : "#334155",
                      outline: "none",
                    }}
                  >
                    {SUPPLIER_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {formErrors.supplier && (
                    <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                      {formErrors.supplier}
                    </span>
                  )}
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Invoice No. <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={formInvoiceNo}
                    onChange={(e) => setFormInvoiceNo(e.target.value)}
                    style={{
                      width: "100%",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "0 10px",
                      fontSize: "13px",
                      color: "#334155",
                      outline: "none",
                    }}
                  />
                  {formErrors.invoice_no && (
                    <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                      {formErrors.invoice_no}
                    </span>
                  )}
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Invoice Date <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <DatePicker
                    value={formInvoiceDate}
                    onChange={(val) => setFormInvoiceDate(val)}
                    ariaLabel="Invoice Date"
                    placeholder="DD-MM-YYYY"
                    inputStyle={{
                      height: "34px",
                      fontSize: "13px",
                      color: "#334155",
                      border: formErrors.invoice_date ? "1px solid #ef4444" : undefined,
                    }}
                  />
                  {formErrors.invoice_date && (
                    <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                      {formErrors.invoice_date}
                    </span>
                  )}
                </div>
              </div>

              {/* Row 2: Basic Value, Including GST Value, Bill File */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 2fr",
                  gap: "16px",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Invoice Total Value (INR) (Basic Without GST) <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formBasicValue}
                    onChange={(e) => setFormBasicValue(e.target.value)}
                    style={{
                      width: "100%",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "0 10px",
                      fontSize: "13px",
                      color: "#334155",
                      outline: "none",
                    }}
                  />
                  {formErrors.basic_amount && (
                    <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                      {formErrors.basic_amount}
                    </span>
                  )}
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Invoice Total Value (INR) (Including GST) <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formTotalValueWithGst}
                    onChange={(e) => setFormTotalValueWithGst(e.target.value)}
                    style={{
                      width: "100%",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "0 10px",
                      fontSize: "13px",
                      color: "#334155",
                      outline: "none",
                    }}
                  />
                  {formErrors.invoice_total && (
                    <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                      {formErrors.invoice_total}
                    </span>
                  )}
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Bill File
                  </label>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      background: "#ffffff",
                      overflow: "hidden",
                    }}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setBillFileName(e.target.files[0].name);
                        }
                      }}
                      style={{ display: "none" }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        height: "100%",
                        padding: "0 12px",
                        background: "#f1f5f9",
                        border: "none",
                        borderRight: "1px solid #cbd5e1",
                        fontSize: "12px",
                        fontWeight: 500,
                        color: "#334155",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Choose File
                    </button>
                    <span style={{ padding: "0 10px", fontSize: "12.5px", color: billFileName ? "#334155" : "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {billFileName || "No file chosen"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: EXPENSES Card */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                padding: "16px 20px",
                marginBottom: "16px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
                EXPENSES
              </div>

              {/* Row 1: Packing & Forwarding, Transport, Offloading, Total Of All Expenses */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "16px",
                  marginBottom: "16px",
                }}
              >
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Packing & Forwarding
                  </label>
                  <div style={{ display: "flex", alignItems: "center", border: "1px solid #cbd5e1", borderRadius: "4px", height: "34px", padding: "0 8px", background: "#ffffff" }}>
                    <span style={{ color: "#64748b", marginRight: "6px", fontSize: "13px" }}>₹</span>
                    <input
                      type="number"
                      step="any"
                      value={packingForwarding}
                      onChange={(e) => setPackingForwarding(e.target.value)}
                      style={{ width: "100%", border: "none", outline: "none", fontSize: "13px", color: "#334155" }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Transport
                  </label>
                  <div style={{ display: "flex", alignItems: "center", border: "1px solid #cbd5e1", borderRadius: "4px", height: "34px", padding: "0 8px", background: "#ffffff" }}>
                    <span style={{ color: "#64748b", marginRight: "6px", fontSize: "13px" }}>₹</span>
                    <input
                      type="number"
                      step="any"
                      value={transportExpense}
                      onChange={(e) => setTransportExpense(e.target.value)}
                      style={{ width: "100%", border: "none", outline: "none", fontSize: "13px", color: "#334155" }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Offloading
                  </label>
                  <div style={{ display: "flex", alignItems: "center", border: "1px solid #cbd5e1", borderRadius: "4px", height: "34px", padding: "0 8px", background: "#ffffff" }}>
                    <span style={{ color: "#64748b", marginRight: "6px", fontSize: "13px" }}>₹</span>
                    <input
                      type="number"
                      step="any"
                      value={offloadingExpense}
                      onChange={(e) => setOffloadingExpense(e.target.value)}
                      style={{ width: "100%", border: "none", outline: "none", fontSize: "13px", color: "#334155" }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Total Of All Expenses
                  </label>
                  <div style={{ display: "flex", alignItems: "center", border: "1px solid #cbd5e1", borderRadius: "4px", height: "34px", padding: "0 8px", background: "#f8fafc" }}>
                    <span style={{ color: "#64748b", marginRight: "6px", fontSize: "13px" }}>₹</span>
                    <input
                      type="text"
                      readOnly
                      value={totalExpenses.toFixed(2)}
                      style={{ width: "100%", border: "none", outline: "none", fontSize: "13px", background: "transparent", color: "#1e293b", fontWeight: 600 }}
                    />
                  </div>
                </div>
              </div>

              {/* Row 2: % Loading Expense (Value Based) */}
              <div style={{ width: "24%" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                  % Loading Expense (Value Based)
                </label>
                <div style={{ display: "flex", alignItems: "center", border: "1px solid #cbd5e1", borderRadius: "4px", height: "34px", padding: "0 8px", background: "#ffffff" }}>
                  <span style={{ color: "#64748b", marginRight: "6px", fontSize: "13px" }}>%</span>
                  <input
                    type="text"
                    readOnly
                    value={loadingExpensePercent.toFixed(2)}
                    style={{ width: "100%", border: "none", outline: "none", fontSize: "13px", color: "#334155", fontWeight: 600 }}
                  />
                </div>
              </div>
            </div>

            {/* Section 3: PRODUCT SEARCH Card */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                padding: "14px 16px",
                marginBottom: "16px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                PRODUCT SEARCH
              </div>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  placeholder="Enter Product Name / Model No"
                  value={productSearchQuery}
                  onChange={(e) => handleProductSearchChange(e.target.value)}
                  style={{
                    width: "100%",
                    height: "36px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    padding: "0 12px",
                    fontSize: "13.5px",
                    outline: "none",
                  }}
                />
                {productSearchMatches.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      background: "#ffffff",
                      border: "1px solid #cbd5e1",
                      borderTop: "none",
                      borderRadius: "0 0 4px 4px",
                      zIndex: 50,
                      maxHeight: "200px",
                      overflowY: "auto",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    }}
                  >
                    {productSearchMatches.map((prod, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleSelectProductMatch(prod)}
                        style={{
                          padding: "8px 12px",
                          cursor: "pointer",
                          fontSize: "13px",
                          borderBottom: "1px solid #f1f5f9",
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
                      >
                        <strong>{prod.product_name}</strong>
                        <span style={{ color: "#64748b" }}>Rate: ₹{prod.rate.toLocaleString("en-IN")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Section 4: PRODUCT ITEM Card */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                padding: "16px 20px",
                marginBottom: "16px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
                PRODUCT ITEM
              </div>

              {formErrors.items && (
                <div style={{ color: "#ef4444", fontSize: "12px", marginBottom: "8px" }}>
                  ⚠️ {formErrors.items}
                </div>
              )}

              <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "4px" }}>
                <table style={{ width: "100%", minWidth: "900px", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr style={{ background: "#ffffff" }}>
                      <th style={{ padding: "10px 12px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "24%" }}>Product Name</th>
                      <th style={{ padding: "10px 12px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "8%" }}>Qty</th>
                      <th style={{ padding: "10px 12px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "12%" }}>Unit Rate</th>
                      <th style={{ padding: "10px 12px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "12%" }}>Item Total</th>
                      <th style={{ padding: "10px 12px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "12%" }}>Expense Per Unit</th>
                      <th style={{ padding: "10px 12px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "14%" }}>Unit Landing Rate (VB)</th>
                      <th style={{ padding: "10px 12px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "14%" }}>Total Landing Rate (VB)</th>
                      <th style={{ padding: "10px 6px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", width: "40px" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {computedLineItems.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: "24px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                          No items added yet. Search above or click "+ Add Product Row".
                        </td>
                      </tr>
                    ) : (
                      computedLineItems.map((row, idx) => (
                        <tr key={row.id || idx} style={{ background: "#ffffff" }}>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }}>
                            <input
                              type="text"
                              placeholder="Product Name"
                              value={row.product_name}
                              onChange={(e) => handleUpdateLineItem(idx, "product_name", e.target.value)}
                              style={{ width: "100%", height: "32px", border: "1px solid #cbd5e1", borderRadius: "3px", padding: "0 8px", fontSize: "12.5px" }}
                            />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }}>
                            <input
                              type="number"
                              min="1"
                              step="any"
                              value={row.quantity}
                              onChange={(e) => handleUpdateLineItem(idx, "quantity", e.target.value)}
                              style={{ width: "100%", height: "32px", border: "1px solid #cbd5e1", borderRadius: "3px", padding: "0 8px", fontSize: "12.5px" }}
                            />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }}>
                            <input
                              type="number"
                              step="any"
                              value={row.unit_rate}
                              onChange={(e) => handleUpdateLineItem(idx, "unit_rate", e.target.value)}
                              style={{ width: "100%", height: "32px", border: "1px solid #cbd5e1", borderRadius: "3px", padding: "0 8px", fontSize: "12.5px" }}
                            />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }}>
                            <div style={{ height: "32px", border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: "3px", display: "flex", alignItems: "center", padding: "0 8px", fontSize: "12.5px", color: "#1e293b", fontWeight: 600 }}>
                              {row.item_total ? row.item_total.toFixed(2) : "0.00"}
                            </div>
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }}>
                            <div style={{ height: "32px", border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: "3px", display: "flex", alignItems: "center", padding: "0 8px", fontSize: "12.5px", color: "#1e293b" }}>
                              {row.expense_per_unit ? row.expense_per_unit.toFixed(2) : "0.00"}
                            </div>
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }}>
                            <div style={{ height: "32px", border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: "3px", display: "flex", alignItems: "center", padding: "0 8px", fontSize: "12.5px", color: "#1e293b" }}>
                              {row.unit_landing_rate ? row.unit_landing_rate.toFixed(2) : "0.00"}
                            </div>
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }}>
                            <div style={{ height: "32px", border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: "3px", display: "flex", alignItems: "center", padding: "0 8px", fontSize: "12.5px", color: "#1e293b", fontWeight: 600 }}>
                              {row.total_landing_rate ? row.total_landing_rate.toFixed(2) : "0.00"}
                            </div>
                          </td>
                          <td style={{ padding: "6px 4px", borderBottom: "1px solid #e2e8f0", textAlign: "center" }}>
                            <button
                              type="button"
                              onClick={() => handleDeleteLineItem(idx)}
                              style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontWeight: 700, fontSize: "14px" }}
                              title="Remove Row"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>

                {/* Grand Total Bar matching Screenshot */}
                <div
                  style={{
                    background: "#cbd5e1",
                    padding: "10px 16px",
                    display: "grid",
                    gridTemplateColumns: "24% 8% 12% 12% 12% 14% 14% 40px",
                    alignItems: "center",
                    fontWeight: 700,
                    fontSize: "12.5px",
                    color: "#1e293b",
                    borderTop: "1px solid #94a3b8",
                  }}
                >
                  <span style={{ textAlign: "right", paddingRight: "16px" }}>Grand Total</span>
                  <span>{grandTotals.totalQty}</span>
                  <span />
                  <span />
                  <span />
                  <span />
                  <span>{grandTotals.totalLandingRate}</span>
                  <span />
                </div>
              </div>

              <div style={{ marginTop: "12px" }}>
                <button
                  type="button"
                  onClick={handleAddProductItem}
                  style={{ fontSize: "12.5px", padding: "6px 14px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "4px", cursor: "pointer", fontWeight: 600, color: "#334155" }}
                >
                  + Add Product Row
                </button>
              </div>

              {/* Remarks Box matching Screenshot */}
              <div style={{ marginTop: "16px" }}>
                <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                  Remarks
                </label>
                <textarea
                  rows={4}
                  placeholder="Make all cheque payable to USER"
                  value={formRemarks}
                  onChange={(e) => setFormRemarks(e.target.value)}
                  style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: "4px", padding: "10px 12px", fontSize: "13px", resize: "vertical" }}
                />
              </div>
            </div>

            {/* Bottom Action: Blue Submit button */}
            <div style={{ marginTop: "16px" }}>
              <button
                type="submit"
                style={{
                  background: "#0061f2",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "4px",
                  padding: "8px 24px",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 2px 4px rgba(0, 97, 242, 0.2)",
                }}
              >
                Submit
              </button>
            </div>
          </form>
        </main>
      </AppShell>
    );
  }

  // ==========================================
  // VIEW 2: Local Purchase List View (matching Screenshot media_1790062631636.png)
  // ==========================================
  return (
    <AppShell activeKey="local-purchases">
      <main className="page" style={{ padding: "16px 24px 60px", maxWidth: "100%", background: "#f8fafc" }}>
        {/* Top Header matching Screenshot */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
            Local Purchase
          </h1>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              data-testid="btn-add-new"
              onClick={handleOpenCreate}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "#0061f2",
                color: "#ffffff",
                border: "none",
                borderRadius: "4px",
                padding: "8px 16px",
                fontSize: "12.5px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0, 97, 242, 0.2)",
                textTransform: "uppercase",
              }}
            >
              + ADD NEW
            </button>

            <button
              type="button"
              data-testid="btn-export"
              onClick={handleExport}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "#f59e0b",
                color: "#ffffff",
                border: "none",
                borderRadius: "4px",
                padding: "8px 16px",
                fontSize: "12.5px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(245, 158, 11, 0.2)",
              }}
            >
              Export
            </button>
          </div>
        </div>

        {/* Table Container Card */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.02)",
            overflow: "hidden",
          }}
        >
          {/* Toolbar: Items/Page and Search */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 16px",
              borderBottom: "1px solid #f1f5f9",
            }}
          >
            <div>
              <select
                aria-label="Items per page"
                value={perPage}
                onChange={(e) => setPerPage(Number(e.target.value))}
                style={{
                  height: "32px",
                  padding: "0 10px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  fontSize: "13px",
                  background: "#ffffff",
                  color: "#334155",
                  outline: "none",
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "3px", fontWeight: 500 }}>
                Items/Page
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="text"
                aria-label="Search Local Purchases"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  height: "32px",
                  width: "200px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  padding: "0 10px",
                  fontSize: "13px",
                  outline: "none",
                  color: "#334155",
                }}
              />
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #cbd5e1", background: "#ffffff" }}>
                  <th
                    onClick={() => handleSort("invoice_no")}
                    style={{ padding: "10px 14px", fontSize: "12.5px", fontWeight: 700, color: "#334155", cursor: "pointer", userSelect: "none" }}
                  >
                    Invoice <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "invoice_no" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th
                    onClick={() => handleSort("supplier_name")}
                    style={{ padding: "10px 14px", fontSize: "12.5px", fontWeight: 700, color: "#334155", cursor: "pointer", userSelect: "none" }}
                  >
                    Supplier <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "supplier_name" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th
                    onClick={() => handleSort("warehouse")}
                    style={{ padding: "10px 14px", fontSize: "12.5px", fontWeight: 700, color: "#334155", cursor: "pointer", userSelect: "none" }}
                  >
                    Warehouse <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "warehouse" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th
                    onClick={() => handleSort("invoice_total")}
                    style={{ padding: "10px 14px", fontSize: "12.5px", fontWeight: 700, color: "#334155", cursor: "pointer", userSelect: "none" }}
                  >
                    Invoice Total Value (INR) (Including GST) <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "invoice_total" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th style={{ padding: "10px 14px", fontSize: "12.5px", fontWeight: 700, color: "#334155" }}>
                    Created By
                  </th>
                  <th
                    onClick={() => handleSort("added_on")}
                    style={{ padding: "10px 14px", fontSize: "12.5px", fontWeight: 700, color: "#334155", cursor: "pointer", userSelect: "none" }}
                  >
                    Added On <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "added_on" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th
                    onClick={() => handleSort("status")}
                    style={{ padding: "10px 14px", fontSize: "12.5px", fontWeight: 700, color: "#334155", cursor: "pointer", userSelect: "none" }}
                  >
                    Status <span style={{ color: "#0284c7", fontSize: "11px" }}>{sortField === "status" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th style={{ padding: "10px 14px", fontSize: "12.5px", fontWeight: 700, color: "#334155", textAlign: "center", width: "70px" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: "32px", textAlign: "center", color: "#64748b", fontSize: "13.5px", background: "#f8fafc" }}>
                      No Data Available In Table
                    </td>
                  </tr>
                ) : (
                  paginatedOrders.map((order, idx) => (
                    <tr
                      key={order.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: idx % 2 === 1 ? "#fafbfd" : "#ffffff",
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 1 ? "#fafbfd" : "#ffffff")}
                    >
                      <td style={{ padding: "10px 14px" }}>
                        <button
                          type="button"
                          onClick={() => setSelectedOrder(order)}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "#0061f2",
                            fontWeight: 600,
                            fontSize: "13px",
                            cursor: "pointer",
                            textAlign: "left",
                            textDecoration: "none",
                          }}
                        >
                          {order.invoice_no}
                        </button>
                        <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                          {order.invoice_date}
                        </div>
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: "13px", color: "#334155" }}>
                        {order.supplier_name}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: "13px", color: "#334155" }}>
                        {order.warehouse}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>
                        {formatIndianCurrency(order.invoice_total)}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: "13px", color: "#334155" }}>
                        {order.created_by}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: "13px", color: "#334155" }}>
                        {order.added_on}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 10px",
                            borderRadius: "9999px",
                            fontSize: "11.5px",
                            fontWeight: 600,
                            background: order.status === "Pending" ? "#fef9c3" : "#e0f2fe",
                            color: order.status === "Pending" ? "#a16207" : "#0284c7",
                            border: `1px solid ${order.status === "Pending" ? "#fde047" : "#bae6fd"}`,
                          }}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "center", position: "relative" }}>
                        <button
                          type="button"
                          aria-label="Order actions"
                          data-testid={`btn-action-${order.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(activeMenuId === order.id ? null : order.id);
                          }}
                          style={{
                            background: activeMenuId === order.id ? "#ffffff" : "transparent",
                            border: activeMenuId === order.id ? "1px solid #cbd5e1" : "1px solid transparent",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "16px",
                            color: "#475569",
                            width: "30px",
                            height: "28px",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: 0,
                            boxShadow: activeMenuId === order.id ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                            transition: "border-color 0.15s ease, background-color 0.15s ease",
                          }}
                          onMouseEnter={(e) => {
                            if (activeMenuId !== order.id) {
                              e.currentTarget.style.borderColor = "#e2e8f0";
                              e.currentTarget.style.backgroundColor = "#f8fafc";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (activeMenuId !== order.id) {
                              e.currentTarget.style.borderColor = "transparent";
                              e.currentTarget.style.backgroundColor = "transparent";
                            }
                          }}
                        >
                          ⋮
                        </button>

                        {activeMenuId === order.id && (
                          <div
                            data-action-menu-container
                            data-testid={`action-menu-${order.id}`}
                            style={{
                              position: "absolute",
                              right: "14px",
                              top: "36px",
                              background: "#ffffff",
                              border: "1px solid #cbd5e1",
                              borderRadius: "4px",
                              boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
                              zIndex: 40,
                              minWidth: "155px",
                              textAlign: "left",
                              overflow: "hidden",
                              padding: "3px 0",
                            }}
                          >
                            {order.status === "Confirmed" ? (
                              <>
                                <button
                                  type="button"
                                  data-testid={`action-edit-${order.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuId(null);
                                    handleOpenEdit(order);
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "8px 14px",
                                    background: "none",
                                    border: "none",
                                    textAlign: "left",
                                    fontSize: "12.5px",
                                    fontWeight: 500,
                                    color: "#334155",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    whiteSpace: "nowrap",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ color: "#334155" }}
                                  >
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                  </svg>
                                  <span>Edit</span>
                                </button>

                                <button
                                  type="button"
                                  data-testid={`action-download-${order.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuId(null);
                                    handleOpenBillPdf(order);
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "8px 14px",
                                    background: "none",
                                    border: "none",
                                    textAlign: "left",
                                    fontSize: "12.5px",
                                    fontWeight: 500,
                                    color: "#334155",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    whiteSpace: "nowrap",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ color: "#334155" }}
                                  >
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                  </svg>
                                  <span>Download Purchase</span>
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  data-testid={`action-edit-${order.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuId(null);
                                    handleOpenEdit(order);
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "8px 14px",
                                    background: "none",
                                    border: "none",
                                    textAlign: "left",
                                    fontSize: "12.5px",
                                    fontWeight: 500,
                                    color: "#334155",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    whiteSpace: "nowrap",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ color: "#334155" }}
                                  >
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                  </svg>
                                  <span>Edit</span>
                                </button>

                                <button
                                  type="button"
                                  data-testid={`action-confirm-${order.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuId(null);
                                    handleConfirmOrder(order);
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "8px 14px",
                                    background: "none",
                                    border: "none",
                                    textAlign: "left",
                                    fontSize: "12.5px",
                                    fontWeight: 500,
                                    color: "#334155",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    whiteSpace: "nowrap",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    style={{ color: "#334155" }}
                                  >
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                                  </svg>
                                  <span>Confirm</span>
                                </button>

                                <button
                                  type="button"
                                  data-testid={`action-delete-${order.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuId(null);
                                    handleDeleteOrder(order);
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "8px 14px",
                                    background: "none",
                                    border: "none",
                                    textAlign: "left",
                                    fontSize: "12.5px",
                                    fontWeight: 500,
                                    color: "#334155",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    whiteSpace: "nowrap",
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ color: "#334155" }}
                                  >
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    <line x1="10" y1="11" x2="10" y2="17" />
                                    <line x1="14" y1="11" x2="14" y2="17" />
                                  </svg>
                                  <span>Delete</span>
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer matching Screenshot */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              borderTop: "1px solid #cbd5e1",
              fontSize: "12.5px",
              color: "#475569",
            }}
          >
            <div>
              {sortedOrders.length === 0
                ? "Showing 0 To 0 Of 0 Entries"
                : `Showing ${(currentPage - 1) * perPage + 1} To ${Math.min(
                    currentPage * perPage,
                    sortedOrders.length
                  )} Of ${sortedOrders.length} Entries`}
            </div>

            <div style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  background: currentPage <= 1 ? "#f8fafc" : "#ffffff",
                  color: currentPage <= 1 ? "#94a3b8" : "#334155",
                  cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                }}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  background: currentPage >= totalPages ? "#f8fafc" : "#ffffff",
                  color: currentPage >= totalPages ? "#94a3b8" : "#334155",
                  cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {/* Local Purchase Details Modal matching Screenshot media_1790064280588.png */}
        {selectedOrder && (() => {
          const details = getOrderDisplayDetails(selectedOrder);
          const grandItemTotal = details.items.reduce(
            (sum, item) => sum + (Number(item.item_total) || 0),
            0
          );
          const grandLandingTotal = details.items.reduce(
            (sum, item) => sum + (Number(item.total_landing_rate) || Number(item.item_total) || 0),
            0
          );

          return (
            <div
              data-testid="local-purchase-details-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="local-purchase-details-title"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setSelectedOrder(null);
                }
              }}
              style={{
                position: "fixed",
                inset: 0,
                backgroundColor: "rgba(15, 23, 42, 0.45)",
                backdropFilter: "blur(2px)",
                zIndex: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px",
              }}
            >
              <div
                style={{
                  backgroundColor: "#ffffff",
                  borderRadius: "6px",
                  width: "100%",
                  maxWidth: "920px",
                  maxHeight: "92vh",
                  overflowY: "auto",
                  boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                  border: "1px solid #cbd5e1",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* Header */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "14px 20px",
                    borderBottom: "1px solid #e2e8f0",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <h2
                      id="local-purchase-details-title"
                      style={{
                        margin: 0,
                        fontSize: "15.5px",
                        fontWeight: 700,
                        color: "#1e293b",
                      }}
                    >
                      Local Purchase Details
                    </h2>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 10px",
                        borderRadius: "9999px",
                        fontSize: "11px",
                        fontWeight: 600,
                        background: selectedOrder.status === "Pending" ? "#fef9c3" : "#e0f2fe",
                        color: selectedOrder.status === "Pending" ? "#a16207" : "#0284c7",
                        border: `1px solid ${selectedOrder.status === "Pending" ? "#fde047" : "#bae6fd"}`,
                      }}
                    >
                      {selectedOrder.status}
                    </span>
                  </div>

                  <button
                    type="button"
                    aria-label="Close"
                    onClick={() => setSelectedOrder(null)}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: "18px",
                      color: "#64748b",
                      cursor: "pointer",
                      padding: "4px 8px",
                      lineHeight: 1,
                      fontWeight: 600,
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* Body Content */}
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
                  {/* Top 3-Column Card: Order Detail | From | To */}
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "4px",
                      display: "grid",
                      gridTemplateColumns: "1.1fr 1.5fr 1.5fr",
                    }}
                  >
                    {/* Col 1: Order Detail */}
                    <div style={{ padding: "12px 14px", borderRight: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "10px" }}>
                        Order Detail
                      </div>
                      <div style={{ fontSize: "11.5px", color: "#334155", lineHeight: "1.7" }}>
                        <div>
                          <span style={{ fontWeight: 600, color: "#1e293b" }}>Created: </span>
                          <span>{details.createdAt}</span>
                        </div>
                        <div>
                          <span style={{ fontWeight: 600, color: "#1e293b" }}>Created By: </span>
                          <span>{selectedOrder.created_by}</span>
                        </div>
                      </div>
                    </div>

                    {/* Col 2: From */}
                    <div style={{ padding: "12px 14px", borderRight: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "10px" }}>
                        From
                      </div>
                      <div style={{ fontSize: "11.5px", color: "#334155", lineHeight: "1.55" }}>
                        <div style={{ fontWeight: 600, color: "#0f172a", marginBottom: "3px" }}>
                          {selectedOrder.supplier_name}
                        </div>
                        <div style={{ color: "#475569", marginBottom: "4px", whiteSpace: "pre-line" }}>
                          {details.supplierAddress}
                        </div>
                        <div>
                          <span style={{ fontWeight: 600, color: "#1e293b" }}>Email: </span>
                          <span>{details.supplierEmail}</span>
                        </div>
                        <div>
                          <span style={{ fontWeight: 600, color: "#1e293b" }}>Phone: </span>
                          <span>{details.supplierPhone}</span>
                        </div>
                        <div>
                          <span style={{ fontWeight: 600, color: "#1e293b" }}>GST No: </span>
                          <span>{details.supplierGst}</span>
                        </div>
                      </div>
                    </div>

                    {/* Col 3: To */}
                    <div style={{ padding: "12px 14px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", marginBottom: "10px" }}>
                        To
                      </div>
                      <div style={{ fontSize: "11.5px", color: "#334155", lineHeight: "1.55" }}>
                        <div style={{ fontWeight: 600, color: "#0f172a", marginBottom: "3px" }}>
                          {details.toName}
                        </div>
                        <div style={{ color: "#475569", marginBottom: "4px", whiteSpace: "pre-line" }}>
                          {details.toAddress}
                        </div>
                        <div>
                          <span style={{ fontWeight: 600, color: "#1e293b" }}>Email: </span>
                          <span>{details.toEmail}</span>
                        </div>
                        <div>
                          <span style={{ fontWeight: 600, color: "#1e293b" }}>Phone: </span>
                          <span>{details.toPhone}</span>
                        </div>
                        <div>
                          <span style={{ fontWeight: 600, color: "#1e293b" }}>GST No: </span>
                          <span>{details.toGst}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Middle 6-Column Summary Strip */}
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "4px",
                      padding: "10px 14px",
                      display: "grid",
                      gridTemplateColumns: "1.2fr 1.4fr 1fr 1.2fr 1.9fr 1.9fr",
                      gap: "10px",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155" }}>Warehouse:</div>
                      <div style={{ fontSize: "12px", color: "#475569", marginTop: "3px" }}>{selectedOrder.warehouse}</div>
                    </div>

                    <div>
                      <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155" }}>Invoice No.:</div>
                      <div style={{ fontSize: "12px", color: "#475569", marginTop: "3px" }}>{selectedOrder.invoice_no}</div>
                    </div>

                    <div>
                      <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155" }}>Bill File:</div>
                      <div style={{ marginTop: "3px" }}>
                        <button
                          type="button"
                          data-testid="btn-bill-file-pdf"
                          aria-label="View Bill File PDF"
                          onClick={() => handleOpenBillPdf(selectedOrder)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#16a34a",
                            cursor: "pointer",
                            padding: 0,
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                          title="View Bill File PDF"
                        >
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155" }}>Invoice Date:</div>
                      <div style={{ fontSize: "12px", color: "#475569", marginTop: "3px" }}>{selectedOrder.invoice_date}</div>
                    </div>

                    <div>
                      <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155" }}>Invoice Total (Without GST):</div>
                      <div style={{ fontSize: "12px", color: "#475569", marginTop: "3px" }}>
                        {formatIndianCurrency(
                          selectedOrder.basic_amount || Math.round((selectedOrder.invoice_total / 1.18) * 100) / 100
                        )}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155" }}>Invoice Total (Including GST):</div>
                      <div style={{ fontSize: "12px", color: "#475569", marginTop: "3px" }}>
                        {formatIndianCurrency(selectedOrder.invoice_total)}
                      </div>
                    </div>
                  </div>

                  {/* Expenses Card */}
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "4px",
                      padding: "8px 14px 12px",
                    }}
                  >
                    <div
                      style={{
                        textAlign: "center",
                        fontSize: "11.5px",
                        fontWeight: 600,
                        color: "#64748b",
                        marginBottom: "10px",
                      }}
                    >
                      Expenses
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5, 1fr)",
                        gap: "10px",
                        textAlign: "left",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155" }}>Packing & Forwarding:</div>
                        <div style={{ fontSize: "12px", color: "#475569", marginTop: "3px" }}>
                          {formatIndianCurrency(selectedOrder.packing_forwarding || 0)}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155" }}>Transport:</div>
                        <div style={{ fontSize: "12px", color: "#475569", marginTop: "3px" }}>
                          {formatIndianCurrency(selectedOrder.transport_expense || 0)}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155" }}>Offloading:</div>
                        <div style={{ fontSize: "12px", color: "#475569", marginTop: "3px" }}>
                          {formatIndianCurrency(selectedOrder.offloading_expense || 0)}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155" }}>Total Of All Expenses:</div>
                        <div style={{ fontSize: "12px", color: "#475569", marginTop: "3px" }}>
                          {formatIndianCurrency(selectedOrder.total_expenses || 0)}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155" }}>% Loading Expense (VB):</div>
                        <div style={{ fontSize: "12px", color: "#475569", marginTop: "3px" }}>
                          {selectedOrder.loading_expense_percent || 0} %
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Product Summary Table */}
                  <div>
                    <div
                      style={{
                        textAlign: "center",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#64748b",
                        marginBottom: "10px",
                      }}
                    >
                      Product Summary
                    </div>

                    <div
                      style={{
                        border: "1px solid #cbd5e1",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                        <thead>
                          <tr style={{ background: "#ffffff", borderBottom: "1px solid #cbd5e1" }}>
                            <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#334155", width: "55px" }}>
                              Sr No.
                            </th>
                            <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#334155" }}>
                              Product Name
                            </th>
                            <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#334155", width: "85px" }}>
                              Quantity
                            </th>
                            <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#334155", width: "105px" }}>
                              Unit Rate
                            </th>
                            <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#334155", width: "115px" }}>
                              Item Total
                            </th>
                            <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#334155", width: "115px" }}>
                              Expense Per Unit
                            </th>
                            <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#334155", width: "145px" }}>
                              Unit Landing Rate (VB)
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {details.items.map((item, idx) => (
                            <tr
                              key={item.id || idx}
                              style={{
                                borderBottom: "1px solid #e2e8f0",
                                background: "#ffffff",
                              }}
                            >
                              <td style={{ padding: "8px 10px", color: "#334155" }}>{idx + 1}</td>
                              <td style={{ padding: "8px 10px", color: "#334155" }}>{item.product_name}</td>
                              <td style={{ padding: "8px 10px", color: "#334155" }}>
                                <div>{item.quantity}</div>
                                <div style={{ color: "#64748b", fontSize: "10.5px" }}>Nos</div>
                              </td>
                              <td style={{ padding: "8px 10px", color: "#334155" }}>
                                {formatIndianCurrency(Number(item.unit_rate) || 0)}
                              </td>
                              <td style={{ padding: "8px 10px", color: "#334155" }}>
                                {formatIndianCurrency(Number(item.item_total) || 0)}
                              </td>
                              <td style={{ padding: "8px 10px", color: "#334155" }}>
                                {formatIndianCurrency(Number(item.expense_per_unit) || 0)}
                              </td>
                              <td style={{ padding: "8px 10px", color: "#334155" }}>
                                {formatIndianCurrency(Number(item.unit_landing_rate) || Number(item.unit_rate) || 0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr
                            style={{
                              background: "#cbd5e1",
                              fontWeight: 700,
                              fontSize: "12px",
                              color: "#1e293b",
                            }}
                          >
                            <td colSpan={4} style={{ padding: "9px 12px", textAlign: "right" }}>
                              Grand Total
                            </td>
                            <td style={{ padding: "9px 10px", color: "#16a34a", fontWeight: 700 }}>
                              {formatIndianCurrency(grandItemTotal)}
                            </td>
                            <td style={{ padding: "9px 10px" }} />
                            <td style={{ padding: "9px 10px", color: "#16a34a", fontWeight: 700 }}>
                              {formatIndianCurrency(grandLandingTotal || grandItemTotal)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </main>
    </AppShell>
  );
}
