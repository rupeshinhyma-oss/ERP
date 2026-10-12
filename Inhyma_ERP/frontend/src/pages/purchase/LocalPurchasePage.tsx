import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { DatePicker } from "@/components/DatePicker";
import { useToast } from "@/lib/toast";
import { apiDelete, apiGet, apiPatch, apiPost, apiPostMultipart, apiPut, errorMessage as apiErrorText } from "@/lib/api";
import { useAuth } from "@/lib/hooks";
import { useLookup } from "@/lib/lookups";
import { availableTransitions, canDelete as ruleCanDelete, canEdit as ruleCanEdit, needsReason, type WorkflowRules } from "@/lib/workflowRules";
import {
  LOCAL_PURCHASE_API,
  buildLocalPayload,
  fetchLocalPurchases,
  mapLocalPurchase,
  type LocalPurchaseItem,
  type PurchaseOrderRecord,
} from "@/lib/purchaseApi";

// The record types live in the shared data layer; re-exported so existing imports keep working.
export type { LocalPurchaseItem, PurchaseOrderRecord } from "@/lib/purchaseApi";

type CatalogProduct = { product_name: string; product_code?: string | null; uom?: string | null; rate: number };

const todayDDMMYYYY = () => new Date().toLocaleDateString("en-GB").split("/").join("-");

