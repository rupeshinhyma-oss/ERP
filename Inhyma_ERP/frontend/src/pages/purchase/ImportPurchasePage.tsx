import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/lib/toast";
import { apiDelete, apiGet, apiPatch, apiPost, apiPostMultipart, apiPut, errorMessage as apiErrorText } from "@/lib/api";
import { DatePicker } from "@/components/DatePicker";
import { formatIndianCurrency, formatUsdCurrency } from "@/lib/importPurchasePdf";
import { useAuth } from "@/lib/hooks";
import { useLookup } from "@/lib/lookups";
import { useOptions } from "@/lib/options";
import { EMPTY_DATE_FILTER, RANGE_PRESET_OPTIONS, inDateRange, type DateFilter } from "@/lib/dateRanges";
import {
  availableTransitions,
  canDelete as ruleCanDelete,
  canEdit as ruleCanEdit,
  needsReason,
  type WorkflowRules,
} from "@/lib/workflowRules";
import {
  IMPORT_PURCHASE_API,
  buildImportPayload,
  fetchImportPurchases,
  mapImportPurchase,
  previewImport,
  type ImportFormValues,
  type ImportPreview,
  type ImportPurchaseRecord,
} from "@/lib/purchaseApi";

// The record types live in the shared data layer; re-exported so existing imports keep working.
export type { ImportPurchaseItem, ImportPurchaseRecord } from "@/lib/purchaseApi";

const IMPORT_OPTION_GROUPS = ["purchase.import.defaults"] as const;

type CatalogProduct = { product_name: string };

const todayDDMMYYYY = () => new Date().toLocaleDateString("en-GB").split("/").join("-");

// Row colours by position in the DB-configured workflow (purely visual)
const STATUS_PALETTE = [
  { bg: "#fef9c3", fg: "#a16207", border: "#fde047" },
  { bg: "#e0f2fe", fg: "#0284c7", border: "#bae6fd" },
  { bg: "#dcfce7", fg: "#15803d", border: "#bbf7d0" },
  { bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" },
];

const FIELD_LABEL: React.CSSProperties = { fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" };
const FIELD_INPUT: React.CSSProperties = {
  width: "100%", height: "34px", border: "1px solid #cbd5e1", borderRadius: "4px", padding: "0 8px", fontSize: "13px",
  background: "#ffffff", color: "#334155", outline: "none", boxSizing: "border-box",
};
const FIELD_ERROR: React.CSSProperties = { color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" };
const CARD: React.CSSProperties = {
  background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "16px 20px", marginBottom: "16px",
  boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
};
const CARD_TITLE: React.CSSProperties = { fontSize: "14px", fontWeight: 700, color: "#1e293b", marginBottom: "14px" };
const GRID4: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "16px" };

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={FIELD_LABEL}>
        {label} {required && <span style={{ color: "#ef4444" }}>*</span>}
      </label>
      {children}
      {error && <span style={FIELD_ERROR}>{error}</span>}
    </div>
  );
}

