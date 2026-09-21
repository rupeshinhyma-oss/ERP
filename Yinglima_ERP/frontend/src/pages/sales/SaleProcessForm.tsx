/**
 * Sale Process Order Form (Create / Edit).
 *
 * Implements full Shipment Planning integration:
 * - Select Buyer (e.g. Inhyma Mumbai, Darsh Impex)
 * - Auto-discovers and lists consignment columns (e.g. MUMINHYMA 1, MUMINHYMA 2)
 * - 1-Click extraction and population of planned products, quantities, and remarks
 * - Multi-currency support (Default: RMB ¥)
 * - Real-time tax & total calculations
 * - Container, BL, LR, and shipping logistics tracking
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { apiGet, apiPatch, apiPost, errorMessage } from "@/lib/api";
import { useLookup } from "@/lib/lookups";
import { useToast } from "@/lib/toast";
import type {
  PlanningConsignmentColumn,
  PlanningConsignmentItemsResponse,
  SaleOrder,
  SaleOrderItem,
} from "@/types/saleProcess";

export function SaleProcessFormPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  // Form State
  const [organizationId, setOrganizationId] = useState("");
  const [organizationName, setOrganizationName] = useState("Yinglima");
  const [buyerId, setBuyerId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerBranchId, setBuyerBranchId] = useState("");
  const [buyerBranchName, setBuyerBranchName] = useState("");
  // Searchable buyer combobox
  const [buyerSearch, setBuyerSearch] = useState("");
  const [buyerOpen, setBuyerOpen] = useState(false);
  const buyerDropdownRef = useRef<HTMLDivElement>(null);

  // Shipment Planning Consignment Integration
  const [consignments, setConsignments] = useState<PlanningConsignmentColumn[]>([]);
  const [selectedColumnId, setSelectedColumnId] = useState("");
  const [selectedConsignmentCode, setSelectedConsignmentCode] = useState("");
  const [selectedSheetId, setSelectedSheetId] = useState("");
  const [loadingConsignments, setLoadingConsignments] = useState(false);
  const [extractingItems, setExtractingItems] = useState(false);
  const [consignmentLoadedInfo, setConsignmentLoadedInfo] = useState<string | null>(null);

  // Order Details
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState("");
  const [currency, setCurrency] = useState("RMB");
  const [status, setStatus] = useState("pending");

  // Logistics
  const [containerNo, setContainerNo] = useState("");
  const [blNo, setBlNo] = useState("");
  const [lrNo, setLrNo] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [portOfLoading, setPortOfLoading] = useState("");
  const [portOfDischarge, setPortOfDischarge] = useState("");
  const [remarks, setRemarks] = useState("");

  // Items
  const [items, setItems] = useState<SaleOrderItem[]>([]);

  // Product Master Search
  const [productSearch, setProductSearch] = useState("");
  const [productSearchResults, setProductSearchResults] = useState<
    Array<{
      id: string;
      product_name: string;
      product_code?: string;
      hsn_code?: string;
      standard_cost?: number;
      refund_vat_percent?: number;
    }>
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);

  // Quick fill rate tool
  const [quickRate, setQuickRate] = useState<string>("");

  // Submitting
  const [submitting, setSubmitting] = useState(false);
  const [initialLoading, setInitialLoading] = useState(isEdit);

  // Lookups
  const orgLookup = useLookup<{ id: string; name: string }>("/masters/company-list/lookup", 250);
  const buyerLookup = useLookup<{
    id: string;
    company_name: string;
    name?: string;
    branches?: Array<{ id: string; name: string }>;
  }>("/buyers?page_size=500", 500);

  // Close search results dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close buyer dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (buyerDropdownRef.current && !buyerDropdownRef.current.contains(e.target as Node)) {
        setBuyerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Set default organization
  useEffect(() => {
    if (!organizationId && orgLookup.items && orgLookup.items.length > 0) {
      const ylm = orgLookup.items.find((o) =>
        o.name.toLowerCase().includes("yinglima")
      );
      if (ylm) {
        setOrganizationId(ylm.id);
        setOrganizationName(ylm.name);
      } else {
        setOrganizationId(orgLookup.items[0].id);
        setOrganizationName(orgLookup.items[0].name);
      }
    }
  }, [orgLookup.items, organizationId]);

  // Load existing order if editing
  useEffect(() => {
    if (!isEdit || !id) return;

    let mounted = true;
    async function loadOrder() {
      try {
        const res = await apiGet<SaleOrder>(`/sales/orders/${id}`);
        if (mounted && res.data) {
          const o = res.data;
          setOrganizationId(o.organization_id);
          setOrganizationName(o.organization_name);
          setBuyerId(o.buyer_id);
          setBuyerName(o.buyer_name);
          setBuyerBranchId(o.buyer_branch_id || "");
          setBuyerBranchName(o.buyer_branch_name || "");
          setSelectedConsignmentCode(o.consignment_code || "");
          setSelectedColumnId(o.planning_column_id || "");
          setSelectedSheetId(o.planning_sheet_id || "");
          setOrderDate(o.order_date);
          setDeliveryDate(o.delivery_date || "");
          setCurrency(o.currency || "RMB");
          setStatus(o.status || "pending");
          setContainerNo(o.container_no || "");
          setBlNo(o.bl_no || "");
          setLrNo(o.lr_no || "");
          setTransporterName(o.transporter_name || "");
          setPortOfLoading(o.port_of_loading || "");
          setPortOfDischarge(o.port_of_discharge || "");
          setRemarks(o.remarks || "");

          if (o.items && o.items.length > 0) {
            setItems(o.items);
          }
        }
      } catch (err) {
        if (mounted) toast(errorMessage(err), "error");
      } finally {
        if (mounted) setInitialLoading(false);
      }
    }
    loadOrder();
    return () => {
      mounted = false;
    };
  }, [id, isEdit, toast]);

  // Fetch consignment columns when buyer changes
  useEffect(() => {
    let mounted = true;
    async function fetchConsignments() {
      setLoadingConsignments(true);
      try {
        const params = new URLSearchParams();
        if (buyerName) params.set("buyer_name", buyerName);

        const res = await apiGet<PlanningConsignmentColumn[]>(
          `/sales/planning-consignments?${params.toString()}`
        );
        if (mounted && res.data) {
          setConsignments(res.data);
        }
      } catch {
        // Fallback quietly
      } finally {
        if (mounted) setLoadingConsignments(false);
      }
    }

    fetchConsignments();
    return () => {
      mounted = false;
    };
  }, [buyerName]);

  // Handle buyer change
  const handleBuyerSelect = (bId: string) => {
    setBuyerId(bId);
    const buyer = buyerLookup.items?.find((b) => b.id === bId);
    if (buyer) {
      const bName = buyer.company_name || buyer.name || "";
      setBuyerName(bName);
      setBuyerBranchId("");
      setBuyerBranchName("");
      setConsignmentLoadedInfo(null);
    } else {
      setBuyerName("");
    }
  };

  // Extract products from selected consignment column
  const handleExtractConsignment = async (columnIdToExtract?: string) => {
    const colId = columnIdToExtract || selectedColumnId;
    if (!colId) {
      toast("Please select a consignment column first.", "warning");
      return;
    }

    setExtractingItems(true);
    try {
      const res = await apiGet<PlanningConsignmentItemsResponse>(
        `/sales/planning-consignments/${colId}/items`
      );

      if (res.data) {
        const data = res.data;
        if (data.items.length === 0) {
          toast(
            `No products with planned quantity > 0 found in consignment ${data.consignment_code}.`,
            "warning"
          );
          return;
        }

        const mappedItems: SaleOrderItem[] = data.items.map((it) => {
          const qty = Number(it.quantity) || 0;
          const rate = Number(it.unit_rate) || 0;
          const taxPct = Number(it.vat_rate) || 0;
          const basic = qty * rate;
          const taxAmt = (basic * taxPct) / 100.0;
          const tot = basic + taxAmt;

          return {
            product_id: it.product_id,
            product_name: it.product_name,
            product_code: it.product_code || null,
            hsn_code: it.hsn_code || null,
            quantity: qty,
            unit_rate: rate,
            tax_percent: taxPct,
            tax_amount: Math.round(taxAmt * 100) / 100,
            item_total: Math.round(tot * 100) / 100,
            planning_row_id: it.planning_row_id,
            remarks: it.remarks || null,
          };
        });

        setItems(mappedItems);
        setSelectedConsignmentCode(data.consignment_code);
        setSelectedSheetId(data.sheet_id);
        setSelectedColumnId(data.column_id);

        const msg = `Successfully loaded ${data.count} planned products (${data.total_quantity.toLocaleString()} pcs) from consignment ${data.consignment_code} (${data.sheet_name})!`;
        setConsignmentLoadedInfo(msg);
        toast(msg, "success");
      }
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setExtractingItems(false);
    }
  };

  // Product Autocomplete Search
  useEffect(() => {
    if (!productSearch.trim() || productSearch.length < 2) {
      setProductSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await apiGet<
          Array<{
            id: string;
            product_name: string;
            product_name_invoice?: string;
            product_name_tally?: string;
            product_code?: string;
            hsn_code?: string;
            standard_cost?: number;
            refund_vat_percent?: number;
          }>
        >(`/masters/products?search=${encodeURIComponent(productSearch)}&page_size=15`);

        // API returns array directly in res.data
        const results = Array.isArray(res.data) ? res.data : [];
        // Normalise display name: prefer product_name_invoice, then product_name_tally, then product_name
        const normalised = results.map((p) => ({
          ...p,
          product_name: p.product_name_invoice || p.product_name_tally || p.product_name,
        }));
        setProductSearchResults(normalised);
        setShowSearchResults(normalised.length > 0);
      } catch {
        // quiet
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [productSearch]);

  const handleAddProduct = (p: {
    id: string;
    product_name: string;
    product_code?: string;
    hsn_code?: string;
    standard_cost?: number;
    refund_vat_percent?: number;
  }) => {
    const rate = Number(p.standard_cost) || 0;
    const taxPct = Number(p.refund_vat_percent) || 0;
    const qty = 1;
    const basic = qty * rate;
    const taxAmt = (basic * taxPct) / 100.0;

    const newItem: SaleOrderItem = {
      product_id: p.id,
      product_name: p.product_name,
      product_code: p.product_code || null,
      hsn_code: p.hsn_code || null,
      quantity: qty,
      unit_rate: rate,
      tax_percent: taxPct,
      tax_amount: Math.round(taxAmt * 100) / 100,
      item_total: Math.round((basic + taxAmt) * 100) / 100,
      remarks: null,
    };

    setItems((prev) => [...prev, newItem]);
    setProductSearch("");
    setShowSearchResults(false);
    toast(`Added ${p.product_name}`, "success");
  };

  // Update item field
  const updateItem = (index: number, field: keyof SaleOrderItem, val: any) => {
    setItems((prev) => {
      const next = [...prev];
      const target = { ...next[index], [field]: val };

      const qty = Number(target.quantity) || 0;
      const rate = Number(target.unit_rate) || 0;
      const taxPct = Number(target.tax_percent) || 0;

      const basic = qty * rate;
      const taxAmt = (basic * taxPct) / 100.0;
      const tot = basic + taxAmt;

      target.tax_amount = Math.round(taxAmt * 100) / 100;
      target.item_total = Math.round(tot * 100) / 100;

      next[index] = target;
      return next;
    });
  };

  // Remove item
  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Apply quick fill rates
  const applyQuickRate = () => {
    const r = parseFloat(quickRate);
    if (isNaN(r) || r < 0) {
      toast("Please enter a valid rate.", "warning");
      return;
    }
    setItems((prev) =>
      prev.map((item) => {
        const qty = Number(item.quantity) || 0;
        const taxPct = Number(item.tax_percent) || 0;
        const basic = qty * r;
        const taxAmt = (basic * taxPct) / 100.0;
        return {
          ...item,
          unit_rate: r,
          tax_amount: Math.round(taxAmt * 100) / 100,
          item_total: Math.round((basic + taxAmt) * 100) / 100,
        };
      })
    );
    toast(`Applied rate ¥ ${r.toFixed(2)} to all line items.`, "success");
    setQuickRate("");
  };

  // Financial totals
  const totals = useMemo(() => {
    let basic = 0;
    let tax = 0;
    let grand = 0;
    let qty = 0;

    for (const it of items) {
      const q = Number(it.quantity) || 0;
      const r = Number(it.unit_rate) || 0;
      const t = Number(it.tax_amount) || 0;
      const tot = Number(it.item_total) || 0;

      basic += q * r;
      tax += t;
      grand += tot;
      qty += q;
    }

    return {
      basic: Math.round(basic * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      grand: Math.round(grand * 100) / 100,
      qty: Math.round(qty * 100) / 100,
      count: items.length,
    };
  }, [items]);

  // Track which rows have invalid unit_rate (for inline highlighting)
  const [invalidRateIds, setInvalidRateIds] = useState<Set<number>>(new Set());

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!buyerId) {
      toast("Please select a Buyer Company.", "error");
      return;
    }
    if (items.length === 0) {
      toast("Please add at least one line item or load a consignment.", "error");
      return;
    }

    // Validate quantity
    for (let i = 0; i < items.length; i++) {
      if (!items[i].quantity || items[i].quantity <= 0) {
        toast(`Item #${i + 1} (${items[i].product_name}) must have quantity > 0.`, "error");
        return;
      }
    }

    // Validate unit_rate — collect ALL offending items and show ONE summary toast
    const badRateIndices = items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => !it.unit_rate || it.unit_rate <= 0)
      .map(({ idx }) => idx);

    if (badRateIndices.length > 0) {
      // Mark rows for highlighting
      setInvalidRateIds(new Set(badRateIndices));
      // Scroll to first offending row
      const firstBadRow = document.querySelector(`[data-row-index="${badRateIndices[0]}"]`);
      if (firstBadRow) firstBadRow.scrollIntoView({ behavior: "smooth", block: "center" });
      // Single consolidated message
      const noun = badRateIndices.length === 1 ? "item has" : "items have";
      toast(
        `${badRateIndices.length} ${noun} unit rate ≤ 0. Please fill the highlighted rows before saving.`,
        "error"
      );
      return;
    }

    // Clear any previous highlights
    setInvalidRateIds(new Set());

    setSubmitting(true);
    try {
      const payload = {
        organization_id: organizationId,
        organization_name: organizationName,
        buyer_id: buyerId,
        buyer_name: buyerName,
        buyer_branch_id: buyerBranchId || null,
        buyer_branch_name: buyerBranchName || null,
        consignment_code: selectedConsignmentCode || null,
        planning_sheet_id: selectedSheetId || null,
        planning_column_id: selectedColumnId || null,
        order_date: orderDate,
        delivery_date: deliveryDate || null,
        currency: currency,
        status: status,
        container_no: containerNo || null,
        bl_no: blNo || null,
        lr_no: lrNo || null,
        transporter_name: transporterName || null,
        port_of_loading: portOfLoading || null,
        port_of_discharge: portOfDischarge || null,
        remarks: remarks || null,
        items: items.map((it) => ({
          product_id: it.product_id || null,
          product_name: it.product_name,
          product_code: it.product_code || null,
          hsn_code: it.hsn_code || null,
          quantity: it.quantity,
          unit_rate: it.unit_rate,
          tax_percent: it.tax_percent,
          tax_amount: it.tax_amount,
          item_total: it.item_total,
          planning_row_id: it.planning_row_id || null,
          remarks: it.remarks || null,
        })),
      };

      if (isEdit) {
        await apiPatch(`/sales/orders/${id}`, payload);
        toast("Sale order updated successfully!", "success");
      } else {
        await apiPost(`/sales/orders`, payload);
        toast("Sale order created successfully!", "success");
      }

      navigate("/sale/process");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSubmitting(false);
    }
  };

  const currencySymbol = currency === "USD" ? "$" : "¥";

  if (initialLoading) {
    return (
      <AppShell activeKey="sale-process">
        <div style={{ padding: "80px 0", textAlign: "center", color: "#64748b" }}>
          <div style={{ fontSize: "28px", marginBottom: "8px" }}>⏳</div>
          Loading sale order details...
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell activeKey="sale-process">
      <Breadcrumb trail={["Sale", "Sale Process", isEdit ? "Edit Sale Order" : "New Sale Order"]} />

      <div style={{ width: "100%", padding: "0 4px", boxSizing: "border-box" }}>
        {/* Header Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "20px",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "#0f172a" }}>
              {isEdit ? "Edit Sale Process Order" : "New Sale Process Order"}
            </h1>
            <div style={{ marginTop: "4px", color: "#64748b", fontSize: "13px" }}>
              {isEdit
                ? "Update order details, logistics tracking, and item rates."
                : "Select consignment from Shipment Planning to automatically load products and quantities."}
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <Link
              to="/sale/process"
              style={{
                padding: "8px 14px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#475569",
                fontSize: "13px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                padding: "8px 20px",
                borderRadius: "6px",
                border: "none",
                background: "#0061f2",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 600,
                cursor: submitting ? "wait" : "pointer",
                boxShadow: "0 2px 4px rgba(0,97,242,0.25)",
              }}
            >
              {submitting ? "Saving..." : isEdit ? "Update Sale Order" : "Save Sale Order"}
            </button>
          </div>
        </div>

        {/* Consignment Loaded Notification Banner */}
        {consignmentLoadedInfo && (
          <div
            style={{
              padding: "12px 16px",
              borderRadius: "8px",
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              color: "#065f46",
              fontSize: "13px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span>✅</span>
              <span>{consignmentLoadedInfo}</span>
            </div>
            <button
              type="button"
              onClick={() => setConsignmentLoadedInfo(null)}
              style={{
                background: "none",
                border: "none",
                color: "#065f46",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              ✕
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Card 1: Core Order & Shipment Planning Consignment Section */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              padding: "20px",
              marginBottom: "16px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div
              style={{
                fontSize: "14px",
                fontWeight: 700,
                color: "#1e293b",
                marginBottom: "16px",
                borderBottom: "1px solid #f1f5f9",
                paddingBottom: "8px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span style={{ fontSize: "16px" }}>🚢</span>
              <span>Consignment & Buyer Identification</span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: "16px",
              }}
            >
              {/* Buyer Company — Searchable Combobox */}
              <div ref={buyerDropdownRef} style={{ position: "relative" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Buyer Company <span style={{ color: "#ef4444" }}>*</span>
                </label>

                {/* Trigger button */}
                <button
                  type="button"
                  onClick={() => {
                    setBuyerOpen((o) => !o);
                    setBuyerSearch("");
                  }}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#fff",
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    color: buyerId ? "#0f172a" : "#94a3b8",
                  }}
                >
                  <span>{buyerName || "-- Select Buyer Company --"}</span>
                  <span style={{ fontSize: "10px", color: "#64748b" }}>{buyerOpen ? "▲" : "▼"}</span>
                </button>

                {/* Dropdown panel */}
                {buyerOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      background: "#fff",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                      zIndex: 999,
                      overflow: "hidden",
                    }}
                  >
                    {/* Search input */}
                    <div style={{ padding: "8px", borderBottom: "1px solid #f1f5f9" }}>
                      <input
                        autoFocus
                        type="text"
                        placeholder="🔍 Search buyer..."
                        value={buyerSearch}
                        onChange={(e) => setBuyerSearch(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "6px 10px",
                          borderRadius: "5px",
                          border: "1px solid #e2e8f0",
                          fontSize: "12px",
                          outline: "none",
                          boxSizing: "border-box",
                          background: "#f8fafc",
                        }}
                      />
                    </div>

                    {/* Options list */}
                    <div style={{ maxHeight: "220px", overflowY: "auto" }}>
                      {/* Clear option */}
                      <div
                        onClick={() => {
                          handleBuyerSelect("");
                          setBuyerName("");
                          setBuyerOpen(false);
                          setBuyerSearch("");
                        }}
                        style={{
                          padding: "8px 12px",
                          fontSize: "12px",
                          color: "#94a3b8",
                          cursor: "pointer",
                          fontStyle: "italic",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        -- Select Buyer Company --
                      </div>

                      {buyerLookup.items
                        ?.filter((b) => {
                          const label = (b.company_name || b.name || "").toLowerCase();
                          return label.includes(buyerSearch.toLowerCase());
                        })
                        .map((b) => {
                          const label = b.company_name || b.name;
                          const isSelected = b.id === buyerId;
                          return (
                            <div
                              key={b.id}
                              onClick={() => {
                                handleBuyerSelect(b.id);
                                setBuyerOpen(false);
                                setBuyerSearch("");
                              }}
                              style={{
                                padding: "8px 12px",
                                fontSize: "13px",
                                cursor: "pointer",
                                fontWeight: isSelected ? 700 : 400,
                                color: isSelected ? "#2563eb" : "#1e293b",
                                background: isSelected ? "#eff6ff" : "transparent",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                              }}
                              onMouseEnter={(e) => {
                                if (!isSelected) e.currentTarget.style.background = "#f8fafc";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = isSelected ? "#eff6ff" : "transparent";
                              }}
                            >
                              {isSelected && <span style={{ fontSize: "10px" }}>✔</span>}
                              {label}
                            </div>
                          );
                        })}

                      {buyerLookup.items?.filter((b) => {
                        const label = (b.company_name || b.name || "").toLowerCase();
                        return label.includes(buyerSearch.toLowerCase());
                      }).length === 0 && (
                        <div style={{ padding: "12px", textAlign: "center", color: "#94a3b8", fontSize: "12px" }}>
                          No buyers match "{buyerSearch}"
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Consignment Selection from Shipment Planning */}
              <div style={{ minWidth: "320px", gridColumn: "span 2" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>
                    Planning Consignment Column
                  </label>
                  {loadingConsignments ? (
                    <span style={{ fontSize: "11px", color: "#0284c7", fontWeight: 600 }}>Loading consignments...</span>
                  ) : (
                    <span style={{ fontSize: "11px", color: "#64748b" }}>{consignments.length} available</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <select
                    value={selectedColumnId}
                    onChange={(e) => {
                      const colId = e.target.value;
                      setSelectedColumnId(colId);
                      const col = consignments.find((c) => c.column_id === colId);
                      if (col) {
                        setSelectedConsignmentCode(col.code || col.column_name);
                        setSelectedSheetId(col.sheet_id);

                        // Auto-match buyer from sheet name if not yet selected
                        if (!buyerId && buyerLookup.items) {
                          const matchedBuyer = buyerLookup.items.find((b) => {
                            const bName = (b.company_name || b.name || "").toLowerCase();
                            const sName = col.sheet_name.toLowerCase();
                            return bName.includes(sName) || sName.includes(bName);
                          });
                          if (matchedBuyer) {
                            setBuyerId(matchedBuyer.id);
                            setBuyerName(matchedBuyer.company_name || matchedBuyer.name || "");
                          }
                        }

                        // Auto-load items immediately on selection
                        handleExtractConsignment(colId);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13px",
                      background: "#ffffff",
                    }}
                  >
                    <option value="">-- Select Consignment Column (Auto-Loads Items) --</option>
                    {consignments.map((c) => (
                      <option key={c.column_id} value={c.column_id}>
                        {c.column_name} ({c.sheet_name} • {c.item_count} items • {c.total_quantity.toLocaleString()} pcs)
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    disabled={!selectedColumnId || extractingItems}
                    onClick={() => handleExtractConsignment()}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "6px",
                      background: selectedColumnId ? "#0284c7" : "#e2e8f0",
                      color: selectedColumnId ? "#ffffff" : "#94a3b8",
                      border: "none",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: selectedColumnId ? "pointer" : "not-allowed",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      boxShadow: selectedColumnId ? "0 1px 3px rgba(2,132,199,0.3)" : "none",
                    }}
                    title="Load all products with quantity > 0 and remarks from this consignment column"
                  >
                    {extractingItems ? "Loading..." : "⚡ Auto-Load Items"}
                  </button>
                </div>
              </div>

              {/* Order Date */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Order Date <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                  required
                />
              </div>

              {/* Delivery Target Date */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Target Delivery Date
                </label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Currency */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Currency
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                >
                  <option value="RMB">RMB (¥ - Chinese Yuan)</option>
                  <option value="USD">USD ($ - US Dollar)</option>
                </select>
              </div>

              {/* Workflow Status */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Order Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                  }}
                >
                  <option value="pending">Pending</option>
                  <option value="sales_confirmed">Sales Confirmed</option>
                  <option value="admin_approved">Admin Approved</option>
                  <option value="dispatched">Dispatched</option>
                  <option value="lr">LR Received</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
          </div>

          {/* Card 2: Shipping & Logistics Tracking */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              padding: "20px",
              marginBottom: "16px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div
              style={{
                fontSize: "14px",
                fontWeight: 700,
                color: "#1e293b",
                marginBottom: "16px",
                borderBottom: "1px solid #f1f5f9",
                paddingBottom: "8px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span style={{ fontSize: "16px" }}>🚚</span>
              <span>Logistics & Shipping Details</span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "16px",
              }}
            >
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Container No
                </label>
                <input
                  type="text"
                  placeholder="e.g. MSKU1234567"
                  value={containerNo}
                  onChange={(e) => setContainerNo(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  BL No (Bill of Lading)
                </label>
                <input
                  type="text"
                  placeholder="e.g. BL-98765432"
                  value={blNo}
                  onChange={(e) => setBlNo(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  LR No (Lorry Receipt)
                </label>
                <input
                  type="text"
                  placeholder="e.g. LR-456789"
                  value={lrNo}
                  onChange={(e) => setLrNo(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Transporter Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Maersk / COSCO / Inland Express"
                  value={transporterName}
                  onChange={(e) => setTransporterName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Port of Loading (POL)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ningbo / Shanghai / Shenzhen"
                  value={portOfLoading}
                  onChange={(e) => setPortOfLoading(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Port of Discharge (POD)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Nhava Sheva / Chennai / Mundra"
                  value={portOfDischarge}
                  onChange={(e) => setPortOfDischarge(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Card 3: Line Items Section */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              padding: "20px",
              marginBottom: "16px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "10px",
                marginBottom: "16px",
                borderBottom: "1px solid #f1f5f9",
                paddingBottom: "10px",
              }}
            >
              <div>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b" }}>
                  📦 Planned Line Items ({items.length} Products)
                </span>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                  Total Planned Quantity:{" "}
                  <strong style={{ color: "#0f172a" }}>{totals.qty.toLocaleString()} pcs</strong> |
                  Total Value:{" "}
                  <strong style={{ color: "#1d4ed8" }}>
                    {currencySymbol} {totals.grand.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </strong>
                </div>
              </div>

              {/* Quick Fill Tool & Search Add */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                {/* Bulk Rate Fill */}
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={`Rate ${currencySymbol}`}
                    value={quickRate}
                    onChange={(e) => setQuickRate(e.target.value)}
                    style={{
                      width: "80px",
                      padding: "6px 8px",
                      borderRadius: "4px",
                      border: "1px solid #cbd5e1",
                      fontSize: "12px",
                    }}
                  />
                  <button
                    type="button"
                    onClick={applyQuickRate}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "4px",
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      color: "#334155",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                    title="Fill this rate into all line items"
                  >
                    Apply Rate
                  </button>
                </div>

                {/* Product Search & Add */}
                <div ref={searchRef} style={{ position: "relative" }}>
                  <input
                    type="text"
                    placeholder="🔍 Search & add product from master..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    style={{
                      width: "260px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1.5px solid #0284c7",
                      fontSize: "12px",
                      outline: "none",
                      color: "#0f172a",
                    }}
                  />

                  {(showSearchResults || searchLoading) && (
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "calc(100% + 4px)",
                        width: "360px",
                        maxHeight: "280px",
                        overflowY: "auto",
                        background: "#ffffff",
                        border: "1px solid #cbd5e1",
                        borderRadius: "8px",
                        boxShadow: "0 12px 28px rgba(0,0,0,0.13)",
                        zIndex: 999,
                      }}
                    >
                      {/* Header */}
                      <div style={{ padding: "6px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: "11px", color: "#64748b", fontWeight: 600 }}>
                        {searchLoading ? "Searching product master..." : `${productSearchResults.length} product(s) found — click to add`}
                      </div>

                      {searchLoading ? (
                        <div style={{ padding: "14px", fontSize: "12px", color: "#64748b", textAlign: "center" }}>⏳ Searching...</div>
                      ) : productSearchResults.length === 0 ? (
                        <div style={{ padding: "14px", fontSize: "12px", color: "#94a3b8", textAlign: "center" }}>No products match "{productSearch}"</div>
                      ) : (
                        productSearchResults.map((p) => (
                          <div
                            key={p.id}
                            onClick={() => handleAddProduct(p)}
                            style={{
                              padding: "9px 12px",
                              fontSize: "12px",
                              cursor: "pointer",
                              borderBottom: "1px solid #f1f5f9",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#eff6ff")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
                          >
                            <div>
                              <div style={{ fontWeight: 600, color: "#0f172a" }}>{p.product_name}</div>
                              <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                                Code: {p.product_code || "—"} &nbsp;|&nbsp; HSN: {p.hsn_code || "—"}
                              </div>
                            </div>
                            <span style={{ fontSize: "11px", background: "#0284c7", color: "#fff", padding: "2px 8px", borderRadius: "99px", flexShrink: 0 }}>+ Add</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Items Table */}
            <div
              style={{
                overflow: "auto",
                maxHeight: items.length > 7 ? "520px" : undefined,
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "separate",
                  borderSpacing: 0,
                  fontSize: "12px",
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "#f8fafc",
                      textAlign: "left",
                      color: "#475569",
                      fontWeight: 700,
                    }}
                  >
                    <th style={{ padding: "8px 10px", width: "30px", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>#</th>
                    <th style={{ padding: "8px 10px", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Product Description</th>
                    <th style={{ padding: "8px 10px", width: "110px", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Item Code</th>
                    <th style={{ padding: "8px 10px", width: "90px", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>HSN</th>
                    <th style={{ padding: "8px 10px", width: "100px", textAlign: "right", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Quantity</th>
                    <th style={{ padding: "8px 10px", width: "110px", textAlign: "right", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Unit Rate ({currencySymbol})</th>
                    <th style={{ padding: "8px 10px", width: "70px", textAlign: "right", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Tax %</th>
                    <th style={{ padding: "8px 10px", width: "90px", textAlign: "right", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Tax ({currencySymbol})</th>
                    <th style={{ padding: "8px 10px", width: "110px", textAlign: "right", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Total ({currencySymbol})</th>
                    <th style={{ padding: "8px 10px", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Remarks / Notes</th>
                    <th style={{ padding: "8px 10px", width: "40px", textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Act</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={11} style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>
                        <div style={{ fontSize: "24px", marginBottom: "6px" }}>📦</div>
                        <div style={{ fontWeight: 600, color: "#475569" }}>No items loaded yet</div>
                        <div style={{ fontSize: "11px", marginTop: "4px" }}>
                          Select a Consignment Column above and click <strong>Auto-Load</strong>, or search for products to add.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    items.map((item, idx) => (
                      <tr
                        key={item.id || idx}
                        data-row-index={idx}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          backgroundColor: invalidRateIds.has(idx)
                            ? "#fff1f2"
                            : idx % 2 === 0
                            ? "#ffffff"
                            : "#fcfdfe",
                          transition: "background-color 0.3s",
                        }}
                      >
                        <td style={{ padding: "6px 10px", color: "#94a3b8" }}>{idx + 1}</td>
                        <td style={{ padding: "6px 10px" }}>
                          <input
                            type="text"
                            value={item.product_name}
                            onChange={(e) => updateItem(idx, "product_name", e.target.value)}
                            style={{
                              width: "100%",
                              padding: "4px 6px",
                              borderRadius: "4px",
                              border: "1px solid #cbd5e1",
                              fontSize: "12px",
                              fontWeight: 600,
                              boxSizing: "border-box",
                            }}
                            required
                          />
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <input
                            type="text"
                            value={item.product_code || ""}
                            onChange={(e) => updateItem(idx, "product_code", e.target.value)}
                            style={{
                              width: "100%",
                              padding: "4px 6px",
                              borderRadius: "4px",
                              border: "1px solid #cbd5e1",
                              fontSize: "12px",
                              boxSizing: "border-box",
                            }}
                          />
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <input
                            type="text"
                            value={item.hsn_code || ""}
                            onChange={(e) => updateItem(idx, "hsn_code", e.target.value)}
                            style={{
                              width: "100%",
                              padding: "4px 6px",
                              borderRadius: "4px",
                              border: "1px solid #cbd5e1",
                              fontSize: "12px",
                              boxSizing: "border-box",
                            }}
                          />
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <input
                            type="number"
                            step="any"
                            min="0.01"
                            value={item.quantity}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)}
                            style={{
                              width: "100%",
                              padding: "4px 6px",
                              borderRadius: "4px",
                              border: "1px solid #cbd5e1",
                              fontSize: "12px",
                              textAlign: "right",
                              fontWeight: 700,
                              boxSizing: "border-box",
                            }}
                            required
                          />
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={item.unit_rate}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              updateItem(idx, "unit_rate", val);
                              // Auto-clear row highlight once user fixes the rate
                              if (val > 0 && invalidRateIds.has(idx)) {
                                setInvalidRateIds((prev) => {
                                  const next = new Set(prev);
                                  next.delete(idx);
                                  return next;
                                });
                              }
                            }}
                            style={{
                              width: "100%",
                              padding: "4px 6px",
                              borderRadius: "4px",
                              border: invalidRateIds.has(idx)
                                ? "1.5px solid #ef4444"
                                : "1px solid #cbd5e1",
                              fontSize: "12px",
                              textAlign: "right",
                              boxSizing: "border-box",
                            }}
                          />
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={item.tax_percent}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => updateItem(idx, "tax_percent", parseFloat(e.target.value) || 0)}
                            style={{
                              width: "100%",
                              padding: "4px 6px",
                              borderRadius: "4px",
                              border: "1px solid #cbd5e1",
                              fontSize: "12px",
                              textAlign: "right",
                              boxSizing: "border-box",
                            }}
                          />
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "right", color: "#64748b" }}>
                          {Number(item.tax_amount).toFixed(2)}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                          {Number(item.item_total).toFixed(2)}
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <input
                            type="text"
                            placeholder="e.g. Mum branch note"
                            value={item.remarks || ""}
                            onChange={(e) => updateItem(idx, "remarks", e.target.value)}
                            style={{
                              width: "100%",
                              padding: "4px 6px",
                              borderRadius: "4px",
                              border: "1px solid #cbd5e1",
                              fontSize: "12px",
                              boxSizing: "border-box",
                            }}
                          />
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#ef4444",
                              fontSize: "15px",
                              cursor: "pointer",
                              padding: "2px 6px",
                            }}
                            title="Remove this item"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {items.length > 0 && (
                  <tfoot>
                    <tr
                      style={{
                        background: "#f8fafc",
                        fontWeight: 700,
                        position: "sticky",
                        bottom: 0,
                        zIndex: 10,
                        boxShadow: "0 -2px 4px rgba(0,0,0,0.05)",
                      }}
                    >
                      <td colSpan={4} style={{ padding: "8px 10px", textAlign: "right", borderTop: "2px solid #cbd5e1" }}>
                        Totals:
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: "#0f172a", borderTop: "2px solid #cbd5e1" }}>
                        {totals.qty.toLocaleString()}
                      </td>
                      <td colSpan={2} style={{ borderTop: "2px solid #cbd5e1" }}></td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: "#64748b", borderTop: "2px solid #cbd5e1" }}>
                        {currencySymbol} {totals.tax.toFixed(2)}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: "#1d4ed8", fontSize: "13px", borderTop: "2px solid #cbd5e1" }}>
                        {currencySymbol} {totals.grand.toFixed(2)}
                      </td>
                      <td colSpan={2} style={{ borderTop: "2px solid #cbd5e1" }}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Card 4: Financial Rollup & Remarks */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "16px",
              marginBottom: "24px",
            }}
          >
            {/* Remarks */}
            <div
              style={{
                background: "#ffffff",
                borderRadius: "8px",
                border: "1px solid #e2e8f0",
                padding: "16px",
              }}
            >
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                Order Remarks / Internal Notes
              </label>
              <textarea
                rows={4}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Add special instructions, container dispatch notes, or buyer requirements..."
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Summary Totals */}
            <div
              style={{
                background: "#eff6ff",
                borderRadius: "8px",
                border: "1px solid #bfdbfe",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e40af", textTransform: "uppercase", marginBottom: "10px" }}>
                  Invoice Valuation Summary
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#334155", marginBottom: "6px" }}>
                  <span>Basic Line Value:</span>
                  <span>{currencySymbol} {totals.basic.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#334155", marginBottom: "6px" }}>
                  <span>Total Tax / VAT:</span>
                  <span>{currencySymbol} {totals.tax.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#334155", marginBottom: "6px" }}>
                  <span>Total Quantity:</span>
                  <span>{totals.qty.toLocaleString()} pcs</span>
                </div>
              </div>

              <div
                style={{
                  borderTop: "1px solid #93c5fd",
                  paddingTop: "10px",
                  marginTop: "10px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#1e3a8a" }}>
                  Grand Total ({currency}):
                </span>
                <span style={{ fontSize: "20px", fontWeight: 800, color: "#1e3a8a" }}>
                  {currencySymbol} {totals.grand.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* Bottom Save Buttons */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
              paddingBottom: "40px",
            }}
          >
            <Link
              to="/sale/process"
              style={{
                padding: "10px 18px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#475569",
                fontSize: "13px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: "10px 24px",
                borderRadius: "6px",
                border: "none",
                background: "#0061f2",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 600,
                cursor: submitting ? "wait" : "pointer",
                boxShadow: "0 2px 4px rgba(0,97,242,0.25)",
              }}
            >
              {submitting ? "Saving..." : isEdit ? "Update Sale Order" : "Save Sale Order"}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