function formatIndianCurrency(amount: number): string {
  return "₹ " + (amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Supplier and buyer details for the detail view / PDF: exactly what the server read from the masters (blank when unknown). */
function getOrderDisplayDetails(order: PurchaseOrderRecord) {
  return {
    supplierAddress: order.supplier_address || "",
    supplierEmail: order.supplier_email || "",
    supplierPhone: order.supplier_phone || "",
    supplierGst: order.supplier_gst || "",
    toName: order.to_name || "",
    toAddress: order.to_address || "",
    toEmail: order.to_email || "",
    toPhone: order.to_phone || "",
    toGst: order.to_gst || "",
    createdAt: order.created_at_time || order.added_on,
    items: order.items || [],
  };
}

export function LocalPurchasePage({ defaultAdd = false }: { defaultAdd?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAddRoute =
    location.pathname.includes("/purchase/localpurchase/add") ||
    location.pathname.includes("/purchase/local-purchase/add") ||
    location.pathname.includes("/purchase-order/add") ||
    location.pathname.includes("/purchase/local/add");
  const isListRoute =
    location.pathname === "/purchase/localpurchase" ||
    location.pathname === "/purchase/localpurchase/" ||
    location.pathname === "/purchase/local-purchase" ||
    location.pathname === "/purchase/local-purchase/" ||
    location.pathname.includes("/purchase/localpurchase/list") ||
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

  const { profile, isSuperAdmin, hasPermission } = useAuth();
  const actor = useMemo(
    () => ({ isAdmin: isSuperAdmin || profile?.username === "admin", has: hasPermission }),
    [isSuperAdmin, profile?.username, hasPermission]
  );

  const [orders, setOrders] = useState<PurchaseOrderRecord[]>([]);
  const [statusRules, setStatusRules] = useState<WorkflowRules>({});
  const [pageError, setPageError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadOrders = async () => {
    try {
      const { orders: rows, rules } = await fetchLocalPurchases();
      setOrders(rows);
      setStatusRules(rules);
      setPageError(null);
    } catch (err) {
      setPageError(apiErrorText(err));
    }
  };
  useEffect(() => {
    void loadOrders();
  }, []);

  // dropdowns come from their masters: suppliers, and physical warehouses only (spec)
  const supplierList = useLookup<{ id: string; company_name: string }>("/suppliers", 500);
  const warehouseList = useLookup<{ name: string; main_warehouse_id?: string | null }>("/masters/warehouses", 250);
  // The product search returns only a unit id; the unit's name comes from the UOM master
  const uomList = useLookup<{ id: string; name: string; short_name?: string | null }>("/masters/uom", 250);
  const uomMapRef = useRef(new Map<string, string>());
  uomMapRef.current = new Map(uomList.items.map((u) => [u.id, u.short_name || u.name]));
  const supplierNames = useMemo(() => supplierList.items.map((x) => x.company_name), [supplierList.items]);
  const warehouseOptions = useMemo(
    () => ["Select", ...warehouseList.items.filter((w) => !w.main_warehouse_id).map((w) => w.name)],
    [warehouseList.items]
  );

  // what each row's menu may offer this user (rules come from the database)
  const isInitialStatus = (o: PurchaseOrderRecord) => !!statusRules[o.status_key]?.initial;
  const canEditOrder = (o: PurchaseOrderRecord) => ruleCanEdit(statusRules, o.status_key, actor);
  const canDeleteOrder = (o: PurchaseOrderRecord) => ruleCanDelete(statusRules, o.status_key, actor);
  const nextStatus = (o: PurchaseOrderRecord) => availableTransitions(statusRules, o.status_key, actor)[0];
  const confirmLabel = (o: PurchaseOrderRecord) => {
    const t = nextStatus(o);
    return (t && statusRules[t]?.action_label) || "Confirm";
  };

  const [searchTerm, setSearchTerm] = useState("");
  const [perPage, setPerPage] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Companies-matching list UI state: Filters, Bulk selection
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);

  // Import states
  const handleResetFilters = () => {
    setFilterSupplier("");
    setFilterWarehouse("");
    setFilterStatus("");
    setFilterDate("");
    setSearchTerm("");
    setCurrentPage(1);
  };

  const handleBulkConfirm = async () => {
    if (selectedIds.length === 0) return;
    let done = 0;
    let failed = 0;
    for (const o of orders.filter((x) => selectedIds.includes(x.id))) {
      const target = nextStatus(o);
      if (!target) {
        failed++;
        continue;
      }
      try {
        await apiPatch(`${LOCAL_PURCHASE_API}/${o.id}/status`, { status: target });
        done++;
      } catch {
        failed++;
      }
    }
    toast(failed ? `${done} confirmed, ${failed} could not be confirmed` : `${done} purchase order(s) confirmed`, failed ? "error" : "success");
    setSelectedIds([]);
    setBulkMenuOpen(false);
    await loadOrders();
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.length} selected orders?`)) return;
    let done = 0;
    let failed = 0;
    for (const o of orders.filter((x) => selectedIds.includes(x.id))) {
      try {
        await apiDelete(`${LOCAL_PURCHASE_API}/${o.id}`);
        done++;
      } catch {
        failed++;
      }
    }
    toast(failed ? `${done} deleted, ${failed} could not be deleted` : `${done} purchase order(s) deleted`, failed ? "error" : "success");
    setSelectedIds([]);
    setBulkMenuOpen(false);
    await loadOrders();
  };

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-action-menu-container]")) {
        setActiveMenuId(null);
      }
      if (!target.closest("[data-bulk-menu-container]")) {
        setBulkMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  // Sorting
  const [sortField, setSortField] = useState<"invoice_no" | "invoice_date" | "supplier_name" | "warehouse" | "invoice_total" | "added_on" | "status">("status");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // ==========================================
  // Add Form State (matching screenshot media_1790063052113.png)
  // ==========================================
  // Card 1: General Details
  const [formWarehouse, setFormWarehouse] = useState("Select");
  const [formSupplier, setFormSupplier] = useState("Select");

  // Default supplier to Yinglima while keeping it fully editable
  useEffect(() => {
    if (editingOrderId) return;
    if (formSupplier === "Select" || !formSupplier) {
      const defaultSupplier = "Yinglima";
      const matched = supplierNames.find(
        (n) => n.toLowerCase() === defaultSupplier.toLowerCase() ||
               n.toLowerCase().startsWith(defaultSupplier.toLowerCase()) ||
               n.toLowerCase().includes(defaultSupplier.toLowerCase())
      ) || defaultSupplier;
      setFormSupplier(matched);
    }
  }, [supplierNames, editingOrderId]);
  const [formInvoiceNo, setFormInvoiceNo] = useState("");
  const [formInvoiceDate, setFormInvoiceDate] = useState(todayDDMMYYYY());
  const [formBasicValue, setFormBasicValue] = useState("");
  const [formTotalValueWithGst, setFormTotalValueWithGst] = useState("");
  const [billFileName, setBillFileName] = useState<string>("");
  const [billFile, setBillFile] = useState<File | null>(null);
  const [removeBill, setRemoveBill] = useState(false);

  // Card 2: Expenses
  const [packingForwarding, setPackingForwarding] = useState<string>("");
  const [transportExpense, setTransportExpense] = useState<string>("");
  const [offloadingExpense, setOffloadingExpense] = useState<string>("");

  // Section 3 & 4: Products
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productSearchMatches, setProductSearchMatches] = useState<CatalogProduct[]>([]);
  const [formLineItems, setFormLineItems] = useState<LocalPurchaseItem[]>([]);
  const [formRemarks, setFormRemarks] = useState("");
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
      if (filterSupplier && !o.supplier_name.toLowerCase().includes(filterSupplier.toLowerCase())) {
        return false;
      }
      if (filterWarehouse && !o.warehouse.toLowerCase().includes(filterWarehouse.toLowerCase())) {
        return false;
      }
      if (filterStatus && o.status !== filterStatus) {
        return false;
      }
      if (filterDate && !o.added_on.includes(filterDate) && !o.invoice_date.includes(filterDate)) {
        return false;
      }
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
  }, [orders, searchTerm, filterSupplier, filterWarehouse, filterStatus, filterDate]);

  const sortedOrders = useMemo(() => {
    return [...filteredOrders].sort((a, b) => {
      let aVal: any = a[sortField] || "";
      let bVal: any = b[sortField] || "";

      if (sortField === "invoice_total") {
        const aNum = Number(a.invoice_total) || 0;
        const bNum = Number(b.invoice_total) || 0;
        return sortOrder === "asc" ? aNum - bNum : bNum - aNum;
      }

      if (sortField === "added_on" || sortField === "invoice_date") {
        const parseDate = (dStr: string) => {
          if (!dStr) return 0;
          const parts = dStr.split("-");
          if (parts.length === 3) {
            return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10)).getTime();
          }
          return new Date(dStr).getTime() || 0;
        };
        const aTime = parseDate(aVal);
        const bTime = parseDate(bVal);
        return sortOrder === "asc" ? aTime - bTime : bTime - aTime;
      }

      const aStr = String(aVal).trim();
      const bStr = String(bVal).trim();
      const cmp = aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: "base" });
      return sortOrder === "asc" ? cmp : -cmp;
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

  const renderSortIndicator = (field: typeof sortField) => {
    const isSorted = sortField === field;
    if (isSorted) {
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#0284c7",
            fontSize: "10px",
            fontWeight: 800,
            background: "#e0f2fe",
            padding: "1px 5px",
            borderRadius: "3px",
            border: "1px solid #bae6fd",
            lineHeight: 1,
            marginLeft: "5px",
            verticalAlign: "middle",
            flexShrink: 0,
          }}
        >
          {sortOrder === "asc" ? "▲" : "▼"}
        </span>
      );
    }
    return (
      <span
        style={{
          fontSize: "10px",
          color: "#94a3b8",
          opacity: 0.45,
          lineHeight: 1,
          marginLeft: "4px",
          verticalAlign: "middle",
          flexShrink: 0,
        }}
      >
        ↕
      </span>
    );
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

  const resetFormFields = () => {
    const defaultSupplier = "Yinglima";
    const matched = supplierNames.find(
      (n) => n.toLowerCase() === defaultSupplier.toLowerCase() ||
             n.toLowerCase().startsWith(defaultSupplier.toLowerCase()) ||
             n.toLowerCase().includes(defaultSupplier.toLowerCase())
    ) || defaultSupplier;
    setFormWarehouse("Select");
    setFormSupplier(matched);
    setFormInvoiceNo("");
    setFormInvoiceDate(todayDDMMYYYY());
    setFormBasicValue("");
    setFormTotalValueWithGst("");
    setBillFileName("");
    setBillFile(null);
    setRemoveBill(false);
    setPackingForwarding("");
    setTransportExpense("");
    setOffloadingExpense("");
    setFormRemarks("");
    setFormLineItems([]);
    setFormErrors({});
  };

  const populateForm = (order: PurchaseOrderRecord) => {
    setEditingOrderId(order.id);
    setFormWarehouse(order.warehouse || "Select");
    setFormSupplier(order.supplier_name || "Select");
    setFormInvoiceNo(order.invoice_no || "");
    setFormInvoiceDate(order.invoice_date || todayDDMMYYYY());
    setFormBasicValue(order.basic_amount ? String(order.basic_amount) : "");
    setFormTotalValueWithGst(order.invoice_total ? String(order.invoice_total) : "");
    setBillFileName(order.bill_file || "");
    setBillFile(null);
    setRemoveBill(false);
    setPackingForwarding(order.packing_forwarding ? String(order.packing_forwarding) : "");
    setTransportExpense(order.transport_expense ? String(order.transport_expense) : "");
    setOffloadingExpense(order.offloading_expense ? String(order.offloading_expense) : "");
    setFormRemarks(order.remarks || "");
    setFormLineItems(order.items && order.items.length > 0 ? [...order.items] : []);
    setFormErrors({});
    setIsFormOpen(true);
  };

  const handleOpenCreate = () => {
    setEditingOrderId(null);
    resetFormFields();
    setIsFormOpen(true);
    navigate("/purchase-order/addedit");
  };

  const handleOpenEdit = (order: PurchaseOrderRecord) => {
    populateForm(order);
    navigate(`/purchase-order/addedit/${order.id}`);
  };

  // Moves an order to another status through the API; the server applies the rules and the stock effect.
  const transitionOrder = async (order: PurchaseOrderRecord, target: string, reason?: string) => {
    try {
      await apiPatch(`${LOCAL_PURCHASE_API}/${order.id}/status`, { status: target, reason });
      toast(`Purchase order ${order.invoice_no} ${statusRules[target]?.label?.toLowerCase() || target}`, "success");
      await loadOrders();
    } catch (err) {
      toast(apiErrorText(err), "error");
    }
  };

  const handleConfirmOrder = (order: PurchaseOrderRecord) => {
    const target = nextStatus(order);
    if (!target) return;
    if (needsReason(statusRules, order.status_key, target)) {
      const reason = window.prompt("Please give a reason");
      if (!reason?.trim()) return;
      void transitionOrder(order, target, reason.trim());
      return;
    }
    void transitionOrder(order, target);
  };

  const handleDeleteOrder = async (order: PurchaseOrderRecord) => {
    if (!window.confirm(`Are you sure you want to delete purchase order ${order.invoice_no}?`)) return;
    try {
      await apiDelete(`${LOCAL_PURCHASE_API}/${order.id}`);
      toast(`Purchase order ${order.invoice_no} deleted successfully`, "success");
      await loadOrders();
    } catch (err) {
      toast(apiErrorText(err), "error");
    }
  };

  // Opening /purchase-order/addedit/:id loads that order into the form
  useEffect(() => {
    if (!routeOrderId || !location.pathname.includes("/purchase-order/addedit/")) return;
    if (editingOrderId === routeOrderId) return;
    let cancelled = false;
    apiGet<any>(`${LOCAL_PURCHASE_API}/${routeOrderId}`)
      .then((res) => {
        if (!cancelled && res?.data) populateForm(mapLocalPurchase(res.data, statusRules));
      })
      .catch((err) => {
        if (!cancelled) setPageError(apiErrorText(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeOrderId, location.pathname]);

  const handleBack = () => {
    setEditingOrderId(null);
    setIsFormOpen(false);
    navigate("/purchase/localpurchase");
  };

  const handleOpenBillPdf = (order: PurchaseOrderRecord) => {
    window.open(`/purchase-order/bill-file/${order.id}`, "_blank");
  };

  // Product search: the Product Master
  const productSearchSeq = useRef(0);
  const handleProductSearchChange = (val: string) => {
    setProductSearchQuery(val);
    if (!val.trim()) {
      setProductSearchMatches([]);
      return;
    }
    const seq = ++productSearchSeq.current;
    void apiGet<any[]>(`/masters/products?page=1&page_size=10&status=active&search=${encodeURIComponent(val.trim())}`)
      .then((res) => {
        if (seq !== productSearchSeq.current) return;
        setProductSearchMatches(
          (res?.data || []).map((p) => ({
            product_name: p.product_name,
            product_code: p.product_code,
            uom: uomMapRef.current.get(p.uom_id) || null,
            rate: Number(p.standard_cost) || 0,
          }))
        );
      })
      .catch(() => {
        if (seq === productSearchSeq.current) setProductSearchMatches([]);
      });
  };

  const handleSelectProductMatch = (prod: CatalogProduct) => {
    const newItem: LocalPurchaseItem = {
      id: "prod-" + Date.now() + Math.random().toString(36).substring(2, 5),
      product_name: prod.product_name,
      product_code: prod.product_code,
      uom: prod.uom,
      quantity: 1,
      unit_rate: prod.rate || "",
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

  const handleSavePurchaseOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { [key: string]: string } = {};

    if (formWarehouse === "Select") errs.warehouse = "Warehouse is required.";
    if (formSupplier === "Select" || !formSupplier.trim()) errs.supplier = "Supplier is required.";
    else if (supplierNames.length > 0) {
      const trimmed = formSupplier.trim().toLowerCase();
      const matched = supplierNames.some((n) => {
        const ln = n.toLowerCase();
        return ln === trimmed || ln.startsWith(trimmed) || ln.includes(trimmed);
      });
      if (!matched) {
        errs.supplier = "Select a supplier from the list.";
      }
    }
    if (!formInvoiceNo.trim()) errs.invoice_no = "Invoice No. is required.";
    if (!formInvoiceDate.trim()) errs.invoice_date = "Invoice Date is required.";
    if (!formBasicValue) errs.basic_amount = "Invoice Basic Value is required.";
    if (!formTotalValueWithGst) errs.invoice_total = "Invoice Total Value (Including GST) is required.";

    const validItems = computedLineItems.filter((it) => it.product_name.trim());
    if (validItems.length === 0) {
      errs.items = "Please add at least one product item.";
    } else if (validItems.some((it) => !(Number(it.quantity) > 0))) {
      errs.items = "Every product needs a quantity above zero.";
    }

    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }
    setFormErrors({});
    setSaving(true);

    try {
      const trimmedSup = formSupplier.trim().toLowerCase();
      const canonicalSupplier =
        supplierNames.find((n) => n.toLowerCase() === trimmedSup) ||
        supplierNames.find((n) => n.toLowerCase().startsWith(trimmedSup)) ||
        supplierNames.find((n) => n.toLowerCase().includes(trimmedSup));
      const body = buildLocalPayload({
        supplier_name: canonicalSupplier || formSupplier.trim(),
        warehouse: formWarehouse,
        invoice_no: formInvoiceNo,
        invoice_date: formInvoiceDate,
        basic_amount: formBasicValue,
        invoice_total: formTotalValueWithGst,
        packing_forwarding: packingForwarding,
        transport: transportExpense,
        offloading: offloadingExpense,
        remarks: formRemarks,
        items: validItems,
      });
      const res = editingOrderId
        ? await apiPut<{ id: string }>(`${LOCAL_PURCHASE_API}/${editingOrderId}`, body)
        : await apiPost<{ id: string }>(LOCAL_PURCHASE_API, body);
      const savedId = (res.data as { id: string }).id;
      if (billFile) {
        const fd = new FormData();
        fd.append("file", billFile);
        await apiPostMultipart(`${LOCAL_PURCHASE_API}/${savedId}/bill`, fd);
      } else if (editingOrderId && removeBill) {
        await apiDelete(`${LOCAL_PURCHASE_API}/${savedId}/bill`);
      }
      toast(editingOrderId ? "Local purchase order updated successfully" : "Local purchase order created successfully", "success");
      setEditingOrderId(null);
      setIsFormOpen(false);
      navigate("/purchase/localpurchase");
      await loadOrders();
    } catch (err) {
      // stay on the form and show the real reason; never pretend it was saved
      setFormErrors({ submit: apiErrorText(err) });
      toast(apiErrorText(err), "error");
    } finally {
      setSaving(false);
    }
  };

  // ==========================================
  // VIEW 1: Add Local Purchase View (exact match to media_1790063052113.png)
  // ==========================================
  if (isFormOpen) {
    return (
      <AppShell activeKey="local-purchases">
        <main className="page" style={{ padding: "16px 24px 60px", maxWidth: "100%", background: "#f8fafc" }}>
          <div style={{ marginBottom: "12px" }}>
            <Breadcrumb trail={["Purchase", "Local Purchase", editingOrderId ? "Edit Local Purchase" : "Add Local Purchase"]} />
          </div>
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
            {formErrors.submit && (
              <div role="alert" style={{ padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "6px", color: "#b91c1c", fontSize: "13px", marginBottom: "12px" }}>
                ⚠️ {formErrors.submit}
              </div>
            )}
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
                    {warehouseOptions.map((w) => (
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
                  <input
                    aria-label="Supplier"
                    list="local-supplier-options"
                    autoComplete="off"
                    placeholder="Type to search suppliers"
                    value={formSupplier === "Select" ? "" : formSupplier}
                    onChange={(e) => setFormSupplier(e.target.value || "Select")}
                    style={{
                      width: "100%",
                      height: "34px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      padding: "0 8px",
                      fontSize: "13px",
                      background: "#ffffff",
                      color: "#334155",
                      boxSizing: "border-box",
                    }}
                  />
                  <datalist id="local-supplier-options">
                    {supplierNames.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
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
                          setBillFile(e.target.files[0]);
                          setRemoveBill(false);
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
                    {billFileName && (
                      <button
                        type="button"
                        aria-label="Remove file"
                        onClick={() => {
                          setBillFileName("");
                          setBillFile(null);
                          setRemoveBill(true);
                        }}
                        style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer", padding: "0 8px" }}
                      >
                        ✕
                      </button>
                    )}
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
                            {row.uom && (
                              <span aria-label={`Unit ${idx + 1}`} style={{ marginLeft: "6px", fontSize: "12px", color: "#64748b" }}>
                                {row.uom}
                              </span>
                            )}
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
                  placeholder="Enter remarks"
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
                disabled={saving}
                style={{
                  background: saving ? "#94a3b8" : "#0061f2",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "4px",
                  padding: "8px 24px",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                  boxShadow: "0 2px 4px rgba(0, 97, 242, 0.2)",
                }}
              >
                {saving ? "Saving…" : "Submit"}
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
        {pageError && (
          <div role="alert" style={{ padding: "12px 16px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "6px", color: "#b91c1c", fontSize: "13px", marginBottom: "16px" }}>
            ⚠️ {pageError}
          </div>
        )}
        <div style={{ marginBottom: "12px" }}>
          <Breadcrumb trail={["Purchase", "Local Purchase"]} />
        </div>
        {/* Top Header matching Companies */}
        <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#1e293b" }}>
            Local Purchase
          </h1>

          <div className="page-header-actions" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* Toggle Filter Button */}
            <button
              type="button"
              className="btn"
              data-testid="btn-filter-toggle"
              style={{
                background: isFilterOpen ? "#0061f2" : "#556987",
                color: "#ffffff",
                padding: "8px 14px",
                borderRadius: "6px",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
              }}
              onClick={() => setIsFilterOpen((v) => !v)}
              title="Toggle Filter Options"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
              </svg>
            </button>

            {/* ADD NEW Button */}
            <button
              type="button"
              className="btn btn-add-new"
              data-testid="btn-add-new"
              onClick={handleOpenCreate}
              style={{
                background: "#0061f2",
                color: "#ffffff",
                padding: "8px 16px",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "13px",
                border: "none",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(0,97,242,0.2)",
              }}
            >
              + ADD NEW
            </button>

            {/* Export Button */}
            <button
              type="button"
              className="btn btn-export"
              data-testid="btn-export"
              onClick={handleExport}
              style={{
                background: "#f59e0b",
                color: "#ffffff",
                padding: "8px 16px",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "13px",
                border: "none",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(245,158,11,0.2)",
              }}
            >
              Export
            </button>

            {/* Bulk Actions Button */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="btn btn-bulk-action"
                disabled={selectedIds.length === 0}
                onClick={() => setBulkMenuOpen((v) => !v)}
                style={{
                  background: selectedIds.length > 0 ? "#198754" : "#94a3b8",
                  color: "#ffffff",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "13px",
                  border: "none",
                  cursor: selectedIds.length > 0 ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                Bulk Actions {selectedIds.length > 0 ? `(${selectedIds.length})` : ""} ▼
              </button>
              {bulkMenuOpen && selectedIds.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 4px)",
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    zIndex: 100,
                    minWidth: "160px",
                    padding: "4px 0",
                  }}
                >
                  <button
                    type="button"
                    onClick={handleBulkConfirm}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 14px",
                      background: "none",
                      border: "none",
                      fontSize: "13px",
                      color: "#1e293b",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    Confirm Selected
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkDelete}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 14px",
                      background: "none",
                      border: "none",
                      fontSize: "13px",
                      color: "#dc2626",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    Delete Selected
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* TOGGLABLE TOP FILTER PANEL matching Companies */}
        {isFilterOpen && (
          <div
            className="card"
            data-testid="filter-panel"
            style={{
              background: "#ffffff",
              padding: "20px 24px",
              borderRadius: "10px",
              border: "1px solid #cbd5e1",
              marginBottom: "16px",
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.04)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                columnGap: "20px",
                rowGap: "16px",
              }}
            >
              <div>
                <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                  Supplier
                </label>
                <input
                  type="text"
                  placeholder="Filter by supplier..."
                  value={filterSupplier}
                  onChange={(e) => {
                    setFilterSupplier(e.target.value);
                    setCurrentPage(1);
                  }}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    color: "#0f172a",
                    background: "#ffffff",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                  Warehouse
                </label>
                <input
                  type="text"
                  placeholder="Filter by warehouse..."
                  value={filterWarehouse}
                  onChange={(e) => {
                    setFilterWarehouse(e.target.value);
                    setCurrentPage(1);
                  }}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    color: "#0f172a",
                    background: "#ffffff",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                  Status
                </label>
                <select
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value);
                    setCurrentPage(1);
                  }}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    color: filterStatus ? "#0f172a" : "#64748b",
                    background: "#ffffff",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">All Statuses</option>
                  {Object.entries(statusRules).map(([key, r]) => (
                    <option key={key} value={r.label || key}>
                      {r.label || key}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                  Date
                </label>
                <input
                  type="text"
                  placeholder="DD-MM-YYYY"
                  value={filterDate}
                  onChange={(e) => {
                    setFilterDate(e.target.value);
                    setCurrentPage(1);
                  }}
                  style={{
                    width: "100%",
                    height: "38px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    color: "#0f172a",
                    background: "#ffffff",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
              <button
                type="button"
                onClick={handleResetFilters}
                style={{
                  background: "#64748b",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "8px 24px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reset
              </button>
            </div>
          </div>
        )}

        {/* Table Container Card */}
        <div
          className="card"
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.02)",
            overflow: "hidden",
          }}
        >
          {/* Toolbar: Items/Page and Search matching Companies */}
          <div
            className="toolbar"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 16px",
              borderBottom: "1px solid #f1f5f9",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <select
                aria-label="Items per page"
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={{
                  height: "34px",
                  padding: "0 10px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
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
              <span style={{ fontSize: "13px", color: "#64748b", fontWeight: 500 }}>
                Items/Page
              </span>
            </div>

            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <input
                type="text"
                aria-label="Search Local Purchases"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                style={{
                  height: "34px",
                  width: "240px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  padding: "0 32px 0 12px",
                  fontSize: "13px",
                  outline: "none",
                  color: "#334155",
                }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  title="Clear search"
                  style={{
                    position: "absolute",
                    right: "8px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#94a3b8",
                    fontSize: "16px",
                    lineHeight: 1,
                    padding: "0 2px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #cbd5e1", background: "#f8fafc" }}>
                  <th style={{ width: "40px", minWidth: "40px", maxWidth: "45px", textAlign: "center", padding: "10px 14px" }}>
                    <input
                      type="checkbox"
                      aria-label="Select all orders"
                      checked={paginatedOrders.length > 0 && paginatedOrders.every((o) => selectedIds.includes(o.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(paginatedOrders.map((o) => o.id));
                        } else {
                          setSelectedIds([]);
                        }
                      }}
                      style={{ cursor: "pointer", width: "16px", height: "16px" }}
                    />
                  </th>
                  <th
                    onClick={() => handleSort("invoice_no")}
                    title={
                      sortField === "invoice_no"
                        ? `Sorted by Invoice (${sortOrder === "asc" ? "Ascending — click for Descending" : "Descending — click for Ascending"})`
                        : "Click to sort by Invoice"
                    }
                    style={{
                      padding: "10px 14px",
                      fontSize: "12.5px",
                      fontWeight: 700,
                      color: sortField === "invoice_no" ? "#0f172a" : "#475569",
                      cursor: "pointer",
                      userSelect: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Invoice {renderSortIndicator("invoice_no")}
                  </th>
                  <th
                    onClick={() => handleSort("supplier_name")}
                    title={
                      sortField === "supplier_name"
                        ? `Sorted by Supplier (${sortOrder === "asc" ? "Ascending — click for Descending" : "Descending — click for Ascending"})`
                        : "Click to sort by Supplier"
                    }
                    style={{
                      padding: "10px 14px",
                      fontSize: "12.5px",
                      fontWeight: 700,
                      color: sortField === "supplier_name" ? "#0f172a" : "#475569",
                      cursor: "pointer",
                      userSelect: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Supplier {renderSortIndicator("supplier_name")}
                  </th>
                  <th
                    onClick={() => handleSort("warehouse")}
                    title={
                      sortField === "warehouse"
                        ? `Sorted by Warehouse (${sortOrder === "asc" ? "Ascending — click for Descending" : "Descending — click for Ascending"})`
                        : "Click to sort by Warehouse"
                    }
                    style={{
                      padding: "10px 14px",
                      fontSize: "12.5px",
                      fontWeight: 700,
                      color: sortField === "warehouse" ? "#0f172a" : "#475569",
                      cursor: "pointer",
                      userSelect: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Warehouse {renderSortIndicator("warehouse")}
                  </th>
                  <th
                    onClick={() => handleSort("invoice_total")}
                    title={
                      sortField === "invoice_total"
                        ? `Sorted by Invoice Total Value (${sortOrder === "asc" ? "Ascending — click for Descending" : "Descending — click for Ascending"})`
                        : "Click to sort by Invoice Total Value"
                    }
                    style={{
                      padding: "10px 14px",
                      fontSize: "12.5px",
                      fontWeight: 700,
                      color: sortField === "invoice_total" ? "#0f172a" : "#475569",
                      cursor: "pointer",
                      userSelect: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Invoice Total Value (INR) (Including GST) {renderSortIndicator("invoice_total")}
                  </th>
                  <th style={{ padding: "10px 14px", fontSize: "12.5px", fontWeight: 700, color: "#475569", whiteSpace: "nowrap" }}>
                    Created By
                  </th>
                  <th
                    onClick={() => handleSort("added_on")}
                    title={
                      sortField === "added_on"
                        ? `Sorted by Added On (${sortOrder === "asc" ? "Ascending — click for Descending" : "Descending — click for Ascending"})`
                        : "Click to sort by Added On"
                    }
                    style={{
                      padding: "10px 14px",
                      fontSize: "12.5px",
                      fontWeight: 700,
                      color: sortField === "added_on" ? "#0f172a" : "#475569",
                      cursor: "pointer",
                      userSelect: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Added On {renderSortIndicator("added_on")}
                  </th>
                  <th
                    onClick={() => handleSort("status")}
                    title={
                      sortField === "status"
                        ? `Sorted by Status (${sortOrder === "asc" ? "Ascending — click for Descending" : "Descending — click for Ascending"})`
                        : "Click to sort by Status"
                    }
                    style={{
                      padding: "10px 14px",
                      fontSize: "12.5px",
                      fontWeight: 700,
                      color: sortField === "status" ? "#0f172a" : "#475569",
                      cursor: "pointer",
                      userSelect: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Status {renderSortIndicator("status")}
                  </th>
                  <th style={{ padding: "10px 14px", fontSize: "12.5px", fontWeight: 700, color: "#475569", textAlign: "center", width: "70px", whiteSpace: "nowrap" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedOrders.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: "32px", textAlign: "center", color: "#64748b", fontSize: "13.5px", background: "#f8fafc" }}>
                      No Data Available In Table
                    </td>
                  </tr>
                ) : (
                  paginatedOrders.map((order, idx) => (
                    <tr
                      key={order.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: selectedIds.includes(order.id) ? "#eff6ff" : idx % 2 === 1 ? "#fafbfd" : "#ffffff",
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        if (!selectedIds.includes(order.id)) {
                          e.currentTarget.style.background = "#f1f5f9";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!selectedIds.includes(order.id)) {
                          e.currentTarget.style.background = idx % 2 === 1 ? "#fafbfd" : "#ffffff";
                        }
                      }}
                    >
                      <td style={{ textAlign: "center", padding: "10px 14px" }}>
                        <input
                          type="checkbox"
                          aria-label={`Select order ${order.invoice_no}`}
                          checked={selectedIds.includes(order.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            if (e.target.checked) {
                              setSelectedIds((prev) => [...prev, order.id]);
                            } else {
                              setSelectedIds((prev) => prev.filter((id) => id !== order.id));
                            }
                          }}
                          style={{ cursor: "pointer", width: "16px", height: "16px" }}
                        />
                      </td>
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
                            background: isInitialStatus(order) ? "#fef9c3" : "#e0f2fe",
                            color: isInitialStatus(order) ? "#a16207" : "#0284c7",
                            border: `1px solid ${isInitialStatus(order) ? "#fde047" : "#bae6fd"}`,
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
                            {!isInitialStatus(order) ? (
                              <>
                                {canEditOrder(order) && (
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
                                )}

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
                                {!!nextStatus(order) && (
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
                                    <span>{confirmLabel(order)}</span>
                                  </button>
                                )}
                                {canDeleteOrder(order) && (
                                  <button
                                    type="button"
                                    data-testid={`action-delete-confirmed-${order.id}`}
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
                                )}
                              </>
                            ) : (
                              <>
                                {canEditOrder(order) && (
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
                                )}

                                {!!nextStatus(order) && (
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
                                    <span>{confirmLabel(order)}</span>
                                  </button>
                                )}

                                {canDeleteOrder(order) && (
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
                                )}
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

          {/* Footer matching Companies pagination */}
          <div
            className="pagination"
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
                        background: isInitialStatus(selectedOrder) ? "#fef9c3" : "#e0f2fe",
                        color: isInitialStatus(selectedOrder) ? "#a16207" : "#0284c7",
                        border: `1px solid ${isInitialStatus(selectedOrder) ? "#fde047" : "#bae6fd"}`,
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