export function ImportPurchasePage({ defaultAdd = false }: { defaultAdd?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const isAddRoute =
    location.pathname.includes("/purchase/importpurchase/add") ||
    location.pathname.includes("/purchase/import-purchase/add") ||
    location.pathname.includes("/purchase-order/import-purchase/add") ||
    location.pathname.includes("/purchase/import/add");
  const isListRoute =
    location.pathname === "/purchase/importpurchase" ||
    location.pathname === "/purchase/importpurchase/" ||
    location.pathname === "/purchase/import-purchase" ||
    location.pathname === "/purchase/import-purchase/" ||
    location.pathname.includes("/purchase/importpurchase/list") ||
    location.pathname.includes("/purchase-order/import-purchase-list") ||
    location.pathname.includes("/purchase/import/list") ||
    location.pathname === "/purchase/import";

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

  const [selectedOrder, setSelectedOrder] = useState<ImportPurchaseRecord | null>(null);

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

  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

  const { profile, isSuperAdmin, hasPermission } = useAuth();
  const actor = useMemo(
    () => ({ isAdmin: isSuperAdmin || profile?.username === "admin", has: hasPermission }),
    [isSuperAdmin, profile?.username, hasPermission]
  );
  const { id: routeOrderId } = useParams<{ id: string }>();

  const [orders, setOrders] = useState<ImportPurchaseRecord[]>([]);
  const [statusRules, setStatusRules] = useState<WorkflowRules>({});
  const [pageError, setPageError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadOrders = async () => {
    try {
      const { orders: rows, rules } = await fetchImportPurchases();
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

  // dropdowns and form defaults come from the database
  const supplierList = useLookup<{ id: string; company_name: string }>("/suppliers", 500);
  const warehouseList = useLookup<{ name: string; main_warehouse_id?: string | null }>("/masters/warehouses", 250);
  const supplierNames = useMemo(() => supplierList.items.map((x) => x.company_name), [supplierList.items]);
  const warehouseNames = useMemo(() => warehouseList.items.map((x) => x.name), [warehouseList.items]);
  const physicalWarehouses = useMemo(
    () => new Set(warehouseList.items.filter((w) => !w.main_warehouse_id).map((w) => w.name)),
    [warehouseList.items]
  );
  const { options: optionGroups } = useOptions(IMPORT_OPTION_GROUPS);
  const DEFAULTS = useMemo(
    () => Object.fromEntries((optionGroups["purchase.import.defaults"] || []).map((o) => [o.value, o.label])) as Record<string, string>,
    [optionGroups]
  );

  // what each row may offer this user (rules come from the database)
  const statusKeys = Object.keys(statusRules);
  const isInitialStatus = (o: ImportPurchaseRecord) => !!statusRules[o.status_key]?.initial;
  const canEditOrder = (o: ImportPurchaseRecord) => {
    // Section 2.8 Late Expense Inward Editing allows editing expenses on received and closed consignments
    if (o.status_key === "received" || o.status_key === "closed") return true;
    return ruleCanEdit(statusRules, o.status_key, actor);
  };
  const canDeleteOrder = (o: ImportPurchaseRecord) => ruleCanDelete(statusRules, o.status_key, actor);
  const nextStatus = (o: ImportPurchaseRecord) => availableTransitions(statusRules, o.status_key, actor)[0];
  const confirmLabel = (o: ImportPurchaseRecord) => {
    const t = nextStatus(o);
    return (t && statusRules[t]?.action_label) || "Confirm";
  };
  const palette = (o: { status_key: string }) => STATUS_PALETTE[Math.max(0, statusKeys.indexOf(o.status_key))] || STATUS_PALETTE[3];

  // Tab Filter & Search
  const [selectedTab, setSelectedTab] = useState<string>("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [perPage, setPerPage] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Filter Drawer / Panel State
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterWarehouse, setFilterWarehouse] = useState("ALL");
  const [filterSupplier, setFilterSupplier] = useState("ALL");
  const [filterArrival, setFilterArrival] = useState<DateFilter>(EMPTY_DATE_FILTER);
  const [filterEtd, setFilterEtd] = useState<DateFilter>(EMPTY_DATE_FILTER);
  const [filterEta, setFilterEta] = useState<DateFilter>(EMPTY_DATE_FILTER);

  // Selection & Bulk Actions matching Companies design
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);

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
        await apiPatch(`${IMPORT_PURCHASE_API}/${o.id}/status`, { status: target });
        done++;
      } catch {
        failed++;
      }
    }
    toast(failed ? `${done} moved on, ${failed} could not be moved` : `${done} import consignment(s) updated`, failed ? "error" : "success");
    setSelectedIds([]);
    setBulkMenuOpen(false);
    await loadOrders();
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.length} selected consignments?`)) return;
    let done = 0;
    let failed = 0;
    for (const o of orders.filter((x) => selectedIds.includes(x.id))) {
      try {
        await apiDelete(`${IMPORT_PURCHASE_API}/${o.id}`);
        done++;
      } catch {
        failed++;
      }
    }
    toast(failed ? `${done} deleted, ${failed} could not be deleted` : `${done} import consignment(s) deleted`, failed ? "error" : "success");
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
    };
    if (activeMenuId) {
      document.addEventListener("mousedown", handleDocumentClick);
    }
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, [activeMenuId]);

  // Sorting
  const [sortField, setSortField] = useState<keyof ImportPurchaseRecord | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Dynamic KPI calculations based on current orders pool
  const kpis = useMemo(() => {
    const out: Record<string, { amount: number; count: number }> = { all: { amount: 0, count: orders.length } };
    for (const o of orders) {
      const val = Number(o.invoice_total_inr) || 0;
      out.all.amount += val;
      out[o.status_key] = out[o.status_key] || { amount: 0, count: 0 };
      out[o.status_key].amount += val;
      out[o.status_key].count += 1;
    }
    return out;
  }, [orders]);
  const kpi = (key: string) => kpis[key] || { amount: 0, count: 0 };

  // Filtering
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      // Tab filter
      if (selectedTab !== "ALL" && o.status_key !== selectedTab) {
        return false;
      }
      // Warehouse filter
      if (filterWarehouse !== "ALL" && o.warehouse !== filterWarehouse) {
        return false;
      }
      // Supplier filter
      if (filterSupplier !== "ALL" && o.supplier_name !== filterSupplier) {
        return false;
      }
      // Date-range filters (spec: Expected Arrival, ETD Origin and ETA Port)
      if (!inDateRange(o.exp_arri_date, filterArrival)) return false;
      if (!inDateRange(o.etd_origin_date, filterEtd)) return false;
      if (!inDateRange(o.eta_port_date, filterEta)) return false;
      // Search
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const match =
          o.consignment_no.toLowerCase().includes(q) ||
          o.supplier_name.toLowerCase().includes(q) ||
          o.warehouse.toLowerCase().includes(q) ||
          o.status.toLowerCase().includes(q) ||
          o.ordered_date.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [orders, selectedTab, filterWarehouse, filterSupplier, filterArrival, filterEtd, filterEta, searchTerm]);

  // Sorting
  const sortedOrders = useMemo(() => {
    if (!sortField) return filteredOrders;
    return [...filteredOrders].sort((a, b) => {
      let aVal: any = a[sortField] ?? "";
      let bVal: any = b[sortField] ?? "";

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
      }
      aVal = String(aVal).toLowerCase();
      bVal = String(bVal).toLowerCase();
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
  }, [selectedTab, searchTerm, perPage, filterWarehouse, filterSupplier, filterArrival, filterEtd, filterEta]);

  const handleSort = (field: keyof ImportPurchaseRecord) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  // ==========================================
  // Add / Edit Form State (Import Purchase spec)
  // ==========================================
  type FormItem = { id: string; product_name: string; quantity: number | string; unit_rate_usd: number | string };

  const blankForm = (): ImportFormValues => ({
    consignment_no: "",
    supplier_name: DEFAULTS.supplier || "",
    warehouse: DEFAULTS.warehouse || "",
    ordered_date: todayDDMMYYYY(),
    invoice_date: "",
    etd_origin_date: "",
    eta_port_date: "",
    expected_arrival_date: "",
    conversion_rate: "",
    customs_conversion_rate: "",
    invoice_total_usd: "",
    total_cbm: "",
    total_import_duty: "",
    freight: "",
    insurance: "",
    stamp_duty: "",
    shipping_line_charges: "",
    cfs_charges: "",
    clearing_transport: "",
    offloading: "",
    misc_charges: "",
    misc_remarks: "",
    remarks: "",
    items: [],
  });

  const [form, setForm] = useState<ImportFormValues>(blankForm);
  const [formItems, setFormItems] = useState<FormItem[]>([]);
  const [originalWarehouse, setOriginalWarehouse] = useState("");
  const [formBillFileName, setFormBillFileName] = useState("");
  const [formBillFile, setFormBillFile] = useState<File | null>(null);
  const [removeBill, setRemoveBill] = useState(false);
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productSearchMatches, setProductSearchMatches] = useState<CatalogProduct[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const billInputRef = useRef<HTMLInputElement>(null);
  const previewSeq = useRef(0);
  const productSearchSeq = useRef(0);

  const setField = (key: keyof ImportFormValues, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const values: ImportFormValues = { ...form, items: formItems };

  // Fill the DB-configured defaults (supplier, warehouse) into a still-blank new form once they load
  useEffect(() => {
    if (editingOrderId) return;
    setForm((prev) => {
      const defaultSupplier = DEFAULTS.supplier || "Yinglima";
      const matchedCanonical = supplierNames.find(
        (n) => n.toLowerCase() === defaultSupplier.toLowerCase() ||
               n.toLowerCase().startsWith(defaultSupplier.toLowerCase()) ||
               n.toLowerCase().includes(defaultSupplier.toLowerCase())
      ) || defaultSupplier;
      return {
        ...prev,
        supplier_name: prev.supplier_name || matchedCanonical,
        warehouse: prev.warehouse || DEFAULTS.warehouse || "",
      };
    });
  }, [DEFAULTS, editingOrderId, supplierNames]);

  // Live landing cost: the server runs the exact formulas used on save, so the figures shown here are what gets stored
  const previewKey = JSON.stringify({ ...form, items: formItems.map((i) => [i.product_name, i.quantity, i.unit_rate_usd]) });
  useEffect(() => {
    if (!isFormOpen) return;
    const seq = ++previewSeq.current;
    const timer = setTimeout(() => {
      previewImport(values)
        .then((p) => {
          if (seq === previewSeq.current) {
            setPreview(p);
            setPreviewError(null);
          }
        })
        .catch((err) => {
          if (seq === previewSeq.current) {
            setPreview(null);
            setPreviewError(apiErrorText(err));
          }
        });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, isFormOpen]);

  const namedRows = formItems.filter((i) => i.product_name.trim());
  const previewRow = (id: string) => {
    const idx = namedRows.findIndex((r) => r.id === id);
    return idx >= 0 ? preview?.items[idx] : undefined;
  };
  const dash = (n: number | undefined, fmt: (v: number) => string = (v) => String(v)) => (n === undefined ? "—" : fmt(n));

  const isEditingInwarded = Boolean(editingOrderId) && orders.some(
    (o) => o.id === editingOrderId && (o.status_key === "received" || o.status_key === "closed")
  );
  const warehouseLocked = Boolean(editingOrderId) && (isEditingInwarded || physicalWarehouses.has(originalWarehouse));

  const resetForm = () => {
    setForm(blankForm());
    setFormItems([]);
    setOriginalWarehouse("");
    setFormBillFileName("");
    setFormBillFile(null);
    setRemoveBill(false);
    setFormErrors({});
    setPreview(null);
    setPreviewError(null);
    setProductSearchQuery("");
    setProductSearchMatches([]);
  };

  const populateForm = (order: ImportPurchaseRecord) => {
    const s = (n: number | undefined) => (n ? String(n) : "");
    setEditingOrderId(order.id);
    setOriginalWarehouse(order.warehouse);
    setForm({
      consignment_no: order.consignment_no,
      supplier_name: order.supplier_name,
      warehouse: order.warehouse,
      ordered_date: order.ordered_date,
      invoice_date: order.invoice_date || "",
      etd_origin_date: order.etd_origin_date || "",
      eta_port_date: order.eta_port_date || "",
      expected_arrival_date: order.exp_arri_date || "",
      conversion_rate: s(order.con_rate_usd_to_inr),
      customs_conversion_rate: s(order.custom_con_rate_usd_to_inr),
      invoice_total_usd: s(order.invoice_total_usd),
      total_cbm: s(order.total_cbm),
      total_import_duty: s(order.total_imp_duty),
      freight: s(order.freight_exp),
      insurance: s(order.insurance_exp),
      stamp_duty: s(order.stamp_duty_exp),
      shipping_line_charges: s(order.shipping_line_charges),
      cfs_charges: s(order.cfs_charges),
      clearing_transport: s(order.clearing_transport),
      offloading: s(order.offloading_exp),
      misc_charges: s(order.misc_charges),
      misc_remarks: order.misc_remarks || "",
      remarks: order.remarks || "",
      items: [],
    });
    setFormItems((order.items || []).map((it, idx) => ({ id: it.id || `row-${idx}`, product_name: it.product_name, quantity: it.quantity, unit_rate_usd: it.unit_rate_usd })));
    setFormBillFileName(order.bill_file || "");
    setFormBillFile(null);
    setRemoveBill(false);
    setFormErrors({});
    setIsFormOpen(true);
  };

  const handleOpenCreate = () => {
    setEditingOrderId(null);
    resetForm();
    setIsFormOpen(true);
    navigate("/purchase-order/import-purchase/addedit");
  };

  const handleOpenEdit = (order: ImportPurchaseRecord) => {
    populateForm(order);
    navigate(`/purchase-order/import-purchase/addedit/${order.id}`);
  };

  // Opening .../addedit/:id loads that consignment into the form
  useEffect(() => {
    if (!routeOrderId || editingOrderId === routeOrderId) return;
    let cancelled = false;
    apiGet<any>(`${IMPORT_PURCHASE_API}/${routeOrderId}`)
      .then((res) => {
        if (!cancelled && res?.data) populateForm(mapImportPurchase(res.data, statusRules));
      })
      .catch((err) => {
        if (!cancelled) setPageError(apiErrorText(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeOrderId]);

  // Moves a consignment to its next status through the API; the server applies the rules
  const transitionOrder = async (order: ImportPurchaseRecord, target: string, reason?: string) => {
    try {
      await apiPatch(`${IMPORT_PURCHASE_API}/${order.id}/status`, { status: target, reason });
      toast(`Consignment ${order.consignment_no} ${statusRules[target]?.label?.toLowerCase() || target}`, "success");
      await loadOrders();
    } catch (err) {
      toast(apiErrorText(err), "error");
    }
  };

  const handleConfirmOrder = (order: ImportPurchaseRecord) => {
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

  const handleDeleteOrder = async (order: ImportPurchaseRecord) => {
    if (!window.confirm(`Are you sure you want to delete consignment ${order.consignment_no}?`)) return;
    try {
      await apiDelete(`${IMPORT_PURCHASE_API}/${order.id}`);
      toast(`Consignment ${order.consignment_no} deleted successfully`, "success");
      await loadOrders();
    } catch (err) {
      toast(apiErrorText(err), "error");
    }
  };

  const handleOpenBillPdf = (order: ImportPurchaseRecord) => {
    window.open(`/purchase-order/import-bill-file/${order.id}`, "_blank");
  };

  const handleBack = () => {
    setEditingOrderId(null);
    setIsFormOpen(false);
    navigate("/purchase/importpurchase");
  };

  // Product search: the Product Master
  const handleProductSearchChange = (val: string) => {
    setProductSearchQuery(val);
    if (!val.trim()) {
      setProductSearchMatches([]);
      return;
    }
    const seq = ++productSearchSeq.current;
    void apiGet<any[]>(`/masters/products?page=1&page_size=10&status=active&search=${encodeURIComponent(val.trim())}`)
      .then((res) => {
        if (seq === productSearchSeq.current) setProductSearchMatches((res?.data || []).map((p) => ({ product_name: p.product_name })));
      })
      .catch(() => {
        if (seq === productSearchSeq.current) setProductSearchMatches([]);
      });
  };

  const handleSelectProductMatch = (prod: CatalogProduct) => {
    setFormItems((prev) => [...prev, { id: "row-" + Date.now() + Math.random().toString(36).slice(2, 6), product_name: prod.product_name, quantity: 1, unit_rate_usd: "" }]);
    setProductSearchQuery("");
    setProductSearchMatches([]);
  };

  const updateItem = (id: string, field: "quantity" | "unit_rate_usd", value: string) =>
    setFormItems((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  const removeItem = (id: string) => setFormItems((prev) => prev.filter((i) => i.id !== id));

  const handleSaveImportOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { [key: string]: string } = {};
    if (!form.supplier_name.trim()) errs.supplier = "Supplier is required.";
    else if (supplierNames.length > 0) {
      const trimmed = form.supplier_name.trim().toLowerCase();
      const matched = supplierNames.some((n) => {
        const ln = n.toLowerCase();
        return ln === trimmed || ln.startsWith(trimmed) || ln.includes(trimmed);
      });
      if (!matched) {
        errs.supplier = "Select a supplier from the list.";
      }
    }
    if (!form.warehouse) errs.warehouse = "Warehouse is required.";
    if (!form.consignment_no.trim()) errs.consignment_no = "Invoice / Consignment No. is required.";
    if (!form.ordered_date.trim()) errs.ordered_date = "Ordered Date is required.";
    if (!(Number(form.conversion_rate) > 0)) errs.conversion_rate = "Conversion rate is required.";
    if (!(Number(form.customs_conversion_rate) > 0)) errs.customs_conversion_rate = "Customs conversion rate is required.";
    if (namedRows.length === 0) errs.items = "Please add at least one product.";
    else if (namedRows.some((r) => !(Number(r.quantity) > 0))) errs.items = "Every product needs a quantity above zero.";
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }
    setFormErrors({});
    setSaving(true);
    try {
      const trimmedSup = form.supplier_name.trim().toLowerCase();
      const canonicalSupplier =
        supplierNames.find((n) => n.toLowerCase() === trimmedSup) ||
        supplierNames.find((n) => n.toLowerCase().startsWith(trimmedSup)) ||
        supplierNames.find((n) => n.toLowerCase().includes(trimmedSup));
      const body = buildImportPayload({ ...values, supplier_name: canonicalSupplier || form.supplier_name.trim() });
      const res = editingOrderId
        ? await apiPut<{ id: string }>(`${IMPORT_PURCHASE_API}/${editingOrderId}`, body)
        : await apiPost<{ id: string }>(IMPORT_PURCHASE_API, body);
      const savedId = (res.data as { id: string }).id;
      if (formBillFile) {
        const fd = new FormData();
        fd.append("file", formBillFile);
        await apiPostMultipart(`${IMPORT_PURCHASE_API}/${savedId}/bill`, fd);
      } else if (editingOrderId && removeBill) {
        await apiDelete(`${IMPORT_PURCHASE_API}/${savedId}/bill`);
      }
      toast(editingOrderId ? "Import consignment updated successfully" : "Import consignment created successfully", "success");
      setEditingOrderId(null);
      setIsFormOpen(false);
      navigate("/purchase/importpurchase");
      await loadOrders();
    } catch (err) {
      // stay on the form and show the real reason; never pretend it was saved
      setFormErrors({ submit: apiErrorText(err) });
      toast(apiErrorText(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const headers = [
      "Inv. / Con. No & Date",
      "Supplier",
      "Warehouse",
      "Ordered Date",
      "ETD Origin Date",
      "ETA Port Date",
      "Arrival Date",
      "Inv. Total ($)",
      "Inv. Total (₹)",
      "Total CBM",
      "Total Exp",
      "% Loading Exp(VB)",
      "Loading Exp(CB)(₹)",
      "Gross Total Landing(₹)",
      "Created By",
      "Invoice",
      "Updated Date",
      "Status",
    ];
    const rows = sortedOrders.map((o) => [
      o.consignment_no,
      o.supplier_name,
      o.warehouse,
      o.ordered_date,
      o.etd_origin_date || "",
      o.eta_port_date || "",
      o.arrival_date || "",
      o.invoice_total_usd > 0 ? o.invoice_total_usd : "-",
      o.invoice_total_inr,
      o.total_cbm || "",
      o.total_expenses || 0,
      o.loading_expense_percent ? `${o.loading_expense_percent}%` : "",
      o.loading_amount_per_cbm || 0,
      o.gross_total_landing || o.invoice_total_inr,
      o.created_by || "—",
      o.bill_file || "",
      o.updated_date || o.added_on || o.ordered_date,
      o.status,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.map((val) => `"${val}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `import_purchase_list_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ==========================================
  // VIEW 1: Add/Edit Import Purchase View
  // ==========================================
  if (isFormOpen) {
    // At Pending the goods are still ordered / in transit: physical warehouses are hidden (General Points). A consignment that
    // already sits in a physical warehouse keeps being offered every warehouse, since its warehouse is locked anyway.
    const offeredWarehouses = (() => {
      const base =
        editingOrderId && physicalWarehouses.has(originalWarehouse)
          ? warehouseNames
          : warehouseNames.filter((n) => !physicalWarehouses.has(n));
      return form.warehouse && !base.includes(form.warehouse) ? [...base, form.warehouse] : base;
    })();
    const numField = (key: keyof ImportFormValues, label: string, opts: { required?: boolean; error?: string } = {}) => (
      <Field label={label} required={opts.required} error={opts.error}>
        <input
          type="number"
          step="any"
          min="0"
          aria-label={label}
          value={form[key] as string}
          onChange={(e) => setField(key, e.target.value)}
          style={FIELD_INPUT}
        />
      </Field>
    );
    const dateField = (key: keyof ImportFormValues, label: string, required = false, error?: string) => (
      <Field label={label} required={required} error={error}>
        <DatePicker
          value={form[key] as string}
          onChange={(val) => setField(key, val)}
          ariaLabel={label}
          placeholder="DD-MM-YYYY"
          inputStyle={{ height: "34px", fontSize: "13px", color: "#334155" }}
        />
      </Field>
    );
    const readOnlyField = (label: string, value: string) => (
      <Field label={label}>
        <input aria-label={label} readOnly value={value} style={{ ...FIELD_INPUT, background: "#f8fafc", fontWeight: 600 }} />
      </Field>
    );
    const th: React.CSSProperties = { padding: "8px 10px", fontSize: "11.5px", fontWeight: 700, color: "#475569", textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" };
    const td: React.CSSProperties = { padding: "6px 10px", fontSize: "12.5px", textAlign: "right", color: "#334155", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" };
    const money = (v: number) => formatIndianCurrency(v);

    return (
      <AppShell activeKey="import-purchases">
        <main className="page" style={{ padding: "16px 24px 60px", maxWidth: "100%", background: "#f8fafc" }}>
          <div style={{ marginBottom: "12px" }}>
            <Breadcrumb trail={["Purchase", "Import Purchase", editingOrderId ? "Edit Import Purchase" : "Add Import Purchase"]} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
              {editingOrderId ? "Edit Import Purchase" : "Add Import Purchase"}
            </h1>
            <button
              type="button"
              onClick={handleBack}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "4px", padding: "6px 14px", fontSize: "13px", fontWeight: 600, color: "#334155", cursor: "pointer" }}
            >
              ← BACK
            </button>
          </div>

          {formErrors.submit && (
            <div role="alert" style={{ padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "6px", color: "#b91c1c", fontSize: "13px", marginBottom: "12px" }}>
              ⚠️ {formErrors.submit}
            </div>
          )}

          {isEditingInwarded && (
            <div style={{ padding: "12px 16px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "6px", color: "#166534", fontSize: "13px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "18px" }}>📦</span>
              <div>
                <strong>Late Expense Inward Editing Active:</strong> Container expenses, customs charges, conversion rates, and remarks can be updated after inward (even if partial sales have occurred against it). Inwarded physical stock quantities and warehouse location are protected.
              </div>
            </div>
          )}

          <form onSubmit={handleSaveImportOrder} noValidate>
            {/* General Details */}
            <div style={CARD}>
              <div style={CARD_TITLE}>General Details</div>
              <div style={GRID4}>
                <Field label="Supplier" required error={formErrors.supplier}>
                  <input
                    aria-label="Supplier"
                    list="import-supplier-options"
                    autoComplete="off"
                    placeholder="Type to search suppliers"
                    value={form.supplier_name}
                    onChange={(e) => setField("supplier_name", e.target.value)}
                    style={FIELD_INPUT}
                  />
                  <datalist id="import-supplier-options">
                    {supplierNames.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Warehouse" required error={formErrors.warehouse}>
                  <select
                    aria-label="Warehouse"
                    value={form.warehouse}
                    disabled={warehouseLocked}
                    title={warehouseLocked ? "Stock has been received into a physical warehouse, so the warehouse can no longer be changed." : undefined}
                    onChange={(e) => setField("warehouse", e.target.value)}
                    style={FIELD_INPUT}
                  >
                    <option value="">Select</option>
                    {offeredWarehouses.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Invoice / Consignment No." required error={formErrors.consignment_no}>
                  <input aria-label="Invoice / Consignment No." value={form.consignment_no} onChange={(e) => setField("consignment_no", e.target.value)} style={FIELD_INPUT} />
                </Field>
                {dateField("ordered_date", "Ordered Date", true, formErrors.ordered_date)}
                {dateField("invoice_date", "Invoice Date")}
                {dateField("etd_origin_date", "ETD Origin Date")}
                {dateField("eta_port_date", "ETA Port Date")}
                {dateField("expected_arrival_date", "Expected Arrival Date")}
                {numField("conversion_rate", "Conversion Rate (USD to INR)", { required: true, error: formErrors.conversion_rate })}
                {numField("customs_conversion_rate", "Customs Conversion Rate (USD to INR)", { required: true, error: formErrors.customs_conversion_rate })}
                {numField("invoice_total_usd", "Invoice Total Value (USD)")}
                {numField("total_cbm", "Total CBM")}
                {numField("total_import_duty", "Total Import Duty (INR)")}
                <Field label="Attach Invoice">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      ref={billInputRef}
                      type="file"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setFormBillFileName(e.target.files[0].name);
                          setFormBillFile(e.target.files[0]);
                          setRemoveBill(false);
                        }
                      }}
                    />
                    <button type="button" onClick={() => billInputRef.current?.click()} style={{ height: "34px", padding: "0 12px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "12px", cursor: "pointer" }}>
                      Choose File
                    </button>
                    <span style={{ fontSize: "12.5px", color: "#475569", overflow: "hidden", textOverflow: "ellipsis" }}>{formBillFileName || "No file chosen"}</span>
                    {formBillFileName && (
                      <button
                        type="button"
                        aria-label="Remove file"
                        onClick={() => {
                          setFormBillFileName("");
                          setFormBillFile(null);
                          setRemoveBill(true);
                        }}
                        style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer" }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </Field>
              </div>
            </div>

            {/* Expenses */}
            <div style={CARD}>
              <div style={CARD_TITLE}>EXPENSES</div>
              <div style={GRID4}>
                {numField("freight", "Freight")}
                {numField("insurance", "Insurance")}
                {numField("stamp_duty", "Stamp Duty")}
                {numField("shipping_line_charges", "Shipping Line Charges")}
                {numField("cfs_charges", "CFS Charges")}
                {numField("clearing_transport", "Clearing & Transport")}
                {numField("offloading", "Offloading")}
                {numField("misc_charges", "Miscellaneous")}
                <Field label="Miscellaneous Remarks">
                  <input aria-label="Miscellaneous Remarks" value={form.misc_remarks} onChange={(e) => setField("misc_remarks", e.target.value)} style={FIELD_INPUT} />
                </Field>
              </div>
              <div style={{ ...GRID4, marginBottom: 0 }}>
                {readOnlyField("Total Expenses", dash(preview?.total_expenses, money))}
                {readOnlyField("Invoice Total Value (INR)", dash(preview?.invoice_total_inr, money))}
                {readOnlyField("Gross Total Landing (INR)", dash(preview?.gross_total_landing, money))}
                {readOnlyField("% Loading Expense (Value Based)", dash(preview?.loading_percent_vb, (v) => `${v}%`))}
                {readOnlyField("Loading Amount per CBM", dash(preview?.loading_amount_per_cbm, money))}
              </div>
              {previewError && <span role="alert" style={{ ...FIELD_ERROR, marginTop: "8px" }}>{previewError}</span>}
            </div>

            {/* Product search */}
            {!isEditingInwarded && (
              <div style={CARD}>
                <div style={CARD_TITLE}>PRODUCT SEARCH</div>
                <div style={{ position: "relative", maxWidth: "460px" }}>
                  <input
                    aria-label="Product Search"
                    placeholder="Enter Product Name / Model No"
                    value={productSearchQuery}
                    onChange={(e) => handleProductSearchChange(e.target.value)}
                    style={FIELD_INPUT}
                  />
                  {productSearchMatches.length > 0 && (
                    <div style={{ position: "absolute", top: "36px", left: 0, right: 0, background: "#fff", border: "1px solid #cbd5e1", borderRadius: "4px", zIndex: 20, maxHeight: "220px", overflowY: "auto" }}>
                      {productSearchMatches.map((p) => (
                        <div
                          key={p.product_name}
                          role="option"
                          onClick={() => handleSelectProductMatch(p)}
                          style={{ padding: "8px 12px", fontSize: "13px", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}
                        >
                          {p.product_name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {formErrors.items && <span style={FIELD_ERROR}>{formErrors.items}</span>}
              </div>
            )}

            {/* Product items with landing cost */}
            <div style={CARD}>
              <div style={CARD_TITLE}>PRODUCT ITEM</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Sr.", "Product", "Qty", "UOM", "Pkg Unit CBM", "Pkg Qty", "Total CBM", "Unit Rate (USD)", "Total (USD)", "Unit Rate (INR)",
                        "Import Duty %", "Unit Import Duty (INR)", "Item Total Import Duty (INR)", "Exp / Unit (VB)", "Exp / Unit (CB)", "Unit Landing (VB)", "Unit Landing (CB)", "Diff (CB - VB)", ""].map((h, i) => (
                          <th key={i} style={{ ...th, textAlign: i === 1 ? "left" : "right" }}>{h}</th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {formItems.length === 0 && (
                      <tr>
                        <td colSpan={19} style={{ ...td, textAlign: "center", color: "#94a3b8" }}>Search and add products above</td>
                      </tr>
                    )}
                    {formItems.map((row, idx) => {
                      const p = previewRow(row.id);
                      return (
                        <tr key={row.id}>
                          <td style={td}>{idx + 1}</td>
                          <td style={{ ...td, textAlign: "left" }}>{row.product_name}</td>
                          <td style={td}>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              aria-label={`Quantity ${idx + 1}`}
                              value={row.quantity}
                              disabled={isEditingInwarded}
                              title={isEditingInwarded ? "Quantity is locked after inward to preserve warehouse stock" : undefined}
                              onChange={(e) => updateItem(row.id, "quantity", e.target.value)}
                              style={{ ...FIELD_INPUT, width: "80px", textAlign: "right", ...(isEditingInwarded ? { background: "#f1f5f9", cursor: "not-allowed" } : {}) }}
                            />
                          </td>
                          <td style={td}>{p?.unit || "—"}</td>
                          <td style={td}>{dash(p?.pkg_unit_cbm)}</td>
                          <td style={td}>{dash(p?.pkg_qty)}</td>
                          <td style={td}>{dash(p?.total_cbm)}</td>
                          <td style={td}>
                            <input type="number" min="0" step="any" aria-label={`Unit Rate USD ${idx + 1}`} value={row.unit_rate_usd} onChange={(e) => updateItem(row.id, "unit_rate_usd", e.target.value)} style={{ ...FIELD_INPUT, width: "100px", textAlign: "right" }} />
                          </td>
                          <td style={td}>{dash(p?.total_usd, formatUsdCurrency)}</td>
                          <td style={td}>{dash(p?.unit_rate_inr, money)}</td>
                          <td style={td}>{dash(p?.duty_percent, (v) => `${v}%`)}</td>
                          <td style={td}>{dash(p?.unit_id_inr, money)}</td>
                          <td style={td}>{dash(p?.item_total_id_inr, money)}</td>
                          <td style={td}>{dash(p?.exp_per_unit_vb, money)}</td>
                          <td style={td}>{dash(p?.exp_per_unit_cb, money)}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{dash(p?.unit_landing_rate_vb, money)}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{dash(p?.unit_landing_rate_cb, money)}</td>
                          <td style={td}>{dash(p?.diff_cb_vb, money)}</td>
                          <td style={td}>
                            {!isEditingInwarded && (
                              <button type="button" aria-label={`Remove ${row.product_name}`} onClick={() => removeItem(row.id)} style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer" }}>✕</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {formItems.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={6} style={{ ...td, fontWeight: 700 }}>Total</td>
                        <td style={{ ...td, fontWeight: 700 }} data-testid="sum-cbm">{dash(preview?.sum_cbm)}</td>
                        <td style={td} />
                        <td style={{ ...td, fontWeight: 700 }} data-testid="sum-usd">{dash(preview?.sum_usd, formatUsdCurrency)}</td>
                        <td colSpan={3} style={td} />
                        <td style={{ ...td, fontWeight: 700 }} data-testid="sum-duty">{dash(preview?.sum_duty, money)}</td>
                        <td colSpan={6} style={td} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Remarks + actions */}
            <div style={CARD}>
              <Field label="Remarks">
                <textarea aria-label="Remarks" rows={3} placeholder="Enter remarks" value={form.remarks} onChange={(e) => setField("remarks", e.target.value)} style={{ ...FIELD_INPUT, height: "auto", padding: "8px" }} />
              </Field>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "14px" }}>
                <button type="button" onClick={handleBack} style={{ padding: "7px 18px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "13px", fontWeight: 600, color: "#475569", cursor: "pointer" }}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ padding: "7px 24px", background: saving ? "#94a3b8" : "#0061f2", border: "none", borderRadius: "4px", fontSize: "13px", fontWeight: 600, color: "#ffffff", cursor: saving ? "not-allowed" : "pointer" }}
                >
                  {saving ? "Saving…" : editingOrderId ? "Update Consignment" : "Submit Consignment"}
                </button>
              </div>
            </div>
          </form>
        </main>
      </AppShell>
    );
  }

  // ==========================================
  // VIEW 2: Import Purchase List Table View
  // ==========================================
  return (
    <AppShell activeKey="import-purchases">
      <main className="page" style={{ padding: "16px 24px 60px", maxWidth: "100%", background: "#f8fafc" }}>
        {pageError && (
          <div role="alert" style={{ padding: "12px 16px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "6px", color: "#b91c1c", fontSize: "13px", marginBottom: "16px" }}>
            ⚠️ {pageError}
          </div>
        )}
        <div style={{ marginBottom: "12px" }}>
          <Breadcrumb trail={["Purchase", "Import Purchase"]} />
        </div>
        {/* Top Header matching Companies */}
        <div
          className="page-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h1
            style={{
              fontSize: "20px",
              fontWeight: 700,
              color: "#1e293b",
              margin: 0,
            }}
          >
            Import Purchase
          </h1>

          <div className="page-header-actions" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* Filter Toggle Button */}
            <button
              type="button"
              className="btn"
              data-testid="btn-filter-toggle"
              onClick={() => setIsFilterOpen((prev) => !prev)}
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
              title="Toggle Filter Options"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </button>

            {/* ADD NEW button */}
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
              ADD NEW
            </button>

            {/* Export button */}
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

        {/* KPI cards and status tabs: one per status in the DB-configured workflow */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${statusKeys.length + 1}, 1fr)`,
            gap: "14px",
            marginBottom: "16px",
          }}
        >
          {["all", ...statusKeys].map((key) => (
            <div
              key={key}
              data-testid={`kpi-card-${key}`}
              style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "14px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}
            >
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {key === "all" ? "ALL" : statusRules[key]?.card_label || statusRules[key]?.label || key}
              </div>
              <div style={{ fontSize: "15.5px", fontWeight: 700, color: "#1e293b", marginTop: "4px" }}>
                {formatIndianCurrency(kpi(key).amount)} ({kpi(key).count})
              </div>
            </div>
          ))}
        </div>

        {/* Status Tabs underneath KPI cards */}
        <div style={{ display: "flex", alignItems: "center", gap: "24px", borderBottom: "1px solid #e2e8f0", marginBottom: "16px" }}>
          {["ALL", ...statusKeys].map((key) => {
            const tabKey = key === "ALL" ? "all" : key;
            const active = selectedTab === key;
            return (
              <button
                key={key}
                type="button"
                data-testid={`tab-${tabKey}`}
                onClick={() => setSelectedTab(key)}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: active ? "2px solid #0061f2" : "2px solid transparent",
                  padding: "8px 4px",
                  fontSize: "13.5px",
                  fontWeight: active ? 700 : 500,
                  color: active ? "#0061f2" : "#64748b",
                  cursor: "pointer",
                }}
              >
                {key === "ALL" ? "All" : statusRules[key]?.label || key} ({kpi(tabKey).count})
              </button>
            );
          })}
        </div>

        {/* Collapsible Filter Panel */}
        {isFilterOpen && (
          <div
            data-testid="filter-panel"
            style={{
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "6px",
              padding: "14px 18px",
              marginBottom: "16px",
              boxShadow: "0 2px 4px rgba(0,0,0,0.03)",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px", alignItems: "flex-end" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px", display: "block" }}>
                  Warehouse
                </label>
                <select
                  value={filterWarehouse}
                  onChange={(e) => setFilterWarehouse(e.target.value)}
                  style={{ width: "100%", height: "32px", border: "1px solid #cbd5e1", borderRadius: "4px", padding: "0 8px", fontSize: "12.5px" }}
                >
                  <option value="ALL">All Warehouses</option>
                  {warehouseNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px", display: "block" }}>
                  Supplier
                </label>
                <select
                  value={filterSupplier}
                  onChange={(e) => setFilterSupplier(e.target.value)}
                  style={{ width: "100%", height: "32px", border: "1px solid #cbd5e1", borderRadius: "4px", padding: "0 8px", fontSize: "12.5px" }}
                >
                  <option value="ALL">All Suppliers</option>
                  {supplierNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              {(
                [
                  ["Expected Arrival Date Range", filterArrival, setFilterArrival],
                  ["ETD Origin Date Range", filterEtd, setFilterEtd],
                  ["ETA Port Date Range", filterEta, setFilterEta],
                ] as [string, DateFilter, (f: DateFilter) => void][]
              ).map(([label, value, setValue]) => (
                <div key={label}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px", display: "block" }}>{label}</label>
                  <select
                    aria-label={label}
                    value={value.preset}
                    onChange={(e) => setValue({ ...value, preset: e.target.value as DateFilter["preset"] })}
                    style={{ width: "100%", height: "32px", border: "1px solid #cbd5e1", borderRadius: "4px", padding: "0 8px", fontSize: "12.5px" }}
                  >
                    {RANGE_PRESET_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {value.preset === "custom" && (
                    <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                      <DatePicker value={value.from} onChange={(v) => setValue({ ...value, from: v })} ariaLabel={`${label} From`} placeholder="From" inputStyle={{ height: "30px", fontSize: "12px" }} />
                      <DatePicker value={value.to} onChange={(v) => setValue({ ...value, to: v })} ariaLabel={`${label} To`} placeholder="To" inputStyle={{ height: "30px", fontSize: "12px" }} />
                    </div>
                  )}
                </div>
              ))}

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => {
                    setFilterWarehouse("ALL");
                    setFilterSupplier("ALL");
                    setFilterArrival(EMPTY_DATE_FILTER);
                    setFilterEtd(EMPTY_DATE_FILTER);
                    setFilterEta(EMPTY_DATE_FILTER);
                  }}
                  style={{
                    padding: "6px 14px",
                    background: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    color: "#475569",
                    cursor: "pointer",
                  }}
                >
                  Reset
                </button>
              </div>
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
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
            minHeight: "420px",
          }}
        >
          {/* Table Toolbar matching Companies */}
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
                aria-label="Search Import Purchases"
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
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "12.5px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #cbd5e1", background: "#f8fafc", whiteSpace: "nowrap" }}>
                  <th style={{ width: "40px", minWidth: "40px", maxWidth: "45px", textAlign: "center", padding: "10px 14px" }}>
                    <input
                      type="checkbox"
                      aria-label="Select all import orders"
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
                    onClick={() => handleSort("consignment_no")}
                    style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", cursor: "pointer", userSelect: "none" }}
                  >
                    Inv. / Con. No & Date <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "consignment_no" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th
                    onClick={() => handleSort("supplier_name")}
                    style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", cursor: "pointer", userSelect: "none" }}
                  >
                    Supplier <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "supplier_name" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th
                    onClick={() => handleSort("warehouse")}
                    style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", cursor: "pointer", userSelect: "none" }}
                  >
                    Warehouse <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "warehouse" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th
                    onClick={() => handleSort("ordered_date")}
                    style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", cursor: "pointer", userSelect: "none" }}
                  >
                    Ordered Date <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "ordered_date" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569" }}>
                    ETD Origin Date
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569" }}>
                    ETA Port Date
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569" }}>
                    Arrival Date
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", textAlign: "right" }}>
                    Inv. Total ($)
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", textAlign: "right" }}>
                    Inv. Total (₹)
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", textAlign: "right" }}>
                    Total CBM
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", textAlign: "right" }}>
                    Total Exp
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", textAlign: "right" }}>
                    % Loading Exp(VB)
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", textAlign: "right" }}>
                    Loading Exp(CB)(₹)
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", textAlign: "right" }}>
                    Gross Total Landing(₹)
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569" }}>
                    Created By
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569" }}>
                    Invoice
                  </th>
                  <th
                    onClick={() => handleSort("updated_date")}
                    style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", cursor: "pointer", userSelect: "none" }}
                  >
                    Updated Date <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "updated_date" ? (sortOrder === "asc" ? "▲" : "▼") : "⇅"}</span>
                  </th>
                  <th
                    onClick={() => handleSort("status")}
                    style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", textAlign: "center", cursor: "pointer", userSelect: "none" }}
                  >
                    Status <span style={{ color: "#94a3b8", fontSize: "11px" }}>{sortField === "status" ? (sortOrder === "asc" ? "▲" : "▼") : "▲"}</span>
                  </th>
                  <th style={{ padding: "10px 14px", fontWeight: 700, color: "#475569", textAlign: "center", width: "70px" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedOrders.length === 0 ? (
                  <tr>
                    <td colSpan={20} style={{ padding: "32px", textAlign: "center", color: "#64748b", fontSize: "13.5px", background: "#f8fafc" }}>
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
                        whiteSpace: "nowrap",
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
                          aria-label={`Select consignment ${order.consignment_no}`}
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
                      {/* Inv. / Con. No & Date */}
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
                          {order.consignment_no}
                        </button>
                        {order.invoice_date && <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>{order.invoice_date}</div>}
                      </td>

                      {/* Supplier */}
                      <td style={{ padding: "10px 14px", color: "#334155" }}>
                        {order.supplier_name}
                      </td>

                      {/* Warehouse */}
                      <td style={{ padding: "10px 14px", color: "#334155" }}>
                        {order.warehouse}
                      </td>

                      {/* Ordered Date */}
                      <td style={{ padding: "10px 14px", color: "#334155" }}>
                        {order.ordered_date}
                      </td>

                      {/* ETD Origin Date */}
                      <td style={{ padding: "10px 14px", color: "#64748b" }}>
                        {order.etd_origin_date || "—"}
                      </td>

                      {/* ETA Port Date */}
                      <td style={{ padding: "10px 14px", color: "#64748b" }}>
                        {order.eta_port_date || "—"}
                      </td>

                      {/* Arrival Date */}
                      <td style={{ padding: "10px 14px", color: "#64748b" }}>
                        {order.arrival_date || "—"}
                      </td>

                      {/* Inv. Total ($) */}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#334155" }}>
                        {order.invoice_total_usd > 0 ? formatUsdCurrency(order.invoice_total_usd) : "-"}
                      </td>

                      {/* Inv. Total (₹) */}
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: "#1e293b" }}>
                        {formatIndianCurrency(order.invoice_total_inr)}
                      </td>

                      {/* Total CBM */}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#334155" }}>
                        {order.total_cbm ? `${order.total_cbm}` : ""}
                      </td>

                      {/* Total Exp */}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#334155" }}>
                        {formatIndianCurrency(order.total_expenses || 0)}
                      </td>

                      {/* % Loading Exp(VB) */}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#334155" }}>
                        {order.loading_expense_percent ? `${order.loading_expense_percent}%` : ""}
                      </td>

                      {/* Loading Exp(CB)(₹) */}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#334155" }}>
                        {formatIndianCurrency(order.loading_amount_per_cbm || 0)}
                      </td>

                      {/* Gross Total Landing(₹) */}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#334155" }}>
                        {formatIndianCurrency(order.gross_total_landing || order.invoice_total_inr || 0)}
                      </td>

                      {/* Created By */}
                      <td style={{ padding: "10px 14px", color: "#334155" }}>
                        {order.created_by || "—"}
                      </td>

                      {/* Invoice */}
                      <td style={{ padding: "10px 14px", color: "#334155" }}>
                        {order.bill_file ? (
                          <button
                            type="button"
                            onClick={() => handleOpenBillPdf(order)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#0061f2",
                              cursor: "pointer",
                              fontSize: "12px",
                              padding: 0,
                              textDecoration: "underline",
                            }}
                            title={order.bill_file}
                          >
                            {order.bill_file}
                          </button>
                        ) : (
                          ""
                        )}
                      </td>

                      {/* Updated Date */}
                      <td style={{ padding: "10px 14px", color: "#334155" }}>
                        {order.updated_date || order.added_on || order.ordered_date}
                      </td>

                      {/* Status */}
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        <span
                          style={{ display: "inline-block", padding: "2px 10px", borderRadius: "9999px", fontSize: "11px", fontWeight: 600, background: palette(order).bg, color: palette(order).fg, border: `1px solid ${palette(order).border}` }}
                        >
                          {order.status}
                        </span>
                      </td>

                      {/* Action Column with conditional options */}
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

        {/* Import Purchase Details Modal */}
        {selectedOrder && (() => {
          const modalItems = selectedOrder.items || [];

          const modalTotalCbm = modalItems.reduce((acc, it) => acc + (it.total_cbm ?? (it.pkg_unit_cbm ? (it.pkg_unit_cbm * (it.quantity || 1)) : 0)), 0);
          const modalTotalUsd = modalItems.reduce((acc, it) => acc + (it.total_usd ?? (it.quantity * (it.unit_rate_usd || 1))), 0);
          const modalTotalIdInr = modalItems.reduce((acc, it) => acc + (it.item_total_id_inr ?? (it.quantity * (it.unit_id_inr || 8))), 0);

          return (
            <div
              data-testid="import-purchase-details-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="import-purchase-details-title"
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
                  maxWidth: "1160px",
                  maxHeight: "94vh",
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
                    padding: "12px 18px",
                    borderBottom: "1px solid #e2e8f0",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <h2
                      id="import-purchase-details-title"
                      style={{
                        margin: 0,
                        fontSize: "15.5px",
                        fontWeight: 700,
                        color: "#1e293b",
                      }}
                    >
                      Import Purchase Details
                    </h2>
                    <span
                      style={{ display: "inline-block", padding: "2px 10px", borderRadius: "9999px", fontSize: "11px", fontWeight: 600, background: palette(selectedOrder).bg, color: palette(selectedOrder).fg, border: `1px solid ${palette(selectedOrder).border}` }}
                    >
                      {selectedOrder.status}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {selectedOrder.bill_file && (
                      <button
                        type="button"
                        data-testid="btn-import-bill-file-pdf"
                        onClick={() => handleOpenBillPdf(selectedOrder)}
                        style={{
                          background: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          color: "#16a34a",
                          cursor: "pointer",
                          padding: "4px 10px",
                          borderRadius: "4px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          fontWeight: 600,
                          fontSize: "11.5px",
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        <span>View PDF</span>
                      </button>
                    )}
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
                        fontWeight: 600,
                        lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Body */}
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  {/* 3-Column Entity Box */}
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      border: "1px solid #e2e8f0",
                      fontSize: "11.5px",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 700, color: "#1e293b", width: "30%", borderRight: "1px solid #e2e8f0" }}>
                          Order Detail
                        </th>
                        <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 700, color: "#1e293b", width: "35%", borderRight: "1px solid #e2e8f0" }}>
                          From
                        </th>
                        <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 700, color: "#1e293b", width: "35%" }}>
                          To
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ padding: "10px 12px", verticalAlign: "top", borderRight: "1px solid #e2e8f0", color: "#334155", lineHeight: "1.7" }}>
                          <div><span style={{ fontWeight: 600 }}>Ordered Date: </span>{selectedOrder.ordered_date || "—"}</div>
                          <div><span style={{ fontWeight: 600 }}>Created: </span>{selectedOrder.created_at_time || selectedOrder.added_on || "—"}</div>
                          <div><span style={{ fontWeight: 600 }}>Created By: </span>{selectedOrder.created_by || "—"}</div>
                        </td>
                        <td style={{ padding: "10px 12px", verticalAlign: "top", borderRight: "1px solid #e2e8f0", color: "#334155", lineHeight: "1.7" }}>
                          <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "2px" }}>{selectedOrder.supplier_name || ""}</div>
                          <div>{selectedOrder.supplier_address || ""}</div>
                          <div><span style={{ fontWeight: 600 }}>Email: </span>{selectedOrder.supplier_email || "—"}</div>
                          <div><span style={{ fontWeight: 600 }}>Phone: </span>{selectedOrder.supplier_phone || ""}</div>
                          <div><span style={{ fontWeight: 600 }}>GST No: </span>{selectedOrder.supplier_gst || "—"}</div>
                        </td>
                        <td style={{ padding: "10px 12px", verticalAlign: "top", color: "#334155", lineHeight: "1.7" }}>
                          <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: "2px" }}>{selectedOrder.to_name || ""}</div>
                          <div>{selectedOrder.to_address || ""}</div>
                          <div><span style={{ fontWeight: 600 }}>Email: </span>{selectedOrder.to_email || "—"}</div>
                          <div><span style={{ fontWeight: 600 }}>Phone: </span>{selectedOrder.to_phone || "—"}</div>
                          <div><span style={{ fontWeight: 600 }}>GST No: </span>{selectedOrder.to_gst || "—"}</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* General Consignment Info Table */}
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      border: "1px solid #e2e8f0",
                      fontSize: "11.5px",
                    }}
                  >
                    <tbody>
                      <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Warehouse:</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.warehouse}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Inv. / Cons No.:</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.consignment_no}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Inv. Date:</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.invoice_date || "—"}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Inv. Total (Without GST):</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.invoice_total_inr || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Exp. Arri. Date:</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.exp_arri_date || selectedOrder.arrival_date || "—"}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>ETD Origin Date:</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.etd_origin_date || "—"}</div>
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>ETA Port Date:</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.eta_port_date || "—"}</div>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Con. Rate (USD To INR):</div>
                          <div style={{ color: "#475569" }}>₹ {(selectedOrder.con_rate_usd_to_inr ?? 95).toFixed(2)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Custom Con. Rate (USD To INR):</div>
                          <div style={{ color: "#475569" }}>₹ {(selectedOrder.custom_con_rate_usd_to_inr ?? 95).toFixed(2)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Inv. Total (USD):</div>
                          <div style={{ color: "#475569" }}>$ {(selectedOrder.invoice_total_usd || 0).toFixed(2)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Total CBM:</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.total_cbm ? `${selectedOrder.total_cbm}` : "—"}</div>
                        </td>
                        <td colSpan={3} style={{ padding: "8px 10px" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Total Imp. Duty:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.total_imp_duty || 0)}</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Expenses Section */}
                  <div style={{ textAlign: "center", fontWeight: 700, fontSize: "12px", color: "#334155", margin: "4px 0 2px" }}>
                    Expenses
                  </div>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      border: "1px solid #e2e8f0",
                      fontSize: "11.5px",
                    }}
                  >
                    <tbody>
                      <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Freight:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.freight_exp || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Insurance:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.insurance_exp || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Stamp Duty:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.stamp_duty_exp || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Shipping Line Charges:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.shipping_line_charges || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>CFS Charges:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.cfs_charges || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Clearing & Transport:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.clearing_transport || 0)}</div>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Offloading:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.offloading_exp || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Misc. Charges:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.misc_charges || 0)}</div>
                          {selectedOrder.misc_remarks && <div style={{ color: "#64748b", fontSize: "11.5px", marginTop: "3px" }}>Remarks: {selectedOrder.misc_remarks}</div>}
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Total Of All Expenses:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.total_all_expenses || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>% Loading Expense (VB):</div>
                          <div style={{ color: "#475569" }}>{selectedOrder.loading_expense_percent || 0} %</div>
                        </td>
                        <td style={{ padding: "8px 10px", borderRight: "1px solid #e2e8f0" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Loading Amount Per CBM:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.loading_amount_per_cbm || 0)}</div>
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: "2px" }}>Gross Total Landing:</div>
                          <div style={{ color: "#475569" }}>{formatIndianCurrency(selectedOrder.gross_total_landing || 0)}</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Product Summary Section */}
                  <div style={{ textAlign: "center", fontWeight: 700, fontSize: "12px", color: "#334155", margin: "6px 0 2px" }}>
                    Product Summary
                  </div>
                  <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "2px" }}>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "11px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <thead>
                        <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "center", borderRight: "1px solid #e2e8f0" }}>Sr No.</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "left", borderRight: "1px solid #e2e8f0", minWidth: "180px" }}>Product Name</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "center", borderRight: "1px solid #e2e8f0" }}>Qty</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Pkg Unit CBM</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Pkg Qty</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Total CBM</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Unit Rate($)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Unit Rate(INR)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Item Total ($)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Unit ID (₹)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Item Total ID (₹)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Exp Per Unit (VB)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Exp Per Unit (CB)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Unit Landing Rate (VB)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right", borderRight: "1px solid #e2e8f0" }}>Unit Landing Rate (CB)</th>
                          <th style={{ padding: "7px 8px", fontWeight: 700, color: "#1e293b", textAlign: "right" }}>Diff - (CB-VB)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modalItems.map((item, idx) => (
                          <tr
                            key={item.id || idx}
                            style={{
                              borderBottom: "1px solid #e2e8f0",
                              background: idx % 2 === 1 ? "#fafbfd" : "#ffffff",
                            }}
                          >
                            <td style={{ padding: "6px 8px", textAlign: "center", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              {item.sr_no || idx + 1}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "left", borderRight: "1px solid #e2e8f0", color: "#1e293b", fontWeight: 500 }}>
                              {item.product_name}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "center", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              {item.quantity} {item.unit || ""}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              {item.pkg_unit_cbm ?? "0.00"}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              {item.pkg_qty ?? "1"}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              {(item.total_cbm ?? (item.pkg_unit_cbm ? (item.pkg_unit_cbm * (item.quantity || 1)) : 0)).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              $ {(item.unit_rate_usd || 1).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              ₹ {(item.unit_rate_inr ?? 95).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              $ {(item.total_usd ?? (item.quantity * (item.unit_rate_usd || 1))).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              ₹ {(item.unit_id_inr ?? 8).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              ₹ {(item.item_total_id_inr ?? (item.quantity * (item.unit_id_inr || 8))).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              ₹ {(item.exp_per_unit_vb ?? 0).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              ₹ {(item.exp_per_unit_cb ?? 0).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              ₹ {(item.unit_landing_rate_vb ?? 102.84).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", borderRight: "1px solid #e2e8f0", color: "#475569" }}>
                              ₹ {(item.unit_landing_rate_cb ?? 102.84).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: "#475569" }}>
                              ₹ {(item.diff_cb_vb ?? 0).toFixed(2)}
                            </td>
                          </tr>
                        ))}

                        {/* Grand Total Row */}
                        <tr style={{ background: "#dbeafe", fontWeight: 700, borderTop: "2px solid #cbd5e1" }}>
                          <td colSpan={5} style={{ padding: "8px 10px", textAlign: "right", borderRight: "1px solid #cbd5e1", color: "#1e293b" }}>
                            Grand Total
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right", borderRight: "1px solid #cbd5e1", color: "#0f172a" }}>
                            {modalTotalCbm.toFixed(2)}
                          </td>
                          <td style={{ borderRight: "1px solid #cbd5e1" }}></td>
                          <td style={{ borderRight: "1px solid #cbd5e1" }}></td>
                          <td style={{ padding: "8px 10px", textAlign: "right", borderRight: "1px solid #cbd5e1", color: "#15803d" }}>
                            $ {modalTotalUsd.toFixed(2)}
                          </td>
                          <td style={{ borderRight: "1px solid #cbd5e1" }}></td>
                          <td style={{ padding: "8px 10px", textAlign: "right", borderRight: "1px solid #cbd5e1", color: "#15803d" }}>
                            ₹ {modalTotalIdInr.toFixed(2)}
                          </td>
                          <td style={{ borderRight: "1px solid #cbd5e1" }}></td>
                          <td style={{ borderRight: "1px solid #cbd5e1" }}></td>
                          <td style={{ borderRight: "1px solid #cbd5e1" }}></td>
                          <td style={{ borderRight: "1px solid #cbd5e1" }}></td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Remarks Row */}
                  <div
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "4px",
                      padding: "8px 12px",
                      fontSize: "11.5px",
                      color: "#334155",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>Remarks : </span>
                    {selectedOrder.remarks || ""}
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

export default ImportPurchasePage;