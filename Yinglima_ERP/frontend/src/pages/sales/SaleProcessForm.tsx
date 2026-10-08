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
  ExtractedConsignmentItem,
  PlanningConsignmentColumn,
  PlanningConsignmentItemsResponse,
  ProductCostingInfo,
  SaleOrder,
  SaleOrderItem,
} from "@/types/saleProcess";

import { getCachedBrandName } from "@/lib/brand";

export function SaleProcessFormPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  // Form State
  const [organizationId, setOrganizationId] = useState("");
  const [organizationName, setOrganizationName] = useState(() => getCachedBrandName());
  const [buyerId, setBuyerId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerBranchId, setBuyerBranchId] = useState("");
  const [buyerBranchName, setBuyerBranchName] = useState("");
  // Searchable buyer combobox
  const [buyerSearch, setBuyerSearch] = useState("");
  const [buyerOpen, setBuyerOpen] = useState(false);
  const buyerDropdownRef = useRef<HTMLDivElement>(null);

  // Shipment Planning Consignment Integration (Searchable Combobox)
  const [consignments, setConsignments] = useState<PlanningConsignmentColumn[]>([]);
  const [selectedColumnId, setSelectedColumnId] = useState("");
  const [selectedConsignmentCode, setSelectedConsignmentCode] = useState("");
  const [selectedSheetId, setSelectedSheetId] = useState("");
  const [loadingConsignments, setLoadingConsignments] = useState(false);
  const [extractingItems, setExtractingItems] = useState(false);
  const [consignmentLoadedInfo, setConsignmentLoadedInfo] = useState<string | null>(null);
  const [consignmentSearch, setConsignmentSearch] = useState("");
  const [consignmentOpen, setConsignmentOpen] = useState(false);
  const consignmentDropdownRef = useRef<HTMLDivElement>(null);

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

  // Shipping & CI Costing Parameters (from official Yinglima export spreadsheet)
  const [oceanFreightUsd, setOceanFreightUsd] = useState<number>(0.0);
  const [localChargesCocUsd, setLocalChargesCocUsd] = useState<number>(0.0);
  const [usdExchangeRate, setUsdExchangeRate] = useState<number>(6.70);
  const [profitPercent, setProfitPercent] = useState<number>(3.00);
  const [totalContainerCbm, setTotalContainerCbm] = useState<number>(0.0);
  const [costingViewMode, setCostingViewMode] = useState<boolean>(true);

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

  // Close buyer & consignment dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (buyerDropdownRef.current && !buyerDropdownRef.current.contains(e.target as Node)) {
        setBuyerOpen(false);
      }
      if (consignmentDropdownRef.current && !consignmentDropdownRef.current.contains(e.target as Node)) {
        setConsignmentOpen(false);
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
          setOceanFreightUsd(Number(o.ocean_freight_usd) || 0.0);
          setLocalChargesCocUsd(Number(o.local_charges_coc_usd) || 0.0);
          setUsdExchangeRate(Number(o.usd_exchange_rate) || 6.70);
          setProfitPercent(Number(o.profit_percent) || 3.00);
          setTotalContainerCbm(Number(o.total_container_cbm) || 0.0);

          if (o.items && o.items.length > 0) {
            setItems(o.items.map((it) => ({ ...it, uom: it.uom || "NOS" })));
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

  // Fetch ALL consignment columns across the ERP once on mount
  useEffect(() => {
    let mounted = true;
    async function fetchConsignments() {
      setLoadingConsignments(true);
      try {
        const res = await apiGet<PlanningConsignmentColumn[]>("/sales/planning-consignments");
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
  }, []);

  // Filtered & smart-sorted consignments for the combobox
  const filteredConsignments = useMemo(() => {
    let list = [...consignments];
    if (consignmentSearch.trim()) {
      const q = consignmentSearch.trim().toLowerCase();
      list = list.filter((c) => {
        const nameMatch = c.column_name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
        const sheetMatch = c.sheet_name.toLowerCase().includes(q);
        const orgMatch = (c.organization_name || "").toLowerCase().includes(q);
        return nameMatch || sheetMatch || orgMatch;
      });
    }

    // If a buyer is selected and user hasn't typed a search, put the buyer's consignments first
    if (buyerName && !consignmentSearch.trim()) {
      const cleanB = buyerName.toLowerCase().trim();
      list.sort((a, b) => {
        const aOrg = (a.organization_name || "").toLowerCase();
        const bOrg = (b.organization_name || "").toLowerCase();
        const aSheet = a.sheet_name.toLowerCase();
        const bSheet = b.sheet_name.toLowerCase();
        const aMatch = aOrg.includes(cleanB) || cleanB.includes(aOrg) || aSheet.includes(cleanB) || cleanB.includes(aSheet);
        const bMatch = bOrg.includes(cleanB) || cleanB.includes(bOrg) || bSheet.includes(cleanB) || cleanB.includes(bSheet);
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return 0;
      });
    }
    return list;
  }, [consignments, consignmentSearch, buyerName]);

  const handleSelectConsignment = (col: PlanningConsignmentColumn) => {
    setSelectedColumnId(col.column_id);
    setSelectedConsignmentCode(col.code || col.column_name);
    setSelectedSheetId(col.sheet_id);

    // If buyer is not selected, auto-select buyer based on organization_name or sheet_name
    if (!buyerId && buyerLookup.items) {
      const targetOrg = (col.organization_name || "").toLowerCase().trim();
      const targetSheet = (col.sheet_name || "").toLowerCase().trim();
      const matchedBuyer = buyerLookup.items.find((b) => {
        const bName = (b.company_name || b.name || "").toLowerCase().trim();
        if (targetOrg && (bName.includes(targetOrg) || targetOrg.includes(bName))) return true;
        if (targetSheet && (bName.includes(targetSheet) || targetSheet.includes(bName))) return true;
        return false;
      });
      if (matchedBuyer) {
        setBuyerId(matchedBuyer.id);
        setBuyerName(matchedBuyer.company_name || matchedBuyer.name || "");
      }
    }

    setConsignmentOpen(false);
    setConsignmentSearch("");

    // Auto-load items immediately on selection
    handleExtractConsignment(col.column_id);
  };

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

        const sumCbm = (data.items || []).reduce((acc: number, it: ExtractedConsignmentItem) => acc + (Number(it.total_cbm) || 0), 0);
        const roundedSumCbm = Math.round(sumCbm * 10000) / 10000;
        setTotalContainerCbm(roundedSumCbm);

        const mappedItems: SaleOrderItem[] = (data.items || []).map((it: ExtractedConsignmentItem) => {
          const qty = Number(it.quantity) || 0;
          const taxPct = Number(it.vat_rate) || 13.0;
          const cfrUsd = Number(it.cfr_price_usd) || 0;
          const rmbWithVat = Number(it.unit_price_rmb_with_vat) || 0;
          const rmbExVat =
            Number(it.unit_price_rmb_ex_vat) ||
            (rmbWithVat > 0 ? Math.round((rmbWithVat / (1 + taxPct / 100)) * 100) / 100 : 0);

          let rate = Number(it.unit_rate) || 0;
          if (currency === "USD" && cfrUsd > 0) {
            rate = cfrUsd;
          } else if (currency === "RMB" && rmbWithVat > 0 && (!rate || rate === 0)) {
            rate = rmbWithVat;
          }

          const basic = qty * rate;
          const taxAmt = (basic * taxPct) / 100.0;
          const tot = basic + taxAmt;

          return {
            product_id: it.product_id,
            product_name: it.product_name,
            product_code: it.product_code || null,
            hsn_code: it.hsn_code || null,
            uom: it.uom || "NOS",
            quantity: qty,
            unit_rate: rate,
            tax_percent: taxPct,
            tax_amount: Math.round(taxAmt * 100) / 100,
            item_total: Math.round(tot * 100) / 100,
            planning_row_id: it.planning_row_id,
            remarks: it.remarks || null,

            // CI Costing extracted from Confirmed Local Purchase
            supplier_id: it.supplier_id || null,
            supplier_name: it.supplier_name || null,
            is_from_local_purchase: Boolean(it.is_from_local_purchase ?? (rmbWithVat > 0 && it.supplier_name)),
            unit_price_rmb_with_vat: rmbWithVat,
            unit_price_rmb_ex_vat: rmbExVat,
            profit_percent: profitPercent,
            fob_price_usd: Number(it.fob_price_usd) || 0.0,
            freight_unit_usd: Number(it.freight_unit_usd) || 0.0,
            cfr_price_usd: cfrUsd,
            cbm_per_unit: Number(it.cbm_per_unit) || 0.0,
            total_cbm: Number(it.total_cbm) || 0.0,
            total_supplier_amount_rmb: Number(it.total_supplier_amount_rmb) || (rmbWithVat * qty),
          };
        });

        setItems(mappedItems);
        setSelectedConsignmentCode(data.consignment_code);
        setSelectedSheetId(data.sheet_id);
        setSelectedColumnId(data.column_id);

        const msg = `Successfully loaded ${data.count} planned products (${data.total_quantity.toLocaleString()} pcs) from consignment ${data.consignment_code} (${data.sheet_name}) with Local Purchase costing!`;
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

  const handleAddProduct = async (p: {
    id: string;
    product_name: string;
    product_code?: string;
    hsn_code?: string;
    standard_cost?: number;
    refund_vat_percent?: number;
    uom?: string;
  }) => {
    // Call costing info to pull supplier & RMB price from Local Purchase!
    let supplierId: string | null = null;
    let supplierName: string | null = null;
    let uomName = p.uom || "NOS";
    let priceRmbWithVat = 0;
    let priceRmbExVat = 0;
    let cbmPerUnit = 0;
    let totalCbm = 0;
    let fobPriceUsd = 0;
    let cfrPriceUsd = 0;
    let totalSupplierRmb = 0;
    let isFromLp = false;
    let taxPct = Number(p.refund_vat_percent) || 13.0;

    try {
      const costRes = await apiGet<ProductCostingInfo>(
        `/sales/products/${p.id}/costing-info?quantity=1&usd_rate=${usdExchangeRate}&profit_percent=${profitPercent}`
      );
      if (costRes.data) {
        const cd = costRes.data;
        supplierId = cd.supplier_id || null;
        supplierName = cd.supplier_name || null;
        isFromLp = Boolean(cd.is_from_local_purchase ?? (cd.unit_price_rmb_with_vat && cd.unit_price_rmb_with_vat > 0));
        priceRmbWithVat = typeof cd.unit_price_rmb_with_vat === "number" ? cd.unit_price_rmb_with_vat : 0;
        priceRmbExVat = typeof cd.unit_price_rmb_ex_vat === "number" ? cd.unit_price_rmb_ex_vat : 0;
        cbmPerUnit = cd.cbm_per_unit || 0;
        totalCbm = cd.total_cbm || 0;
        fobPriceUsd = cd.fob_price_usd || 0;
        cfrPriceUsd = cd.cfr_price_usd || 0;
        totalSupplierRmb = cd.total_supplier_amount_rmb || 0;
        if (cd.uom) uomName = cd.uom;
        if (cd.refund_vat_percent) taxPct = cd.refund_vat_percent;
      }
    } catch {
      // quiet fallback
    }

    const qty = 1;
    let rate = 0;
    if (currency === "USD" && cfrPriceUsd > 0) {
      rate = cfrPriceUsd;
    } else if (currency === "RMB" && priceRmbWithVat > 0) {
      rate = priceRmbWithVat;
    }

    const basic = qty * rate;
    const taxAmt = (basic * taxPct) / 100.0;

    const newItem: SaleOrderItem = {
      product_id: p.id,
      product_name: p.product_name,
      product_code: p.product_code || null,
      hsn_code: p.hsn_code || null,
      uom: uomName,
      quantity: qty,
      unit_rate: rate,
      tax_percent: taxPct,
      tax_amount: Math.round(taxAmt * 100) / 100,
      item_total: Math.round((basic + taxAmt) * 100) / 100,
      remarks: null,

      // CI Costing (from Local Purchase)
      supplier_id: supplierId,
      supplier_name: supplierName,
      is_from_local_purchase: isFromLp,
      unit_price_rmb_with_vat: priceRmbWithVat,
      unit_price_rmb_ex_vat: priceRmbExVat,
      profit_percent: profitPercent,
      fob_price_usd: fobPriceUsd,
      freight_unit_usd: 0.0,
      cfr_price_usd: cfrPriceUsd,
      cbm_per_unit: cbmPerUnit,
      total_cbm: totalCbm,
      total_supplier_amount_rmb: totalSupplierRmb,
    };

    setItems((prev) => [...prev, newItem]);
    setProductSearch("");
    setShowSearchResults(false);
    toast(`Added ${p.product_name}${supplierName ? ` (Supplier: ${supplierName})` : " (No Confirmed LP)"}`, "success");
  };

  // Helper to recompute all line items with CI Costing & CFR rates
  const recomputeAllCosting = (
    oceanFr = oceanFreightUsd,
    localCoc = localChargesCocUsd,
    usdRate = usdExchangeRate,
    pPct = profitPercent,
    contCbm = totalContainerCbm
  ) => {
    setItems((prev) => {
      // 1. Calculate sum of CBM across items
      const sumCbm = prev.reduce((acc, it) => {
        const itQty = Number(it.quantity) || 0;
        const cbmUnit = Number(it.cbm_per_unit) || 0;
        const lineCbm = it.total_cbm && it.total_cbm > 0 ? it.total_cbm : cbmUnit * itQty;
        return acc + lineCbm;
      }, 0);

      const effCbm = contCbm > 0 ? contCbm : (sumCbm > 0 ? sumCbm : 1.0);
      const frRatePerCbm = (oceanFr + localCoc) / effCbm;

      return prev.map((it) => {
        const qty = Number(it.quantity) || 0;
        const vatPct = Number(it.tax_percent) || 13.0;
        const rmbWithVat = Number(it.unit_price_rmb_with_vat) || 0;
        const rmbExVat =
          rmbWithVat > 0
            ? Math.round((rmbWithVat / (1.0 + (vatPct / 100.0))) * 100) / 100
            : (it.unit_price_rmb_ex_vat || 0);
        const priceWithProfit = Math.round(rmbExVat * (1.0 + (pPct / 100.0)) * 100) / 100;
        const fobUsd = usdRate > 0 ? Math.round((priceWithProfit / usdRate) * 10000) / 10000 : 0;

        const cbmUnit = Number(it.cbm_per_unit) || 0;
        const lineCbm = it.total_cbm && it.total_cbm > 0 ? it.total_cbm : Math.round(cbmUnit * qty * 10000) / 10000;
        const freightUnit = qty > 0 ? Math.round(((frRatePerCbm * lineCbm) / qty) * 10000) / 10000 : 0;
        const cfrUsd = Math.ceil((fobUsd + freightUnit) * 100) / 100;
        const supTotRmb = Math.round(rmbWithVat * qty * 100) / 100;

        let rate = Number(it.unit_rate) || 0;
        if (currency === "USD" && cfrUsd > 0) {
          rate = cfrUsd;
        }

        const basic = qty * rate;
        const taxAmt = Math.round(((basic * vatPct) / 100.0) * 100) / 100;
        const tot = Math.round((basic + taxAmt) * 100) / 100;

        return {
          ...it,
          quantity: qty,
          unit_rate: rate,
          tax_amount: taxAmt,
          item_total: tot,
          unit_price_rmb_with_vat: rmbWithVat,
          unit_price_rmb_ex_vat: rmbExVat,
          profit_percent: pPct,
          fob_price_usd: fobUsd,
          freight_unit_usd: freightUnit,
          cfr_price_usd: cfrUsd,
          total_cbm: lineCbm,
          total_supplier_amount_rmb: supTotRmb,
        };
      });
    });
  };

  // Update item field
  const updateItem = (index: number, field: keyof SaleOrderItem, val: any) => {
    setItems((prev) => {
      const next = [...prev];
      const target = { ...next[index], [field]: val };

      const qty = Number(target.quantity) || 0;
      const vatPct = Number(target.tax_percent) || 13.0;

      // When quantity, RMB price, or total CBM changes, recompute CI costing for this item
      if (field === "unit_price_rmb_with_vat" || field === "quantity" || field === "total_cbm") {
        const rmbWithVat = Number(target.unit_price_rmb_with_vat) || 0;
        const rmbExVat =
          rmbWithVat > 0 ? Math.round((rmbWithVat / (1.0 + (vatPct / 100.0))) * 100) / 100 : 0;
        const priceWithProfit = Math.round(rmbExVat * (1.0 + (profitPercent / 100.0)) * 100) / 100;
        const fobUsd = usdExchangeRate > 0 ? Math.round((priceWithProfit / usdExchangeRate) * 10000) / 10000 : 0;

        let lineCbm = Number(target.total_cbm) || 0;
        if (field !== "total_cbm") {
          const cbmUnit = Number(target.cbm_per_unit) || 0;
          lineCbm = target.total_cbm && target.total_cbm > 0 ? target.total_cbm : Math.round(cbmUnit * qty * 10000) / 10000;
        } else {
          target.cbm_per_unit = qty > 0 ? lineCbm / qty : 0;
        }
        const effCbm = totalContainerCbm > 0 ? totalContainerCbm : 1.0;
        const frRatePerCbm = (oceanFreightUsd + localChargesCocUsd) / effCbm;
        const freightUnit = qty > 0 ? Math.round(((frRatePerCbm * lineCbm) / qty) * 10000) / 10000 : 0;
        const cfrUsd = Math.ceil((fobUsd + freightUnit) * 100) / 100;

        target.unit_price_rmb_ex_vat = rmbExVat;
        target.fob_price_usd = fobUsd;
        target.freight_unit_usd = freightUnit;
        target.cfr_price_usd = cfrUsd;
        target.total_cbm = lineCbm;
        target.total_supplier_amount_rmb = Math.round(rmbWithVat * qty * 100) / 100;

        if (currency === "USD" && cfrUsd > 0) {
          target.unit_rate = cfrUsd;
        } else if (currency === "RMB" && rmbWithVat > 0 && field === "unit_price_rmb_with_vat") {
          target.unit_rate = rmbWithVat;
        }
      }

      const rate = Number(target.unit_rate) || 0;
      const basic = qty * rate;
      const taxAmt = (basic * vatPct) / 100.0;
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
    let supplierRmb = 0;
    let sumCbm = 0;
    let totalUsd = 0;

    for (const it of items) {
      const q = Number(it.quantity) || 0;
      const r = Number(it.unit_rate) || 0;
      const t = Number(it.tax_amount) || 0;
      const tot = Number(it.item_total) || 0;
      const supAmt = Number(it.total_supplier_amount_rmb) || (Number(it.unit_price_rmb_with_vat) || 0) * q;
      const cbm = Number(it.total_cbm) || (Number(it.cbm_per_unit) || 0) * q;
      const cfr = Number(it.cfr_price_usd) || 0;
      const unitUsd = currency === "USD" ? (r || cfr) : cfr;

      basic += q * r;
      tax += t;
      grand += tot;
      qty += q;
      supplierRmb += supAmt;
      sumCbm += cbm;
      totalUsd += Math.round(unitUsd * q * 100) / 100;
    }

    return {
      basic: Math.round(basic * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      grand: Math.round(grand * 100) / 100,
      qty: Math.round(qty * 100) / 100,
      count: items.length,
      supplierRmb: Math.round(supplierRmb * 100) / 100,
      sumCbm: Math.round(sumCbm * 10000) / 10000,
      totalUsd: Math.round(totalUsd * 100) / 100,
    };
  }, [items, currency]);

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
        ocean_freight_usd: oceanFreightUsd,
        local_charges_coc_usd: localChargesCocUsd,
        usd_exchange_rate: usdExchangeRate,
        profit_percent: profitPercent,
        total_container_cbm: totalContainerCbm,
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
          supplier_id: it.supplier_id || null,
          supplier_name: it.supplier_name || null,
          unit_price_rmb_with_vat: it.unit_price_rmb_with_vat ?? 0.0,
          unit_price_rmb_ex_vat: it.unit_price_rmb_ex_vat ?? 0.0,
          profit_percent: it.profit_percent ?? profitPercent,
          fob_price_usd: it.fob_price_usd ?? 0.0,
          freight_unit_usd: it.freight_unit_usd ?? 0.0,
          cfr_price_usd: it.cfr_price_usd ?? 0.0,
          cbm_per_unit: it.cbm_per_unit ?? 0.0,
          total_cbm: it.total_cbm ?? 0.0,
          total_supplier_amount_rmb: it.total_supplier_amount_rmb ?? 0.0,
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

        <form onSubmit={handleSubmit} noValidate>
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

              {/* Consignment Selection from Shipment Planning (Searchable Combobox) */}
              <div ref={consignmentDropdownRef} style={{ minWidth: "360px", gridColumn: "span 2", position: "relative" }}>
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
                  {/* Combobox Trigger Button */}
                  <div style={{ flex: 1, position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setConsignmentOpen((prev) => !prev)}
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
                        color: selectedColumnId ? "#0f172a" : "#94a3b8",
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {selectedColumnId ? (() => {
                          const col = consignments.find((c) => c.column_id === selectedColumnId);
                          if (!col) return selectedConsignmentCode || "Consignment Selected";
                          const orgBadge = col.organization_name ? ` [${col.organization_name}]` : "";
                          return `${col.column_name}${orgBadge} (${col.sheet_name} • ${col.item_count} items • ${col.total_quantity} pcs)`;
                        })() : "🔍 Type or select consignment column..."}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        {selectedColumnId && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedColumnId("");
                              setSelectedConsignmentCode("");
                              setSelectedSheetId("");
                            }}
                            style={{
                              fontSize: "12px",
                              color: "#94a3b8",
                              padding: "2px 4px",
                              borderRadius: "3px",
                              cursor: "pointer",
                            }}
                            title="Clear selected consignment"
                          >
                            ✕
                          </span>
                        )}
                        <span style={{ fontSize: "10px", color: "#64748b" }}>{consignmentOpen ? "▲" : "▼"}</span>
                      </div>
                    </button>

                    {/* Dropdown Panel */}
                    {consignmentOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: "calc(100% + 4px)",
                          left: 0,
                          right: 0,
                          background: "#fff",
                          border: "1px solid #cbd5e1",
                          borderRadius: "8px",
                          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                          zIndex: 50,
                          overflow: "hidden",
                        }}
                      >
                        {/* Search Input */}
                        <div style={{ padding: "8px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                          <input
                            type="text"
                            placeholder="Type to filter consignment, sheet, or buyer..."
                            value={consignmentSearch}
                            onChange={(e) => setConsignmentSearch(e.target.value)}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: "100%",
                              padding: "6px 10px",
                              borderRadius: "5px",
                              border: "1px solid #e2e8f0",
                              fontSize: "12px",
                              outline: "none",
                              boxSizing: "border-box",
                              background: "#ffffff",
                            }}
                          />
                        </div>

                        {/* Options List */}
                        <div style={{ maxHeight: "250px", overflowY: "auto" }}>
                          {filteredConsignments.length === 0 ? (
                            <div style={{ padding: "12px", textAlign: "center", color: "#94a3b8", fontSize: "12px" }}>
                              No consignments match "{consignmentSearch}"
                            </div>
                          ) : (
                            filteredConsignments.map((c) => {
                              const isSelected = c.column_id === selectedColumnId;
                              const isRecommended = buyerName && (
                                (c.organization_name && (c.organization_name.toLowerCase().includes(buyerName.toLowerCase()) || buyerName.toLowerCase().includes(c.organization_name.toLowerCase()))) ||
                                (c.sheet_name && (c.sheet_name.toLowerCase().includes(buyerName.toLowerCase()) || buyerName.toLowerCase().includes(c.sheet_name.toLowerCase())))
                              );

                              return (
                                <div
                                  key={c.column_id}
                                  onClick={() => handleSelectConsignment(c)}
                                  style={{
                                    padding: "8px 12px",
                                    fontSize: "12.5px",
                                    cursor: "pointer",
                                    background: isSelected ? "#eff6ff" : "transparent",
                                    borderBottom: "1px solid #f1f5f9",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isSelected) e.currentTarget.style.background = "#f8fafc";
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = isSelected ? "#eff6ff" : "transparent";
                                  }}
                                >
                                  <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                      {isSelected && <span style={{ color: "#2563eb", fontSize: "10px" }}>✔</span>}
                                      <span style={{ fontWeight: 700, color: "#0f172a" }}>{c.column_name}</span>
                                      {c.organization_name && (
                                        <span style={{ fontSize: "11px", background: "#e0f2fe", color: "#0369a1", padding: "1px 6px", borderRadius: "4px", fontWeight: 600 }}>
                                          {c.organization_name}
                                        </span>
                                      )}
                                      <span style={{ fontSize: "11px", color: "#64748b" }}>
                                        ({c.sheet_name})
                                      </span>
                                      {isRecommended && (
                                        <span style={{ fontSize: "10px", background: "#dcfce7", color: "#15803d", padding: "1px 5px", borderRadius: "3px", fontWeight: 600 }}>
                                          Matched Buyer
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div style={{ fontSize: "11.5px", color: "#64748b", fontWeight: 500 }}>
                                    {c.item_count} items • {c.total_quantity.toLocaleString()} pcs
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>

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

            {/* Export Shipping & CI Costing Parameters */}
            <div
              style={{
                marginTop: "16px",
                padding: "16px",
                borderRadius: "8px",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "12px",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "16px" }}>⚓</span>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#166534" }}>
                    Export Costing & Container Freight Parameters (Yinglima Official Spreadsheet Engine)
                  </span>
                </div>
                <div style={{ fontSize: "11.5px", color: "#15803d", fontWeight: 600 }}>
                  Supplier & RMB Factory Price sourced directly from Confirmed Local Purchase
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: "12px",
                }}
              >
                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#166534", marginBottom: "4px" }}>
                    Ocean Freight ($ USD)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0.00"
                    value={oceanFreightUsd === 0 ? "" : oceanFreightUsd}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setOceanFreightUsd(val);
                      recomputeAllCosting(val, localChargesCocUsd, usdExchangeRate, profitPercent, totalContainerCbm);
                    }}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      border: "1px solid #86efac",
                      background: "#ffffff",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#166534", marginBottom: "4px" }}>
                    Local Charges & COC ($ USD)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0.00"
                    value={localChargesCocUsd === 0 ? "" : localChargesCocUsd}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setLocalChargesCocUsd(val);
                      recomputeAllCosting(oceanFreightUsd, val, usdExchangeRate, profitPercent, totalContainerCbm);
                    }}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      border: "1px solid #86efac",
                      background: "#ffffff",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#166534", marginBottom: "4px" }}>
                    USD Conversion Rate
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.0001"
                    placeholder="6.70"
                    value={usdExchangeRate === 0 ? "" : usdExchangeRate}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setUsdExchangeRate(val);
                      recomputeAllCosting(oceanFreightUsd, localChargesCocUsd, val || 6.70, profitPercent, totalContainerCbm);
                    }}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      border: "1px solid #86efac",
                      background: "#ffffff",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#166534", marginBottom: "4px" }}>
                    Export Profit Margin (%)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="3.00"
                    value={profitPercent === 0 ? "" : profitPercent}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setProfitPercent(val);
                      recomputeAllCosting(oceanFreightUsd, localChargesCocUsd, usdExchangeRate, val, totalContainerCbm);
                    }}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      border: "1px solid #86efac",
                      background: "#ffffff",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#166534", marginBottom: "4px" }}>
                    Total Container CBM (m³)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0.000"
                    value={totalContainerCbm === 0 ? "" : totalContainerCbm}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setTotalContainerCbm(val);
                      recomputeAllCosting(oceanFreightUsd, localChargesCocUsd, usdExchangeRate, profitPercent, val);
                    }}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      border: "1px solid #86efac",
                      background: "#ffffff",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>

              {/* Derived rate banner */}
              <div
                style={{
                  marginTop: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "8px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  background: "#ffffff",
                  border: "1px solid #dcfce7",
                  fontSize: "12px",
                }}
              >
                <div>
                  Total Shipping Expense: <strong>${(oceanFreightUsd + localChargesCocUsd).toFixed(2)} USD</strong>
                  &nbsp;•&nbsp; Freight Allocation Rate:{" "}
                  <strong style={{ color: "#15803d" }}>
                    ${totalContainerCbm > 0 ? ((oceanFreightUsd + localChargesCocUsd) / totalContainerCbm).toFixed(2) : "0.00"} / m³
                  </strong>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const sumCbm = items.reduce((acc, it) => {
                      const itQty = Number(it.quantity) || 0;
                      const cbmUnit = Number(it.cbm_per_unit) || 0;
                      return acc + (it.total_cbm && it.total_cbm > 0 ? it.total_cbm : cbmUnit * itQty);
                    }, 0);
                    const effCbm = totalContainerCbm > 0 ? totalContainerCbm : (sumCbm > 0 ? Math.round(sumCbm * 1000) / 1000 : 0);
                    if (totalContainerCbm === 0 && effCbm > 0) {
                      setTotalContainerCbm(effCbm);
                    }
                    recomputeAllCosting(oceanFreightUsd, localChargesCocUsd, usdExchangeRate, profitPercent, effCbm);
                    if (oceanFreightUsd === 0 && localChargesCocUsd === 0) {
                      toast(`⚡ CFR rates refreshed for ${items.length} items (Note: Ocean Freight & Local Charges are currently $0.00)`, "info");
                    } else {
                      toast(`✓ Recalculated CFR rates for ${items.length} item(s) successfully!`, "success");
                    }
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "4px",
                    background: "#16a34a",
                    color: "#ffffff",
                    border: "none",
                    fontWeight: 700,
                    fontSize: "11.5px",
                    cursor: "pointer",
                  }}
                >
                  ⚡ Recalculate CFR Rates
                </button>
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
                  {costingViewMode && totals.supplierRmb > 0 && (
                    <>
                      {" "}| Supplier Payable:{" "}
                      <strong style={{ color: "#059669" }}>
                        ¥ {totals.supplierRmb.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                    </>
                  )}
                  {costingViewMode && totals.sumCbm > 0 && (
                    <>
                      {" "}| Total Volume:{" "}
                      <strong style={{ color: "#0891b2" }}>
                        {totals.sumCbm.toFixed(3)} m³
                      </strong>
                    </>
                  )}
                </div>
              </div>

              {/* View Mode Toggle, Quick Fill & Product Search */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                {/* Costing Engine Toggle */}
                <button
                  type="button"
                  onClick={() => setCostingViewMode(!costingViewMode)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: costingViewMode ? "#0284c7" : "#ffffff",
                    color: costingViewMode ? "#ffffff" : "#334155",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    boxShadow: costingViewMode ? "0 1px 3px rgba(2,132,199,0.3)" : "none",
                  }}
                  title="Toggle between standard sales order view and full 16-column CI costing engine view"
                >
                  <span>📊</span>
                  <span>{costingViewMode ? "Costing & Supplier Columns (Active)" : "Show Costing & Supplier"}</span>
                </button>
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
                    <th style={{ padding: "8px 8px", width: "40px", textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Sr.No</th>
                    <th style={{ padding: "8px 10px", minWidth: "180px", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Description</th>
                    <th style={{ padding: "8px 8px", width: "90px", minWidth: "90px", whiteSpace: "normal", lineHeight: 1.25, textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>HS CODE AS<br />PER CHINA</th>
                    <th style={{ padding: "8px 8px", width: "80px", minWidth: "80px", textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>UOM</th>
                    <th style={{ padding: "8px 8px", width: "80px", textAlign: "right", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Quantity</th>
                    
                    {costingViewMode ? (
                      <>
                        <th style={{ padding: "8px 8px", width: "85px", minWidth: "85px", whiteSpace: "normal", lineHeight: 1.25, textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Unit Price<br />(USD)</th>
                        <th style={{ padding: "8px 8px", width: "95px", minWidth: "95px", whiteSpace: "normal", lineHeight: 1.25, textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Total Amount<br />(USD)</th>
                        <th style={{ padding: "8px 8px", width: "95px", minWidth: "95px", whiteSpace: "normal", lineHeight: 1.25, textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#fef9c3", borderBottom: "2px solid #cbd5e1" }}>Unit Price(RMB)<br />Including VAT</th>
                        <th style={{ padding: "8px 8px", width: "95px", minWidth: "95px", whiteSpace: "normal", lineHeight: 1.25, textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Unit Price(RMB)<br />Excluding VAT</th>
                        <th style={{ padding: "8px 8px", width: "80px", minWidth: "80px", whiteSpace: "normal", lineHeight: 1.25, textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Including<br />Profit {profitPercent}%</th>
                        <th style={{ padding: "8px 8px", width: "105px", minWidth: "105px", whiteSpace: "normal", lineHeight: 1.25, textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>FOB PRICE<br />(USD Conversion @{usdExchangeRate || 6.7})</th>
                        <th style={{ padding: "8px 8px", width: "95px", minWidth: "95px", whiteSpace: "normal", lineHeight: 1.25, textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Freight, Local<br />charges, COC</th>
                        <th style={{ padding: "8px 8px", width: "80px", minWidth: "80px", whiteSpace: "normal", lineHeight: 1.25, textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>CFR<br />Price/Unit</th>
                        <th style={{ padding: "8px 10px", width: "150px", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Supplier</th>
                        <th style={{ padding: "8px 8px", width: "80px", minWidth: "80px", whiteSpace: "normal", lineHeight: 1.25, textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Total<br />CBM</th>
                        <th style={{ padding: "8px 8px", width: "100px", minWidth: "100px", whiteSpace: "normal", lineHeight: 1.25, textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Total Supplier<br />Amount</th>
                      </>
                    ) : (
                      <>
                        <th style={{ padding: "8px 10px", width: "110px", textAlign: "right", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Unit Rate ({currencySymbol})</th>
                        <th style={{ padding: "8px 10px", width: "70px", textAlign: "right", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Tax %</th>
                        <th style={{ padding: "8px 10px", width: "90px", textAlign: "right", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Tax ({currencySymbol})</th>
                        <th style={{ padding: "8px 10px", width: "110px", textAlign: "right", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Total ({currencySymbol})</th>
                      </>
                    )}

                    <th style={{ padding: "8px 10px", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Remarks / Notes</th>
                    <th style={{ padding: "8px 10px", width: "40px", textAlign: "center", position: "sticky", top: 0, zIndex: 10, background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>Act</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={costingViewMode ? 18 : 11} style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>
                        <div style={{ fontSize: "24px", marginBottom: "6px" }}>📦</div>
                        <div style={{ fontWeight: 600, color: "#475569" }}>No items loaded yet</div>
                        <div style={{ fontSize: "11px", marginTop: "4px" }}>
                          Select a Consignment Column above and click <strong>Auto-Load Items</strong>, or search for products to add.
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
                        <td style={{ padding: "6px 8px", color: "#94a3b8", textAlign: "center" }}>{idx + 1}</td>

                        <td style={{ padding: "6px 8px" }}>
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
                          {item.product_code && (
                            <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "2px" }}>{item.product_code}</div>
                          )}
                        </td>
                        <td style={{ padding: "6px 6px" }}>
                          <input
                            type="text"
                            value={item.hsn_code || ""}
                            placeholder="HS Code"
                            onChange={(e) => updateItem(idx, "hsn_code", e.target.value)}
                            style={{
                              width: "100%",
                              padding: "4px 6px",
                              borderRadius: "4px",
                              border: "1px solid #cbd5e1",
                              fontSize: "11.5px",
                              boxSizing: "border-box",
                            }}
                          />
                        </td>
                        <td style={{ padding: "6px 6px", minWidth: "80px" }}>
                          <input
                            type="text"
                            value={item.uom || "NOS"}
                            placeholder="NOS"
                            onChange={(e) => updateItem(idx, "uom", e.target.value.toUpperCase())}
                            style={{
                              width: "100%",
                              padding: "4px 6px",
                              borderRadius: "4px",
                              border: "1px solid #cbd5e1",
                              fontSize: "11.5px",
                              textAlign: "center",
                              fontWeight: 600,
                              color: "#0f172a",
                              boxSizing: "border-box",
                            }}
                          />
                        </td>
                        <td style={{ padding: "6px 6px" }}>
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

                        {costingViewMode ? (
                          <>
                            {(() => {
                              const qtyN = Number(item.quantity) || 0;
                              const exVat = Number(item.unit_price_rmb_ex_vat) || 0;
                              const pPct = Number(item.profit_percent ?? profitPercent) || 0;
                              const priceWithProfit = Math.round(exVat * (1 + pPct / 100) * 100) / 100;
                              const cfr = Number(item.cfr_price_usd) || 0;
                              const isUsd = currency === "USD";
                              const unitUsd = isUsd ? (Number(item.unit_rate) || cfr) : cfr;
                              const totalUsd = Math.round(unitUsd * qtyN * 100) / 100;
                              return (
                                <>
                                  {/* 6. Unit Price (USD) = CFR Price/Unit (override allowed when currency is USD) */}
                                  <td style={{ padding: "6px 6px" }}>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      placeholder="0.00"
                                      value={unitUsd === 0 ? "" : unitUsd}
                                      readOnly={!isUsd}
                                      title={isUsd ? "Auto = CFR Price/Unit. You can type a negotiated price." : "Auto = CFR Price/Unit. Set Currency to USD to override."}
                                      onFocus={(e) => e.target.select()}
                                      onChange={(e) => updateItem(idx, "unit_rate", parseFloat(e.target.value) || 0)}
                                      style={{
                                        width: "100%",
                                        padding: "4px 6px",
                                        borderRadius: "4px",
                                        border: "1px solid #cbd5e1",
                                        fontSize: "11.5px",
                                        textAlign: "right",
                                        fontWeight: 700,
                                        color: "#1d4ed8",
                                        background: isUsd ? "#ffffff" : "#f8fafc",
                                        boxSizing: "border-box",
                                      }}
                                    />
                                  </td>
                                  {/* 7. Total Amount (USD) = Unit Price × Quantity */}
                                  <td style={{ padding: "6px 6px", textAlign: "right", fontWeight: 700, color: "#1d4ed8", fontSize: "11.5px" }}>
                                    $ {totalUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                  {/* 8. Unit Price(RMB) Including VAT — from Confirmed Local Purchase, editable */}
                                  <td style={{ padding: "6px 6px", background: "#fefce8" }}>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      placeholder="0.00"
                                      value={item.unit_price_rmb_with_vat === 0 ? "" : item.unit_price_rmb_with_vat}
                                      onFocus={(e) => e.target.select()}
                                      onChange={(e) => updateItem(idx, "unit_price_rmb_with_vat", parseFloat(e.target.value) || 0)}
                                      style={{
                                        width: "100%",
                                        padding: "4px 6px",
                                        borderRadius: "4px",
                                        border: "1px solid #cbd5e1",
                                        fontSize: "11.5px",
                                        textAlign: "right",
                                        fontWeight: 600,
                                        background: "#f0fdf4",
                                        color: "#166534",
                                        boxSizing: "border-box",
                                      }}
                                    />
                                  </td>
                                  {/* 9. Unit Price(RMB) Excluding VAT = Col 8 / 1.13 */}
                                  <td style={{ padding: "6px 6px", textAlign: "right", color: "#475569", fontWeight: 600, fontSize: "11.5px" }}>
                                    ¥ {exVat.toFixed(2)}
                                  </td>
                                  {/* 10. Including Profit % = Col 9 × (1 + Profit%) */}
                                  <td style={{ padding: "6px 6px", textAlign: "right", color: "#16a34a", fontWeight: 600, fontSize: "11.5px" }}>
                                    ¥ {priceWithProfit.toFixed(2)}
                                  </td>
                                  {/* 11. FOB PRICE (USD) = Col 10 / USD rate */}
                                  <td style={{ padding: "6px 6px", textAlign: "right", color: "#1e40af", fontWeight: 600, fontSize: "11.5px" }}>
                                    $ {Number(item.fob_price_usd || 0).toFixed(3)}
                                  </td>
                                  {/* 12. Freight, Local charges, COC (per unit) */}
                                  <td style={{ padding: "6px 6px", textAlign: "right", color: "#15803d", fontSize: "11.5px" }}>
                                    $ {Number(item.freight_unit_usd || 0).toFixed(3)}
                                  </td>
                                  {/* 13. CFR Price/Unit = ROUNDUP(FOB + Freight, 2) */}
                                  <td style={{ padding: "6px 6px", textAlign: "right", color: "#0f172a", fontWeight: 700, fontSize: "12px", background: "#fef9c3" }}>
                                    $ {cfr.toFixed(2)}
                                  </td>
                                </>
                              );
                            })()}
                            {/* 14. Supplier (from Confirmed Local Purchase) */}
                            <td style={{ padding: "6px 8px" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                <input
                                  type="text"
                                  placeholder="Supplier name..."
                                  value={item.supplier_name || ""}
                                  onChange={(e) => updateItem(idx, "supplier_name", e.target.value)}
                                  style={{
                                    width: "100%",
                                    padding: "3px 6px",
                                    borderRadius: "4px",
                                    border: "1px solid #cbd5e1",
                                    fontSize: "11.5px",
                                    boxSizing: "border-box",
                                  }}
                                />
                                {item.supplier_name && item.unit_price_rmb_with_vat && item.unit_price_rmb_with_vat > 0 ? (
                                  <span style={{ fontSize: "10px", color: "#059669", fontWeight: 700 }}>
                                    ✓ Local Purchase
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            {/* 15. Total CBM (editable) */}
                            <td style={{ padding: "6px 6px" }}>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                placeholder="0.000"
                                value={item.total_cbm === 0 ? "" : item.total_cbm}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  updateItem(idx, "total_cbm", val);
                                }}
                                style={{
                                  width: "100%",
                                  padding: "3px 5px",
                                  borderRadius: "4px",
                                  border: "1px solid #cbd5e1",
                                  fontSize: "11.5px",
                                  textAlign: "right",
                                  color: "#0891b2",
                                  fontWeight: 600,
                                  background: "#f0fdf4",
                                  boxSizing: "border-box",
                                }}
                              />
                            </td>
                            {/* 16. Total Supplier Amount = Col 8 × Quantity */}
                            <td style={{ padding: "6px 6px", textAlign: "right", color: "#059669", fontWeight: 700, fontSize: "11.5px" }}>
                              ¥ {Number(item.total_supplier_amount_rmb || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </>
                        ) : (
                          <>
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
                              {currencySymbol} {Number(item.tax_amount).toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, color: "#1d4ed8" }}>
                              {currencySymbol} {Number(item.item_total).toFixed(2)}
                            </td>
                          </>
                        )}

                        <td style={{ padding: "6px 8px" }}>
                          <input
                            type="text"
                            placeholder="Optional remark..."
                            value={item.remarks || ""}
                            onChange={(e) => updateItem(idx, "remarks", e.target.value)}
                            style={{
                              width: "100%",
                              padding: "4px 6px",
                              borderRadius: "4px",
                              border: "1px solid #cbd5e1",
                              fontSize: "11.5px",
                              boxSizing: "border-box",
                            }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "center" }}>
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
                      <td style={{ padding: "8px 6px", textAlign: "right", color: "#0f172a", borderTop: "2px solid #cbd5e1" }}>
                        {totals.qty.toLocaleString()}
                      </td>

                      {costingViewMode ? (
                        <>
                          <td style={{ borderTop: "2px solid #cbd5e1" }}></td>
                          <td style={{ padding: "8px 6px", textAlign: "right", color: "#1d4ed8", fontSize: "12.5px", borderTop: "2px solid #cbd5e1" }}>
                            $ {totals.totalUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td colSpan={7} style={{ borderTop: "2px solid #cbd5e1" }}></td>
                          <td style={{ padding: "8px 6px", textAlign: "right", color: "#0891b2", borderTop: "2px solid #cbd5e1" }}>
                            {totals.sumCbm.toFixed(3)} m³
                          </td>
                          <td style={{ padding: "8px 6px", textAlign: "right", color: "#059669", fontSize: "12.5px", borderTop: "2px solid #cbd5e1" }}>
                            ¥ {totals.supplierRmb.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </>
                      ) : (
                        <>
                          <td colSpan={2} style={{ borderTop: "2px solid #cbd5e1" }}></td>
                          <td style={{ padding: "8px 10px", textAlign: "right", color: "#64748b", borderTop: "2px solid #cbd5e1" }}>
                            {currencySymbol} {totals.tax.toFixed(2)}
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right", color: "#1d4ed8", fontSize: "13px", borderTop: "2px solid #cbd5e1" }}>
                            {currencySymbol} {totals.grand.toFixed(2)}
                          </td>
                        </>
                      )}

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
