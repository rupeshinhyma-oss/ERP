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
import type { PlanningSheet } from "@/types/planning";
import {
  getSaleOrderDetailCache,
  updateSaleOrderInCache,
  getCachedPlanningSheets,
  setCachedPlanningSheets,
} from "@/lib/saleProcessCache";

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
  // Entity Combobox (Organization & Buyer)
  const [selectedEntityType, setSelectedEntityType] = useState<"org" | "buyer" | "">("");
  const [selectedEntityId, setSelectedEntityId] = useState<string>("");
  const [entitySearch, setEntitySearch] = useState("");
  const [entityOpen, setEntityOpen] = useState(false);
  const entityDropdownRef = useRef<HTMLDivElement>(null);

  // Planning Sheet / Branch Combobox
  const [sheets, setSheets] = useState<PlanningSheet[]>(() => getCachedPlanningSheets() || []);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [selectedSheetId, setSelectedSheetId] = useState("");
  const [selectedSheetName, setSelectedSheetName] = useState("");
  const [sheetSearch, setSheetSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetDropdownRef = useRef<HTMLDivElement>(null);

  // Shipment Planning Consignment Integration (Searchable Combobox)
  const [consignments, setConsignments] = useState<PlanningConsignmentColumn[]>([]);
  const [selectedColumnId, setSelectedColumnId] = useState("");
  const [selectedConsignmentCode, setSelectedConsignmentCode] = useState("");
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
  const [etdOriginDate, setEtdOriginDate] = useState("");
  const [etaPortDate, setEtaPortDate] = useState("");
  const [remarks, setRemarks] = useState("");

  // Shipping & CI Costing Parameters (from official Yinglima export spreadsheet)
  const [oceanFreightUsd, setOceanFreightUsd] = useState<number>(0.0);
  const [localChargesCocUsd, setLocalChargesCocUsd] = useState<number>(0.0);
  const [usdExchangeRate, setUsdExchangeRate] = useState<number>(6.70);
  const [profitPercent, setProfitPercent] = useState<number>(3.00);
  const [totalContainerCbm, setTotalContainerCbm] = useState<number>(0.0);
  // Costing & supplier columns are always visible (toggle button removed 2026-10-30)
  const costingViewMode = true;

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
      category_name?: string;
      uom?: string;
    }>
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);

  // Dedicated Spares Picker Modal
  const [showSpareModal] = useState(false);
  const [spareSearch] = useState("");
  const [, setSpareSearchResults] = useState<
    Array<{
      id: string;
      product_name: string;
      product_code?: string;
      hsn_code?: string;
      standard_cost?: number;
      refund_vat_percent?: number;
      category_name?: string;
      uom?: string;
    }>
  >([]);
  const [, setSpareSearchLoading] = useState(false);

  // Quick fill rate tool


  // Submitting
  const [submitting, setSubmitting] = useState(false);
  const [initialLoading, setInitialLoading] = useState(() => isEdit && !getSaleOrderDetailCache(id || "")?.order);

  // Lookups
  const orgLookup = useLookup<{ id: string; name: string }>("/masters/company-list/lookup", 250);
  const buyerLookup = useLookup<{
    id: string;
    company_name: string;
    name?: string;
    branches?: Array<{ id: string; name: string }>;
  }>("/buyers", 500);

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

  // Close entity, sheet & consignment dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (entityDropdownRef.current && !entityDropdownRef.current.contains(e.target as Node)) {
        setEntityOpen(false);
      }
      if (sheetDropdownRef.current && !sheetDropdownRef.current.contains(e.target as Node)) {
        setSheetOpen(false);
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

  const populateFromOrder = (o: SaleOrder) => {
    setOrganizationId(o.organization_id);
    setOrganizationName(o.organization_name);
    setBuyerId(o.buyer_id || "");
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
    setEtdOriginDate(o.etd_origin_date ? String(o.etd_origin_date).slice(0, 10) : "");
    setEtaPortDate(o.eta_port_date ? String(o.eta_port_date).slice(0, 10) : "");
    setRemarks(o.remarks || "");
    setOceanFreightUsd(Number(o.ocean_freight_usd) || 0.0);
    setLocalChargesCocUsd(Number(o.local_charges_coc_usd) || 0.0);
    setUsdExchangeRate(Number(o.usd_exchange_rate) || 6.70);
    setProfitPercent(Number(o.profit_percent) || 3.00);
    setTotalContainerCbm(Number(o.total_container_cbm) || 0.0);

    if (o.items && o.items.length > 0) {
      setItems(o.items.map((it) => ({ ...it, uom: it.uom || "NOS", was_spare: Boolean(it.is_spare) })));
    }
  };

  // Load existing order if editing
  useEffect(() => {
    if (!isEdit || !id) return;

    const cached = getSaleOrderDetailCache(id);
    if (cached?.order) {
      populateFromOrder(cached.order);
      setInitialLoading(false);
    }

    let mounted = true;
    async function loadOrder() {
      try {
        const res = await apiGet<SaleOrder>(`/sales/orders/${id}`);
        if (mounted && res.data) {
          populateFromOrder(res.data);
          updateSaleOrderInCache(res.data);
        }
      } catch (err) {
        if (mounted && !cached?.order) toast(errorMessage(err), "error");
      } finally {
        if (mounted) setInitialLoading(false);
      }
    }
    loadOrder();
    return () => {
      mounted = false;
    };
  }, [id, isEdit, toast]);

  // Fetch ALL planning sheets across the ERP
  useEffect(() => {
    let mounted = true;
    const cachedSheets = getCachedPlanningSheets();
    if (cachedSheets && cachedSheets.length > 0) {
      setSheets(cachedSheets);
      setLoadingSheets(false);
    }

    async function fetchSheets() {
      if (!cachedSheets || cachedSheets.length === 0) {
        setLoadingSheets(true);
      }
      try {
        const res = await apiGet<PlanningSheet[]>("/planning/sheets");
        if (mounted && res.data) {
          setSheets(res.data);
          setCachedPlanningSheets(res.data);
        }
      } catch {
        // Fallback quietly
      } finally {
        if (mounted) setLoadingSheets(false);
      }
    }
    fetchSheets();
    return () => {
      mounted = false;
    };
  }, []);

  // Fetch consignment columns - filtered by selectedSheetId if set
  useEffect(() => {
    let mounted = true;
    async function fetchConsignments() {
      setLoadingConsignments(true);
      try {
        const url = selectedSheetId
          ? `/sales/planning-consignments?sheet_id=${selectedSheetId}`
          : "/sales/planning-consignments";
        const res = await apiGet<PlanningConsignmentColumn[]>(url);
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
  }, [selectedSheetId]);

  // Synchronize entity & sheet when loading an existing order
  useEffect(() => {
    if (selectedSheetId && sheets.length > 0) {
      const s = sheets.find((item) => item.id === selectedSheetId);
      if (s) {
        setSelectedSheetName(s.name);
        if (!selectedEntityId) {
          if (s.organization_id) {
            setSelectedEntityType("org");
            setSelectedEntityId(s.organization_id);
          } else if (s.buyer_id) {
            setSelectedEntityType("buyer");
            setSelectedEntityId(s.buyer_id);
          }
        }
      }
    } else if (buyerId && !selectedEntityId) {
      setSelectedEntityType("buyer");
      setSelectedEntityId(buyerId);
    }
  }, [selectedSheetId, sheets, buyerId, selectedEntityId]);

  // Filter available sheets based on selected entity (Organization or Buyer)
  // Filter available sheets based on selected entity (Organization or Buyer)
  // Strict Gating: If no Customer/Entity is selected, no sheets are available (locked)
  const availableSheets = useMemo(() => {
    if (!selectedEntityType || !selectedEntityId) {
      return [];
    }
    if (selectedEntityType === "org") {
      const org = orgLookup.items?.find((o) => o.id === selectedEntityId);
      const orgName = (org?.name || "").toLowerCase().trim();
      return sheets.filter((s) => {
        if (s.organization_id === selectedEntityId) return true;
        if (orgName && s.name.toLowerCase().includes(orgName)) return true;
        return false;
      });
    }
    if (selectedEntityType === "buyer") {
      const buyer = buyerLookup.items?.find((b) => b.id === selectedEntityId);
      const bName = (buyer?.company_name || buyer?.name || "").toLowerCase().trim();
      return sheets.filter((s) => {
        if (s.buyer_id === selectedEntityId) return true;
        if (bName && (s.name.toLowerCase().includes(bName) || bName.includes(s.name.toLowerCase()))) return true;
        return false;
      });
    }
    return [];
  }, [sheets, selectedEntityType, selectedEntityId, orgLookup.items, buyerLookup.items]);

  const filteredSheets = useMemo(() => {
    if (!sheetSearch.trim()) return availableSheets;
    const q = sheetSearch.trim().toLowerCase();
    return availableSheets.filter((s) => s.name.toLowerCase().includes(q));
  }, [availableSheets, sheetSearch]);

  // Search filtered organizations & buyers for entity dropdown
  const filteredOrgs = useMemo(() => {
    const q = entitySearch.trim().toLowerCase();
    if (!q) return orgLookup.items || [];
    return (orgLookup.items || []).filter((o) => o.name.toLowerCase().includes(q));
  }, [orgLookup.items, entitySearch]);

  const filteredBuyers = useMemo(() => {
    const q = entitySearch.trim().toLowerCase();
    if (!q) return buyerLookup.items || [];
    return (buyerLookup.items || []).filter((b) => {
      const name = (b.company_name || b.name || "").toLowerCase();
      return name.includes(q);
    });
  }, [buyerLookup.items, entitySearch]);

  // Filtered consignments for the combobox:
  // Strict Gating: only available when Customer AND Sheet are selected
  const filteredConsignments = useMemo(() => {
    if (!selectedEntityId || !selectedSheetId) {
      return [];
    }
    let list = consignments.filter((c) => c.sheet_id === selectedSheetId);
    if (consignmentSearch.trim()) {
      const q = consignmentSearch.trim().toLowerCase();
      list = list.filter((c) => {
        const nameMatch = c.column_name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
        const sheetMatch = c.sheet_name.toLowerCase().includes(q);
        const orgMatch = (c.organization_name || "").toLowerCase().includes(q);
        return nameMatch || sheetMatch || orgMatch;
      });
    }
    return list;
  }, [consignments, consignmentSearch, selectedEntityId, selectedSheetId]);

  // Complete Cascade Reset: Clear Customer and all dependent data & line items
  const handleClearCustomer = () => {
    setSelectedEntityType("");
    setSelectedEntityId("");
    setBuyerId("");
    setBuyerName("");
    setBuyerBranchId("");
    setBuyerBranchName("");
    setSelectedSheetId("");
    setSelectedSheetName("");
    setSelectedColumnId("");
    setSelectedConsignmentCode("");
    setConsignmentLoadedInfo(null);
    setTotalContainerCbm(0);
    setItems([]);
    setSheetOpen(false);
    setConsignmentOpen(false);
    setEntityOpen(false);
    setEntitySearch("");
  };

  // Complete Cascade Reset: Clear Sheet and dependent consignment & line items
  const handleClearSheet = () => {
    setSelectedSheetId("");
    setSelectedSheetName("");
    setSelectedColumnId("");
    setSelectedConsignmentCode("");
    setConsignmentLoadedInfo(null);
    setTotalContainerCbm(0);
    setItems([]);
    setSheetOpen(false);
    setConsignmentOpen(false);
    setSheetSearch("");
  };

  // Complete Cascade Reset: Clear Consignment Column and dependent line items
  const handleClearConsignment = () => {
    setSelectedColumnId("");
    setSelectedConsignmentCode("");
    setConsignmentLoadedInfo(null);
    setTotalContainerCbm(0);
    setItems([]);
    setConsignmentOpen(false);
    setConsignmentSearch("");
  };

  // Handle entity change (Organization or Buyer)
  const handleSelectEntity = (type: "org" | "buyer", entId: string, entName: string) => {
    if (entId !== selectedEntityId) {
      // Clear previous customer's sheet, consignment, and planned items
      setSelectedSheetId("");
      setSelectedSheetName("");
      setSelectedColumnId("");
      setSelectedConsignmentCode("");
      setConsignmentLoadedInfo(null);
      setTotalContainerCbm(0);
      setItems([]);
    }

    setSelectedEntityType(type);
    setSelectedEntityId(entId);
    setBuyerName(entName);

    if (type === "buyer") {
      setBuyerId(entId);
      const b = buyerLookup.items?.find((item) => item.id === entId);
      if (b?.branches && b.branches.length > 0) {
        setBuyerBranchId(b.branches[0].id);
        setBuyerBranchName(b.branches[0].name);
      } else {
        setBuyerBranchId("");
        setBuyerBranchName("");
      }
    } else {
      const matchingBuyer = buyerLookup.items?.find((b) => {
        const bName = (b.company_name || b.name || "").toLowerCase().trim();
        return bName === entName.toLowerCase().trim() || bName.startsWith(entName.toLowerCase().trim());
      });
      setBuyerId(matchingBuyer ? matchingBuyer.id : "");
      setBuyerBranchId("");
      setBuyerBranchName("");
    }

    setEntityOpen(false);
    setEntitySearch("");
  };

  // Handle sheet change
  const handleSelectSheet = (sheet: PlanningSheet) => {
    if (sheet.id !== selectedSheetId) {
      // Clear previous sheet's consignment and planned items
      setSelectedColumnId("");
      setSelectedConsignmentCode("");
      setConsignmentLoadedInfo(null);
      setTotalContainerCbm(0);
      setItems([]);
    }

    setSelectedSheetId(sheet.id);
    setSelectedSheetName(sheet.name);

    // If entity was not chosen yet, auto-set entity from sheet
    if (!selectedEntityId) {
      if (sheet.organization_id) {
        const org = orgLookup.items?.find((o) => o.id === sheet.organization_id);
        if (org) {
          setSelectedEntityType("org");
          setSelectedEntityId(org.id);
          setBuyerName(org.name);
        }
      } else if (sheet.buyer_id) {
        const buyer = buyerLookup.items?.find((b) => b.id === sheet.buyer_id);
        if (buyer) {
          setSelectedEntityType("buyer");
          setSelectedEntityId(buyer.id);
          setBuyerId(buyer.id);
          setBuyerName(buyer.company_name || buyer.name || "");
        }
      }
    }

    // Attempt to match a buyer for this specific sheet
    const sNameLower = sheet.name.toLowerCase().trim();
    const specificBuyer = buyerLookup.items?.find((b) => {
      const bName = (b.company_name || b.name || "").toLowerCase().trim();
      return bName.includes(sNameLower) || sNameLower.includes(bName);
    });
    if (specificBuyer) {
      setBuyerId(specificBuyer.id);
      setBuyerBranchId(specificBuyer.id);
      setBuyerBranchName(sheet.name);
    } else {
      setBuyerBranchName(sheet.name);
    }

    setSheetOpen(false);
    setSheetSearch("");
  };

  const handleSelectConsignment = (col: PlanningConsignmentColumn) => {
    setSelectedColumnId(col.column_id);
    setSelectedConsignmentCode(col.code || col.column_name);
    setSelectedSheetId(col.sheet_id);

    if (!selectedSheetName) {
      setSelectedSheetName(col.sheet_name);
    }

    setConsignmentOpen(false);
    setConsignmentSearch("");

    // Auto-load items immediately on selection for the newly chosen consignment column
    handleExtractConsignment(col.column_id);
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
          setItems([]);
          setTotalContainerCbm(0);
          setConsignmentLoadedInfo(null);
          toast(
            `No products with planned quantity > 0 found in consignment ${data.consignment_code}. Table reset.`,
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
            is_spare: Boolean(it.is_spare),
            was_spare: Boolean(it.is_spare),
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

  // Autocomplete search for Spares Modal (strictly spare products only)
  useEffect(() => {
    if (!showSpareModal) return;
    let mounted = true;
    const timer = setTimeout(async () => {
      setSpareSearchLoading(true);
      try {
        const query = spareSearch.trim() ? `&search=${encodeURIComponent(spareSearch.trim())}` : "";
        const res = await apiGet<any[]>(`/masters/products?is_spare=true&status=active&page_size=100${query}`);
        if (mounted && res.data) {
          const list = Array.isArray(res.data) ? res.data : [];
          setSpareSearchResults(list);
        }
      } catch {
        // quiet fallback
      } finally {
        if (mounted) setSpareSearchLoading(false);
      }
    }, 200);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [showSpareModal, spareSearch]);

  const handleAddProduct = async (
    p: {
      id: string;
      product_name: string;
      product_code?: string;
      hsn_code?: string;
      standard_cost?: number;
      refund_vat_percent?: number;
      uom?: string;
    },
    extraOpts?: { isSpare?: boolean }
  ) => {
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
    let taxPct = Number(p.refund_vat_percent) || 0.0;
    let isCostingSpare = false;

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
        isCostingSpare = Boolean(cd.is_spare);
        if (cd.uom) uomName = cd.uom;
        if (cd.refund_vat_percent) taxPct = cd.refund_vat_percent;
      }
    } catch {
      // quiet fallback
    }

    const isSpareFinal = Boolean(extraOpts?.isSpare ?? isCostingSpare);
    if (isSpareFinal && (!uomName || uomName === "NOS")) {
      uomName = "PCS";
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
      hsn_code: p.hsn_code || (isSpareFinal ? "8422.90.90" : null),
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
      is_spare: isSpareFinal,
      was_spare: isSpareFinal,
    };

    setItems((prev) => [...prev, newItem]);
    setProductSearch("");
    setShowSearchResults(false);
    toast(
      `Added ${isSpareFinal ? "⚙️ Spare Part: " : ""}${p.product_name}${supplierName ? ` (Supplier: ${supplierName})` : ""}`,
      "success"
    );
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
      const vatPct = Number(target.tax_percent) || 0.0;

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

  // Directly update USD Unit Price (Col 6)
  const updateItemUsdPrice = (index: number, usdVal: number) => {
    setItems((prev) => {
      const next = [...prev];
      const target = { ...next[index] };
      const qty = Number(target.quantity) || 0;
      const vatPct = Number(target.tax_percent) || 0.0;

      target.cfr_price_usd = usdVal;

      if (currency === "USD") {
        target.unit_rate = usdVal;
      } else {
        // When currency is RMB, unit_rate is in RMB: convert from USD @ exchange rate
        const rmbRate = Math.round(usdVal * (usdExchangeRate || 6.70) * 100) / 100;
        target.unit_rate = rmbRate;
      }

      const basic = qty * target.unit_rate;
      const taxAmt = (basic * vatPct) / 100.0;
      target.tax_amount = Math.round(taxAmt * 100) / 100;
      target.item_total = Math.round((basic + taxAmt) * 100) / 100;

      next[index] = target;
      return next;
    });

    if (usdVal > 0 && invalidRateIds.has(index)) {
      setInvalidRateIds((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };

  // Remove item
  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Convert a Spare Part line item to a standalone Product (or revert back) for this Sale Order only
  const toggleItemSpareStatus = (index: number, nextIsSpare: boolean) => {
    const targetName = items[index]?.product_name || "Item";
    setItems((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        is_spare: nextIsSpare,
        was_spare: true,
      };
      return next;
    });
    toast(
      nextIsSpare
        ? `"${targetName}" reverted to Spare Part for this sale order.`
        : `"${targetName}" converted to Product for this sale order (remains Spare in Product Master).`,
      "success"
    );
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

    if (!buyerName && !buyerId) {
      toast("Please select an Entity (Buyer or Organization).", "error");
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
        buyer_id: buyerId || null,
        buyer_name: buyerName || (selectedSheetName ? selectedSheetName : "Customer"),
        buyer_branch_id: buyerBranchId || null,
        buyer_branch_name: buyerBranchName || selectedSheetName || null,
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
        etd_origin_date: etdOriginDate || null,
        eta_port_date: etaPortDate || null,
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
          is_spare: Boolean(it.is_spare),
        })),
      };

      if (isEdit) {
        const res = await apiPatch<SaleOrder>(`/sales/orders/${id}`, payload);
        if (res.data) updateSaleOrderInCache(res.data);
        toast("Sale order updated successfully!", "success");
      } else {
        const res = await apiPost<SaleOrder>(`/sales/orders`, payload);
        if (res.data) updateSaleOrderInCache(res.data);
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
            <h1 className="page-title">
              {isEdit ? "Edit Sale Process Order" : "New Sale Process Order"}
            </h1>
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

            {/* Row 1: 3-Level Shipment Planning Hierarchy (Entity -> Sheet/Branch -> Consignment Column) */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: "16px",
                marginBottom: "16px",
                width: "100%",
                minWidth: 0,
              }}
            >
              {/* 1. Entity (Organization or Buyer) Combobox */}
              <div ref={entityDropdownRef} style={{ position: "relative", minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>
                    Customer / Entity <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>
                    {(orgLookup.items?.length || 0) + (buyerLookup.items?.length || 0)} available
                  </span>
        </div>

                {/* Trigger button */}
                <button
                  type="button"
                  onClick={() => {
                    setEntityOpen((o) => !o);
                    setEntitySearch("");
                  }}
                  style={{
                    width: "100%",
                    minWidth: 0,
                    overflow: "hidden",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: selectedEntityId ? "1.5px solid #93C5FD" : "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: selectedEntityId ? (selectedEntityType === "org" ? "#EFF6FF" : "#F0FDF4") : "#fff",
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    color: selectedEntityId ? "#0f172a" : "#94a3b8",
                    fontWeight: selectedEntityId ? 600 : 400,
                  }}
                >
                  <span style={{ flex: "1 1 0%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {selectedEntityId ? (
                      selectedEntityType === "org" ? `🏢 ${buyerName}` : `👤 ${buyerName}`
                    ) : (
                      "-- Select Entity (Organization or Buyer) --"
                    )}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                    {selectedEntityId && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearCustomer();
                        }}
                        style={{ fontSize: "12px", color: "#94a3b8", padding: "2px 4px", cursor: "pointer" }}
                        title="Clear entity"
                      >
                        ✕
                      </span>
                    )}
                    <span style={{ fontSize: "10px", color: "#64748b" }}>{entityOpen ? "▲" : "▼"}</span>
          </div>
                </button>

                {/* Dropdown panel */}
                {entityOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      background: "#fff",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      boxShadow: "0 10px 25px -5px rgba(0,0,0,0.15)",
                      zIndex: 999,
                      overflow: "hidden",
                    }}
                  >
                    {/* Search input */}
                    <div style={{ padding: "8px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" }}>
                      <input
                        autoFocus
                        type="text"
                        placeholder="🔍 Search organization or buyer..."
                        value={entitySearch}
                        onChange={(e) => setEntitySearch(e.target.value)}
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

                    {/* Options list */}
                    <div style={{ maxHeight: "250px", overflowY: "auto" }}>
                      {/* Clear Option */}
                      <div
                        onClick={() => handleClearCustomer()}
                        style={{ padding: "8px 12px", fontSize: "12px", color: "#94a3b8", cursor: "pointer", fontStyle: "italic" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        -- Select Entity (Organization or Buyer) --
              </div>

                      {/* Internal Organizations Group */}
                      {filteredOrgs.length > 0 && (
                        <div>
                          <div
                            style={{
                              padding: "6px 12px",
                              fontSize: "11px",
                              fontWeight: 800,
                              textTransform: "uppercase",
                              letterSpacing: "0.5px",
                              color: "#1D4ED8",
                              background: "#EFF6FF",
                              borderTop: "1px solid #DBEAFE",
                              borderBottom: "1px solid #DBEAFE",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                              <span>🏢</span>
                              <span>INTERNAL ORGANIZATIONS</span>
                            </span>
                            <span style={{ background: "#DBEAFE", color: "#1E40AF", borderRadius: "10px", padding: "1px 6px", fontSize: "10px", fontWeight: 700 }}>
                              {filteredOrgs.length}
                            </span>
                  </div>
                          {filteredOrgs.map((org) => {
                            const isSelected = selectedEntityType === "org" && selectedEntityId === org.id;
                            return (
                              <div
                                key={org.id}
                                onClick={() => handleSelectEntity("org", org.id, org.name)}
                                style={{
                                  padding: "8px 14px",
                                  fontSize: "12.5px",
                                  cursor: "pointer",
                                  fontWeight: isSelected ? 700 : 400,
                                  color: isSelected ? "#1d4ed8" : "#1e293b",
                                  background: isSelected ? "#eff6ff" : "transparent",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                }}
                                onMouseEnter={(e) => {
                                  if (!isSelected) e.currentTarget.style.background = "#f8fafc";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = isSelected ? "#eff6ff" : "transparent";
                                }}
                              >
                                <span>{org.name}</span>
                                {isSelected && <span style={{ fontSize: "11px", color: "#1d4ed8" }}>✔</span>}
                      </div>
                            );
                          })}
                </div>
                      )}

                      {/* Buyers Group */}
                      {filteredBuyers.length > 0 && (
                        <div>
                          <div
                            style={{
                              padding: "6px 12px",
                              fontSize: "11px",
                              fontWeight: 800,
                              textTransform: "uppercase",
                              letterSpacing: "0.5px",
                              color: "#0369A1",
                              background: "#F0F9FF",
                              borderTop: "1px solid #BAE6FD",
                              borderBottom: "1px solid #BAE6FD",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                              <span>👤</span>
                              <span>BUYERS</span>
                            </span>
                            <span style={{ background: "#BAE6FD", color: "#0369A1", borderRadius: "10px", padding: "1px 6px", fontSize: "10px", fontWeight: 700 }}>
                              {filteredBuyers.length}
                            </span>
                  </div>
                          {filteredBuyers.map((b) => {
                            const bName = b.company_name || b.name || "";
                            const isSelected = selectedEntityType === "buyer" && selectedEntityId === b.id;
                            return (
                              <div
                                key={b.id}
                                onClick={() => handleSelectEntity("buyer", b.id, bName)}
                                style={{
                                  padding: "8px 14px",
                                  fontSize: "12.5px",
                                  cursor: "pointer",
                                  fontWeight: isSelected ? 700 : 400,
                                  color: isSelected ? "#0369a1" : "#1e293b",
                                  background: isSelected ? "#f0f9ff" : "transparent",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                }}
                                onMouseEnter={(e) => {
                                  if (!isSelected) e.currentTarget.style.background = "#f8fafc";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = isSelected ? "#f0f9ff" : "transparent";
                                }}
                              >
                                <span>{bName}</span>
                                {isSelected && <span style={{ fontSize: "11px", color: "#0369a1" }}>✔</span>}
                      </div>
                            );
                          })}
                </div>
                      )}

                      {filteredOrgs.length === 0 && filteredBuyers.length === 0 && (
                        <div style={{ padding: "12px", textAlign: "center", color: "#94a3b8", fontSize: "12px" }}>
                          No entities match "{entitySearch}"
                </div>
                      )}
            </div>
          </div>
                )}
      </div>

              {/* 2. Planning Sheet / Branch Combobox */}
              <div ref={sheetDropdownRef} style={{ position: "relative", minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>
                    Planning Sheet / Branch
                  </label>
                  {!selectedEntityId ? (
                    <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600 }}>🔒 Locked</span>
                  ) : loadingSheets ? (
                    <span style={{ fontSize: "11px", color: "#0284c7", fontWeight: 600 }}>Loading sheets...</span>
                  ) : (
                    <span style={{ fontSize: "11px", color: "#64748b" }}>
                      {availableSheets.length} sheet{availableSheets.length === 1 ? "" : "s"}
                    </span>
                  )}
        </div>

                {/* Trigger button */}
                <button
                  type="button"
                  disabled={!selectedEntityId}
                  onClick={() => {
                    if (!selectedEntityId) return;
                    setSheetOpen((o) => !o);
                    setSheetSearch("");
                  }}
                  style={{
                    width: "100%",
                    minWidth: 0,
                    overflow: "hidden",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: !selectedEntityId
                      ? "1px dashed #cbd5e1"
                      : selectedSheetId
                      ? "1.5px solid #A7F3D0"
                      : "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: !selectedEntityId ? "#f8fafc" : selectedSheetId ? "#ECFDF5" : "#fff",
                    textAlign: "left",
                    cursor: !selectedEntityId ? "not-allowed" : "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    color: !selectedEntityId ? "#94a3b8" : selectedSheetId ? "#065f46" : "#475569",
                    fontWeight: selectedSheetId ? 600 : 400,
                    opacity: !selectedEntityId ? 0.75 : 1,
                  }}
                >
                  <span style={{ flex: "1 1 0%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {!selectedEntityId ? (
                      "🔒 Select Customer / Entity first"
                    ) : selectedSheetName ? (
                      `📄 ${selectedSheetName}`
                    ) : (
                      `-- Select Sheet in ${buyerName} --`
                    )}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                    {selectedEntityId && selectedSheetId && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearSheet();
                        }}
                        style={{ fontSize: "12px", color: "#94a3b8", padding: "2px 4px", cursor: "pointer" }}
                        title="Clear sheet"
                      >
                        ✕
                      </span>
                    )}
                    <span style={{ fontSize: "10px", color: "#64748b" }}>{sheetOpen ? "▲" : "▼"}</span>
          </div>
                </button>

                {/* Dropdown panel */}
                {selectedEntityId && sheetOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      background: "#fff",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      boxShadow: "0 10px 25px -5px rgba(0,0,0,0.15)",
                      zIndex: 999,
                      overflow: "hidden",
                    }}
                  >
                    {/* Search input if multiple sheets */}
                    {availableSheets.length > 4 && (
                      <div style={{ padding: "8px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" }}>
                        <input
                          autoFocus
                          type="text"
                          placeholder="🔍 Search sheet..."
                          value={sheetSearch}
                          onChange={(e) => setSheetSearch(e.target.value)}
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
                    )}

                    {/* Options list */}
                    <div style={{ maxHeight: "250px", overflowY: "auto" }}>
                      <div
                        onClick={() => handleClearSheet()}
                        style={{ padding: "8px 12px", fontSize: "12px", color: "#94a3b8", cursor: "pointer", fontStyle: "italic" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        -- All Sheets / Clear Selection --
              </div>

                      {filteredSheets.map((s) => {
                        const isSelected = selectedSheetId === s.id;
                        const org = orgLookup.items?.find((o) => o.id === s.organization_id);
                        const buyer = buyerLookup.items?.find((b) => b.id === s.buyer_id);
                        return (
                          <div
                            key={s.id}
                            onClick={() => handleSelectSheet(s)}
                            style={{
                              padding: "8px 14px",
                              fontSize: "12.5px",
                              cursor: "pointer",
                              fontWeight: isSelected ? 700 : 500,
                              color: isSelected ? "#065f46" : "#1e293b",
                              background: isSelected ? "#ecfdf5" : "transparent",
                              borderBottom: "1px solid #f8fafc",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected) e.currentTarget.style.background = "#f8fafc";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = isSelected ? "#ecfdf5" : "transparent";
                            }}
                          >
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                              <span>📄</span>
                              <span>{s.name}</span>
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              {org && (
                                <span style={{ fontSize: "10.5px", background: "#dbeafe", color: "#1e40af", padding: "1px 6px", borderRadius: "4px", fontWeight: 600 }}>
                                  {org.name}
                                </span>
                              )}
                              {buyer && (
                                <span style={{ fontSize: "10.5px", background: "#e0f2fe", color: "#0369a1", padding: "1px 6px", borderRadius: "4px", fontWeight: 600 }}>
                                  {buyer.company_name || buyer.name}
                                </span>
                              )}
                              {isSelected && <span style={{ fontSize: "11px", color: "#065f46" }}>✔</span>}
                    </div>
                  </div>
                        );
                      })}

                      {filteredSheets.length === 0 && (
                        <div style={{ padding: "12px", textAlign: "center", color: "#94a3b8", fontSize: "12px" }}>
                          No sheets found {selectedEntityId ? `under ${buyerName}` : ""}
                </div>
                      )}
            </div>
          </div>
                )}
      </div>

              {/* 3. Planning Consignment Column Combobox */}
              <div ref={consignmentDropdownRef} style={{ position: "relative", minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>
                    Planning Consignment Column
                  </label>
                  {!selectedEntityId ? (
                    <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600 }}>🔒 Locked</span>
                  ) : !selectedSheetId ? (
                    <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600 }}>🔒 Select Sheet first</span>
                  ) : loadingConsignments ? (
                    <span style={{ fontSize: "11px", color: "#0284c7", fontWeight: 600 }}>Loading...</span>
                  ) : (
                    <span style={{ fontSize: "11px", color: "#64748b" }}>{filteredConsignments.length} available</span>
                  )}
        </div>

                <div style={{ display: "flex", gap: "8px", alignItems: "center", width: "100%", minWidth: 0 }}>
                  {/* Combobox Trigger Button */}
                  <div style={{ flex: "1 1 0%", minWidth: 0, position: "relative" }}>
                    <button
                      type="button"
                      disabled={!selectedEntityId || !selectedSheetId}
                      onClick={() => {
                        if (!selectedEntityId || !selectedSheetId) return;
                        setConsignmentOpen((prev) => !prev);
                      }}
                      title={selectedColumnId ? (() => {
                        const col = consignments.find((c) => c.column_id === selectedColumnId);
                        if (!col) return selectedConsignmentCode || "Consignment Selected";
                        return `${col.column_name} (${col.sheet_name} • ${col.item_count} items • ${col.total_quantity} pcs)`;
                      })() : undefined}
                      style={{
                        width: "100%",
                        minWidth: 0,
                        overflow: "hidden",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        border: (!selectedEntityId || !selectedSheetId)
                          ? "1px dashed #cbd5e1"
                          : selectedColumnId
                          ? "1.5px solid #BAE6FD"
                          : "1px solid #cbd5e1",
                        fontSize: "13px",
                        background: (!selectedEntityId || !selectedSheetId) ? "#f8fafc" : selectedColumnId ? "#F0F9FF" : "#fff",
                        textAlign: "left",
                        cursor: (!selectedEntityId || !selectedSheetId) ? "not-allowed" : "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        color: (!selectedEntityId || !selectedSheetId) ? "#94a3b8" : selectedColumnId ? "#0369a1" : "#475569",
                        fontWeight: selectedColumnId ? 600 : 400,
                        opacity: (!selectedEntityId || !selectedSheetId) ? 0.75 : 1,
                      }}
                    >
                      <span style={{ flex: "1 1 0%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {!selectedEntityId ? (
                          "🔒 Select Customer first"
                        ) : !selectedSheetId ? (
                          "🔒 Select Sheet first"
                        ) : selectedColumnId ? (() => {
                          const col = consignments.find((c) => c.column_id === selectedColumnId);
                          if (!col) return selectedConsignmentCode || "Consignment Selected";
                          return `${col.column_name} • ${col.item_count} items (${col.total_quantity} pcs)`;
                        })() : (
                          selectedSheetName ? `🔍 Select consignment in ${selectedSheetName}...` : "🔍 Select consignment column..."
                        )}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                        {selectedEntityId && selectedSheetId && selectedColumnId && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              handleClearConsignment();
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
                    {selectedEntityId && selectedSheetId && consignmentOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: "calc(100% + 4px)",
                          left: 0,
                          right: 0,
                          background: "#fff",
                          border: "1px solid #cbd5e1",
                          borderRadius: "8px",
                          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.15)",
                          zIndex: 999,
                          overflow: "hidden",
                        }}
                      >
                        {/* Search Input */}
                        <div style={{ padding: "8px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                          <input
                            type="text"
                            placeholder="Type to filter column..."
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
                              {selectedSheetName
                                ? `No consignment columns found in sheet "${selectedSheetName}"`
                                : `No consignments match "${consignmentSearch}"`}
                    </div>
                          ) : (
                            filteredConsignments.map((c) => {
                              const isSelected = c.column_id === selectedColumnId;
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
                                      <span style={{ fontSize: "11px", color: "#64748b" }}>
                                        ({c.sheet_name})
                                      </span>
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
                    disabled={!selectedEntityId || !selectedSheetId || !selectedColumnId || extractingItems}
                    onClick={() => handleExtractConsignment()}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      background: (selectedEntityId && selectedSheetId && selectedColumnId && !extractingItems) ? "#0284c7" : "#e2e8f0",
                      color: (selectedEntityId && selectedSheetId && selectedColumnId && !extractingItems) ? "#ffffff" : "#94a3b8",
                      border: "none",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: (selectedEntityId && selectedSheetId && selectedColumnId && !extractingItems) ? "pointer" : "not-allowed",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      boxShadow: (selectedEntityId && selectedSheetId && selectedColumnId && !extractingItems) ? "0 1px 3px rgba(2,132,199,0.3)" : "none",
                    }}
                    title="Load all products with quantity > 0 and remarks from this consignment column"
                  >
                    {extractingItems ? (
                      <>
                        <span className="spinner" style={{ width: "12px", height: "12px", border: "2px solid #ffffff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 1s linear infinite" }} />
                        <span>Loading...</span>
                      </>
                    ) : (
                      <>
                        <span>⚡</span>
                        <span>Auto-Load</span>
                      </>
                    )}
                  </button>
        </div>
      </div>
            </div>

            {/* Row 2: Order Metadata */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "16px",
              }}
            >

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

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  ETD Origin Date
                </label>
                <input
                  type="date"
                  value={etdOriginDate}
                  onChange={(e) => setEtdOriginDate(e.target.value)}
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
                  ETA Port Date
                </label>
                <input
                  type="date"
                  value={etaPortDate}
                  onChange={(e) => setEtaPortDate(e.target.value)}
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
                {(() => {
                  const spareCount = items.filter((it) => it.is_spare).length;
                  const machineCount = items.length - spareCount;
                  return (
                    <>
                      <span style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b" }}>
                        📦 Planned Line Items ({items.length} Products{spareCount > 0 ? `: ${machineCount} Machines, ${spareCount} Spares` : ""})
                      </span>
                      {spareCount > 0 && (
                        <div style={{ marginTop: "4px", fontSize: "11px", color: "#c2410c", background: "#fff7ed", border: "1px solid #fed7aa", padding: "2px 8px", borderRadius: "4px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          <span>⚙️</span>
                          <span><strong>{spareCount} Spare Part(s) selected:</strong> highlighted in light orange; will consolidate into 1 line on CI/PL, with full itemized breakdown on Sheet 2 (Spares).</span>
                </div>
                      )}
                    </>
                  );
                })()}
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
                    items.map((item, idx) => {
                      const isSpare = Boolean(item.is_spare);
                      const isInvalid = invalidRateIds.has(idx);

                      // If spare product, highlight in clean light orange!
                      const rowBg = isInvalid
                        ? "#fff1f2"
                        : isSpare
                        ? "#fff7ed"
                        : idx % 2 === 0
                        ? "#ffffff"
                        : "#fcfdfe";

                      return (
                      <tr
                        key={item.id || idx}
                        data-row-index={idx}
                        style={{
                          borderBottom: isSpare ? "1px solid #fed7aa" : "1px solid #f1f5f9",
                          backgroundColor: rowBg,
                          transition: "background-color 0.3s",
                        }}
                      >
                        <td style={{ padding: "6px 8px", color: isSpare ? "#c2410c" : "#94a3b8", fontWeight: isSpare ? 700 : 400, textAlign: "center" }}>{idx + 1}</td>

                        <td style={{ padding: "6px 8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                            <input
                              type="text"
                              value={item.product_name}
                              onChange={(e) => updateItem(idx, "product_name", e.target.value)}
                              style={{
                                flex: 1,
                                padding: "4px 6px",
                                borderRadius: "4px",
                                border: isSpare ? "1px solid #fdba74" : "1px solid #cbd5e1",
                                background: isSpare ? "#fffaf5" : "#ffffff",
                                fontSize: "12px",
                                fontWeight: 600,
                                boxSizing: "border-box",
                              }}
                              required
                            />
                            {/* If spare product, show clean light-orange badge without emoji and non-clickable */}
                            {isSpare && (
                              <span
                                title="Spare Part: consolidates on CI/PL into single spare line"
                                style={{
                                  flexShrink: 0,
                                  padding: "2px 7px",
                                  borderRadius: "4px",
                                  fontSize: "10.5px",
                                  fontWeight: 700,
                                  border: "1px solid #fdba74",
                                  background: "#ffedd5",
                                  color: "#c2410c",
                                  letterSpacing: "0.2px",
                                  userSelect: "none",
                                }}
                              >
                                Spare Part
                              </span>
                            )}
                            {isSpare && (
                              <button
                                type="button"
                                onClick={() => toggleItemSpareStatus(idx, false)}
                                title="Convert this spare item into a regular Product line for this sale order only (Product Master remains unchanged)"
                                style={{
                                  flexShrink: 0,
                                  padding: "2px 8px",
                                  borderRadius: "4px",
                                  fontSize: "10.5px",
                                  fontWeight: 700,
                                  border: "1px solid #3b82f6",
                                  background: "#eff6ff",
                                  color: "#1d4ed8",
                                  cursor: "pointer",
                                  letterSpacing: "0.2px",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                ⇄ Make Product
                              </button>
                            )}
                            {!isSpare && item.was_spare && (
                              <button
                                type="button"
                                onClick={() => toggleItemSpareStatus(idx, true)}
                                title="Revert back to Spare Part for this sale order"
                                style={{
                                  flexShrink: 0,
                                  padding: "2px 8px",
                                  borderRadius: "4px",
                                  fontSize: "10.5px",
                                  fontWeight: 700,
                                  border: "1px solid #fdba74",
                                  background: "#fff7ed",
                                  color: "#c2410c",
                                  cursor: "pointer",
                                  letterSpacing: "0.2px",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                ↩ Make Spare
                              </button>
                            )}
                            {false && (
                              <span>
                              </span>
                            )}
                  </div>
                          {item.product_code && (
                            <div style={{ fontSize: "10px", color: isSpare ? "#ea580c" : "#94a3b8", marginTop: "2px" }}>{item.product_code}</div>
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
                              const unitUsd = cfr > 0 
                                ? cfr 
                                : (isUsd ? (Number(item.unit_rate) || 0) : (Number(item.unit_rate) > 0 ? Math.round((Number(item.unit_rate) / (usdExchangeRate || 6.70)) * 100) / 100 : 0));
                              const totalUsd = Math.round(unitUsd * qtyN * 100) / 100;
                              return (
                                <>
                                  {/* 6. Unit Price (USD) = CFR Price/Unit or custom selling price (Always Editable!) */}
                                  <td style={{ padding: "6px 6px" }}>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      placeholder="0.00"
                                      value={unitUsd === 0 ? "" : unitUsd}
                                      title="Editable: enter your selling unit price in USD"
                                      onFocus={(e) => e.target.select()}
                                      onChange={(e) => updateItemUsdPrice(idx, parseFloat(e.target.value) || 0)}
                                      style={{
                                        width: "100%",
                                        padding: "4px 6px",
                                        borderRadius: "4px",
                                        border: "1.5px solid #93c5fd",
                                        fontSize: "11.5px",
                                        textAlign: "right",
                                        fontWeight: 700,
                                        color: "#1d4ed8",
                                        background: "#ffffff",
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
                                  {/* 9. Unit Price(RMB) Excluding VAT = Col 8 / (1 + vatPct/100) */}
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
                      );
                    })
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
