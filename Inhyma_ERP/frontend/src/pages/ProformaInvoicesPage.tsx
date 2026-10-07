/**
 * Proforma Invoices Page
 *
 * Matches erp.inhymasolutions.com/proforma-invoice/list -- the first
 * module built under the SALE nav section.
 *
 * UI shell: AppShell, Breadcrumb, page-header, Filter toggle button,
 * + ADD NEW button, collapsible filter panel, table, status tab badges,
 * KPI summary cards, and SideDrawer details view.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DatePicker } from "@/components/DatePicker";
import { Combobox } from "@/components/Combobox";
import { ClientNameAutocomplete, type CompanyAutocompleteItem } from "@/components/ClientNameAutocomplete";
import { Pagination } from "@/components/Pagination";
import { SideDrawer, DetailFieldGrid } from "@/components/SideDrawer";
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage as apiErrorText } from "@/lib/api";
import { useAuth } from "@/lib/hooks";
import { useOptions, useMasterNames } from "@/lib/options";
import type { PaginationMeta, ProformaInvoice, ProformaStatusRules, ProformaTabCounts } from "@/types";
import { numberToIndianWords } from "@/utils/text";
import "@/styles/stockAdjustment.css";

const PROFORMA_OPTION_GROUPS = [
  "proforma.status",
  "proforma.defaults",
  "common.yes_no",
  "delivery.type",
  "delivery.charge",
] as const;

type StatusTab = { key: string; label: string; cardLabel: string; badge: string; actionLabel?: string; actionColor?: string };
type CatalogProduct = { product_name: string; hsn: string; rate: number; gst_percent: number; min_price: number };

const todayDDMMYYYY = () => new Date().toLocaleDateString("en-GB").split("/").join("-");

/** A blank PI form; default values (payment terms, transport, ...) come from the `proforma.defaults` option group. */
function emptyFormState(defaults: Record<string, string>, salesPerson: string) {
  return {
    proforma_date: todayDDMMYYYY(),
    expected_delivery_date: todayDDMMYYYY(),
    warehouse: "",
    payment_terms: defaults.payment_terms || "",
    sales_person: salesPerson,
    transport_name: defaults.transport_name || "",
    third_party_delivery: defaults.third_party_delivery || "",
    lead_source: "",
    transport_destination: "",
    delivery_type: defaults.delivery_type || "",
    delivery_charge: defaults.delivery_charge || "",
    company_name: "",
    city: "",
    state: "",
    billing_address: "",
    shipping_address: "",
    product_search: "",
    additional_charges_enabled: true,
    terms_and_conditions: defaults.terms_and_conditions || "",
    remarks: "",
  };
}
type FormState = ReturnType<typeof emptyFormState>;

