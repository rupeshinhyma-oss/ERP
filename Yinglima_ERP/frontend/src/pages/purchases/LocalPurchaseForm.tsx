/**
 * Local Purchase Add / Edit Form Page.
 *
 * Features:
 * - Cascading Organization & Branch dropdowns (replaces plain Warehouse)
 * - Single "Invoice Total Value with VAT" in RMB (¥) default
 * - Automated Bill Data Extraction for PDF and Excel (.xlsx, .csv)
 * - Value-Based (VB) proportional landing expense engine
 * - Product Master autocomplete search & HSN/VAT auto-inheritance
 * - Real-time reconciliation banner (compares entered invoice total vs item lines)
 * - Fully styled with ERP native design tokens & vanilla CSS (zero unstyled Tailwind dependencies)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { apiGet, apiPatch, apiPost, apiPostMultipart, errorMessage } from "@/lib/api";
import { useLookup } from "@/lib/lookups";
import { useToast } from "@/lib/toast";
import type { LocalPurchaseDetail, LocalPurchaseItem } from "@/types/localPurchase";

export function LocalPurchaseFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const toast = useToast();

  // Form Fields
  const [organizationId, setOrganizationId] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [branchName, setBranchName] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState("RMB");
  const [invoiceTotalValue, setInvoiceTotalValue] = useState<number | "">("");

  // Expenses
  const [packingForwarding, setPackingForwarding] = useState<number | "">("");
  const [transportExpense, setTransportExpense] = useState<number | "">("");
  const [offloadingExpense, setOffloadingExpense] = useState<number | "">("");
  const [otherExpense, setOtherExpense] = useState<number | "">("");

  // Remarks & Status
  const [remarks, setRemarks] = useState("");
  const [status, setStatus] = useState("Confirmed");

  // Validation state (Product Master visual styling)
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Line items
  const [items, setItems] = useState<LocalPurchaseItem[]>([]);

  // Shipment Planning Auto-Fetch State
  const [planningLoading, setPlanningLoading] = useState(false);
  const [planningInfo, setPlanningInfo] = useState<{
    sheetName: string;
    count: number;
    items: LocalPurchaseItem[];
  } | null>(null);
  const lastFetchedPlanningKeyRef = useRef<string>("");

  // Bill file extraction
  const [billFile, setBillFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Product Search state
  const [productSearch, setProductSearch] = useState("");
  const [productSearchResults, setProductSearchResults] = useState<
    Array<{ id: string; product_name: string; product_code?: string; hsn_id?: string; hsn_code?: string; refund_vat_percent?: number; standard_cost?: number }>
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [initialLoading, setInitialLoading] = useState(isEdit);

  // Lookups
  const orgLookup = useLookup<{ id: string; name: string; branches?: { id: string; name: string }[] | null }>(
    "/masters/company-list/lookup",
    250
  );
  const supplierLookup = useLookup<{ id: string; company_name: string }>(
    "/suppliers?page_size=1000",
    500
  );
  const hsnLookup = useLookup<{ id: string; code: string }>("/masters/hsn", 500);
  const productLookup = useLookup<{
    id: string;
    product_name: string;
    product_code?: string;
    hsn_id?: string;
    hsn_code?: string;
    refund_vat_percent?: number;
    standard_cost?: number;
    organization_id?: string;
    organization_ids?: string[];
  }>("/masters/products", 1000);

  // Dynamic branches based on selected Organization
  const availableBranches = useMemo(() => {
    if (!organizationId || !orgLookup.items) return [];
    const org = orgLookup.items.find((o: { id: string; name: string }) => o.id === organizationId);
    return org?.branches || [];
  }, [organizationId, orgLookup.items]);

  // Load existing purchase for Edit mode
  useEffect(() => {
    if (!isEdit || !id) return;
    const loadPurchase = async () => {
      setInitialLoading(true);
      try {
        const { data } = await apiGet<LocalPurchaseDetail>(`/purchases/local/${id}`);
        if (data) {
          setOrganizationId(data.organization_id);
          setOrganizationName(data.organization_name);
          setBranchId(data.branch_id);
          setBranchName(data.branch_name);
          setSupplierId(data.supplier_id);
          setSupplierName(data.supplier_name);
          setInvoiceNo(data.invoice_no);
          setInvoiceDate(data.invoice_date);
          setCurrency(data.currency || "RMB");
          setInvoiceTotalValue(data.invoice_total_value);
          setPackingForwarding(data.total_expenses ? (data as any).packing_forwarding || "" : "");
          setTransportExpense((data as any).transport_expense || "");
          setOffloadingExpense((data as any).offloading_expense || "");
          setOtherExpense((data as any).other_expense || "");
          setRemarks(data.remarks || "");
          setStatus(data.status || "Confirmed");
          setItems(data.items || []);
        }
      } catch (err) {
        toast(errorMessage(err), "error");
      } finally {
        setInitialLoading(false);
      }
    };
    loadPurchase();
  }, [id, isEdit, toast]);

  // Handle Organization selection with item reset warning & error clearance
  // Handle Organization selection with auto item reset & error clearance
  const handleSelectOrg = (orgId: string) => {
    setOrganizationId(orgId);
    const org = orgLookup.items?.find((o: { id: string; name: string }) => o.id === orgId);
    setOrganizationName(org?.name || "");
    // Reset branch
    setBranchId("");
    setBranchName("");
    // Reset items and planning info so previous items don't linger across organizations
    setItems([]);
    setPlanningInfo(null);
    lastFetchedPlanningKeyRef.current = "";
    // Reset all validation errors so previous errors don't linger
    setSubmitAttempted(false);
    setErrors({});
  };

  // Handle Branch selection with auto item reset & error clearance
  const handleSelectBranch = (brId: string) => {
    setBranchId(brId);
    const br = availableBranches.find((b: { id: string; name: string }) => b.id === brId);
    setBranchName(br?.name || "");
    // Reset items and planning info so previous branch items don't linger
    setItems([]);
    setPlanningInfo(null);
    lastFetchedPlanningKeyRef.current = "";
    // Reset all validation errors so previous errors don't linger
    setSubmitAttempted(false);
    setErrors({});
  };

  // Handle Supplier selection with auto item reset & error clearance
  const handleSelectSupplier = (supId: string) => {
    setSupplierId(supId);
    const sup = supplierLookup.items?.find((s: { id: string; company_name: string }) => s.id === supId);
    setSupplierName(sup?.company_name || "");
    // Reset items and planning info so previous supplier items don't linger
    setItems([]);
    setPlanningInfo(null);
    lastFetchedPlanningKeyRef.current = "";
    // Reset all validation errors so previous errors don't linger
    setSubmitAttempted(false);
    setErrors({});
  };

  // Auto-fetch planned items from Shipment Planning for selected Org, Branch & Supplier
  useEffect(() => {
    if (isEdit) return;
    if (!organizationId || (!branchId && !branchName) || (!supplierId && !supplierName)) {
      setPlanningInfo(null);
      return;
    }

    const key = `${organizationId}_${branchId || branchName}_${supplierId || supplierName}`;
    if (key === lastFetchedPlanningKeyRef.current) return;
    lastFetchedPlanningKeyRef.current = key;

    const fetchPlanningItems = async () => {
      setPlanningLoading(true);
      try {
        const queryParams = new URLSearchParams({
          organization_id: organizationId,
          branch_id: branchId || "",
          branch_name: branchName || "",
          supplier_name: supplierName || "",
          supplier_id: supplierId || "",
        });
        const res = await apiGet<{
          items: LocalPurchaseItem[];
          sheet_name: string;
          count: number;
          message?: string;
        }>(`/purchases/local/planning-items?${queryParams.toString()}`);

        if (res.data && res.data.count > 0) {
          const plannedItems = res.data.items;
          const sheetName = res.data.sheet_name;
          const count = res.data.count;

          setPlanningInfo({ sheetName, count, items: plannedItems });
          setItems(plannedItems);
          // Clear any stale errors from previous supplier
          setSubmitAttempted(false);
          setErrors({});
          toast(`✨ Auto-populated ${count} planned product(s) for ${supplierName || "supplier"} from ${sheetName}`, "info");
        } else {
          const sheetName = res.data?.sheet_name || branchName || "Shipment Planning";
          setPlanningInfo({ sheetName, count: 0, items: [] });
          setItems([]);
          if (supplierName) {
            toast(`ℹ️ No planned products found for ${supplierName} in ${sheetName}.`, "info");
          }
        }
      } catch (err) {
        console.error("Failed to fetch shipment planning items:", err);
        setPlanningInfo(null);
        setItems([]);
      } finally {
        setPlanningLoading(false);
      }
    };

    fetchPlanningItems();
  }, [organizationId, branchId, branchName, supplierId, supplierName, isEdit, toast]);

  const handleLoadPlannedProducts = () => {
    if (!planningInfo || planningInfo.items.length === 0) return;
    setItems(planningInfo.items);
    setSubmitAttempted(false);
    setErrors({});
    toast(`Loaded ${planningInfo.count} planned items from ${planningInfo.sheetName}`, "success");
  };

  // Close search dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Products filtered strictly by selected Organization (Zero NULL leaks)
  const availableProducts = useMemo(() => {
    const allProds = productLookup.items || [];
    if (!organizationId) return []; // STRICT: Return empty if no organization selected!
    return allProds.filter((p: any) => {
      if (p.organization_id && p.organization_id === organizationId) return true;
      if (Array.isArray(p.organization_ids) && p.organization_ids.includes(organizationId)) return true;
      return false;
    });
  }, [productLookup.items, organizationId]);

  // Instant client-side search across availableProducts (0ms latency)
  const displayedSearchResults = useMemo(() => {
    if (!organizationId) return [];
    const q = productSearch.trim().toLowerCase();
    if (!q) {
      return availableProducts.slice(0, 35);
    }
    return availableProducts
      .filter((p: any) => {
        const name = (p.product_name || p.product_name_tally || "").toLowerCase();
        const code = (p.product_code || "").toLowerCase();
        const barcode = (p.barcode || "").toLowerCase();
        return name.includes(q) || code.includes(q) || barcode.includes(q);
      })
      .slice(0, 40);
  }, [availableProducts, productSearch, organizationId]);

  // Background fallback search for queries not matched in local cache (strictly scoped to org)
  useEffect(() => {
    const query = productSearch.trim();
    if (!query || !organizationId || displayedSearchResults.length > 0) {
      setProductSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const orgParam = `organization_id=${encodeURIComponent(organizationId)}&`;
        const { data } = await apiGet<any>(
          `/masters/products?${orgParam}search=${encodeURIComponent(query)}&page=1&page_size=20&status=active`
        );
        const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
        setProductSearchResults(
          list.map((it: any) => ({
            id: it.id,
            product_name: it.product_name || it.product_name_tally || "Unnamed Product",
            product_code: it.product_code,
            hsn_id: it.hsn_id,
            hsn_code: it.hsn_code,
            refund_vat_percent: it.refund_vat_percent,
            standard_cost: it.standard_cost,
          }))
        );
      } catch {
        // quiet error
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [productSearch, organizationId, displayedSearchResults.length]);

  const finalSearchResults = useMemo(() => {
    if (displayedSearchResults.length > 0) return displayedSearchResults;
    return productSearchResults;
  }, [displayedSearchResults, productSearchResults]);

  // Add Product to line items
  const handleAddProduct = (prod: {
    id: string;
    product_name: string;
    product_code?: string;
    hsn_id?: string;
    hsn_code?: string;
    refund_vat_percent?: number;
    standard_cost?: number;
  }) => {
    if (!organizationId) {
      toast("Please select an Organization first in Card 1.", "warning");
      return;
    }
    const resolvedHsn =
      prod.hsn_code ||
      (prod.hsn_id ? hsnLookup.items?.find((h) => h.id === prod.hsn_id)?.code : undefined) ||
      null;

    const newItem: LocalPurchaseItem = {
      product_id: prod.id,
      product_name: prod.product_name,
      product_code: prod.product_code || null,
      hsn_code: resolvedHsn,
      quantity: 1,
      unit_rate: prod.standard_cost && prod.standard_cost > 0 ? prod.standard_cost : 0,
      vat_rate: prod.refund_vat_percent !== undefined && prod.refund_vat_percent !== null ? Number(prod.refund_vat_percent) : 0,
      item_total: 0,
      vat_amount: 0,
      expense_per_unit: 0,
      unit_landing_rate: 0,
      total_landing_rate: 0,
    };
    setItems((prev) => {
      // If there is currently only 1 row and it is completely blank (no product name and 0 unit rate), replace it
      if (prev.length === 1 && !prev[0].product_name && (!prev[0].unit_rate || prev[0].unit_rate === 0)) {
        return [newItem];
      }
      return [...prev, newItem];
    });
    setProductSearch("");
    setShowSearchResults(false);
    if (errors.items) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.items;
        return next;
      });
    }
  };

  // Remove Item Row
  const handleRemoveItem = (index: number) => {
    setItems((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      const invalid = next.filter((it) => !it.unit_rate || Number(it.unit_rate) <= 0);
      if (invalid.length === 0) {
        setErrors((errs) => {
          const e = { ...errs };
          delete e.unit_rates;
          delete e.discrepancy;
          return e;
        });
      }
      return next;
    });
  };

  // Item Field Change with Auto-strip leading zeros on direct typing
  const handleItemChange = (
    index: number,
    field: keyof LocalPurchaseItem,
    value: string | number | null | undefined
  ) => {
    let cleanVal = value;
    if (typeof value === "string" && (field === "unit_rate" || field === "quantity" || field === "vat_rate")) {
      // When typing over 0 (e.g. "05"), automatically strip leading zeros unless decimal (e.g. "0.5")
      if (value.length > 1 && value.startsWith("0") && !value.startsWith("0.")) {
        cleanVal = value.replace(/^0+/, "") || "0";
      }
    }
    setItems((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: cleanVal,
      };

      // When unit_rate is updated, re-evaluate unit_rates error dynamically
      if (field === "unit_rate") {
        const anyInvalid = next.some((it) => !it.unit_rate || Number(it.unit_rate) <= 0);
        setErrors((errs) => {
          const e = { ...errs };
          if (!anyInvalid) {
            delete e.unit_rates;
          }
          delete e.discrepancy;
          return e;
        });
      }

      return next;
    });
  };


  // ==========================================
  // Value-Based (VB) Landing Cost Calculations
  // ==========================================
  const calculations = useMemo(() => {
    const pack = Number(packingForwarding) || 0;
    const trans = Number(transportExpense) || 0;
    const offload = Number(offloadingExpense) || 0;
    const other = Number(otherExpense) || 0;
    const totalExpenses = pack + trans + offload + other;

    // 1. Calculate base item totals
    let itemsTotalBasic = 0;
    let itemsTotalVat = 0;
    let totalQuantity = 0;

    const baseCalculations = items.map((it) => {
      const qty = Number(it.quantity) || 0;
      const rate = Number(it.unit_rate) || 0;
      const vatRate = Number(it.vat_rate) || 0;

      const basicItemTotal = Number((qty * rate).toFixed(2));
      const vatAmount = Number(((basicItemTotal * vatRate) / 100).toFixed(2));
      const grossItemTotal = Number((basicItemTotal + vatAmount).toFixed(2));

      itemsTotalBasic += basicItemTotal;
      itemsTotalVat += vatAmount;
      totalQuantity += qty;

      return {
        ...it,
        quantity: qty,
        unit_rate: rate,
        vat_rate: vatRate,
        item_total: basicItemTotal,
        vat_amount: vatAmount,
        gross_total: grossItemTotal,
      };
    });

    itemsTotalBasic = Number(itemsTotalBasic.toFixed(2));
    itemsTotalVat = Number(itemsTotalVat.toFixed(2));
    const itemsTotalGross = Number((itemsTotalBasic + itemsTotalVat).toFixed(2));

    // 2. Value-Based Expense Ratio
    const expenseRatio = itemsTotalBasic > 0 ? totalExpenses / itemsTotalBasic : 0;
    const loadingExpensePct = Number((expenseRatio * 100).toFixed(2));

    // 3. Distribute expenses proportionally
    let itemsTotalLanding = 0;
    const calculatedItems = baseCalculations.map((it) => {
      const expensePerUnit = Number((it.unit_rate * expenseRatio).toFixed(2));
      const unitLandingRate = Number((it.unit_rate + expensePerUnit).toFixed(2));
      const totalLandingRate = Number((it.quantity * unitLandingRate).toFixed(2));

      itemsTotalLanding += totalLandingRate;

      return {
        ...it,
        expense_per_unit: expensePerUnit,
        unit_landing_rate: unitLandingRate,
        total_landing_rate: totalLandingRate,
      };
    });

    itemsTotalLanding = Number(itemsTotalLanding.toFixed(2));

    return {
      totalExpenses,
      itemsTotalBasic,
      itemsTotalVat,
      itemsTotalGross,
      loadingExpensePct,
      itemsTotalLanding,
      totalQuantity,
      calculatedItems,
    };
  }, [packingForwarding, transportExpense, offloadingExpense, otherExpense, items]);

  // Smart Reconciliation Check
  const invoiceDiff = useMemo(() => {
    if (invoiceTotalValue === "") return null;
    const invVal = Number(invoiceTotalValue);
    const diff = Number((invVal - calculations.itemsTotalGross).toFixed(2));
    return diff;
  }, [invoiceTotalValue, calculations.itemsTotalGross]);

  // Bill Extraction (PDF & Excel)
  const handleExtractBill = async () => {
    if (!billFile) {
      toast("Please choose a PDF or Excel bill file first.", "warning");
      return;
    }
    setExtracting(true);
    try {
      const formData = new FormData();
      formData.append("file", billFile);

      const res = await apiPostMultipart<any>("/purchases/local/extract-bill", formData);
      if (res.data) {
        const d = res.data;
        if (d.supplier_id) {
          setSupplierId(d.supplier_id);
          setSupplierName(d.supplier_name || "");
        } else if (d.supplier_name && !supplierId) {
          const match = supplierLookup.items?.find((s: { id: string; company_name: string }) =>
            s.company_name.toLowerCase().includes(d.supplier_name.toLowerCase())
          );
          if (match) {
            setSupplierId(match.id);
            setSupplierName(match.company_name);
          }
        }

        if (d.invoice_no) setInvoiceNo(d.invoice_no);
        if (d.invoice_date) setInvoiceDate(d.invoice_date);
        if (d.currency) setCurrency(d.currency);
        if (d.invoice_total_value) setInvoiceTotalValue(d.invoice_total_value);

        if (d.items && d.items.length > 0) {
          const newRows: LocalPurchaseItem[] = d.items.map((it: any) => ({
            product_id: it.matched_product_id || null,
            product_name: it.product_name || "Item",
            product_code: it.product_code || null,
            hsn_code: it.hsn_code || null,
            quantity: it.quantity || 1,
            unit_rate: it.unit_rate || 0,
            vat_rate: it.vat_rate !== undefined ? it.vat_rate : 13,
            item_total: Number((it.quantity * it.unit_rate).toFixed(2)),
            vat_amount: 0,
            expense_per_unit: 0,
            unit_landing_rate: it.unit_rate || 0,
            total_landing_rate: Number((it.quantity * it.unit_rate).toFixed(2)),
          }));
          setItems(newRows);
        }

        toast(
          `Extracted ${d.items?.length || 0} items from bill successfully!`,
          "success"
        );
      }
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setExtracting(false);
    }
  };

  // Comprehensive Form Validation (Product Master Visual Style)
  const validateForm = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!organizationId) {
      errs.organization_id = "Organization is required.";
    }
    if (!branchId) {
      errs.branch_id = "Operating Branch is required.";
    }
    if (!supplierId) {
      errs.supplier_id = "Supplier is required.";
    }
    if (!invoiceNo.trim()) {
      errs.invoice_no = "Invoice Number is required.";
    }
    if (!invoiceDate) {
      errs.invoice_date = "Invoice Date is required.";
    }
    if (invoiceTotalValue === "" || Number(invoiceTotalValue) <= 0) {
      errs.invoice_total_value = "Invoice Total Value must be greater than 0.";
    }
    if (items.length === 0) {
      errs.items = "At least one product item is required.";
    } else {
      const invalidItems = items
        .map((it, idx) => ({ ...it, rowNum: idx + 1 }))
        .filter((it) => !it.unit_rate || Number(it.unit_rate) <= 0);
      if (invalidItems.length > 0) {
        errs.unit_rates = `Unit Rate must be greater than 0 for all items. Please check row(s): ${invalidItems
          .map((inv) => `#${inv.rowNum} (${inv.product_name || "Custom Product"})`)
          .join(", ")}.`;
      }
    }

    // Strict Invoice Reconciliation check: Block if any mismatch
    if (invoiceTotalValue !== "") {
      const diff = Math.abs(Number(invoiceTotalValue) - calculations.itemsTotalGross);
      if (diff > 0.05) {
        errs.discrepancy = `Invoice reconciliation discrepancy of ${currencySymbol} ${diff.toFixed(
          2
        )} detected. Entered Total (${currencySymbol} ${Number(invoiceTotalValue).toFixed(
          2
        )}) does not match Line Items Total with VAT (${currencySymbol} ${calculations.itemsTotalGross.toFixed(
          2
        )}). Please balance the line items before submitting.`;
      }
    }

    return errs;
  };

  // Form Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);

    const validationErrors = validateForm();
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      const firstError = Object.values(validationErrors)[0];
      toast(firstError, "warning");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        organization_id: organizationId,
        organization_name: organizationName,
        branch_id: branchId,
        branch_name: branchName,
        supplier_id: supplierId,
        supplier_name: supplierName,
        invoice_no: invoiceNo.trim(),
        invoice_date: invoiceDate,
        currency: currency,
        invoice_total_value: Number(invoiceTotalValue),
        packing_forwarding: Number(packingForwarding) || 0,
        transport_expense: Number(transportExpense) || 0,
        offloading_expense: Number(offloadingExpense) || 0,
        other_expense: Number(otherExpense) || 0,
        remarks: remarks.trim() || null,
        status: status,
        items: calculations.calculatedItems.map((it) => ({
          id: it.id,
          product_id: it.product_id,
          product_name: it.product_name,
          product_code: it.product_code,
          hsn_code: it.hsn_code,
          quantity: it.quantity,
          unit_rate: it.unit_rate,
          vat_rate: it.vat_rate,
        })),
      };

      if (isEdit && id) {
        await apiPatch(`/purchases/local/${id}`, payload);
        toast("Local purchase updated successfully!", "success");
      } else {
        await apiPost("/purchases/local", payload);
        toast("Local purchase created successfully!", "success");
      }

      navigate("/purchase/local");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSubmitting(false);
    }
  };

  const currencySymbol = currency === "RMB" ? "¥" : currency === "INR" ? "₹" : "$";

  if (initialLoading) {
    return (
      <AppShell activeKey="local-purchases">
        <main className="page" style={{ textAlign: "center", padding: "80px 20px", color: "#64748b" }}>
          <div style={{ fontSize: "24px", marginBottom: "12px" }}>⏳</div>
          <div style={{ fontSize: "15px", fontWeight: 600 }}>Loading purchase details...</div>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell activeKey="local-purchases">
      <main className="page" style={{ width: "100%", padding: "16px 24px", boxSizing: "border-box" }}>
        <form onSubmit={handleSubmit} noValidate>
          {/* Header Breadcrumb & Back Navigation */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <Breadcrumb trail={["Purchase", "Local Purchase", isEdit ? "Edit Purchase" : "Add Purchase"]} />
              <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", margin: "4px 0 0 0" }}>
                {isEdit ? `Edit Local Purchase: ${invoiceNo || "Invoice"}` : "New Local Purchase Order"}
              </h1>
            </div>
            <Link
              to="/purchase/local"
              className="btn btn-secondary"
              style={{
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                padding: "8px 16px",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "13px",
                color: "#475569",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                textDecoration: "none",
              }}
            >
              ← BACK TO LIST
            </Link>
          </div>

          {/* Top Validation Error Banner (Product Master visual styling) */}
          {submitAttempted && Object.keys(errors).length > 0 && (
            <div
              style={{
                background: "#fef2f2",
                border: "1.5px solid #ef4444",
                borderRadius: "8px",
                padding: "14px 18px",
                marginBottom: "16px",
                color: "#991b1b",
                boxShadow: "0 2px 6px rgba(239, 68, 68, 0.12)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "14px", marginBottom: "6px" }}>
                <span>⚠️</span> Please fix the required field errors before saving:
              </div>
              <ul style={{ margin: "4px 0 0 20px", padding: 0, fontSize: "12.5px", lineHeight: "1.6" }}>
                {Object.entries(errors).map(([key, msg]) => (
                  <li key={key}>{msg}</li>
                ))}
              </ul>
            </div>
          )}

          {/* CARD 1: Procurement & Billing Essentials */}
          <div
            className="card"
            style={{
              background: "#ffffff",
              padding: "24px",
              borderRadius: "10px",
              border: "1px solid #cbd5e1",
              marginBottom: "16px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", marginBottom: "16px", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#0061f2" }}>🏢</span> Procurement & Organization Essentials
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "16px" }}>
              {/* 1. Organization List (Replaces plain warehouse) */}
              <div>
                <label style={{ fontSize: "12.5px", fontWeight: 700, color: "#334155", marginBottom: "6px", display: "block" }}>
                  Organization List <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <select
                  value={organizationId}
                  onChange={(e) => handleSelectOrg(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: errors.organization_id ? "1.5px solid #ef4444" : "1px solid #cbd5e1",
                    boxShadow: errors.organization_id ? "0 0 0 3px rgba(239, 68, 68, 0.15)" : undefined,
                    background: errors.organization_id ? "#fff5f5" : "#ffffff",
                    fontSize: "13px",
                    color: "#0f172a",
                    fontWeight: 500,
                  }}
                >
                  <option value="">Select Organization</option>
                  {orgLookup.items?.map((org: { id: string; name: string }) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
                {errors.organization_id ? (
                  <div style={{ color: "#dc2626", fontSize: "11.5px", fontWeight: 600, marginTop: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>▲</span> {errors.organization_id}
                  </div>
                ) : (
                  <span style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px", display: "block" }}>
                    Master enterprise operating entity
                  </span>
                )}
              </div>

              {/* 2. Branch of Organization (Dynamically populated) */}
              <div>
                <label style={{ fontSize: "12.5px", fontWeight: 700, color: "#334155", marginBottom: "6px", display: "block" }}>
                  Branch <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <select
                  value={branchId}
                  onChange={(e) => handleSelectBranch(e.target.value)}
                  disabled={!organizationId || availableBranches.length === 0}
                  required
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: errors.branch_id ? "1.5px solid #ef4444" : "1px solid #cbd5e1",
                    boxShadow: errors.branch_id ? "0 0 0 3px rgba(239, 68, 68, 0.15)" : undefined,
                    fontSize: "13px",
                    background: errors.branch_id ? "#fff5f5" : !organizationId ? "#f8fafc" : "#ffffff",
                    color: !organizationId ? "#94a3b8" : "#0f172a",
                    fontWeight: 500,
                  }}
                >
                  <option value="">{organizationId ? "Select Branch" : "Select Org first"}</option>
                  {availableBranches.map((br: { id: string; name: string }) => (
                    <option key={br.id} value={br.id}>
                      {br.name}
                    </option>
                  ))}
                </select>
                {errors.branch_id ? (
                  <div style={{ color: "#dc2626", fontSize: "11.5px", fontWeight: 600, marginTop: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>▲</span> {errors.branch_id}
                  </div>
                ) : (
                  <span style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px", display: "block" }}>
                    Receiving location / operating branch
                  </span>
                )}
              </div>

              {/* 3. Supplier */}
              <div>
                <label style={{ fontSize: "12.5px", fontWeight: 700, color: "#334155", marginBottom: "6px", display: "block" }}>
                  Supplier <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <select
                  value={supplierId}
                  onChange={(e) => handleSelectSupplier(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: errors.supplier_id ? "1.5px solid #ef4444" : "1px solid #cbd5e1",
                    boxShadow: errors.supplier_id ? "0 0 0 3px rgba(239, 68, 68, 0.15)" : undefined,
                    background: errors.supplier_id ? "#fff5f5" : "#ffffff",
                    fontSize: "13px",
                    color: "#0f172a",
                    fontWeight: 500,
                  }}
                >
                  <option value="">Select Supplier</option>
                  {supplierLookup.items?.map((sup: { id: string; company_name: string }) => (
                    <option key={sup.id} value={sup.id}>
                      {sup.company_name}
                    </option>
                  ))}
                </select>
                {errors.supplier_id ? (
                  <div style={{ color: "#dc2626", fontSize: "11.5px", fontWeight: 600, marginTop: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>▲</span> {errors.supplier_id}
                  </div>
                ) : (
                  <span style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px", display: "block" }}>
                    Domestic factory / vendor
                  </span>
                )}
              </div>

              {/* 4. Invoice No */}
              <div>
                <label style={{ fontSize: "12.5px", fontWeight: 700, color: "#334155", marginBottom: "6px", display: "block" }}>
                  Invoice No <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. INV-2026/089"
                  value={invoiceNo}
                  onChange={(e) => {
                    setInvoiceNo(e.target.value);
                    if (e.target.value.trim() && errors.invoice_no) {
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.invoice_no;
                        return next;
                      });
                    }
                  }}
                  required
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: errors.invoice_no ? "1.5px solid #ef4444" : "1px solid #cbd5e1",
                    boxShadow: errors.invoice_no ? "0 0 0 3px rgba(239, 68, 68, 0.15)" : undefined,
                    background: errors.invoice_no ? "#fff5f5" : "#ffffff",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
                {errors.invoice_no && (
                  <div style={{ color: "#dc2626", fontSize: "11.5px", fontWeight: 600, marginTop: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>▲</span> {errors.invoice_no}
                  </div>
                )}
              </div>

              {/* 5. Invoice Date */}
              <div>
                <label style={{ fontSize: "12.5px", fontWeight: 700, color: "#334155", marginBottom: "6px", display: "block" }}>
                  Invoice Date <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => {
                    setInvoiceDate(e.target.value);
                    if (e.target.value && errors.invoice_date) {
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.invoice_date;
                        return next;
                      });
                    }
                  }}
                  required
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: "6px",
                    border: errors.invoice_date ? "1.5px solid #ef4444" : "1px solid #cbd5e1",
                    boxShadow: errors.invoice_date ? "0 0 0 3px rgba(239, 68, 68, 0.15)" : undefined,
                    background: errors.invoice_date ? "#fff5f5" : "#ffffff",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
                {errors.invoice_date && (
                  <div style={{ color: "#dc2626", fontSize: "11.5px", fontWeight: 600, marginTop: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>▲</span> {errors.invoice_date}
                  </div>
                )}
              </div>
            </div>

            {/* Financial Details Row: Single Invoice Total Value with VAT, Bill Extraction */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(360px, 1.4fr)", gap: "20px", paddingTop: "14px", borderTop: "1px solid #f1f5f9", alignItems: "flex-end" }}>
              {/* Single Consolidated Field: Invoice Total Value with VAT */}
              <div>
                <label style={{ fontSize: "12.5px", fontWeight: 700, color: "#0f172a", marginBottom: "6px", display: "block" }}>
                  Invoice Total Value with VAT (RMB ¥) <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", fontWeight: 700, color: "#64748b", fontSize: "14px" }}>
                    {currencySymbol}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={invoiceTotalValue}
                    onChange={(e) => {
                      let v = e.target.value;
                      if (v.length > 1 && v.startsWith("0") && !v.startsWith("0.")) {
                        v = v.replace(/^0+/, "") || "0";
                      }
                      setInvoiceTotalValue(v === "" ? "" : Number(v));
                      if (Number(v) > 0 && errors.invoice_total_value) {
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next.invoice_total_value;
                          return next;
                        });
                      }
                    }}
                    onFocus={(e) => e.currentTarget.select()}
                    required
                    style={{
                      width: "100%",
                      padding: "8px 12px 8px 28px",
                      borderRadius: "6px",
                      border: errors.invoice_total_value ? "2px solid #ef4444" : "2px solid #94a3b8",
                      boxShadow: errors.invoice_total_value ? "0 0 0 3px rgba(239, 68, 68, 0.15)" : undefined,
                      background: errors.invoice_total_value ? "#fff5f5" : "#ffffff",
                      fontSize: "14px",
                      fontWeight: 700,
                      color: "#0f172a",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                {errors.invoice_total_value && (
                  <div style={{ color: "#dc2626", fontSize: "11.5px", fontWeight: 600, marginTop: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>▲</span> {errors.invoice_total_value}
                  </div>
                )}
              </div>

              {/* Bill File Upload & Extract Action */}
              <div>
                <label style={{ fontSize: "12.5px", fontWeight: 700, color: "#334155", marginBottom: "6px", display: "block" }}>
                  Bill Document File <span style={{ fontWeight: 400, color: "#64748b" }}>(PDF or Excel sheet)</span>
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.xlsx,.xls,.csv"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setBillFile(e.target.files[0]);
                        }
                      }}
                      style={{
                        width: "100%",
                        padding: "5px 10px",
                        fontSize: "12px",
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        background: "#f8fafc",
                        boxSizing: "border-box",
                      }}
                    />
                    {billFile && (
                      <button
                        type="button"
                        onClick={() => {
                          setBillFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        style={{
                          position: "absolute",
                          right: "6px",
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "none",
                          border: "none",
                          color: "#ef4444",
                          cursor: "pointer",
                          fontWeight: 700,
                          padding: "2px 4px",
                        }}
                        title="Clear file"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleExtractBill}
                    disabled={!billFile || extracting}
                    style={{
                      background: !billFile || extracting ? "#94a3b8" : "#f59e0b",
                      color: "#ffffff",
                      border: "none",
                      padding: "8px 14px",
                      borderRadius: "6px",
                      fontWeight: 700,
                      fontSize: "12.5px",
                      cursor: !billFile || extracting ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      whiteSpace: "nowrap",
                      boxShadow: !billFile || extracting ? "none" : "0 2px 4px rgba(245,158,11,0.25)",
                    }}
                  >
                    {extracting ? "⏳ Extracting..." : "⚡ Extract Bill Data"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* CARD 2: Value-Based (VB) Landing Expense Engine */}
          <div
            className="card"
            style={{
              background: "#ffffff",
              padding: "20px 24px",
              borderRadius: "10px",
              border: "1px solid #cbd5e1",
              marginBottom: "16px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", borderBottom: "1px solid #e2e8f0", paddingBottom: "8px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ color: "#0061f2" }}>⚓</span> EXPENSES (Value-Based Landing Cost Engine)
              </div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>
                Expenses are allocated proportionally based on basic line item values
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px", alignItems: "flex-end" }}>
              {/* Packing */}
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>
                  Packing & Forwarding ({currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={packingForwarding}
                  onChange={(e) => {
                    let v = e.target.value;
                    if (v.length > 1 && v.startsWith("0") && !v.startsWith("0.")) {
                      v = v.replace(/^0+/, "") || "0";
                    }
                    setPackingForwarding(v === "" ? "" : Number(v));
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>

              {/* Transport */}
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>
                  Transport / Freight ({currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={transportExpense}
                  onChange={(e) => {
                    let v = e.target.value;
                    if (v.length > 1 && v.startsWith("0") && !v.startsWith("0.")) {
                      v = v.replace(/^0+/, "") || "0";
                    }
                    setTransportExpense(v === "" ? "" : Number(v));
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>

              {/* Offloading */}
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>
                  Offloading Charges ({currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={offloadingExpense}
                  onChange={(e) => {
                    let v = e.target.value;
                    if (v.length > 1 && v.startsWith("0") && !v.startsWith("0.")) {
                      v = v.replace(/^0+/, "") || "0";
                    }
                    setOffloadingExpense(v === "" ? "" : Number(v));
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>

              {/* Other */}
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}>
                  Other Misc Charges ({currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={otherExpense}
                  onChange={(e) => {
                    let v = e.target.value;
                    if (v.length > 1 && v.startsWith("0") && !v.startsWith("0.")) {
                      v = v.replace(/^0+/, "") || "0";
                    }
                    setOtherExpense(v === "" ? "" : Number(v));
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>

              {/* Total Expenses Card */}
              <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: "8px", border: "1.5px solid #cbd5e1" }}>
                <span style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  Total All Expenses
                </span>
                <span style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
                  {currencySymbol} {calculations.totalExpenses.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {/* % Loading Expense Card */}
              <div style={{ background: "#eff6ff", padding: "10px 14px", borderRadius: "8px", border: "1.5px solid #bfdbfe" }}>
                <span style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#1e40af", textTransform: "uppercase" }}>
                  % Loading Expense (VB)
                </span>
                <span style={{ fontSize: "16px", fontWeight: 800, color: "#1d4ed8" }}>
                  {calculations.loadingExpensePct.toFixed(2)} %
                </span>
              </div>
            </div>
          </div>

          {/* CARD 3: PRODUCT SEARCH (Inhyma ERP Style) */}
          <div
            className="card"
            style={{
              background: "#ffffff",
              padding: "16px 20px",
              borderRadius: "10px",
              border: "1.5px solid #cbd5e1",
              marginBottom: "16px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                PRODUCT SEARCH
              </div>
              {organizationName ? (
                <div style={{ fontSize: "12px", color: "#0061f2", fontWeight: 600 }}>
                  Scoped to Organization: <strong>{organizationName}</strong>
                </div>
              ) : (
                <div style={{ fontSize: "12px", color: "#ef4444", fontWeight: 600 }}>
                  🔒 Organization Required First
                </div>
              )}
            </div>

            <div ref={searchContainerRef} style={{ position: "relative" }}>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  disabled={!organizationId}
                  placeholder={
                    !organizationId
                      ? "🔒 Select Organization in Card 1 above to unlock product search..."
                      : `Search products in ${organizationName || "organization"} (Name, Model, Code)...`
                  }
                  value={productSearch}
                  onFocus={() => {
                    if (organizationId) setShowSearchResults(true);
                  }}
                  onChange={(e) => {
                    if (!organizationId) return;
                    setProductSearch(e.target.value);
                    setShowSearchResults(true);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 38px 10px 14px",
                    borderRadius: "6px",
                    border: !organizationId
                      ? "1.5px dashed #cbd5e1"
                      : showSearchResults
                      ? "1.5px solid #0061f2"
                      : "1.5px solid #3b82f6",
                    fontSize: "13.5px",
                    fontWeight: 500,
                    boxSizing: "border-box",
                    outline: "none",
                    background: !organizationId ? "#f8fafc" : "#ffffff",
                    color: !organizationId ? "#94a3b8" : "#0f172a",
                    cursor: !organizationId ? "not-allowed" : "text",
                    boxShadow: showSearchResults && organizationId ? "0 0 0 3px rgba(59, 130, 246, 0.15)" : "none",
                  }}
                />
                {searchLoading && (
                  <span style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", fontSize: "14px" }}>
                    ⏳
                  </span>
                )}
              </div>

              {!organizationId && (
                <div
                  style={{
                    marginTop: "8px",
                    padding: "8px 12px",
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    borderRadius: "6px",
                    fontSize: "12px",
                    color: "#1e40af",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span style={{ fontSize: "14px" }}>🔒</span>
                  <span>
                    <strong>Organization Required:</strong> Please choose an Organization in <strong>Card 1</strong> above. Product catalog search and line item entry are strictly restricted to products belonging to the active organization.
                  </span>
                </div>
              )}

              {/* Autocomplete Results Dropdown Opening Strictly Below */}
              {showSearchResults && organizationId && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: "calc(100% + 4px)",
                    background: "#ffffff",
                    borderRadius: "8px",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.18)",
                    border: "1.5px solid #cbd5e1",
                    zIndex: 1000,
                    maxHeight: "300px",
                    overflowY: "auto",
                  }}
                >
                  <div style={{ padding: "6px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                    Click product to add to consignment items ({finalSearchResults.length} available)
                  </div>
                  {finalSearchResults.length > 0 ? (
                    finalSearchResults.map((prod: any) => (
                      <div
                        key={prod.id}
                        onClick={() => handleAddProduct(prod)}
                        style={{
                          padding: "10px 14px",
                          borderBottom: "1px solid #f1f5f9",
                          cursor: "pointer",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: "13px",
                          background: "#ffffff",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#eff6ff")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
                      >
                        <div>
                          <span style={{ fontWeight: 700, color: "#1e293b" }}>{prod.product_name}</span>
                          {prod.product_code && (
                            <span style={{ marginLeft: "8px", padding: "2px 6px", fontSize: "11px", fontWeight: 600, background: "#f1f5f9", color: "#475569", borderRadius: "4px", border: "1px solid #cbd5e1" }}>
                              {prod.product_code}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "12px", color: "#64748b", whiteSpace: "nowrap" }}>
                          VAT: <strong>{prod.refund_vat_percent != null ? `${prod.refund_vat_percent}%` : "0%"}</strong>
                          {prod.standard_cost && prod.standard_cost > 0 && (
                            <span style={{ marginLeft: "8px", color: "#059669", fontWeight: 700 }}>
                              Cost: {currencySymbol}{prod.standard_cost}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: "16px", color: "#64748b", fontSize: "13px", textAlign: "center" }}>
                      No products found matching "<strong>{productSearch}</strong>" in <strong>{organizationName}</strong>.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* CARD 4: PRODUCT ITEM (Inhyma ERP Style Table) */}
          <div
            className="card"
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              border: errors.items || errors.unit_rates ? "1.5px solid #ef4444" : "1.5px solid #cbd5e1",
              boxShadow: errors.items || errors.unit_rates ? "0 0 0 3px rgba(239, 68, 68, 0.12)" : "0 1px 3px rgba(0,0,0,0.05)",
              marginBottom: "16px",
              padding: 0,
              overflow: "visible",
            }}
          >
            {/* Header Bar */}
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  PRODUCT ITEM ({items.length}) <span style={{ color: "#ef4444" }}>*</span>
                </span>
                <span style={{ fontSize: "12px", color: "#64748b" }}>
                  • Amounts in {currency} ({currencySymbol})
                </span>
                {planningLoading && (
                  <span style={{ fontSize: "12px", color: "#0284c7", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    ⏳ Syncing Shipment Planning...
                  </span>
                )}
              </div>

              {planningInfo && planningInfo.count > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "12px", color: "#0369a1", background: "#f0f9ff", border: "1px solid #bae6fd", padding: "3px 10px", borderRadius: "6px", fontWeight: 600 }}>
                    📦 {planningInfo.count} planned item(s) from <strong>{planningInfo.sheetName}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={handleLoadPlannedProducts}
                    style={{
                      padding: "4px 10px",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#ffffff",
                      background: "#0284c7",
                      border: "none",
                      borderRadius: "5px",
                      cursor: "pointer",
                    }}
                    title="Reload planned products into table"
                  >
                    Load Planned Items
                  </button>
                </div>
              )}
              {planningInfo && planningInfo.count === 0 && supplierName && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "12px", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", padding: "3px 10px", borderRadius: "6px", fontWeight: 500 }}>
                    ℹ️ 0 planned items for <strong>{supplierName}</strong> in {planningInfo.sheetName || branchName || "this branch"}
                  </span>
                </div>
              )}
            </div>

            {/* Error alerts if items are empty or have 0 rate */}
            {errors.items && (
              <div style={{ padding: "10px 18px", background: "#fef2f2", borderBottom: "1px solid #fecaca", color: "#dc2626", fontSize: "12.5px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
                <span>▲</span> {errors.items}
              </div>
            )}
            {errors.unit_rates && (
              <div style={{ padding: "10px 18px", background: "#fef2f2", borderBottom: "1px solid #fecaca", color: "#dc2626", fontSize: "12.5px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
                <span>▲</span> {errors.unit_rates}
              </div>
            )}

            {/* Items Table */}
            <div className="table-scroll" style={{ maxHeight: "calc(100vh - 350px)", minHeight: "220px", border: "none", borderRadius: 0, overflowY: "visible" }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "35px", textAlign: "center" }}>#</th>
                    <th style={{ minWidth: "220px" }}>Product Name</th>
                    <th style={{ width: "90px" }}>HSN Code</th>
                    <th style={{ width: "90px", textAlign: "right" }}>Qty</th>
                    <th style={{ width: "100px", textAlign: "right" }}>Unit Rate</th>
                    <th style={{ width: "70px", textAlign: "right" }}>VAT %</th>
                    <th style={{ width: "110px", textAlign: "right" }}>Item Total</th>
                    <th style={{ width: "90px", textAlign: "right", background: "#eff6ff" }}>Expense Per Unit</th>
                    <th style={{ width: "120px", textAlign: "right", background: "#eff6ff" }}>Unit Landing Rate (VB)</th>
                    <th style={{ width: "130px", textAlign: "right", background: "#eff6ff" }}>Total Landing Rate (VB)</th>
                    <th style={{ width: "40px", textAlign: "center" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {calculations.calculatedItems.length === 0 ? (
                    <tr>
                      <td colSpan={11} style={{ padding: "35px 20px", textAlign: "center", color: "#64748b" }}>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
                          No items in this purchase
                        </div>
                        <div style={{ fontSize: "12.5px" }}>
                          {planningInfo && planningInfo.count === 0 && supplierName ? (
                            <span>
                              No planned products found for <strong>{supplierName}</strong> in <strong>{planningInfo.sheetName || branchName || "this branch"}</strong>. You can use the <strong>PRODUCT SEARCH</strong> bar above to add products manually.
                            </span>
                          ) : (
                            <span>
                              Use the <strong>PRODUCT SEARCH</strong> bar above to search and add products to this purchase.
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    calculations.calculatedItems.map((item, idx) => (
                      <tr key={idx}>
                        {/* Index */}
                        <td style={{ textAlign: "center", color: "#94a3b8", fontWeight: 600 }}>
                          {idx + 1}
                        </td>

                        {/* Product Name */}
                        <td>
                          {item.product_id ? (
                            <div>
                              <div style={{ fontWeight: 700, color: "#0f172a", fontSize: "13px" }}>
                                {item.product_name}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginTop: "2px" }}>
                                {item.product_code && (
                                  <span
                                    style={{
                                      padding: "1px 6px",
                                      fontSize: "11px",
                                      fontWeight: 600,
                                      background: "#f1f5f9",
                                      color: "#475569",
                                      borderRadius: "4px",
                                      border: "1px solid #cbd5e1",
                                    }}
                                  >
                                    {item.product_code}
                                  </span>
                                )}
                                {item.planning_sheet_name && (
                                  <span
                                    style={{
                                      padding: "1px 6px",
                                      fontSize: "10.5px",
                                      fontWeight: 700,
                                      background: "#e0f2fe",
                                      color: "#0369a1",
                                      borderRadius: "4px",
                                      border: "1px solid #bae6fd",
                                    }}
                                    title={`Planned from ${item.planning_sheet_name}`}
                                  >
                                    📦 Planned
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <input
                                type="text"
                                placeholder="Enter custom product name..."
                                value={item.product_name}
                                onChange={(e) => handleItemChange(idx, "product_name", e.target.value)}
                                required
                                style={{ width: "100%", padding: "6px 8px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "12.5px", fontWeight: 600, boxSizing: "border-box" }}
                              />
                              {item.planning_sheet_name && (
                                <span
                                  style={{
                                    display: "inline-block",
                                    marginTop: "2px",
                                    padding: "1px 6px",
                                    fontSize: "10.5px",
                                    fontWeight: 700,
                                    background: "#e0f2fe",
                                    color: "#0369a1",
                                    borderRadius: "4px",
                                    border: "1px solid #bae6fd",
                                  }}
                                  title={`Planned from ${item.planning_sheet_name}`}
                                >
                                  📦 Planned
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* HSN */}
                        <td>
                          <input
                            type="text"
                            value={item.hsn_code || ""}
                            onChange={(e) => handleItemChange(idx, "hsn_code", e.target.value)}
                            placeholder="HSN"
                            style={{ width: "100%", padding: "5px 6px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "12px", boxSizing: "border-box" }}
                          />
                        </td>

                        {/* Qty */}
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={item.quantity}
                            onChange={(e) => handleItemChange(idx, "quantity", e.target.value)}
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={(e) => {
                              if (e.target.value === "" || Number(e.target.value) <= 0) {
                                handleItemChange(idx, "quantity", 1);
                              }
                            }}
                            placeholder="1"
                            required
                            style={{ width: "100%", padding: "5px 6px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "12.5px", fontWeight: 700, textAlign: "right", boxSizing: "border-box" }}
                          />
                        </td>

                        {/* Unit Rate */}
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={item.unit_rate}
                            onChange={(e) => handleItemChange(idx, "unit_rate", e.target.value)}
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={(e) => {
                              if (e.target.value === "") {
                                handleItemChange(idx, "unit_rate", 0);
                              }
                            }}
                            placeholder="0.00"
                            required
                            style={{
                              width: "100%",
                              padding: "5px 6px",
                              borderRadius: "4px",
                              border:
                                submitAttempted && (!item.unit_rate || Number(item.unit_rate) <= 0)
                                  ? "1.5px solid #ef4444"
                                  : "1px solid #cbd5e1",
                              boxShadow:
                                submitAttempted && (!item.unit_rate || Number(item.unit_rate) <= 0)
                                  ? "0 0 0 2px rgba(239, 68, 68, 0.15)"
                                  : undefined,
                              background:
                                submitAttempted && (!item.unit_rate || Number(item.unit_rate) <= 0)
                                  ? "#fff5f5"
                                  : "#ffffff",
                              fontSize: "12.5px",
                              fontWeight: 700,
                              textAlign: "right",
                              boxSizing: "border-box",
                            }}
                          />
                          {submitAttempted && (!item.unit_rate || Number(item.unit_rate) <= 0) && (
                            <div style={{ color: "#dc2626", fontSize: "10.5px", fontWeight: 700, marginTop: "2px", textAlign: "right" }}>
                              ▲ Rate &gt; 0 req.
                            </div>
                          )}
                        </td>

                        {/* VAT % */}
                        <td>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="100"
                            value={item.vat_rate}
                            onChange={(e) => handleItemChange(idx, "vat_rate", e.target.value)}
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={(e) => {
                              if (e.target.value === "") {
                                handleItemChange(idx, "vat_rate", 0);
                              }
                            }}
                            placeholder="0"
                            style={{ width: "100%", padding: "5px 4px", borderRadius: "4px", border: "1px solid #cbd5e1", fontSize: "12px", textAlign: "right", boxSizing: "border-box" }}
                          />
                        </td>

                        {/* Basic Total */}
                        <td style={{ textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                          {currencySymbol} {item.item_total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          <div style={{ fontSize: "10.5px", color: "#64748b" }}>
                            + VAT: {currencySymbol}{item.vat_amount.toFixed(2)}
                          </div>
                        </td>

                        {/* Expense per Unit */}
                        <td style={{ textAlign: "right", color: "#475569", background: "#f8fafc" }}>
                          {currencySymbol} {item.expense_per_unit.toFixed(2)}
                        </td>

                        {/* Unit Landing Rate (VB) */}
                        <td style={{ textAlign: "right", fontWeight: 700, color: "#1e40af", background: "#f8fafc" }}>
                          {currencySymbol} {item.unit_landing_rate.toFixed(2)}
                        </td>

                        {/* Total Landing Cost (VB) */}
                        <td style={{ textAlign: "right", fontWeight: 800, color: "#059669", background: "#f8fafc" }}>
                          {currencySymbol} {item.total_landing_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>

                        {/* Action: Delete */}
                        <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#ef4444",
                              cursor: "pointer",
                              fontSize: "15px",
                              padding: "4px",
                            }}
                            title="Remove row"
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>

                {/* Grand Totals Footer */}
                {calculations.calculatedItems.length > 0 && (
                  <tfoot>
                    <tr style={{ background: "#f1f5f9", fontWeight: 700 }}>
                      <td colSpan={3} style={{ textAlign: "right", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        Grand Total:
                      </td>
                      <td style={{ textAlign: "right" }}>{calculations.totalQuantity}</td>
                      <td colSpan={2}></td>
                      <td style={{ textAlign: "right", color: "#0f172a", fontSize: "13.5px" }}>
                        {currencySymbol} {calculations.itemsTotalBasic.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ textAlign: "right", color: "#475569", background: "#e0edff" }}>
                        {currencySymbol} {calculations.totalExpenses.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ textAlign: "right", color: "#1e40af", background: "#e0edff", fontSize: "11px", textTransform: "uppercase" }}>
                        Total Landing:
                      </td>
                      <td style={{ textAlign: "right", color: "#059669", background: "#e0edff", fontSize: "14px", fontWeight: 800 }}>
                        {currencySymbol} {calculations.itemsTotalLanding.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* CARD 4: Smart Financial Reconciliation Banner */}
          {invoiceTotalValue !== "" && (
            <div
              style={{
                padding: "16px 20px",
                borderRadius: "10px",
                border:
                  invoiceDiff === 0 || Math.abs(invoiceDiff || 0) <= 0.05
                    ? "1.5px solid #86efac"
                    : "2px solid #ef4444",
                background:
                  invoiceDiff === 0 || Math.abs(invoiceDiff || 0) <= 0.05
                    ? "#f0fdf4"
                    : "#fef2f2",
                marginBottom: "16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "20px" }}>
                  {invoiceDiff === 0 || Math.abs(invoiceDiff || 0) <= 0.05 ? "✅" : "⛔"}
                </span>
                <div>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 700,
                      color:
                        invoiceDiff === 0 || Math.abs(invoiceDiff || 0) <= 0.05
                          ? "#15803d"
                          : "#b91c1c",
                    }}
                  >
                    {invoiceDiff === 0 || Math.abs(invoiceDiff || 0) <= 0.05
                      ? `Invoice Total Matches Line Items Perfectly (${currencySymbol} ${Number(invoiceTotalValue).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                      : submitAttempted
                      ? `Submission Blocked: Invoice Discrepancy of ${currencySymbol} ${Math.abs(invoiceDiff || 0).toFixed(2)} must be reconciled before saving!`
                      : `Invoice Discrepancy Detected: Entered Total ${currencySymbol} ${Number(invoiceTotalValue).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} vs Items Sum with VAT ${currencySymbol} ${calculations.itemsTotalGross.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </div>
                  {invoiceDiff !== 0 && Math.abs(invoiceDiff || 0) > 0.05 && (
                    <div style={{ fontSize: "12px", color: "#991b1b", marginTop: "2px" }}>
                      Difference: <strong>{currencySymbol} {Math.abs(invoiceDiff || 0).toFixed(2)}</strong> ({invoiceDiff! > 0 ? "entered invoice total is higher" : "calculated items total is higher"}. Submission is blocked until line items match the invoice total).
                    </div>
                  )}
                </div>
              </div>

              <div style={{ textAlign: "right", fontSize: "12px", color: "#475569" }}>
                <div style={{ fontWeight: 700, textTransform: "uppercase", fontSize: "11px", color: "#64748b" }}>
                  Basic + VAT Breakdown
                </div>
                <div>
                  Basic: <strong>{currencySymbol} {calculations.itemsTotalBasic.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> + VAT: <strong>{currencySymbol} {calculations.itemsTotalVat.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                </div>
              </div>
            </div>
          )}

          {/* CARD 5: Remarks & Notes */}
          <div
            className="card"
            style={{
              background: "#ffffff",
              padding: "18px 24px",
              borderRadius: "10px",
              border: "1px solid #cbd5e1",
              marginBottom: "16px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <label style={{ fontSize: "12.5px", fontWeight: 700, color: "#334155", marginBottom: "6px", display: "block" }}>
              Remarks / Factory Delivery Notes
            </label>
            <textarea
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Supplier payment terms, delivery instructions, or factory inspection notes..."
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontSize: "13px",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Form Submit & Cancel Actions Bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "8px" }}>
            <button
              type="button"
              onClick={() => navigate("/purchase/local")}
              style={{
                padding: "10px 20px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#475569",
                fontWeight: 600,
                fontSize: "13.5px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: "10px 32px",
                borderRadius: "6px",
                border: "none",
                background: submitting ? "#94a3b8" : "#0061f2",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: "14px",
                cursor: submitting ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                boxShadow: submitting ? "none" : "0 2px 6px rgba(0,97,242,0.3)",
              }}
            >
              {submitting ? "Saving Local Purchase..." : isEdit ? "Save Changes" : "Submit Local Purchase"}
            </button>
          </div>
        </form>
      </main>
    </AppShell>
  );
}