/** The two always-visible additional-charge rows (spec: Transport and Packing & Forwarding). */
function emptyChargeRows(): any[] {
  return [1, 2].map((n) => ({
    id: `charge-${n}-${Date.now()}`,
    is_additional_charge: true,
    charge_type: "",
    product_name: "",
    hsn: "",
    quantity: "",
    unit_price: "",
    unit_discount: "",
    taxable_amount: 0,
    gst_percent: "",
    gst_amount: 0,
    total: 0,
  }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Spec formula: taxable = (unit price - unit discount) x quantity. Same rule the server applies. */
function priceLine(line: any) {
  const q = parseFloat(String(line.quantity)) || 0;
  const up = parseFloat(String(line.unit_price)) || 0;
  const ud = parseFloat(String(line.unit_discount)) || 0;
  const gstPct = parseFloat(String(line.gst_percent)) || 0;
  const taxable = Math.max(0, up - ud) * q;
  const gstAmt = (taxable * gstPct) / 100;
  return { taxable_amount: round2(taxable), gst_amount: round2(gstAmt), total: round2(taxable + gstAmt) };
}

function ActionMenuItem({ label, color, onClick }: { label: string; color?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ width: "100%", padding: "8px 12px", background: "none", border: "none", textAlign: "left", fontSize: "12.5px", cursor: "pointer", color: color || "#1e293b", display: "flex", alignItems: "center", gap: "6px" }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f1f5f9")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      {label}
    </button>
  );
}

function statusBadgeClass(status: string, tabs: StatusTab[]): string {
  return tabs.find((t) => t.key === status)?.badge || "badge badge-neutral";
}

function statusLabel(status: string, tabs: StatusTab[]): string {
  const found = tabs.find((t) => t.key === status);
  if (found) return found.label;
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatIndianCurrency(amount: number): string {
  return "₹ " + (amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseDateAny(dateStr?: string | null): Date | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (trimmed.includes("-")) {
    const parts = trimmed.split("-");
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      } else {
        return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
      }
    }
  }
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    if (parts.length === 3) {
      return new Date(parseInt(parts[2], 10), parseInt(parts[0], 10) - 1, parseInt(parts[1], 10));
    }
  }
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

function dateInRange(targetStr?: string | null, rangeStr?: string): boolean {
  if (!rangeStr || !rangeStr.trim() || !targetStr) return true;
  if (!rangeStr.includes("-")) {
    return targetStr.toLowerCase().includes(rangeStr.trim().toLowerCase());
  }
  const [s1, s2] = rangeStr.split("-").map((s) => s.trim());
  const start = parseDateAny(s1);
  const end = parseDateAny(s2);
  const target = parseDateAny(targetStr);
  if (!start || !end || !target) return true;
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  target.setHours(12, 0, 0, 0);
  return target >= start && target <= end;
}

export function ProformaInvoicesPage({
  defaultAdd = false,
  defaultFilterOpen = false,
}: {
  defaultAdd?: boolean;
  defaultFilterOpen?: boolean;
} = {}) {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();

  const [items, setItems] = useState<ProformaInvoice[]>([]);
  const [tabCounts, setTabCounts] = useState<ProformaTabCounts>({});
  const [activeTab, setActiveTab] = useState<string>("all");

  // Option lists: fixed choices from option_lists, others from their master tables
  const { options: optionGroups } = useOptions(PROFORMA_OPTION_GROUPS);
  const STATUS_TABS: StatusTab[] = useMemo(
    () =>
      (optionGroups["proforma.status"] || []).map((o) => ({
        key: o.value,
        label: o.label,
        cardLabel: o.meta?.card_label || o.label.toUpperCase(),
        badge: o.meta?.badge || "badge badge-neutral",
        actionLabel: o.meta?.action_label,
        actionColor: o.meta?.action_color,
      })),
    [optionGroups]
  );
  const THIRD_PARTY_OPTIONS = useMemo(() => (optionGroups["common.yes_no"] || []).map((o) => o.value), [optionGroups]);
  const DELIVERY_TYPE_OPTIONS = useMemo(() => (optionGroups["delivery.type"] || []).map((o) => o.value), [optionGroups]);
  const DELIVERY_CHARGE_OPTIONS = useMemo(() => (optionGroups["delivery.charge"] || []).map((o) => o.value), [optionGroups]);
  const WAREHOUSE_OPTIONS = useMasterNames("/masters/warehouses");
  const PAYMENT_TERM_OPTIONS = useMasterNames("/masters/payment-terms");
  const TRANSPORT_NAME_OPTIONS = useMasterNames("/masters/transports");
  const LEAD_SOURCE_OPTIONS = useMasterNames("/masters/lead-sources");
  const ADDITIONAL_CHARGE_TYPES = useMasterNames("/masters/additional-charges");
  const DEFAULTS = useMemo(
    () => Object.fromEntries((optionGroups["proforma.defaults"] || []).map((o) => [o.value, o.label])) as Record<string, string>,
    [optionGroups]
  );
  const selfPickupTransport = DEFAULTS.self_pickup_transport || "";

  // Workflow rules (allowed next statuses, who can edit/delete) are configured in the database
  const [statusRules, setStatusRules] = useState<ProformaStatusRules>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reasonDialog, setReasonDialog] = useState<{ pi: ProformaInvoice; target: string } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [perPage, setPerPage] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filter state matching legacy ERP screenshot:
  // - Proforma Invoice Date Range
  // - Expected Delivery Date Range
  // - Warehouse
  // - Sales Person
  // - Lead Source
  const [filterOpen, setFilterOpen] = useState(defaultFilterOpen);
  const [filterDateRange, setFilterDateRange] = useState("");
  const [filterExpDateRange, setFilterExpDateRange] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("All");
  const [filterSalesPerson, setFilterSalesPerson] = useState("All");
  const [filterLeadSource, setFilterLeadSource] = useState("All");

  const [appliedDateRange, setAppliedDateRange] = useState("");
  const [appliedExpDateRange, setAppliedExpDateRange] = useState("");
  const [appliedWarehouse, setAppliedWarehouse] = useState("All");
  const [appliedSalesPerson, setAppliedSalesPerson] = useState("All");
  const [appliedLeadSource, setAppliedLeadSource] = useState("All");

  // Drawer detail state
  const [selectedProforma, setSelectedProforma] = useState<ProformaInvoice | null>(null);
  const [openActionId, setOpenActionId] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(defaultAdd);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const { profile, isSuperAdmin, hasPermission } = useAuth();
  const isAdmin = isSuperAdmin || profile?.username === "admin" || hasPermission("proforma.approve");
  const loggedInUserName = useMemo(() => {
    if (!profile) return "";
    return (
      profile.full_name ||
      (profile.first_name ? `${profile.first_name} ${profile.last_name || ""}`.trim() : (profile.username === "admin" ? "Admin" : profile.username))
    );
  }, [profile]);

  const [salesPersonOptions, setSalesPersonOptions] = useState<string[]>([]);

  useEffect(() => {
    void apiGet<Array<{ id: string; full_name: string; username: string }>>("/companies/sales-persons")
      .then((res) => {
        if (res?.data) {
          setSalesPersonOptions(res.data.map((u) => u.full_name || u.username));
        }
      })
      .catch(() => { });
  }, []);

  const [formState, setFormState] = useState<FormState>(() => emptyFormState({}, ""));

  useEffect(() => {
    if (loggedInUserName) {
      setFormState((prev) => (!prev.sales_person ? { ...prev, sales_person: loggedInUserName } : prev));
    }
  }, [loggedInUserName]);

  const effectiveSalesPersonOptions = useMemo(() => {
    const set = new Set<string>();
    if (loggedInUserName) set.add(loggedInUserName);
    salesPersonOptions.forEach((n) => set.add(n));
    if (formState.sales_person && formState.sales_person.trim()) set.add(formState.sales_person.trim());
    return Array.from(set);
  }, [loggedInUserName, salesPersonOptions, formState.sales_person]);
  const [formLineItems, setFormLineItems] = useState<any[]>(() => emptyChargeRows());

  // Fill still-blank fields with the DB-configured defaults once they load (new invoices only)
  useEffect(() => {
    if (editingId) return;
    setFormState((prev) => ({
      ...prev,
      payment_terms: prev.payment_terms || DEFAULTS.payment_terms || "",
      transport_name: prev.transport_name || DEFAULTS.transport_name || "",
      delivery_type: prev.delivery_type || DEFAULTS.delivery_type || "",
      delivery_charge: prev.delivery_charge || DEFAULTS.delivery_charge || "",
      third_party_delivery: prev.third_party_delivery || DEFAULTS.third_party_delivery || "",
      terms_and_conditions: prev.terms_and_conditions || DEFAULTS.terms_and_conditions || "",
    }));
  }, [DEFAULTS, editingId]);

  const selfPickup = !!selfPickupTransport && formState.transport_name === selfPickupTransport;
  const belowMinCount = formLineItems.filter(
    (it) => !it.is_additional_charge && it.min_price && (parseFloat(String(it.unit_price)) || 0) < it.min_price
  ).length;
  const fieldError = (key: string) =>
    formErrors[key] ? <span style={{ color: "#ef4444", fontSize: "11.5px", marginTop: "4px", display: "block" }}>{formErrors[key]}</span> : null;
  const productSearchSeq = useRef(0);
  const [productSearchMatches, setProductSearchMatches] = useState<CatalogProduct[]>([]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (appliedDateRange.trim()) count++;
    if (appliedExpDateRange.trim()) count++;
    if (appliedWarehouse && appliedWarehouse !== "All") count++;
    if (appliedSalesPerson && appliedSalesPerson !== "All") count++;
    if (appliedLeadSource && appliedLeadSource !== "All") count++;
    return count;
  }, [appliedDateRange, appliedExpDateRange, appliedWarehouse, appliedSalesPerson, appliedLeadSource]);

  const loadProformas = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const params = new URLSearchParams();
      if (activeTab !== "all") params.set("status", activeTab);
      if (searchTerm.trim()) params.set("search", searchTerm.trim());
      if (appliedWarehouse && appliedWarehouse !== "All") params.set("warehouse", appliedWarehouse.trim());
      if (appliedSalesPerson && appliedSalesPerson !== "All") params.set("sales_person", appliedSalesPerson.trim());
      if (appliedLeadSource && appliedLeadSource !== "All") params.set("lead_source", appliedLeadSource.trim());
      params.set("skip", String((currentPage - 1) * perPage));
      params.set("limit", String(perPage));

      const { data } = await apiGet<{ items: ProformaInvoice[]; tab_counts: ProformaTabCounts; status_rules: ProformaStatusRules }>(
        `/proforma-invoice/list?${params.toString()}`
      );
      setItems(data?.items || []);
      setTabCounts(data?.tab_counts || {});
      setStatusRules(data?.status_rules || {});
    } catch (err) {
      setItems([]);
      setTabCounts({});
      setErrorMessage(apiErrorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProformas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, searchTerm, perPage, currentPage, appliedWarehouse, appliedSalesPerson, appliedLeadSource, appliedDateRange, appliedExpDateRange]);

  const handleSearchFilter = () => {
    setAppliedDateRange(filterDateRange);
    setAppliedExpDateRange(filterExpDateRange);
    setAppliedWarehouse(filterWarehouse);
    setAppliedSalesPerson(filterSalesPerson);
    setAppliedLeadSource(filterLeadSource);
  };

  const handleResetFilter = () => {
    setFilterDateRange("");
    setFilterExpDateRange("");
    setFilterWarehouse("All");
    setFilterSalesPerson("All");
    setFilterLeadSource("All");
    setAppliedDateRange("");
    setAppliedExpDateRange("");
    setAppliedWarehouse("All");
    setAppliedSalesPerson("All");
    setAppliedLeadSource("All");
  };

  const filteredItems = useMemo(() => {
    return items.filter((p) => {
      if (activeTab !== "all" && p.status !== activeTab) return false;
      if (appliedWarehouse && appliedWarehouse !== "All" && p.warehouse.toLowerCase() !== appliedWarehouse.toLowerCase()) return false;
      if (appliedSalesPerson && appliedSalesPerson !== "All" && (p.sales_person || "").toLowerCase() !== appliedSalesPerson.toLowerCase()) return false;
      if (appliedLeadSource && appliedLeadSource !== "All" && (p.lead_source || "").toLowerCase() !== appliedLeadSource.toLowerCase()) return false;
      if (appliedDateRange && !dateInRange(p.proforma_date, appliedDateRange)) return false;
      if (appliedExpDateRange && !dateInRange(p.expected_delivery_date, appliedExpDateRange)) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const match =
          p.proforma_no.toLowerCase().includes(q) ||
          p.company_name.toLowerCase().includes(q) ||
          (p.sales_person || "").toLowerCase().includes(q) ||
          (p.city || "").toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [
    items,
    activeTab,
    appliedWarehouse,
    appliedSalesPerson,
    appliedLeadSource,
    appliedDateRange,
    appliedExpDateRange,
    searchTerm,
  ]);

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

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, activeTab, appliedWarehouse, appliedSalesPerson, appliedLeadSource, appliedDateRange, appliedExpDateRange, perPage]);

  const totals = useMemo(() => {
    let totalQty = 0;
    let totalBasic = 0;
    let totalDiscount = 0;
    let totalTaxable = 0;
    let totalTax = 0;
    let totalWithTax = 0;

    for (const item of formLineItems) {
      const q = parseFloat(String(item.quantity)) || 0;
      const up = parseFloat(String(item.unit_price)) || 0;
      const ud = parseFloat(String(item.unit_discount)) || 0;
      const taxable = item.taxable_amount || 0;
      const gstAmt = item.gst_amount || 0;
      const tot = item.total || 0;

      totalQty += q;
      totalBasic += q * up;
      totalDiscount += ud * q;
      totalTaxable += taxable;
      totalTax += gstAmt;
      totalWithTax += tot;
    }

    return {
      totalQty,
      totalBasic: Math.round(totalBasic * 100) / 100,
      totalDiscount: Math.round(totalDiscount * 100) / 100,
      totalTaxable: Math.round(totalTaxable * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      totalWithTax: Math.round(totalWithTax * 100) / 100,
    };
  }, [formLineItems]);

  const handleUpdateLineItem = (index: number, field: string, value: any) => {
    setFormLineItems((prev) => {
      const next = [...prev];
      const target = { ...next[index], [field]: value };

      if (field === "charge_type") {
        target.product_name = value === "-- Select Charge --" ? "" : value;
      }

      const q = parseFloat(String(target.quantity)) || 0;
      const up = parseFloat(String(target.unit_price)) || 0;
      const ud = parseFloat(String(target.unit_discount)) || 0;
      const taxable = Math.max(0, up - ud) * q;
      const gstPct = parseFloat(String(target.gst_percent)) || 0;
      const gstAmt = (taxable * gstPct) / 100;
      const tot = taxable + gstAmt;

      target.taxable_amount = Math.round(taxable * 100) / 100;
      target.gst_amount = Math.round(gstAmt * 100) / 100;
      target.total = Math.round(tot * 100) / 100;

      next[index] = target;
      return next;
    });
  };

  const handleAddProductItem = (prod?: { product_name: string; hsn?: string; rate?: number; gst_percent?: number; min_price?: number }) => {
    const base = {
      id: "prod-" + Date.now() + Math.random().toString(36).substring(2, 5),
      is_additional_charge: false,
      charge_type: "",
      product_name: prod?.product_name || "",
      hsn: prod?.hsn || "",
      quantity: 1,
      unit_price: prod?.rate ?? "",
      unit_discount: 0,
      gst_percent: prod?.gst_percent ?? 0,
      min_price: prod?.min_price,
    };
    setFormLineItems((prev) => [{ ...base, ...priceLine(base) }, ...prev]);
  };

  const handleAddChargeItem = () => {
    const newCharge = {
      id: "charge-" + Date.now() + Math.random().toString(36).substring(2, 5),
      is_additional_charge: true,
      charge_type: "",
      product_name: "",
      hsn: "",
      quantity: "",
      unit_price: "",
      unit_discount: "",
      taxable_amount: 0,
      gst_percent: "",
      gst_amount: 0,
      total: 0,
    };
    setFormLineItems((prev) => [...prev, newCharge]);
  };

  const handleDeleteLineItem = (index: number) => {
    if (formLineItems.length <= 1) return;
    setFormLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleProductSearchChange = (query: string) => {
    setFormState((prev) => ({ ...prev, product_search: query }));
    if (!query.trim()) {
      setProductSearchMatches([]);
      return;
    }
    const seq = ++productSearchSeq.current;
    void apiGet<any[]>(`/masters/products?page=1&page_size=10&status=active&search=${encodeURIComponent(query.trim())}`)
      .then((res) => {
        if (seq !== productSearchSeq.current) return;
        setProductSearchMatches(
          (res?.data || []).map((p) => ({
            product_name: p.product_name,
            hsn: p.hsn_number || "",
            rate: Number(p.standard_price) || 0,
            min_price: Number(p.standard_price) || 0,
            gst_percent: Number(p.gst_percent) || 0,
          }))
        );
      })
      .catch(() => {
        if (seq === productSearchSeq.current) setProductSearchMatches([]);
      });
  };

  const handleSelectProductMatch = (prod: CatalogProduct) => {
    handleAddProductItem(prod);
    setFormState((prev) => ({ ...prev, product_search: "" }));
    setProductSearchMatches([]);
  };

  const handleOpenCreate = () => {
    setErrorMessage(null);
    setFormErrors({});
    setEditingId(null);
    setFormState(emptyFormState(DEFAULTS, loggedInUserName));
    setFormLineItems(emptyChargeRows());
    setIsFormOpen(true);
  };

  const handleOpenEdit = (p: ProformaInvoice) => {
    setErrorMessage(null);
    setFormErrors({});
    setEditingId(p.id);
    setFormState({
      ...emptyFormState({}, ""),
      proforma_date: p.proforma_date,
      expected_delivery_date: p.expected_delivery_date || "",
      warehouse: p.warehouse || "",
      payment_terms: p.payment_terms || "",
      sales_person: p.sales_person || "",
      transport_name: p.transport_name || "",
      third_party_delivery: p.third_party_delivery || "",
      lead_source: p.lead_source || "",
      transport_destination: p.transport_destination || "",
      delivery_type: p.delivery_type || "",
      delivery_charge: p.delivery_charge || "",
      company_name: p.company_name || "",
      city: p.city || "",
      state: p.state || "",
      billing_address: p.billing_address || "",
      shipping_address: p.shipping_address || "",
      terms_and_conditions: p.terms_and_conditions || "",
      remarks: p.remark || "",
    });
    const lines = (p.items || []).map((it, idx) => {
      const line = {
        id: it.id || `item-${idx}`,
        is_additional_charge: !!it.is_additional_charge,
        charge_type: it.charge_type || "",
        product_name: it.product_name,
        hsn: it.hsn_code || it.hsn || "",
        quantity: it.quantity,
        unit_price: it.unit_price ?? it.rate,
        unit_discount: it.unit_discount ?? 0,
        gst_percent: it.gst_percent ?? 0,
      };
      return { ...line, ...priceLine(line) };
    });
    // keep the two always-visible additional-charge rows available while editing
    const chargeCount = lines.filter((l) => l.is_additional_charge).length;
    setFormLineItems([...lines, ...emptyChargeRows().slice(chargeCount)]);
    setIsFormOpen(true);
  };

  // Opening /proforma-invoice/addedit/:id loads that invoice into the form
  useEffect(() => {
    if (!routeId) return;
    let cancelled = false;
    apiGet<ProformaInvoice>(`/proforma-invoice/${routeId}`)
      .then((res) => {
        if (!cancelled && res?.data) handleOpenEdit(res.data);
      })
      .catch((err) => {
        if (!cancelled) setErrorMessage(apiErrorText(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  const handleSelectCompany = (c: CompanyAutocompleteItem) => {
    const place = [c.address, c.area, c.city_name, c.state_name].filter(Boolean).join(", ");
    const shipping = [place, c.pincode].filter(Boolean).join(" - ");
    const contact = [c.contact_full_name, c.contact_calling_number].filter(Boolean).join(" ");
    const billing = [shipping, contact, c.tax_id_number ? `GST: ${c.tax_id_number}` : ""].filter(Boolean).join(" | ");
    setFormState((prev) => ({
      ...prev,
      company_name: c.company_name,
      city: c.city_name || "",
      state: c.state_name || "",
      billing_address: billing,
      shipping_address: shipping,
    }));
  };

  // ---- workflow actions (rules come from the database) ----
  const rulesFor = (p: ProformaInvoice) => statusRules[p.status];
  const canEdit = (p: ProformaInvoice) => {
    const mode = rulesFor(p)?.edit;
    return mode === "any" || (mode === "admin" && isAdmin);
  };
  const canDelete = (p: ProformaInvoice) => !!rulesFor(p)?.delete;
  const availableTransitions = (p: ProformaInvoice) => {
    const r = rulesFor(p);
    if (!r) return [];
    return r.next.filter((t) => !(r.admin_only_to || []).includes(t) || isAdmin);
  };

  const applyTransition = async (p: ProformaInvoice, target: string, reason?: string) => {
    try {
      setErrorMessage(null);
      setSuccessMessage(null);
      const res = await apiPatch<{ message: string; sale_order_no?: string; sale_order_id?: string }>(
        `/proforma-invoice/${p.id}/status`,
        { status: target, reason }
      );
      if (res?.data?.sale_order_no) {
        setSuccessMessage(`Proforma ${p.proforma_no} confirmed! Sales Order ${res.data.sale_order_no} created successfully.`);
      }
      await loadProformas();
    } catch (err) {
      setErrorMessage(apiErrorText(err));
    }
  };

  const startTransition = (p: ProformaInvoice, target: string) => {
    setOpenActionId(null);
    if ((rulesFor(p)?.reason_required_to || []).includes(target)) {
      setReasonText("");
      setReasonDialog({ pi: p, target });
      return;
    }
    void applyTransition(p, target);
  };

  const handleDeleteProforma = async (p: ProformaInvoice) => {
    setOpenActionId(null);
    if (!window.confirm(`Delete proforma ${p.proforma_no}?`)) return;
    try {
      setErrorMessage(null);
      await apiDelete(`/proforma-invoice/${p.id}`);
      await loadProformas();
    } catch (err) {
      setErrorMessage(apiErrorText(err));
    }
  };

  const handleBack = () => {
    setIsFormOpen(false);
    navigate("/proforma-invoice/list");
  };

  const handleSaveProforma = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!formState.warehouse || formState.warehouse === "Select") errs.warehouse = "Warehouse is required.";
    if (!formState.company_name.trim()) errs.company_name = "Company name is required.";
    if (!formState.payment_terms.trim()) errs.payment_terms = "Payment terms are required.";
    if (!formState.transport_name.trim()) errs.transport_name = "Transport name is required.";
    if (!selfPickup) {
      if (!formState.delivery_type.trim()) errs.delivery_type = "Delivery type is required.";
      if (!formState.delivery_charge.trim()) errs.delivery_charge = "Delivery charge is required.";
    }
    if (!formState.billing_address.trim()) errs.billing_address = "Billing address is required.";
    if (!formState.shipping_address.trim()) errs.shipping_address = "Shipping address is required.";

    const expected = parseDateAny(formState.expected_delivery_date);
    if (expected) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (expected < today) errs.expected_delivery_date = "Expected delivery date cannot be in the past.";
    }

    const validItems = formLineItems.filter(
      (it) => it.product_name.trim() && it.product_name !== "-- Select Charge --"
    );
    if (validItems.length === 0) {
      errs.items = "Please add at least one product or additional charge item.";
    } else if (
      validItems.some((it) => (parseFloat(String(it.unit_discount)) || 0) > (parseFloat(String(it.unit_price)) || 0))
    ) {
      errs.items = "A unit discount cannot be more than the unit price.";
    }

    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      setErrorMessage(errs.items || "Please fix the highlighted fields.");
      return;
    }

    setFormSubmitting(true);
    setErrorMessage(null);
    setFormErrors({});

    try {
      const payload = {
        proforma_date: formState.proforma_date,
        expected_delivery_date: formState.expected_delivery_date.trim() || undefined,
        warehouse: formState.warehouse,
        payment_terms: formState.payment_terms || undefined,
        sales_person: formState.sales_person || undefined,
        transport_name: formState.transport_name || undefined,
        third_party_delivery: formState.third_party_delivery || undefined,
        lead_source: formState.lead_source || undefined,
        transport_destination: selfPickup ? undefined : formState.transport_destination.trim() || undefined,
        delivery_type: selfPickup ? undefined : formState.delivery_type || undefined,
        delivery_charge: selfPickup ? undefined : formState.delivery_charge || undefined,
        company_name: formState.company_name.trim(),
        city: formState.city || undefined,
        state: formState.state || undefined,
        billing_address: formState.billing_address.trim() || undefined,
        shipping_address: formState.shipping_address.trim() || undefined,
        terms_and_conditions: formState.terms_and_conditions.trim() || undefined,
        remark: formState.remarks.trim() || undefined,
        // totals, status, discount and author are calculated / set by the server
        items: validItems.map((it) => ({
          product_name: it.product_name.trim(),
          hsn_code: it.hsn.trim() || undefined,
          quantity: parseFloat(String(it.quantity)) || 1,
          unit_price: parseFloat(String(it.unit_price)) || 0,
          unit_discount: parseFloat(String(it.unit_discount)) || 0,
          gst_percent: parseFloat(String(it.gst_percent)) || 0,
          is_additional_charge: it.is_additional_charge || false,
          charge_type: it.is_additional_charge ? it.charge_type || it.product_name : undefined,
        })),
      };

      if (editingId) {
        await apiPatch(`/proforma-invoice/${editingId}`, payload);
      } else {
        await apiPost("/proforma-invoice", payload);
      }
      setIsFormOpen(false);
      setEditingId(null);
      navigate("/proforma-invoice/list");
      await loadProformas();
    } catch (err) {
      // keep the form open and tell the user the truth -- never pretend the save worked
      setErrorMessage(apiErrorText(err));
    } finally {
      setFormSubmitting(false);
    }
  };

  if (isFormOpen) {
    return (
      <AppShell activeKey="proforma">
        <main className="page" style={{ maxWidth: "1350px", margin: "0 auto", padding: "16px 24px 60px" }}>
          <Breadcrumb trail={["Sale", "Proforma", editingId ? "Edit" : "Add"]} />

          {/* Page Header matching legacy screenshot */}
          <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#0f172a", margin: 0 }}>{editingId ? "Edit Proforma Invoice" : "Add Proforma Invoice"}</h1>
            </div>
            <div className="page-header-actions">
              <button
                type="button"
                className="btn"
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
          </div>

          {errorMessage && (
            <div style={{ padding: "12px 16px", backgroundColor: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "6px", color: "#b91c1c", fontSize: "13px", marginBottom: "16px" }}>
              ⚠️ {errorMessage}
            </div>
          )}

          {belowMinCount > 0 && (
            <div style={{ padding: "10px 16px", backgroundColor: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "6px", color: "#92400e", fontSize: "13px", marginBottom: "16px" }}>
              ⚠ {belowMinCount} item(s) priced below the minimum price. This invoice will need admin approval.
            </div>
          )}

          <form onSubmit={handleSaveProforma}>
            {/* Card 1: General Details 4-Column Responsive Grid */}
            <div
              className="card"
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                padding: "20px",
                marginBottom: "16px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "16px 20px",
                }}
              >
                {/* Row 1 */}
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Warehouse <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <Combobox
                    ariaLabel="Warehouse"
                    value={formState.warehouse}
                    onChange={(val) => setFormState({ ...formState, warehouse: val })}
                    options={WAREHOUSE_OPTIONS}
                    placeholder="Select Warehouse"
                  />
                  {formErrors.warehouse && <span style={{ color: "#ef4444", fontSize: "11.5px", marginTop: "4px", display: "block" }}>{formErrors.warehouse}</span>}
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Expected Delivery Date
                  </label>
                  <DatePicker
                    ariaLabel="Expected Delivery Date"
                    placeholder="DD-MM-YYYY"
                    value={formState.expected_delivery_date}
                    onChange={(val) => setFormState({ ...formState, expected_delivery_date: val })}
                  />
                  {fieldError("expected_delivery_date")}
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Payment Terms <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <Combobox
                    ariaLabel="Payment Terms"
                    value={formState.payment_terms}
                    onChange={(val) => setFormState({ ...formState, payment_terms: val })}
                    options={PAYMENT_TERM_OPTIONS}
                    placeholder="Select Payment Terms"
                  />
                  {fieldError("payment_terms")}
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Sales Person <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <Combobox
                    ariaLabel="Sales Person"
                    value={formState.sales_person}
                    onChange={(val) => setFormState({ ...formState, sales_person: val })}
                    options={effectiveSalesPersonOptions}
                    placeholder="Select Sales Person"
                  />
                </div>

                {/* Row 2 */}
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Transport Name <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <Combobox
                    ariaLabel="Transport Name"
                    value={formState.transport_name}
                    onChange={(val) => setFormState({ ...formState, transport_name: val })}
                    options={TRANSPORT_NAME_OPTIONS}
                    placeholder="Select Transport Name"
                  />
                  {fieldError("transport_name")}
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Third Party Delivery <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <Combobox
                    ariaLabel="Third Party Delivery"
                    value={formState.third_party_delivery}
                    onChange={(val) => setFormState({ ...formState, third_party_delivery: val })}
                    options={THIRD_PARTY_OPTIONS}
                    placeholder="Select Option"
                  />
                </div>

                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Lead Source
                  </label>
                  <Combobox
                    ariaLabel="Lead Source"
                    value={formState.lead_source}
                    onChange={(val) => setFormState({ ...formState, lead_source: val })}
                    options={LEAD_SOURCE_OPTIONS}
                    placeholder="Select Lead Source"
                  />
                </div>

                <div />

                {/* Row 3: hidden when the transport is Self Pick-up (spec) */}
                {!selfPickup && (
                  <>
                    <div>
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                        Transport Destination
                      </label>
                      <input
                        type="text"
                        placeholder="Enter Destination"
                        value={formState.transport_destination}
                        onChange={(e) => setFormState({ ...formState, transport_destination: e.target.value })}
                        style={{ width: "100%", height: "36px", border: "1px solid #cbd5e1", borderRadius: "4px", padding: "0 10px", fontSize: "13px", background: "#ffffff", color: "#1e293b", outline: "none" }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                        Delivery Type <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <Combobox
                        ariaLabel="Delivery Type"
                        value={formState.delivery_type}
                        onChange={(val) => setFormState({ ...formState, delivery_type: val })}
                        options={DELIVERY_TYPE_OPTIONS}
                        placeholder="Select Delivery Type"
                      />
                      {fieldError("delivery_type")}
                    </div>

                    <div>
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                        Delivery Charge <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <Combobox
                        ariaLabel="Delivery Charge"
                        value={formState.delivery_charge}
                        onChange={(val) => setFormState({ ...formState, delivery_charge: val })}
                        options={DELIVERY_CHARGE_OPTIONS}
                        placeholder="Select Delivery Charge"
                      />
                      {fieldError("delivery_charge")}
                    </div>
                  </>
                )}

                <div />
              </div>
            </div>

            {/* Section 2: 3 Entity Cards (Company, Billing Address, Shipping Address) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "16px" }}>
              {/* Company Card */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "14px 16px", boxShadow: "0 1px 2px rgba(0,0,0,0.02)" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "8px", display: "block" }}>
                  Company <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <div style={{ display: "flex", gap: "0px", alignItems: "center" }}>
                  <ClientNameAutocomplete
                    id="pi-company"
                    value={formState.company_name}
                    onChange={(val) => setFormState((prev) => ({ ...prev, company_name: val }))}
                    onSelectCompany={handleSelectCompany}
                    placeholder="Enter Customer Name"
                    className=""
                    style={{ flex: 1 }}
                    inputStyle={{ width: "100%", height: "34px", border: "1px solid #cbd5e1", borderRight: "none", borderTopLeftRadius: "4px", borderBottomLeftRadius: "4px", padding: "0 10px", fontSize: "13px", outline: "none" }}
                  />
                  <button
                    type="button"
                    title="Clear"
                    onClick={() => setFormState({ ...formState, company_name: "", city: "", state: "", billing_address: "", shipping_address: "" })}
                    style={{ width: "34px", height: "34px", background: "#ef4444", color: "#ffffff", border: "none", borderTopRightRadius: "4px", borderBottomRightRadius: "4px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" }}
                  >
                    🗑️
                  </button>
                </div>
                {formErrors.company_name && <span style={{ color: "#ef4444", fontSize: "11.5px", marginTop: "4px", display: "block" }}>{formErrors.company_name}</span>}
              </div>

              {/* Billing Address Card */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "14px 16px", boxShadow: "0 1px 2px rgba(0,0,0,0.02)" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "8px", display: "block" }}>
                  Billing Address <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <div style={{ display: "flex", gap: "0px", alignItems: "center" }}>
                  <input
                    type="text"
                    placeholder="Enter Address"
                    value={formState.billing_address}
                    onChange={(e) => setFormState({ ...formState, billing_address: e.target.value })}
                    style={{ flex: 1, height: "34px", border: "1px solid #cbd5e1", borderRight: "none", borderTopLeftRadius: "4px", borderBottomLeftRadius: "4px", padding: "0 10px", fontSize: "13px", outline: "none" }}
                  />
                  <button
                    type="button"
                    title="Clear"
                    onClick={() => setFormState({ ...formState, billing_address: "" })}
                    style={{ width: "34px", height: "34px", background: "#ef4444", color: "#ffffff", border: "none", borderTopRightRadius: "4px", borderBottomRightRadius: "4px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" }}
                  >
                    🗑️
                  </button>
                </div>
                {fieldError("billing_address")}
              </div>

              {/* Shipping Address Card */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "14px 16px", boxShadow: "0 1px 2px rgba(0,0,0,0.02)" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "8px", display: "block" }}>
                  Shipping Address <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <div style={{ display: "flex", gap: "0px", alignItems: "center" }}>
                  <input
                    type="text"
                    placeholder="Enter Address"
                    value={formState.shipping_address}
                    onChange={(e) => setFormState({ ...formState, shipping_address: e.target.value })}
                    style={{ flex: 1, height: "34px", border: "1px solid #cbd5e1", borderRight: "none", borderTopLeftRadius: "4px", borderBottomLeftRadius: "4px", padding: "0 10px", fontSize: "13px", outline: "none" }}
                  />
                  <button
                    type="button"
                    title="Clear"
                    onClick={() => setFormState({ ...formState, shipping_address: "" })}
                    style={{ width: "34px", height: "34px", background: "#ef4444", color: "#ffffff", border: "none", borderTopRightRadius: "4px", borderBottomRightRadius: "4px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" }}
                  >
                    🗑️
                  </button>
                </div>
                {fieldError("shipping_address")}
              </div>
            </div>

            {/* Section 3: PRODUCT SEARCH Card */}
            <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "14px 16px", marginBottom: "16px", boxShadow: "0 1px 2px rgba(0,0,0,0.02)" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                PRODUCT SEARCH
              </div>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  placeholder={formState.warehouse ? "Enter Product Name / Model No" : "Select a warehouse first"}
                  disabled={!formState.warehouse}
                  value={formState.product_search}
                  onChange={(e) => handleProductSearchChange(e.target.value)}
                  style={{ width: "100%", height: "36px", border: "1px solid #cbd5e1", borderRadius: "4px", padding: "0 12px", fontSize: "13.5px", outline: "none" }}
                />
                {productSearchMatches.length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#ffffff", border: "1px solid #cbd5e1", borderTop: "none", borderRadius: "0 0 4px 4px", zIndex: 50, maxHeight: "200px", overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                    {productSearchMatches.map((prod, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleSelectProductMatch(prod)}
                        style={{ padding: "8px 12px", cursor: "pointer", fontSize: "13px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
                      >
                        <strong>{prod.product_name}</strong>
                        <span style={{ color: "#64748b" }}>HSN: {prod.hsn} | Rate: ₹{prod.rate}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Section 4: PRODUCT ITEM Table Card */}
            <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "16px 20px", marginBottom: "16px", boxShadow: "0 1px 2px rgba(0,0,0,0.02)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  PRODUCT ITEM
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", fontWeight: 600, color: "#1e293b", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={formState.additional_charges_enabled}
                    onChange={(e) => setFormState({ ...formState, additional_charges_enabled: e.target.checked })}
                    style={{ cursor: "pointer", accentColor: "#0061f2", width: "15px", height: "15px" }}
                  />
                  Additional Charges
                </label>
              </div>

              {formErrors.items && (
                <div style={{ color: "#ef4444", fontSize: "12px", marginBottom: "8px" }}>
                  ⚠️ {formErrors.items}
                </div>
              )}

              <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "4px" }}>
                <table style={{ width: "100%", minWidth: "920px", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      <th style={{ padding: "8px 10px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "24%" }}>Product Name</th>
                      <th style={{ padding: "8px 10px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "10%" }}>HSN</th>
                      <th style={{ padding: "8px 10px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "7%" }}>Qty</th>
                      <th style={{ padding: "8px 10px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "10%" }}>Unit Price</th>
                      <th style={{ padding: "8px 10px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "10%" }}>Unit Discount</th>
                      <th style={{ padding: "8px 10px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "11%" }}>Taxable Amount</th>
                      <th style={{ padding: "8px 10px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "7%" }}>GST</th>
                      <th style={{ padding: "8px 10px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "10%" }}>GST Amount</th>
                      <th style={{ padding: "8px 10px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", textAlign: "left", width: "11%" }}>Total</th>
                      <th style={{ padding: "8px 6px", fontSize: "12px", fontWeight: 700, color: "#334155", borderBottom: "1px solid #cbd5e1", width: "35px" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {formLineItems.map((row, idx) => (
                      <tr key={row.id || idx} style={{ background: row.is_additional_charge ? "#fcfdfe" : "#ffffff" }}>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                          {row.is_additional_charge ? (
                            <Combobox
                              ariaLabel="Additional Charge Type"
                              value={row.charge_type || ""}
                              onChange={(val) => handleUpdateLineItem(idx, "charge_type", val)}
                              options={ADDITIONAL_CHARGE_TYPES}
                              placeholder="Select Charge"
                              inputStyle={{ height: "32px", fontSize: "12.5px" }}
                            />
                          ) : (
                            <input
                              type="text"
                              placeholder="Product Name"
                              value={row.product_name}
                              onChange={(e) => handleUpdateLineItem(idx, "product_name", e.target.value)}
                              style={{ width: "100%", height: "32px", border: "1px solid #cbd5e1", borderRadius: "3px", padding: "0 8px", fontSize: "12.5px" }}
                            />
                          )}
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                          <input
                            type="text"
                            placeholder="HSN"
                            value={row.hsn}
                            onChange={(e) => handleUpdateLineItem(idx, "hsn", e.target.value)}
                            style={{ width: "100%", height: "32px", border: "1px solid #cbd5e1", borderRadius: "3px", padding: "0 6px", fontSize: "12.5px" }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                          <input
                            type="number"
                            step="any"
                            value={row.quantity}
                            onChange={(e) => handleUpdateLineItem(idx, "quantity", e.target.value)}
                            style={{ width: "100%", height: "32px", border: "1px solid #cbd5e1", borderRadius: "3px", padding: "0 6px", fontSize: "12.5px" }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                          <input
                            type="number"
                            step="any"
                            value={row.unit_price}
                            onChange={(e) => handleUpdateLineItem(idx, "unit_price", e.target.value)}
                            style={{ width: "100%", height: "32px", border: "1px solid #cbd5e1", borderRadius: "3px", padding: "0 6px", fontSize: "12.5px" }}
                          />
                          {!row.is_additional_charge && row.min_price > 0 && (parseFloat(String(row.unit_price)) || 0) < row.min_price && (
                            <div style={{ color: "#b45309", fontSize: "11px", marginTop: "2px" }}>Below min ₹{row.min_price}</div>
                          )}
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                          <div style={{ display: "flex", alignItems: "center", border: "1px solid #cbd5e1", borderRadius: "3px", overflow: "hidden" }}>
                            <span style={{ background: "#f1f5f9", padding: "0 6px", fontSize: "12px", color: "#64748b", height: "30px", display: "flex", alignItems: "center" }}>₹</span>
                            <input
                              type="number"
                              step="any"
                              value={row.unit_discount}
                              onChange={(e) => handleUpdateLineItem(idx, "unit_discount", e.target.value)}
                              style={{ width: "100%", height: "30px", border: "none", padding: "0 6px", fontSize: "12.5px", outline: "none" }}
                            />
                          </div>
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                          <div style={{ height: "32px", border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: "3px", display: "flex", alignItems: "center", padding: "0 8px", fontSize: "12.5px", color: "#1e293b", fontWeight: 600 }}>
                            {row.taxable_amount ? row.taxable_amount.toFixed(2) : "0.00"}
                          </div>
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                          <div style={{ display: "flex", alignItems: "center", border: "1px solid #cbd5e1", borderRadius: "3px", overflow: "hidden" }}>
                            <input
                              type="number"
                              step="any"
                              value={row.gst_percent}
                              onChange={(e) => handleUpdateLineItem(idx, "gst_percent", e.target.value)}
                              style={{ width: "100%", height: "30px", border: "none", padding: "0 6px", fontSize: "12.5px", outline: "none" }}
                            />
                            <span style={{ background: "#f1f5f9", padding: "0 5px", fontSize: "12px", color: "#64748b", height: "30px", display: "flex", alignItems: "center" }}>%</span>
                          </div>
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                          <div style={{ height: "32px", border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: "3px", display: "flex", alignItems: "center", padding: "0 8px", fontSize: "12.5px", color: "#1e293b", fontWeight: 600 }}>
                            {row.gst_amount ? row.gst_amount.toFixed(2) : "0.00"}
                          </div>
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                          <div style={{ height: "32px", border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: "3px", display: "flex", alignItems: "center", padding: "0 8px", fontSize: "12.5px", color: "#1e293b", fontWeight: 600 }}>
                            {row.total ? row.total.toFixed(2) : "0.00"}
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
                    ))}
                  </tbody>
                </table>

                {/* Table Summary Bar matching Screenshot 2 */}
                <div
                  style={{
                    background: "#cbd5e1",
                    padding: "9px 16px",
                    display: "flex",
                    justifyContent: "space-around",
                    alignItems: "center",
                    fontWeight: 700,
                    fontSize: "12.5px",
                    color: "#1e293b",
                    borderTop: "1px solid #94a3b8",
                  }}
                >
                  <span>{totals.totalQty} (Quantity)</span>
                  <span>{totals.totalTaxable.toFixed(2)} (Taxable)</span>
                  <span>{totals.totalTax.toFixed(2)} (TAX)</span>
                  <span>{totals.totalWithTax.toFixed(2)} (Total)</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleAddProductItem()}
                  style={{ fontSize: "12.5px", padding: "6px 14px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "4px", cursor: "pointer", fontWeight: 600 }}
                >
                  + Add Product Row
                </button>
                {formState.additional_charges_enabled && (
                  <button
                    type="button"
                    className="btn"
                    onClick={handleAddChargeItem}
                    style={{ fontSize: "12.5px", padding: "6px 14px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "4px", cursor: "pointer", fontWeight: 600 }}
                  >
                    + Add Charge Row
                  </button>
                )}
              </div>
            </div>

            {/* Section 5: Bottom Details & Totals Summary */}
            <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", marginBottom: "24px" }}>
              {/* Left Column: Terms & Conditions and Remarks */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "14px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Terms And Conditions
                  </label>
                  <textarea
                    rows={4}
                    value={formState.terms_and_conditions}
                    onChange={(e) => setFormState({ ...formState, terms_and_conditions: e.target.value })}
                    style={{ width: "100%", padding: "10px", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "13px", resize: "vertical", outline: "none", color: "#334155" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", marginBottom: "6px", display: "block" }}>
                    Remarks
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Remarks by sales person"
                    value={formState.remarks}
                    onChange={(e) => setFormState({ ...formState, remarks: e.target.value })}
                    style={{ width: "100%", padding: "10px", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "13px", resize: "vertical", outline: "none", color: "#334155" }}
                  />
                </div>
              </div>

              {/* Right Column: Totals Summary Breakdown Card matching Screenshot 2 */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "6px",
                  padding: "18px 22px",
                  width: "380px",
                  minWidth: "350px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", fontSize: "13px", color: "#475569" }}>
                  <span>Total Basic</span>
                  <span style={{ fontWeight: 600, color: "#1e293b" }}>{formatIndianCurrency(totals.totalBasic)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", fontSize: "13px", color: "#475569" }}>
                  <span>Total Discount</span>
                  <span style={{ fontWeight: 600, color: "#1e293b" }}>{formatIndianCurrency(totals.totalDiscount)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", fontSize: "13px", color: "#475569" }}>
                  <span>Total Taxable Amount</span>
                  <span style={{ fontWeight: 600, color: "#1e293b" }}>{formatIndianCurrency(totals.totalTaxable)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px", fontSize: "13px", color: "#475569" }}>
                  <span>Total Tax</span>
                  <span style={{ fontWeight: 600, color: "#1e293b" }}>{formatIndianCurrency(totals.totalTax)}</span>
                </div>
                <div
                  style={{
                    borderTop: "1px solid #e2e8f0",
                    paddingTop: "12px",
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "8px",
                    fontSize: "16px",
                    fontWeight: 800,
                    color: "#0f172a",
                  }}
                >
                  <span>Total Including Tax</span>
                  <span>{formatIndianCurrency(totals.totalWithTax)}</span>
                </div>
                <div style={{ fontSize: "12px", color: "#64748b", fontStyle: "italic", textAlign: "right", marginTop: "4px" }}>
                  Amount In Words: <strong style={{ fontWeight: 600, color: "#334155" }}>{numberToIndianWords(totals.totalWithTax)}</strong>
                </div>
              </div>
            </div>

            {/* Bottom Action Button matching screenshot */}
            <div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={formSubmitting}
                style={{
                  background: "#0061f2",
                  color: "#ffffff",
                  border: "none",
                  padding: "10px 28px",
                  borderRadius: "4px",
                  fontWeight: 600,
                  fontSize: "14px",
                  cursor: "pointer",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                {formSubmitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </form>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell activeKey="proforma">
      <main className="page">
        <Breadcrumb trail={["Sale", "Proforma Invoices"]} />

        <div className="page-header">
          <div>
            <h1>Proforma Invoices</h1>
          </div>
          <div className="page-header-actions" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* Filter Toggle Button */}
            <button
              type="button"
              data-testid="btn-toggle-filter"
              className={`btn-filter ${filterOpen ? "active" : ""}`}
              onClick={() => setFilterOpen(!filterOpen)}
              aria-label="Filter"
              title="Toggle Filter Panel"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: filterOpen || activeFiltersCount > 0 ? "#5b6b82" : "#ffffff",
                color: filterOpen || activeFiltersCount > 0 ? "#ffffff" : "#475569",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                cursor: "pointer",
                height: "38px",
                width: "38px",
                minWidth: "38px",
                padding: 0,
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                transition: "all 0.15s ease",
                position: "relative",
              }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              {activeFiltersCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: "-4px",
                    right: "-4px",
                    backgroundColor: "#ef4444",
                    color: "#ffffff",
                    borderRadius: "10px",
                    fontSize: "10px",
                    fontWeight: 800,
                    padding: "1px 5px",
                    lineHeight: "1",
                  }}
                >
                  {activeFiltersCount}
                </span>
              )}
            </button>

            <button type="button" className="btn btn-add-new" onClick={handleOpenCreate}>
              + ADD NEW
            </button>
          </div>
        </div>

        {successMessage && (
          <div
            style={{
              padding: "12px 16px",
              backgroundColor: "#dcfce7",
              border: "1px solid #86efac",
              borderRadius: "6px",
              color: "#15803d",
              fontSize: "13px",
              marginBottom: "16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>✅ {successMessage}</span>
            <button
              type="button"
              onClick={() => navigate("/sales/process")}
              style={{
                background: "#15803d",
                color: "#ffffff",
                border: "none",
                borderRadius: "4px",
                padding: "5px 12px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Go to Sale Process →
            </button>
          </div>
        )}

        {errorMessage && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "6px", color: "#b91c1c", fontSize: "13px", marginBottom: "16px" }}>
            ⚠️ {errorMessage}
          </div>
        )}

        {/* Collapsible Filter Panel matching legacy ERP screenshot */}
        {filterOpen && (
          <div
            className="card"
            data-testid="proforma-filter-panel"
            style={{
              marginBottom: "16px",
              backgroundColor: "#ffffff",
              border: "1px solid #cbd5e1",
              padding: "18px 20px",
              borderRadius: "8px",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: "14px", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                Filter Options
              </div>
              <button
                type="button"
                className="btn btn-small"
                style={{ background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1", borderRadius: "6px", cursor: "pointer", fontWeight: 600, fontSize: "12.5px" }}
                onClick={handleResetFilter}
              >
                Reset Filters
              </button>
            </div>

            {/* Top Row: 3 columns */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "16px 24px",
                marginBottom: "16px",
              }}
            >
              <div className="field" style={{ margin: 0 }}>
                <label
                  htmlFor="filter-proforma-date-range"
                  style={{ fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px", display: "block" }}
                >
                  Proforma Invoice Date Range
                </label>
                <DateRangePicker
                  id="filter-proforma-date-range"
                  value={filterDateRange}
                  onChange={(val) => setFilterDateRange(val)}
                  onApply={(val) => {
                    setFilterDateRange(val);
                    setAppliedDateRange(val);
                  }}
                  placeholder=""
                />
              </div>

              <div className="field" style={{ margin: 0 }}>
                <label
                  htmlFor="filter-exp-date-range"
                  style={{ fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px", display: "block" }}
                >
                  Expected Delivery Date Range
                </label>
                <DateRangePicker
                  id="filter-exp-date-range"
                  value={filterExpDateRange}
                  onChange={(val) => setFilterExpDateRange(val)}
                  onApply={(val) => {
                    setFilterExpDateRange(val);
                    setAppliedExpDateRange(val);
                  }}
                  placeholder=""
                />
              </div>

              <div className="field" style={{ margin: 0 }}>
                <label
                  htmlFor="filter-warehouse"
                  style={{ fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px", display: "block" }}
                >
                  Warehouse
                </label>
                <select
                  id="filter-warehouse"
                  className="adjustment-filter-select"
                  value={filterWarehouse}
                  onChange={(e) => setFilterWarehouse(e.target.value)}
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    padding: "0 10px",
                    fontSize: "13.5px",
                    backgroundColor: "#ffffff",
                    color: "#334155",
                  }}
                >
                  <option value="All">All</option>
                  <option value="Mumbai">Mumbai</option>
                  <option value="Ahmedabad">Ahmedabad</option>
                  <option value="Indore">Indore</option>
                </select>
              </div>
            </div>

            {/* Second Row: 2 columns + Action Buttons at bottom right */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "16px 24px",
                alignItems: "flex-end",
              }}
            >
              <div className="field" style={{ margin: 0 }}>
                <label
                  htmlFor="filter-sales-person"
                  style={{ fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px", display: "block" }}
                >
                  Sales Person
                </label>
                <select
                  id="filter-sales-person"
                  className="adjustment-filter-select"
                  value={filterSalesPerson}
                  onChange={(e) => setFilterSalesPerson(e.target.value)}
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    padding: "0 10px",
                    fontSize: "13.5px",
                    backgroundColor: "#ffffff",
                    color: "#334155",
                  }}
                >
                  <option value="All">All</option>
                  <option value="Deepika Samel">Deepika Samel</option>
                  <option value="Dhairya Shah">Dhairya Shah</option>
                  <option value="Sunita Pawar">Sunita Pawar</option>
                  <option value="Bhavin Suthar">Bhavin Suthar</option>
                </select>
              </div>

              <div className="field" style={{ margin: 0 }}>
                <label
                  htmlFor="filter-lead-source"
                  style={{ fontSize: "13px", fontWeight: 500, color: "#334155", marginBottom: "6px", display: "block" }}
                >
                  Lead Source
                </label>
                <select
                  id="filter-lead-source"
                  className="adjustment-filter-select"
                  value={filterLeadSource}
                  onChange={(e) => setFilterLeadSource(e.target.value)}
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    padding: "0 10px",
                    fontSize: "13.5px",
                    backgroundColor: "#ffffff",
                    color: "#334155",
                  }}
                >
                  <option value="All">All</option>
                  <option value="Other">Other</option>
                  <option value="Direct">Direct</option>
                  <option value="IndiaMART">IndiaMART</option>
                  <option value="TradeIndia">TradeIndia</option>
                  <option value="Website">Website</option>
                </select>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  alignItems: "center",
                }}
              >
                <button
                  type="button"
                  onClick={handleResetFilter}
                  style={{
                    backgroundColor: "#5c6b84",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "4px",
                    padding: "8px 22px",
                    fontSize: "13.5px",
                    fontWeight: 500,
                    cursor: "pointer",
                    height: "38px",
                    transition: "all 0.15s ease",
                  }}
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleSearchFilter}
                  style={{
                    backgroundColor: "#ffa800",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "4px",
                    padding: "8px 22px",
                    fontSize: "13.5px",
                    fontWeight: 600,
                    cursor: "pointer",
                    height: "38px",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                    transition: "all 0.15s ease",
                  }}
                >
                  Search
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Summary cards: ALL / PENDING / ADMIN APPROVED / CONFIRMED / CANCELLED */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "16px" }}>
          {STATUS_TABS.map((card) => {
            const c = tabCounts[card.key] || { count: 0, amount: 0 };
            const isActive = activeTab === card.key;
            return (
              <div
                key={card.key}
                className="card"
                style={{
                  margin: 0,
                  cursor: "pointer",
                  border: isActive ? "2px solid #0061f2" : "1px solid #e2e8f0",
                  backgroundColor: isActive ? "#f8fafc" : "#ffffff",
                  padding: "12px 14px",
                  boxShadow: isActive ? "0 4px 6px -1px rgba(0,97,242,0.1)" : "0 1px 3px rgba(0,0,0,0.04)",
                  transition: "all 0.15s ease",
                }}
                onClick={() => {
                  setActiveTab(card.key);
                  setCurrentPage(1);
                }}
              >
                <div style={{ fontSize: "11px", fontWeight: 700, color: isActive ? "#0061f2" : "#64748b", letterSpacing: "0.03em", marginBottom: "6px" }}>
                  {card.cardLabel}
                </div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                  {formatIndianCurrency(c.amount)} <span style={{ fontWeight: 500, fontSize: "13px", color: "#64748b" }}>({c.count})</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Main Data Card (Aligned with Companies UI Design) */}
        <div className="card" style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", padding: 0, overflow: "hidden" }}>
          {/* Status tabs inside Card Header */}
          <div style={{ display: "flex", gap: "20px", borderBottom: "1px solid #e2e8f0", padding: "6px 16px 0", background: "#ffffff" }}>
            {STATUS_TABS.map((tab) => {
              const c = tabCounts[tab.key] || { count: 0, amount: 0 };
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.key);
                    setCurrentPage(1);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: isActive ? "2.5px solid #0061f2" : "2.5px solid transparent",
                    color: isActive ? "#0061f2" : "#64748b",
                    fontWeight: isActive ? 700 : 600,
                    fontSize: "13.5px",
                    paddingBottom: "8px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {tab.label} ({c.count})
                </button>
              );
            })}
          </div>

          {/* Controls Toolbar: Items per page + Live Search */}
          <div
            className="toolbar"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 16px",
              gap: "10px",
              flexWrap: "wrap",
              borderBottom: "1px solid #e2e8f0",
              background: "#ffffff",
            }}
          >
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <select
                  value={perPage}
                  onChange={(e) => {
                    setPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", color: "#334155", background: "#ffffff" }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span style={{ fontSize: "13px", color: "#64748b", fontWeight: 500 }}>Items/Page</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                style={{
                  padding: "7px 12px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  fontSize: "13px",
                  width: "220px",
                  outline: "none",
                  color: "#0f172a",
                }}
              />
            </div>
          </div>

          {/* Table Container */}
          <div className="table-scroll" style={{ maxHeight: "calc(100vh - 220px)", overflowY: "auto", overflowX: "auto", border: "none", borderRadius: 0, boxShadow: "none" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: "13px", textAlign: "left", minWidth: "1150px" }}>
              <thead>
                <tr>
                  <th style={{ width: "55px", textAlign: "center", verticalAlign: "middle", padding: "8px 10px", fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "#1e293b", backgroundColor: "#f1f5f9", borderBottom: "1px solid #cbd5e1", borderRight: "1px solid #cbd5e1", whiteSpace: "nowrap" }}>
                    Sr. No.
                  </th>
                  <th style={{ padding: "8px 10px", fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "#1e293b", backgroundColor: "#f1f5f9", borderBottom: "1px solid #cbd5e1", borderRight: "1px solid #cbd5e1", whiteSpace: "nowrap" }}>
                    Proforma No.
                  </th>
                  <th style={{ padding: "8px 10px", fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "#1e293b", backgroundColor: "#f1f5f9", borderBottom: "1px solid #cbd5e1", borderRight: "1px solid #cbd5e1", whiteSpace: "nowrap" }}>
                    Warehouse
                  </th>
                  <th style={{ padding: "8px 10px", fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "#1e293b", backgroundColor: "#f1f5f9", borderBottom: "1px solid #cbd5e1", borderRight: "1px solid #cbd5e1", whiteSpace: "nowrap" }}>
                    Lead Source
                  </th>
                  <th style={{ padding: "8px 10px", fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "#1e293b", backgroundColor: "#f1f5f9", borderBottom: "1px solid #cbd5e1", borderRight: "1px solid #cbd5e1", whiteSpace: "nowrap" }}>
                    Exp. Deli. Date
                  </th>
                  <th style={{ padding: "8px 10px", fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "#1e293b", backgroundColor: "#f1f5f9", borderBottom: "1px solid #cbd5e1", borderRight: "1px solid #cbd5e1", whiteSpace: "nowrap" }}>
                    Company
                  </th>
                  <th style={{ padding: "8px 10px", fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "#1e293b", backgroundColor: "#f1f5f9", borderBottom: "1px solid #cbd5e1", borderRight: "1px solid #cbd5e1", whiteSpace: "nowrap" }}>
                    City / State
                  </th>
                  <th style={{ padding: "8px 10px", fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "#1e293b", backgroundColor: "#f1f5f9", borderBottom: "1px solid #cbd5e1", borderRight: "1px solid #cbd5e1", whiteSpace: "nowrap" }}>
                    Sales Person
                  </th>
                  <th style={{ textAlign: "right", padding: "8px 10px", fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "#1e293b", backgroundColor: "#f1f5f9", borderBottom: "1px solid #cbd5e1", borderRight: "1px solid #cbd5e1", whiteSpace: "nowrap" }}>
                    Amount (Inc.GST)
                  </th>
                  <th style={{ textAlign: "right", padding: "8px 10px", fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "#1e293b", backgroundColor: "#f1f5f9", borderBottom: "1px solid #cbd5e1", borderRight: "1px solid #cbd5e1", whiteSpace: "nowrap" }}>
                    Discount
                  </th>
                  <th style={{ textAlign: "center", padding: "8px 10px", fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "#1e293b", backgroundColor: "#f1f5f9", borderBottom: "1px solid #cbd5e1", borderRight: "1px solid #cbd5e1", whiteSpace: "nowrap" }}>
                    Status
                  </th>
                  <th style={{ textAlign: "center", width: "60px", padding: "8px 10px", fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "#1e293b", backgroundColor: "#f1f5f9", borderBottom: "1px solid #cbd5e1", whiteSpace: "nowrap" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={12} style={{ textAlign: "center", padding: "28px", color: "#64748b", height: "50px", backgroundColor: "#ffffff" }}>
                      Loading…
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={12} style={{ textAlign: "center", padding: "28px", color: "#64748b", height: "50px", backgroundColor: "#ffffff" }}>
                      No proforma invoices found.
                    </td>
                  </tr>
                ) : (
                  paginatedItems.map((p, idx) => (
                    <tr
                      key={p.id}
                      style={{ transition: "background-color 0.15s ease", cursor: "pointer" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
                    >
                      <td style={{ textAlign: "center", color: "#64748b", fontWeight: 500, padding: "8px 10px", borderBottom: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", height: "38px" }}>
                        {(currentPage - 1) * perPage + idx + 1}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", height: "38px" }}>
                        <a
                          href={`/proforma-invoice/download-proforma-invoice/${p.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            window.open(`/proforma-invoice/download-proforma-invoice/${p.id}`, "_blank");
                          }}
                          style={{ color: "#0061f2", fontWeight: 600, textDecoration: "none", cursor: "pointer" }}
                          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                          title={`Open PDF for ${p.proforma_no}`}
                        >
                          {p.proforma_no}
                        </a>
                        <div style={{ fontSize: "11.5px", color: "#64748b" }}>{p.proforma_date}</div>
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", height: "38px" }}>{p.warehouse}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", height: "38px" }}>
                        {p.lead_source ? (
                          <span style={{ background: "#f1f5f9", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", color: "#475569" }}>
                            {p.lead_source}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", height: "38px" }}>{p.expected_delivery_date || "—"}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", height: "38px" }}>
                        <div style={{ fontWeight: 600, color: "#1e293b" }}>{p.company_name}</div>
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", height: "38px" }}>
                        <div>{p.city || "—"}</div>
                        {p.state ? <div style={{ fontSize: "11.5px", color: "#64748b" }}>{p.state}</div> : null}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", height: "38px" }}>{p.sales_person || "—"}</td>
                      <td style={{ textAlign: "right", fontWeight: 600, padding: "8px 10px", borderBottom: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", height: "38px" }}>
                        {formatIndianCurrency(p.amount_inc_gst)}
                      </td>
                      <td style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", height: "38px" }}>
                        {formatIndianCurrency(p.discount)}
                      </td>
                      <td style={{ textAlign: "center", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", height: "38px" }}>
                        <span className={statusBadgeClass(p.status, STATUS_TABS)}>{statusLabel(p.status, STATUS_TABS)}</span>
                        {p.below_min_price && (
                          <span title="Priced below the minimum price" style={{ marginLeft: "6px", color: "#b45309" }}>⚠</span>
                        )}
                        {p.remark && <div style={{ fontSize: "11px", color: "#dc2626", marginTop: "2px" }}>{p.remark}</div>}
                      </td>
                      <td style={{ textAlign: "center", position: "relative", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", height: "38px" }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenActionId(openActionId === p.id ? null : p.id);
                          }}
                          style={{
                            background: "none",
                            border: "1px solid #e2e8f0",
                            borderRadius: "4px",
                            fontSize: "14px",
                            color: "#64748b",
                            cursor: "pointer",
                            padding: "3px 8px",
                            lineHeight: 1,
                          }}
                        >
                          ⋮
                        </button>
                        {openActionId === p.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: "absolute",
                              right: "10px",
                              top: "34px",
                              background: "#ffffff",
                              border: "1px solid #cbd5e1",
                              borderRadius: "6px",
                              boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                              zIndex: 100,
                              minWidth: "140px",
                              textAlign: "left",
                              overflow: "hidden",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                window.open(`/proforma-invoice/download-proforma-invoice/${p.id}`, "_blank");
                                setOpenActionId(null);
                              }}
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                background: "none",
                                border: "none",
                                textAlign: "left",
                                fontSize: "12.5px",
                                cursor: "pointer",
                                color: "#1e293b",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f1f5f9")}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            >
                              📄 Download / View PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedProforma(p);
                                setOpenActionId(null);
                              }}
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                background: "none",
                                border: "none",
                                textAlign: "left",
                                fontSize: "12.5px",
                                cursor: "pointer",
                                color: "#1e293b",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f1f5f9")}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            >
                              👁️ View Details
                            </button>
                            {canEdit(p) && (
                              <ActionMenuItem
                                label="✏️ Edit"
                                color="#2563eb"
                                onClick={() => {
                                  setOpenActionId(null);
                                  handleOpenEdit(p);
                                }}
                              />
                            )}
                            {availableTransitions(p).map((target) => {
                              const tab = STATUS_TABS.find((t) => t.key === target);
                              const label =
                                target === "confirmed"
                                  ? "✅ Confirm & Create SO"
                                  : tab?.actionLabel || tab?.label || target;
                              return (
                                <ActionMenuItem
                                  key={target}
                                  label={label}
                                  color={target === "confirmed" ? "#16a34a" : tab?.actionColor}
                                  onClick={() => startTransition(p, target)}
                                />
                              );
                            })}
                            {canDelete(p) && <ActionMenuItem label="🗑️ Delete" color="#dc2626" onClick={() => void handleDeleteProforma(p)} />}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Standardized Companies Pagination Footer Bar */}
          <div style={{ padding: "0 16px 14px", borderTop: "1px solid #e2e8f0", background: "#ffffff" }}>
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

        {/* SideDrawer for Proforma Detail */}
        <SideDrawer
          open={Boolean(selectedProforma)}
          onClose={() => setSelectedProforma(null)}
          title={`Proforma: ${selectedProforma?.proforma_no || ""}`}
          subtitle={`Company: ${selectedProforma?.company_name || ""}`}
        >
          {selectedProforma && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => window.open(`/proforma-invoice/download-proforma-invoice/${selectedProforma.id}`, "_blank")}
                  className="btn btn-secondary"
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", padding: "6px 14px", cursor: "pointer" }}
                >
                  📄 Open / Download PDF
                </button>
              </div>
              <div className="card" style={{ margin: 0 }}>
                <h4 style={{ fontSize: "14px", fontWeight: 700, marginBottom: "10px" }}>Invoice Header</h4>
                <DetailFieldGrid
                  fields={[
                    { label: "Proforma No.", value: selectedProforma.proforma_no },
                    { label: "Date", value: selectedProforma.proforma_date },
                    { label: "Exp. Delivery Date", value: selectedProforma.expected_delivery_date || "—" },
                    { label: "Warehouse", value: selectedProforma.warehouse },
                    { label: "Company", value: selectedProforma.company_name },
                    { label: "City / State", value: `${selectedProforma.city || "—"}, ${selectedProforma.state || "—"}` },
                    { label: "Sales Person", value: selectedProforma.sales_person || "—" },
                    { label: "Lead Source", value: selectedProforma.lead_source || "—" },
                    { label: "Status", value: statusLabel(selectedProforma.status, STATUS_TABS) },
                    { label: "Payment Terms", value: selectedProforma.payment_terms || "—" },
                    { label: "Transport", value: selectedProforma.transport_name || "—" },
                    { label: "Transport Destination", value: selectedProforma.transport_destination || "—" },
                    { label: "Delivery Type", value: selectedProforma.delivery_type || "—" },
                    { label: "Delivery Charge", value: selectedProforma.delivery_charge || "—" },
                    { label: "Third Party Delivery", value: selectedProforma.third_party_delivery || "—" },
                    { label: "Billing Address", value: selectedProforma.billing_address || "—" },
                    { label: "Shipping Address", value: selectedProforma.shipping_address || "—" },
                    { label: "Created By", value: selectedProforma.created_by || "—" },
                    ...(selectedProforma.approved_by ? [{ label: "Approved By", value: selectedProforma.approved_by }] : []),
                    ...(selectedProforma.cancel_reason ? [{ label: "Cancel Reason", value: selectedProforma.cancel_reason }] : []),
                    ...(selectedProforma.below_min_price ? [{ label: "Pricing", value: "Below minimum price: needs admin approval" }] : []),
                  ]}
                />
              </div>

              <div className="card" style={{ margin: 0 }}>
                <h4 style={{ fontSize: "14px", fontWeight: 700, marginBottom: "10px" }}>Line Items</h4>
                <table style={{ width: "100%", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                      <th style={{ padding: "6px" }}>Product</th>
                      <th style={{ padding: "6px", textAlign: "center" }}>Qty</th>
                      <th style={{ padding: "6px", textAlign: "right" }}>Rate</th>
                      <th style={{ padding: "6px", textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedProforma.items || []).map((it, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px 6px" }}>{it.product_name}</td>
                        <td style={{ padding: "8px 6px", textAlign: "center" }}>{it.quantity} {it.uom}</td>
                        <td style={{ padding: "8px 6px", textAlign: "right" }}>{formatIndianCurrency(it.rate)}</td>
                        <td style={{ padding: "8px 6px", textAlign: "right", fontWeight: 600 }}>{formatIndianCurrency(it.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card" style={{ margin: 0, backgroundColor: "#f8fafc" }}>
                <DetailFieldGrid
                  fields={[
                    { label: "Amount (Inc. GST)", value: formatIndianCurrency(selectedProforma.amount_inc_gst) },
                    { label: "Discount", value: formatIndianCurrency(selectedProforma.discount) },
                    { label: "Net Payable", value: formatIndianCurrency(selectedProforma.amount_inc_gst - selectedProforma.discount) },
                  ]}
                />
              </div>
            </div>
          )}
        </SideDrawer>
      </main>
      {reasonDialog && (
        <div
          role="dialog"
          aria-label="Reason required"
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setReasonDialog(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "8px", width: "420px", maxWidth: "92%", padding: "20px", boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
            <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 6px", color: "#1e293b" }}>
              {STATUS_TABS.find((t) => t.key === reasonDialog.target)?.actionLabel || reasonDialog.target}: {reasonDialog.pi.proforma_no}
            </h3>
            <p style={{ fontSize: "12.5px", color: "#64748b", margin: "0 0 10px" }}>Please give a reason.</p>
            <textarea
              aria-label="Reason"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              rows={3}
              style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: "4px", padding: "8px", fontSize: "13px" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "14px" }}>
              <button type="button" className="btn" onClick={() => setReasonDialog(null)}>
                Close
              </button>
              <button
                type="button"
                className="btn btn-add-new"
                disabled={!reasonText.trim()}
                onClick={() => {
                  const d = reasonDialog;
                  setReasonDialog(null);
                  void applyTransition(d.pi, d.target, reasonText.trim());
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}