/**
 * VAT Return (China Export Tax Rebate / 出口退税) Page (`/finance/vat-return`).
 *
 * Automatically pulls all Confirmed Sales Process orders (and supports Excel/CSV Import & Export
 * for historical `EXP` shipments), calculating shipment-level and product-level VAT rebates using:
 *   VAT To Be Returned (¥) = (Total RMB Inclusive VAT / (1 + Purchase VAT %)) * Refund VAT %
 *
 * Includes:
 * - 4 Interactive KPI Summary Cards with active blue border sync
 * - Financial Year Tabs (`All Years`, `FY 2026-2027`, `FY 2025-2026`, `FY 2024-2025`, `FY 2023-2024`)
 * - Stage Filter Tabs (`All`, `Pending`, `Partial Received`, `Received`, `No VAT`)
 * - `Imp / Exp ▾` Dropdown (`Sample File`, `Import Excel/CSV`, `Export Excel`) + `+ New EXP Entry`
 * - Clickable `EXP No.` opening the Per-Shipment Product & Supplier VAT Breakdown Modal (Table 2)
 *   with inline VAT Rebate % (`13%`, `9%`, `0%`), Contract No., RMB Price, and Remarks editing
 * - 3-dot (`⋮`) row menu for recording Full/Partial VAT Receipts, viewing Receipt History, and editing metadata.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPostMultipart,
  downloadExport,
  errorMessage,
} from "@/lib/api";
import { Auth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useToast } from "@/lib/toast";
import type {
  VatReturnBreakdownItem,
  VatReturnListResponse,
  VatReturnReceiptCreatePayload,
  VatReturnReceiptItem,
  VatReturnRow,
  VatReturnStageFilter,
  VatReturnStatus,
  VatReturnUpdatePayload,
} from "@/types/finance";

let cachedVatReturnData: VatReturnListResponse | null = null;

function fmtMoney(val: number | null | undefined, symbol = "¥"): string {
  const num = Number(val ?? 0);
  return `${symbol} ${num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const clean = d.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const [y, m, day] = clean.split("-");
    return `${day}-${m}-${y}`;
  }
  return clean;
}

function computeItemVatReturn(
  totalRmbInclVat: number,
  purchaseVatPct: number,
  refundVatPct: number
): number {
  if (totalRmbInclVat <= 0 || refundVatPct <= 0) return 0;
  const denom = 1 + (purchaseVatPct >= 0 ? purchaseVatPct / 100 : 0.13);
  return Number(((totalRmbInclVat / (denom > 0 ? denom : 1.13)) * (refundVatPct / 100)).toFixed(2));
}

function statusBadgeStyle(status: VatReturnStatus): React.CSSProperties {
  if (status === "RECEIVED") {
    return {
      background: "#dcfce7",
      color: "#15803d",
      border: "1px solid #86efac",
    };
  }
  if (status === "PARTIAL RECEIVED") {
    return {
      background: "#fef3c7",
      color: "#b45309",
      border: "1px solid #fde68a",
    };
  }
  if (status === "NO VAT") {
    return {
      background: "#f1f5f9",
      color: "#475569",
      border: "1px solid #cbd5e1",
    };
  }
  return {
    background: "#fee2e2",
    color: "#b91c1c",
    border: "1px solid #fecaca",
  };
}

export function VatReturnPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  // Granular Action Permissions for VAT Return
  const canCreateVatReturn = Auth.hasPermission("vat_return.create");
  const canUpdateVatReturn = Auth.hasPermission("vat_return.update");
  const canManageVatReceipt = Auth.hasPermission("vat_return.receipt");
  const canImportVatReturn = Auth.hasPermission("vat_return.import");
  const canExportVatReturn = Auth.hasPermission("vat_return.export");

  const initialStage = (searchParams.get("stage") as VatReturnStageFilter) || "all";
  const initialFy = searchParams.get("fy") || "all";

  const [data, setData] = useState<VatReturnListResponse | null>(cachedVatReturnData);
  const [loading, setLoading] = useState<boolean>(!cachedVatReturnData);

  const [activeStage, setActiveStage] = useState<VatReturnStageFilter>(initialStage);
  const [activeFy, setActiveFy] = useState<string>(initialFy);
  const [search, setSearch] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [showFilterBar, setShowFilterBar] = useState<boolean>(false);

  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Dropdowns
  const [impExpOpen, setImpExpOpen] = useState<boolean>(false);
  const impExpRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importingFile, setImportingFile] = useState<boolean>(false);
  const [exportingFile, setExportingFile] = useState<boolean>(false);

  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);

  // Modals
  const [breakdownRowKey, setBreakdownRowKey] = useState<string | null>(null);
  const [breakdownDraft, setBreakdownDraft] = useState<VatReturnBreakdownItem[]>([]);
  const [savingBreakdown, setSavingBreakdown] = useState<boolean>(false);

  const [receiptModalRow, setReceiptModalRow] = useState<VatReturnRow | null>(null);
  const [receiptDate, setReceiptDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [receiptAmount, setReceiptAmount] = useState<string>("");
  const [receiptRefNo, setReceiptRefNo] = useState<string>("");
  const [receiptRemarks, setReceiptRemarks] = useState<string>("");
  const [savingReceipt, setSavingReceipt] = useState<boolean>(false);

  const [historyModalRowKey, setHistoryModalRowKey] = useState<string | null>(null);
  const [deletingReceiptId, setDeletingReceiptId] = useState<string | null>(null);

  const [editMetaRow, setEditMetaRow] = useState<VatReturnRow | null>(null);
  const [metaFilingDate, setMetaFilingDate] = useState<string>("");
  const [metaReceivingDateText, setMetaReceivingDateText] = useState<string>("");
  const [metaStatusOverride, setMetaStatusOverride] = useState<string>("");
  const [metaTotalVatOverride, setMetaTotalVatOverride] = useState<string>("");
  const [metaRemarks, setMetaRemarks] = useState<string>("");
  const [savingMeta, setSavingMeta] = useState<boolean>(false);

  const [showNewModal, setShowNewModal] = useState<boolean>(false);
  const [newExpNo, setNewExpNo] = useState<string>("");
  const [newInvoiceDate, setNewInvoiceDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [newConsignment, setNewConsignment] = useState<string>("");
  const [newBuyerName, setNewBuyerName] = useState<string>("");
  const [newTotalVatRmb, setNewTotalVatRmb] = useState<string>("");
  const [newReceivedVatRmb, setNewReceivedVatRmb] = useState<string>("0");
  const [newFilingDate, setNewFilingDate] = useState<string>("");
  const [newRemarks, setNewRemarks] = useState<string>("");
  const [creatingNew, setCreatingNew] = useState<boolean>(false);

  const fetchVatReturns = useCallback(async (silent = false) => {
    if (!silent && !cachedVatReturnData) {
      setLoading(true);
    }
    try {
      const res = await apiGet<VatReturnListResponse>("/finance/vat-returns?stage=all");
      if (res.data) {
        cachedVatReturnData = res.data;
        setData(res.data);
      }
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchVatReturns();
  }, [fetchVatReturns]);

  // Close menus on outside click
  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      if (impExpRef.current && !impExpRef.current.contains(e.target as Node)) {
        setImpExpOpen(false);
      }
      setOpenMenuKey(null);
    };
    document.addEventListener("click", handleDocClick);
    return () => document.removeEventListener("click", handleDocClick);
  }, []);

  const handleStageSelect = (st: VatReturnStageFilter) => {
    setActiveStage(st);
    setCurrentPage(1);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("stage", st);
      return next;
    }, { replace: true });
  };

  const handleFySelect = (fy: string) => {
    setActiveFy(fy);
    setCurrentPage(1);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("fy", fy);
      return next;
    }, { replace: true });
  };

  // Filter rows client-side by Financial Year, Date Range, and Search for instant 0ms tab & KPI switching
  const fyAndSearchFilteredRows = useMemo(() => {
    const allItems = data?.items || [];
    const q = search.trim().toLowerCase();
    return allItems.filter((r) => {
      if (activeFy !== "all" && r.financial_year !== activeFy) return false;
      if (dateFrom && r.invoice_date && r.invoice_date < dateFrom) return false;
      if (dateTo && r.invoice_date && r.invoice_date > dateTo) return false;
      if (q) {
        const hay = [
          r.exp_no,
          r.consignment_code,
          r.buyer_name,
          r.status,
          r.remarks,
          r.receiving_date_display,
          ...r.breakdown_items.map((bi) => `${bi.supplier_name} ${bi.product_name} ${bi.contract_no || ""}`),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, activeFy, dateFrom, dateTo, search]);

  // Compute live KPIs from `fyAndSearchFilteredRows`
  const liveKpi = useMemo(() => {
    const rate = data?.kpi?.usd_to_rmb_rate || 7.2;
    const totalRecords = fyAndSearchFilteredRows.length;
    const pendingRecords = fyAndSearchFilteredRows.filter((r) => r.stage_key === "pending").length;
    const partialRecords = fyAndSearchFilteredRows.filter((r) => r.stage_key === "partial").length;
    const receivedRecords = fyAndSearchFilteredRows.filter((r) => r.stage_key === "received").length;
    const noVatRecords = fyAndSearchFilteredRows.filter((r) => r.stage_key === "no_vat").length;

    const totalRmbIncl = Number(
      fyAndSearchFilteredRows.reduce((s, r) => s + (r.total_rmb_incl_vat || 0), 0).toFixed(2)
    );
    const totalVatRmb = Number(
      fyAndSearchFilteredRows.reduce((s, r) => s + (r.total_vat_return_rmb || 0), 0).toFixed(2)
    );
    const receivedVatRmb = Number(
      fyAndSearchFilteredRows.reduce((s, r) => s + (r.received_vat_rmb || 0), 0).toFixed(2)
    );
    const partialReceivedRmb = Number(
      fyAndSearchFilteredRows
        .filter((r) => r.stage_key === "partial")
        .reduce((s, r) => s + (r.received_vat_rmb || 0), 0)
        .toFixed(2)
    );
    const balanceVatRmb = Number(
      fyAndSearchFilteredRows.reduce((s, r) => s + (r.balance_vat_rmb || 0), 0).toFixed(2)
    );

    return {
      totalRecords,
      pendingRecords,
      partialRecords,
      receivedRecords,
      noVatRecords,
      totalRmbIncl,
      totalVatRmb,
      receivedVatRmb,
      partialReceivedRmb,
      balanceVatRmb,
      rate,
      totalVatUsd: Number((totalVatRmb / rate).toFixed(2)),
      receivedVatUsd: Number((receivedVatRmb / rate).toFixed(2)),
      partialVatUsd: Number((partialReceivedRmb / rate).toFixed(2)),
      balanceVatUsd: Number((balanceVatRmb / rate).toFixed(2)),
    };
  }, [fyAndSearchFilteredRows, data?.kpi?.usd_to_rmb_rate]);

  // Apply stage filter
  const visibleRows = useMemo(() => {
    if (activeStage === "all") return fyAndSearchFilteredRows;
    return fyAndSearchFilteredRows.filter((r) => r.stage_key === activeStage);
  }, [fyAndSearchFilteredRows, activeStage]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return visibleRows.slice(start, start + pageSize);
  }, [visibleRows, currentPage, pageSize]);

  const activeBreakdownRow = useMemo(
    () => (data?.items || []).find((r) => r.record_key === breakdownRowKey) || null,
    [data, breakdownRowKey]
  );

  const activeHistoryRow = useMemo(
    () => (data?.items || []).find((r) => r.record_key === historyModalRowKey) || null,
    [data, historyModalRowKey]
  );

  // Open Breakdown Modal
  const openBreakdownModal = (row: VatReturnRow) => {
    setBreakdownRowKey(row.record_key);
    setBreakdownDraft(
      row.breakdown_items.map((bi) => ({
        ...bi,
      }))
    );
  };

  const handleBreakdownFieldChange = (
    idx: number,
    field: keyof VatReturnBreakdownItem,
    value: string | number
  ) => {
    setBreakdownDraft((prev) => {
      const next = [...prev];
      const item = { ...next[idx] };
      if (field === "quantity" || field === "rmb_price_with_vat" || field === "purchase_vat_percent" || field === "refund_vat_percent" || field === "usd_price") {
        const num = Number(value) || 0;
        (item as Record<string, unknown>)[field] = num;
        const qty = field === "quantity" ? num : item.quantity;
        const rmbUnit = field === "rmb_price_with_vat" ? num : item.rmb_price_with_vat;
        const pVat = field === "purchase_vat_percent" ? num : item.purchase_vat_percent;
        const rVat = field === "refund_vat_percent" ? num : item.refund_vat_percent;
        const totRmb = Number((qty * rmbUnit).toFixed(2));
        item.total_rmb_incl_vat = totRmb;
        item.vat_to_be_returned = computeItemVatReturn(totRmb, pVat, rVat);
      } else if (field === "total_rmb_incl_vat") {
        const totRmb = Number(value) || 0;
        item.total_rmb_incl_vat = totRmb;
        item.vat_to_be_returned = computeItemVatReturn(totRmb, item.purchase_vat_percent, item.refund_vat_percent);
      } else {
        (item as Record<string, unknown>)[field] = value;
      }
      next[idx] = item;
      return next;
    });
  };

  const handleAddBreakdownLine = () => {
    if (!activeBreakdownRow) return;
    const expPrefix = activeBreakdownRow.exp_no.toUpperCase().startsWith("YL-")
      ? activeBreakdownRow.exp_no
      : `YL-${activeBreakdownRow.exp_no}`;
    setBreakdownDraft((prev) => [
      ...prev,
      {
        item_key: `custom-${Date.now()}`,
        order_no: expPrefix,
        contract_date: activeBreakdownRow.invoice_date || new Date().toISOString().slice(0, 10),
        contract_no: "",
        supplier_name: "",
        product_name: "",
        quantity: 1,
        rmb_price_with_vat: 0,
        total_rmb_incl_vat: 0,
        usd_price: 0,
        purchase_vat_percent: 13,
        refund_vat_percent: 13,
        vat_to_be_returned: 0,
        remarks: "",
        first_filing_date: activeBreakdownRow.first_filing_date || null,
      },
    ]);
  };

  const handleRemoveBreakdownLine = (idx: number) => {
    setBreakdownDraft((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveBreakdown = async () => {
    if (!activeBreakdownRow) return;
    setSavingBreakdown(true);
    try {
      const totalRmbSum = Number(
        breakdownDraft.reduce((s, i) => s + (i.total_rmb_incl_vat || 0), 0).toFixed(2)
      );
      const totalVatSum = Number(
        breakdownDraft.reduce((s, i) => s + (i.vat_to_be_returned || 0), 0).toFixed(2)
      );
      const payload: VatReturnUpdatePayload = {
        breakdown_items: breakdownDraft,
        total_rmb_incl_vat_override: totalRmbSum,
        total_vat_return_override: totalVatSum,
      };
      await apiPatch(
        `/finance/vat-returns/record?key=${encodeURIComponent(activeBreakdownRow.record_key)}`,
        payload
      );
      toast("Shipment VAT breakdown saved and totals recalculated.", "success");
      setBreakdownRowKey(null);
      await fetchVatReturns(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSavingBreakdown(false);
    }
  };

  // Open Record Receipt Modal
  const openReceiptModal = (row: VatReturnRow) => {
    setReceiptModalRow(row);
    setReceiptDate(new Date().toISOString().slice(0, 10));
    setReceiptAmount(row.balance_vat_rmb > 0 ? String(row.balance_vat_rmb) : "");
    setReceiptRefNo("");
    setReceiptRemarks("");
  };

  const handleSaveReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiptModalRow) return;
    const amt = Number(receiptAmount);
    if (!amt || amt <= 0) {
      toast("Please enter a valid VAT receipt amount greater than 0.", "error");
      return;
    }
    setSavingReceipt(true);
    try {
      const payload: VatReturnReceiptCreatePayload = {
        receipt_date: receiptDate,
        amount_rmb: amt,
        reference_no: receiptRefNo.trim() || null,
        remarks: receiptRemarks.trim() || null,
      };
      await apiPost<VatReturnReceiptItem>(
        `/finance/vat-returns/receipts?key=${encodeURIComponent(receiptModalRow.record_key)}`,
        payload
      );
      toast(`Recorded ¥ ${amt.toLocaleString()} VAT refund for ${receiptModalRow.exp_no}.`, "success");
      setReceiptModalRow(null);
      await fetchVatReturns(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSavingReceipt(false);
    }
  };

  const handleDeleteReceipt = async (rec: VatReturnReceiptItem) => {
    const ok = await confirm({
      title: "Delete VAT Refund Receipt",
      message: `Are you sure you want to delete the receipt of ¥ ${rec.amount_rmb.toLocaleString()} (${fmtDate(rec.receipt_date)})? The shipment balance and status will recalculate automatically.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    setDeletingReceiptId(rec.id);
    try {
      await apiDelete(`/finance/vat-returns/receipts/${rec.id}`);
      toast("VAT receipt deleted and balance recalculated.", "success");
      await fetchVatReturns(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setDeletingReceiptId(null);
    }
  };

  // Open Edit Metadata Modal
  const openEditMetaModal = (row: VatReturnRow) => {
    setEditMetaRow(row);
    setMetaFilingDate(row.first_filing_date || "");
    setMetaReceivingDateText(row.receiving_date_display || "");
    setMetaStatusOverride(row.status);
    setMetaTotalVatOverride(String(row.total_vat_return_rmb ?? 0));
    setMetaRemarks(row.remarks || "");
  };

  const handleSaveMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editMetaRow) return;
    setSavingMeta(true);
    try {
      const payload: VatReturnUpdatePayload = {
        first_filing_date: metaFilingDate.trim() || null,
        receiving_date_text: metaReceivingDateText.trim() || null,
        status_override: metaStatusOverride || null,
        total_vat_return_override:
          metaTotalVatOverride.trim() !== "" ? Number(metaTotalVatOverride) : null,
        remarks: metaRemarks.trim() || null,
      };
      await apiPatch(
        `/finance/vat-returns/record?key=${encodeURIComponent(editMetaRow.record_key)}`,
        payload
      );
      toast(`Updated VAT Return details for ${editMetaRow.exp_no}.`, "success");
      setEditMetaRow(null);
      await fetchVatReturns(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSavingMeta(false);
    }
  };

  // Create Manual EXP Entry
  const handleCreateManualEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExpNo.trim()) {
      toast("EXP No. is required.", "error");
      return;
    }
    setCreatingNew(true);
    try {
      await apiPost("/finance/vat-returns/manual", {
        exp_no: newExpNo.trim(),
        invoice_date: newInvoiceDate || null,
        consignment_code: newConsignment.trim() || null,
        buyer_name: newBuyerName.trim() || null,
        total_vat_return_override: newTotalVatRmb.trim() ? Number(newTotalVatRmb) : 0,
        received_amount_rmb: newReceivedVatRmb.trim() ? Number(newReceivedVatRmb) : 0,
        first_filing_date: newFilingDate || null,
        remarks: newRemarks.trim() || null,
      });
      toast(`Created VAT Return entry ${newExpNo.trim()}.`, "success");
      setShowNewModal(false);
      setNewExpNo("");
      setNewConsignment("");
      setNewBuyerName("");
      setNewTotalVatRmb("");
      setNewReceivedVatRmb("0");
      setNewFilingDate("");
      setNewRemarks("");
      await fetchVatReturns(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setCreatingNew(false);
    }
  };

  // Import / Export Handlers
  const handleDownloadSample = () => {
    setImpExpOpen(false);
    try {
      const csvRows = [
        [
          "EXP NO.",
          "Invoice Date",
          "TOTAL VAT RETURN AMOUNT",
          "VAT Amount Received",
          "Balance VAT Amount to be Received",
          "STATUS",
          "VAT RECEIVING DATE",
          "Partial Amount Received",
          "REMARKS",
          "1st Filing Date",
        ],
        [
          "EXP2026 - 01",
          "2026-04-15",
          "26890.09",
          "26890.09",
          "0.00",
          "RECEIVED",
          "2026-05-20",
          "",
          "Sample full VAT rebate received",
          "2026-05-06",
        ],
        [
          "EXP2026 - 02",
          "2026-04-22",
          "25150.56",
          "9638.94",
          "15511.62",
          "PARTIAL RECEIVED",
          "2026-06-10",
          "9638.94",
          "Balance under Tax Bureau review",
          "2026-05-12",
        ],
      ];
      const csvContent =
        "\uFEFF" +
        csvRows
          .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
          .join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vat_return_sample.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("Downloaded sample VAT Return template.", "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImpExpOpen(false);
    setImportingFile(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiPostMultipart<{
        created: number;
        updated: number;
        total_processed: number;
      }>("/finance/vat-returns/import", fd);
      toast(
        `Imported ${res.data?.total_processed ?? 0} VAT Return records (${res.data?.created ?? 0} new, ${res.data?.updated ?? 0} updated).`,
        "success"
      );
      await fetchVatReturns(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setImportingFile(false);
    }
  };

  const handleExportExcel = async () => {
    setImpExpOpen(false);
    setExportingFile(true);
    try {
      const qs = new URLSearchParams();
      if (activeStage && activeStage !== "all") qs.set("stage", activeStage);
      if (activeFy && activeFy !== "all") qs.set("financial_year", activeFy);
      if (search.trim()) qs.set("search", search.trim());
      if (dateFrom) qs.set("date_from", dateFrom);
      if (dateTo) qs.set("date_to", dateTo);
      await downloadExport(
        `/finance/vat-returns?${qs.toString()}`,
        "xlsx",
        "Yinglima_VAT_Return_Report"
      );
      toast("Exported 2-sheet VAT Return Excel workbook.", "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setExportingFile(false);
    }
  };

  const availableFys = data?.available_financial_years || [
    "2026-2027",
    "2025-2026",
    "2024-2025",
    "2023-2024",
  ];

  return (
    <AppShell activeKey="vat-return">
      <main className="page" style={{ width: "100%", maxWidth: "none", padding: "16px 20px" }}>
        {/* Header Bar */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: "#0f172a",
                margin: 0,
                letterSpacing: "-0.02em",
              }}
            >
              China Export VAT Return
            </h1>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#334155",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                padding: "6px 10px",
              }}
            >
              1 USD = ¥ {liveKpi.rate.toFixed(2)} RMB
            </span>

            {canCreateVatReturn && (
              <button
                type="button"
                onClick={() => setShowNewModal(true)}
                style={{
                  background: "#0f172a",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 6,
                  padding: "7px 13px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                + New EXP Entry
              </button>
            )}

            {/* Imp / Exp Dropdown */}
            {(canImportVatReturn || canExportVatReturn) && (
              <div ref={impExpRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  disabled={importingFile || exportingFile}
                  onClick={(e) => {
                    e.stopPropagation();
                    setImpExpOpen((o) => !o);
                  }}
                  style={{
                    background: "#f59e0b",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 6,
                    padding: "7px 13px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {importingFile ? "Importing..." : exportingFile ? "Exporting..." : "Imp / Exp ▾"}
                </button>

                {canImportVatReturn && (
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: "none" }}
                    onChange={handleImportFileChange}
                  />
                )}

                {impExpOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 6px)",
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      boxShadow: "0 10px 25px rgba(15,23,42,0.12)",
                      minWidth: 210,
                      zIndex: 50,
                      padding: 6,
                    }}
                  >
                    {canImportVatReturn && (
                      <>
                        <button
                          type="button"
                          onClick={handleDownloadSample}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: "#1e293b",
                            background: "transparent",
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span>📄</span> Sample File (.csv)
                        </button>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: "#1e293b",
                            background: "transparent",
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span>📥</span> Import Excel / CSV
                        </button>
                      </>
                    )}
                    {canImportVatReturn && canExportVatReturn && (
                      <div style={{ height: 1, background: "#f1f5f9", margin: "4px 0" }} />
                    )}
                    {canExportVatReturn && (
                      <button
                        type="button"
                        onClick={handleExportExcel}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "8px 10px",
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "#0f766e",
                          background: "transparent",
                          border: "none",
                          borderRadius: 6,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span>📊</span> Export 2-Sheet Excel (.xlsx)
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowFilterBar((f) => !f)}
              style={{
                background: showFilterBar ? "#1d4ed8" : "#2563eb",
                color: "#ffffff",
                border: "none",
                borderRadius: 6,
                padding: "7px 13px",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ▼ Filter
            </button>
          </div>
        </div>

        {/* Optional Date Range Filter Bar */}
        {showFilterBar && (
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "12px 16px",
              marginBottom: 16,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-end",
              gap: 14,
            }}
          >
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
                INVOICE DATE FROM
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setCurrentPage(1);
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 12.5,
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
                INVOICE DATE TO
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setCurrentPage(1);
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 12.5,
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
                setSearch("");
                handleFySelect("all");
                handleStageSelect("all");
              }}
              style={{
                padding: "7px 12px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                fontSize: 12,
                fontWeight: 600,
                color: "#334155",
                cursor: "pointer",
              }}
            >
              Reset Filters
            </button>
          </div>
        )}

        {/* 4 Interactive KPI Summary Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
            marginBottom: 16,
          }}
        >
          {/* Card 1: ALL VAT RETURNS */}
          <div
            onClick={() => handleStageSelect("all")}
            style={{
              background: "#ffffff",
              borderRadius: 10,
              padding: "13px 16px",
              cursor: "pointer",
              border: activeStage === "all" ? "1.5px solid #3b82f6" : "1px solid #e2e8f0",
              boxShadow:
                activeStage === "all"
                  ? "0 2px 10px rgba(59,130,246,0.10)"
                  : "0 1px 2px rgba(15,23,42,0.03)",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.04em" }}>
              TOTAL VAT RETURN — ALL
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
              {fmtMoney(liveKpi.totalVatRmb, "¥")}{" "}
              <span style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}>
                ({liveKpi.totalRecords})
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 3 }}>
              Incl. VAT Base: {fmtMoney(liveKpi.totalRmbIncl, "¥")} | Eqv: {fmtMoney(liveKpi.totalVatUsd, "$")}
            </div>
          </div>

          {/* Card 2: VAT RECEIVED */}
          <div
            onClick={() => handleStageSelect("received")}
            style={{
              background: "#ffffff",
              borderRadius: 10,
              padding: "13px 16px",
              cursor: "pointer",
              border: activeStage === "received" ? "1.5px solid #3b82f6" : "1px solid #e2e8f0",
              boxShadow:
                activeStage === "received"
                  ? "0 2px 10px rgba(59,130,246,0.10)"
                  : "0 1px 2px rgba(15,23,42,0.03)",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.04em" }}>
              VAT AMOUNT RECEIVED
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#16a34a", marginTop: 4 }}>
              {fmtMoney(liveKpi.receivedVatRmb, "¥")}
            </div>
            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 3 }}>
              Received: {liveKpi.receivedRecords} | Eqv: {fmtMoney(liveKpi.receivedVatUsd, "$")}
            </div>
          </div>

          {/* Card 3: PARTIAL RECEIVED */}
          <div
            onClick={() => handleStageSelect("partial")}
            style={{
              background: "#ffffff",
              borderRadius: 10,
              padding: "13px 16px",
              cursor: "pointer",
              border: activeStage === "partial" ? "1.5px solid #3b82f6" : "1px solid #e2e8f0",
              boxShadow:
                activeStage === "partial"
                  ? "0 2px 10px rgba(59,130,246,0.10)"
                  : "0 1px 2px rgba(15,23,42,0.03)",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.04em" }}>
              PARTIAL VAT RECEIVED
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#d97706", marginTop: 4 }}>
              {fmtMoney(liveKpi.partialReceivedRmb, "¥")}{" "}
              <span style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}>
                ({liveKpi.partialRecords})
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 3 }}>
              Partial Shipments: {liveKpi.partialRecords} | Eqv: {fmtMoney(liveKpi.partialVatUsd, "$")}
            </div>
          </div>

          {/* Card 4: BALANCE VAT PENDING */}
          <div
            onClick={() => handleStageSelect("pending")}
            style={{
              background: "#ffffff",
              borderRadius: 10,
              padding: "13px 16px",
              cursor: "pointer",
              border: activeStage === "pending" ? "1.5px solid #3b82f6" : "1px solid #e2e8f0",
              boxShadow:
                activeStage === "pending"
                  ? "0 2px 10px rgba(59,130,246,0.10)"
                  : "0 1px 2px rgba(15,23,42,0.03)",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.04em" }}>
              BALANCE VAT TO BE RECEIVED
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#dc2626", marginTop: 4 }}>
              {fmtMoney(liveKpi.balanceVatRmb, "¥")}
            </div>
            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 3 }}>
              Pending: {liveKpi.pendingRecords} | Eqv: {fmtMoney(liveKpi.balanceVatUsd, "$")}
            </div>
          </div>
        </div>

        {/* Main Card Container */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
            overflow: "hidden",
          }}
        >
          {/* Financial Year Pill Bar */}
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid #f1f5f9",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 10,
              background: "#f8fafc",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#475569", marginRight: 4 }}>
                FINANCIAL YEAR:
              </span>
              <button
                type="button"
                onClick={() => handleFySelect("all")}
                style={{
                  padding: "5px 12px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  border: activeFy === "all" ? "1.5px solid #2563eb" : "1px solid #cbd5e1",
                  background: activeFy === "all" ? "#eff6ff" : "#ffffff",
                  color: activeFy === "all" ? "#1d4ed8" : "#475569",
                }}
              >
                All Years
              </button>
              {availableFys.map((fy) => {
                const isSelected = activeFy === fy;
                return (
                  <button
                    key={fy}
                    type="button"
                    onClick={() => handleFySelect(fy)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      border: isSelected ? "1.5px solid #2563eb" : "1px solid #cbd5e1",
                      background: isSelected ? "#eff6ff" : "#ffffff",
                      color: isSelected ? "#1d4ed8" : "#475569",
                    }}
                  >
                    FY {fy}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stage Sub-Tabs + Search Bar */}
          <div
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              {(
                [
                  { key: "all", label: `All (${liveKpi.totalRecords})` },
                  { key: "pending", label: `Pending (${liveKpi.pendingRecords})` },
                  { key: "partial", label: `Partial Received (${liveKpi.partialRecords})` },
                  { key: "received", label: `Received (${liveKpi.receivedRecords})` },
                  { key: "no_vat", label: `No VAT (${liveKpi.noVatRecords})` },
                ] as { key: VatReturnStageFilter; label: string }[]
              ).map((tab) => {
                const isAct = activeStage === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => handleStageSelect(tab.key)}
                    style={{
                      background: "transparent",
                      border: "none",
                      borderBottom: isAct ? "2.5px solid #2563eb" : "2.5px solid transparent",
                      padding: "6px 2px",
                      fontSize: 13,
                      fontWeight: isAct ? 700 : 600,
                      color: isAct ? "#2563eb" : "#64748b",
                      cursor: "pointer",
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={{
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 12.5,
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
              </select>
              <span style={{ fontSize: 12, color: "#64748b" }}>items/page</span>

              <input
                type="search"
                placeholder="Search EXP No., consignment, supplier, product, remarks..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                style={{
                  width: 310,
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 12.5,
                }}
              />
            </div>
          </div>

          {/* Table 1: VAT Return Summary Ledger */}
          <div style={{ width: "100%", overflowX: "hidden", paddingBottom: openMenuKey ? 185 : 0 }}>
            <table
              style={{
                width: "100%",
                tableLayout: "fixed",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <colgroup>
                <col style={{ width: "11%" }} />
                <col style={{ width: "9.5%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "9.5%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "6.5%" }} />
                <col style={{ width: "7.5%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "12.5%" }} />
                <col style={{ width: "3.5%" }} />
              </colgroup>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                  <th style={{ padding: "8px 7px", textAlign: "left", fontWeight: 700, color: "#475569", whiteSpace: "normal", lineHeight: 1.2 }}>
                    EXP NO.
                  </th>
                  <th style={{ padding: "8px 7px", textAlign: "left", fontWeight: 700, color: "#475569", whiteSpace: "normal", lineHeight: 1.2 }}>
                    INVOICE DATE
                  </th>
                  <th style={{ padding: "8px 7px", textAlign: "right", fontWeight: 700, color: "#475569", whiteSpace: "normal", lineHeight: 1.2 }}>
                    TOTAL RMB INCL. VAT
                  </th>
                  <th style={{ padding: "8px 7px", textAlign: "right", fontWeight: 700, color: "#475569", whiteSpace: "normal", lineHeight: 1.2 }}>
                    TOTAL VAT RETURN (¥)
                  </th>
                  <th style={{ padding: "8px 7px", textAlign: "right", fontWeight: 700, color: "#475569", whiteSpace: "normal", lineHeight: 1.2 }}>
                    VAT RECEIVED (¥)
                  </th>
                  <th style={{ padding: "8px 7px", textAlign: "right", fontWeight: 700, color: "#475569", whiteSpace: "normal", lineHeight: 1.2 }}>
                    BALANCE VAT (¥)
                  </th>
                  <th style={{ padding: "8px 6px", textAlign: "center", fontWeight: 700, color: "#475569", whiteSpace: "normal", lineHeight: 1.2 }}>
                    STATUS
                  </th>
                  <th style={{ padding: "8px 7px", textAlign: "left", fontWeight: 700, color: "#475569", whiteSpace: "normal", lineHeight: 1.2 }}>
                    VAT RECEIVING DATE
                  </th>
                  <th style={{ padding: "8px 7px", textAlign: "right", fontWeight: 700, color: "#475569", whiteSpace: "normal", lineHeight: 1.2 }}>
                    PARTIAL AMOUNT
                  </th>
                  <th style={{ padding: "8px 7px", textAlign: "left", fontWeight: 700, color: "#475569", whiteSpace: "normal", lineHeight: 1.2 }}>
                    1ST FILING DATE
                  </th>
                  <th style={{ padding: "8px 7px", textAlign: "left", fontWeight: 700, color: "#475569", whiteSpace: "normal", lineHeight: 1.2 }}>
                    REMARKS
                  </th>
                  <th style={{ padding: "8px 4px", textAlign: "center", fontWeight: 700, color: "#475569", whiteSpace: "nowrap" }}>
                    ACT
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={12} style={{ padding: 36, textAlign: "center", color: "#64748b", whiteSpace: "normal" }}>
                      Loading China Export VAT Return ledger...
                    </td>
                  </tr>
                ) : paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} style={{ padding: 36, textAlign: "center", color: "#64748b", whiteSpace: "normal" }}>
                      No VAT Return records match the current filters. Confirmed Sales Process orders appear here automatically, or click{" "}
                      <strong>Imp / Exp ▾ → Import Excel / CSV</strong> to import historical EXP rows.
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((row) => (
                    <tr
                      key={row.record_key}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      {/* EXP NO. (Clickable -> Opens Product VAT Breakdown Modal) */}
                      <td style={{ padding: "8px 7px", verticalAlign: "top", whiteSpace: "normal", wordBreak: "break-word" }}>
                        <button
                          type="button"
                          onClick={() => openBreakdownModal(row)}
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            color: "#2563eb",
                            fontWeight: 800,
                            fontSize: 12.5,
                            cursor: "pointer",
                            textDecoration: "underline",
                            textAlign: "left",
                            wordBreak: "break-word",
                          }}
                          title="Click to open Per-Shipment Product & Supplier VAT Breakdown"
                        >
                          {row.exp_no}
                        </button>
                        <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 2, lineHeight: 1.25 }}>
                          {row.consignment_code ? `Cons: ${row.consignment_code}` : `FY ${row.financial_year}`}
                          {row.items_count > 0 ? ` • ${row.items_count} items` : ""}
                        </div>
                      </td>

                      {/* INVOICE DATE */}
                      <td style={{ padding: "8px 7px", verticalAlign: "top", color: "#334155", whiteSpace: "normal", wordBreak: "break-word" }}>
                        <div style={{ whiteSpace: "nowrap" }}>{fmtDate(row.invoice_date)}</div>
                        {row.buyer_name && (
                          <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 2, lineHeight: 1.25 }}>
                            {row.buyer_name}
                          </div>
                        )}
                      </td>

                      {/* TOTAL RMB INCL. VAT */}
                      <td style={{ padding: "8px 7px", textAlign: "right", verticalAlign: "top", fontWeight: 600, color: "#334155", whiteSpace: "nowrap" }}>
                        {row.total_rmb_incl_vat > 0 ? fmtMoney(row.total_rmb_incl_vat, "¥") : "—"}
                      </td>

                      {/* TOTAL VAT RETURN AMOUNT */}
                      <td style={{ padding: "8px 7px", textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap" }}>
                        <div style={{ fontWeight: 800, color: "#0f172a" }}>
                          {fmtMoney(row.total_vat_return_rmb, "¥")}
                        </div>
                        <div style={{ fontSize: 10.5, color: "#64748b" }}>
                          {fmtMoney(row.total_vat_return_usd, "$")}
                        </div>
                      </td>

                      {/* VAT AMOUNT RECEIVED */}
                      <td style={{ padding: "8px 7px", textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap" }}>
                        <div style={{ fontWeight: 700, color: "#16a34a" }}>
                          {fmtMoney(row.received_vat_rmb, "¥")}
                        </div>
                        {row.receipts_count > 0 && (
                          <button
                            type="button"
                            onClick={() => setHistoryModalRowKey(row.record_key)}
                            style={{
                              background: "transparent",
                              border: "none",
                              padding: 0,
                              fontSize: 10.5,
                              color: "#2563eb",
                              textDecoration: "underline",
                              cursor: "pointer",
                            }}
                          >
                            {row.receipts_count} {row.receipts_count === 1 ? "receipt" : "receipts"}
                          </button>
                        )}
                      </td>

                      {/* BALANCE VAT TO BE RECEIVED */}
                      <td style={{ padding: "8px 7px", textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap" }}>
                        <div
                          style={{
                            fontWeight: 800,
                            color: row.balance_vat_rmb > 0.01 ? "#dc2626" : "#16a34a",
                          }}
                        >
                          {fmtMoney(row.balance_vat_rmb, "¥")}
                        </div>
                        <div style={{ fontSize: 10.5, color: "#64748b" }}>
                          {fmtMoney(row.balance_vat_usd, "$")}
                        </div>
                      </td>

                      {/* STATUS BADGE */}
                      <td style={{ padding: "8px 5px", textAlign: "center", verticalAlign: "top", whiteSpace: "nowrap" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 7px",
                            borderRadius: 999,
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: "0.02em",
                            whiteSpace: "nowrap",
                            ...statusBadgeStyle(row.status),
                          }}
                        >
                          {row.status}
                        </span>
                      </td>

                      {/* VAT RECEIVING DATE */}
                      <td style={{ padding: "8px 7px", verticalAlign: "top", color: "#334155", fontSize: 11.5, whiteSpace: "normal", wordBreak: "break-word" }}>
                        {row.receiving_date_display ? fmtDate(row.receiving_date_display) : "—"}
                      </td>

                      {/* PARTIAL AMOUNT RECEIVED */}
                      <td style={{ padding: "8px 7px", textAlign: "right", verticalAlign: "top", color: "#b45309", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {row.partial_amount_display > 0 ? fmtMoney(row.partial_amount_display, "¥") : "—"}
                      </td>

                      {/* 1ST FILING DATE */}
                      <td style={{ padding: "8px 7px", verticalAlign: "top", color: "#334155", whiteSpace: "nowrap", fontSize: 11.5 }}>
                        {fmtDate(row.first_filing_date)}
                      </td>

                      {/* REMARKS */}
                      <td
                        style={{
                          padding: "8px 7px",
                          verticalAlign: "top",
                          color: "#475569",
                          whiteSpace: "normal",
                          wordBreak: "break-word",
                          overflowWrap: "anywhere",
                          overflow: "hidden",
                          fontSize: 11.5,
                          lineHeight: 1.35,
                        }}
                        title={row.remarks || ""}
                      >
                        {row.remarks || "—"}
                      </td>

                      {/* 3-DOT ACTION MENU */}
                      <td style={{ padding: "8px 4px", textAlign: "center", verticalAlign: "top", position: "relative", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuKey((k) => (k === row.record_key ? null : row.record_key));
                          }}
                          style={{
                            background: "#f8fafc",
                            border: "1px solid #cbd5e1",
                            borderRadius: 6,
                            width: 28,
                            height: 26,
                            cursor: "pointer",
                            fontWeight: 800,
                            color: "#334155",
                          }}
                        >
                          ⋮
                        </button>

                        {openMenuKey === row.record_key && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: "absolute",
                              right: 8,
                              top: 34,
                              background: "#ffffff",
                              border: "1px solid #e2e8f0",
                              borderRadius: 8,
                              boxShadow: "0 10px 25px rgba(15,23,42,0.14)",
                              minWidth: 235,
                              zIndex: 60,
                              padding: 6,
                              textAlign: "left",
                            }}
                          >
                            {canManageVatReceipt && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuKey(null);
                                  openReceiptModal(row);
                                }}
                                style={{
                                  width: "100%",
                                  textAlign: "left",
                                  padding: "8px 10px",
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  color: "#0f172a",
                                  background: "transparent",
                                  border: "none",
                                  borderRadius: 6,
                                  cursor: "pointer",
                                }}
                              >
                                💳 Record VAT Receipt (Full / Partial)
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuKey(null);
                                openBreakdownModal(row);
                              }}
                              style={{
                                width: "100%",
                                textAlign: "left",
                                padding: "8px 10px",
                                fontSize: 12.5,
                                fontWeight: 600,
                                color: "#2563eb",
                                background: "transparent",
                                border: "none",
                                borderRadius: 6,
                                cursor: "pointer",
                              }}
                            >
                              📋 Product & Supplier VAT Breakdown
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuKey(null);
                                setHistoryModalRowKey(row.record_key);
                              }}
                              style={{
                                width: "100%",
                                textAlign: "left",
                                padding: "8px 10px",
                                fontSize: 12.5,
                                fontWeight: 600,
                                color: "#0f172a",
                                background: "transparent",
                                border: "none",
                                borderRadius: 6,
                                cursor: "pointer",
                              }}
                            >
                              📜 Receipt History ({row.receipts_count})
                            </button>
                            {canUpdateVatReturn && (
                              <>
                                <div style={{ height: 1, background: "#f1f5f9", margin: "4px 0" }} />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMenuKey(null);
                                    openEditMetaModal(row);
                                  }}
                                  style={{
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "8px 10px",
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    color: "#475569",
                                    background: "transparent",
                                    border: "none",
                                    borderRadius: 6,
                                    cursor: "pointer",
                                  }}
                                >
                                  ✏️ Edit Filing Date / Status / Remarks
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

              {/* Table Footer Rollup */}
              {visibleRows.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#f8fafc", borderTop: "2px solid #cbd5e1", fontWeight: 800 }}>
                    <td colSpan={2} style={{ padding: "10px 7px", color: "#0f172a", whiteSpace: "nowrap" }}>
                      TOTAL ({visibleRows.length} Shipments)
                    </td>
                    <td style={{ padding: "10px 7px", textAlign: "right", color: "#0f172a", whiteSpace: "nowrap" }}>
                      {fmtMoney(
                        visibleRows.reduce((s, r) => s + (r.total_rmb_incl_vat || 0), 0),
                        "¥"
                      )}
                    </td>
                    <td style={{ padding: "10px 7px", textAlign: "right", color: "#0f172a", whiteSpace: "nowrap" }}>
                      {fmtMoney(
                        visibleRows.reduce((s, r) => s + (r.total_vat_return_rmb || 0), 0),
                        "¥"
                      )}
                    </td>
                    <td style={{ padding: "10px 7px", textAlign: "right", color: "#16a34a", whiteSpace: "nowrap" }}>
                      {fmtMoney(
                        visibleRows.reduce((s, r) => s + (r.received_vat_rmb || 0), 0),
                        "¥"
                      )}
                    </td>
                    <td style={{ padding: "10px 7px", textAlign: "right", color: "#dc2626", whiteSpace: "nowrap" }}>
                      {fmtMoney(
                        visibleRows.reduce((s, r) => s + (r.balance_vat_rmb || 0), 0),
                        "¥"
                      )}
                    </td>
                    <td colSpan={6} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Pagination Footer */}
          <div
            style={{
              padding: "12px 16px",
              borderTop: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 12.5,
              color: "#64748b",
            }}
          >
            <div>
              Showing{" "}
              <strong>
                {visibleRows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
              </strong>{" "}
              to{" "}
              <strong>{Math.min(currentPage * pageSize, visibleRows.length)}</strong> of{" "}
              <strong>{visibleRows.length}</strong> entries
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{
                  padding: "5px 11px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: currentPage <= 1 ? "#f8fafc" : "#ffffff",
                  cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Prev
              </button>
              <span style={{ fontWeight: 700, color: "#0f172a" }}>
                Page {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  padding: "5px 11px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: currentPage >= totalPages ? "#f8fafc" : "#ffffff",
                  cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* =====================================================================
          MODAL 1: Per-Shipment Product & Supplier VAT Breakdown (Table 2)
      ===================================================================== */}
      {activeBreakdownRow && (
        <div
          onClick={() => setBreakdownRowKey(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "12px 14px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#ffffff",
              borderRadius: 12,
              width: "98vw",
              maxWidth: 1560,
              maxHeight: "92vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 50px rgba(15,23,42,0.28)",
              overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#0f172a",
                color: "#ffffff",
              }}
            >
              <div>
                <div style={{ fontSize: 16.5, fontWeight: 800 }}>
                  Product & Supplier VAT Breakdown — {activeBreakdownRow.exp_no}
                </div>
                <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2 }}>
                  Formula: VAT To Be Returned (¥) = [Total RMB Incl. VAT ÷ (1 + Purchase VAT %)] × Refund VAT %
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {canUpdateVatReturn && (
                  <button
                    type="button"
                    onClick={handleAddBreakdownLine}
                    style={{
                      background: "#2563eb",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    + Add Product Line
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setBreakdownRowKey(null)}
                  style={{
                    background: "transparent",
                    color: "#cbd5e1",
                    border: "none",
                    fontSize: 20,
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Table Body — fits 100% width with zero horizontal scroll */}
            <div style={{ overflowY: "auto", overflowX: "hidden", padding: "12px 14px", flex: 1 }}>
              <table
                style={{
                  width: "100%",
                  tableLayout: "fixed",
                  borderCollapse: "collapse",
                  fontSize: 11.5,
                }}
              >
                <colgroup>
                  <col style={{ width: "8.5%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "9.5%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "4.5%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "5.5%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "2.5%" }} />
                </colgroup>
                <thead>
                  <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #cbd5e1" }}>
                    <th style={{ padding: "7px 5px", textAlign: "left", whiteSpace: "normal", lineHeight: 1.2 }}>ORDER NO.</th>
                    <th style={{ padding: "7px 5px", textAlign: "left", whiteSpace: "normal", lineHeight: 1.2 }}>CONTRACT DATE</th>
                    <th style={{ padding: "7px 5px", textAlign: "left", whiteSpace: "normal", lineHeight: 1.2 }}>CONTRACT NO.</th>
                    <th style={{ padding: "7px 5px", textAlign: "left", whiteSpace: "normal", lineHeight: 1.2 }}>SUPPLIER</th>
                    <th style={{ padding: "7px 5px", textAlign: "left", whiteSpace: "normal", lineHeight: 1.2 }}>PRODUCT</th>
                    <th style={{ padding: "7px 5px", textAlign: "right", whiteSpace: "normal", lineHeight: 1.2 }}>QTY</th>
                    <th style={{ padding: "7px 5px", textAlign: "right", whiteSpace: "normal", lineHeight: 1.2 }}>RMB PRICE W/ VAT</th>
                    <th style={{ padding: "7px 5px", textAlign: "right", whiteSpace: "normal", lineHeight: 1.2 }}>TOTAL RMB INCL. VAT</th>
                    <th style={{ padding: "7px 5px", textAlign: "right", whiteSpace: "normal", lineHeight: 1.2 }}>USD PRICE</th>
                    <th style={{ padding: "7px 5px", textAlign: "center", whiteSpace: "normal", lineHeight: 1.2 }}>REBATE %</th>
                    <th style={{ padding: "7px 5px", textAlign: "right", whiteSpace: "normal", lineHeight: 1.2 }}>VAT TO BE RETURNED (¥)</th>
                    <th style={{ padding: "7px 5px", textAlign: "left", whiteSpace: "normal", lineHeight: 1.2 }}>REMARKS</th>
                    <th style={{ padding: "7px 3px", textAlign: "center", whiteSpace: "nowrap" }}>DEL</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdownDraft.length === 0 ? (
                    <tr>
                      <td colSpan={13} style={{ padding: 28, textAlign: "center", color: "#64748b", whiteSpace: "normal" }}>
                        No product breakdown lines recorded yet.
                      </td>
                    </tr>
                  ) : (
                    breakdownDraft.map((item, idx) => (
                      <tr key={item.item_key || idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "5px 4px", whiteSpace: "normal" }}>
                          <input
                            type="text"
                            disabled={!canUpdateVatReturn}
                            value={item.order_no || ""}
                            title={item.order_no || ""}
                            onChange={(e) => handleBreakdownFieldChange(idx, "order_no", e.target.value)}
                            style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "4px 5px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 11.5 }}
                          />
                        </td>
                        <td style={{ padding: "5px 4px", whiteSpace: "normal" }}>
                          <input
                            type="date"
                            disabled={!canUpdateVatReturn}
                            value={(item.contract_date || "").slice(0, 10)}
                            onChange={(e) => handleBreakdownFieldChange(idx, "contract_date", e.target.value)}
                            style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "4px 4px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 11 }}
                          />
                        </td>
                        <td style={{ padding: "5px 4px", whiteSpace: "normal" }}>
                          <input
                            type="text"
                            disabled={!canUpdateVatReturn}
                            placeholder="Contract / Fapiao"
                            value={item.contract_no || ""}
                            title={item.contract_no || ""}
                            onChange={(e) => handleBreakdownFieldChange(idx, "contract_no", e.target.value)}
                            style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "4px 5px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 11.5 }}
                          />
                        </td>
                        <td style={{ padding: "5px 4px", whiteSpace: "normal" }}>
                          <input
                            type="text"
                            disabled={!canUpdateVatReturn}
                            value={item.supplier_name || ""}
                            title={item.supplier_name || ""}
                            onChange={(e) => handleBreakdownFieldChange(idx, "supplier_name", e.target.value)}
                            style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "4px 5px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 11.5 }}
                          />
                        </td>
                        <td style={{ padding: "5px 4px", whiteSpace: "normal" }}>
                          <input
                            type="text"
                            disabled={!canUpdateVatReturn}
                            value={item.product_name || ""}
                            title={item.product_name || ""}
                            onChange={(e) => handleBreakdownFieldChange(idx, "product_name", e.target.value)}
                            style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "4px 5px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 11.5 }}
                          />
                        </td>
                        <td style={{ padding: "5px 4px", whiteSpace: "normal" }}>
                          <input
                            type="number"
                            step="any"
                            disabled={!canUpdateVatReturn}
                            value={item.quantity}
                            onChange={(e) => handleBreakdownFieldChange(idx, "quantity", e.target.value)}
                            style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "4px 4px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 11.5, textAlign: "right" }}
                          />
                        </td>
                        <td style={{ padding: "5px 4px", whiteSpace: "normal" }}>
                          <input
                            type="number"
                            step="any"
                            disabled={!canUpdateVatReturn}
                            value={item.rmb_price_with_vat}
                            onChange={(e) => handleBreakdownFieldChange(idx, "rmb_price_with_vat", e.target.value)}
                            style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "4px 5px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 11.5, textAlign: "right" }}
                          />
                        </td>
                        <td style={{ padding: "5px 5px", textAlign: "right", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>
                          {fmtMoney(item.total_rmb_incl_vat, "¥")}
                        </td>
                        <td style={{ padding: "5px 4px", whiteSpace: "normal" }}>
                          <input
                            type="number"
                            step="any"
                            disabled={!canUpdateVatReturn}
                            value={item.usd_price}
                            onChange={(e) => handleBreakdownFieldChange(idx, "usd_price", e.target.value)}
                            style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "4px 4px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 11.5, textAlign: "right" }}
                          />
                        </td>
                        <td style={{ padding: "5px 4px", textAlign: "center", whiteSpace: "normal" }}>
                          <select
                            disabled={!canUpdateVatReturn}
                            value={item.refund_vat_percent}
                            onChange={(e) => handleBreakdownFieldChange(idx, "refund_vat_percent", Number(e.target.value))}
                            style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "4px 4px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 11, fontWeight: 700 }}
                          >
                            <option value={13}>13%</option>
                            <option value={9}>9%</option>
                            <option value={6}>6%</option>
                            <option value={0}>0% (No VAT)</option>
                          </select>
                        </td>
                        <td style={{ padding: "5px 5px", textAlign: "right", fontWeight: 800, color: "#15803d", whiteSpace: "nowrap" }}>
                          {fmtMoney(item.vat_to_be_returned, "¥")}
                        </td>
                        <td style={{ padding: "5px 4px", whiteSpace: "normal" }}>
                          <input
                            type="text"
                            disabled={!canUpdateVatReturn}
                            placeholder="e.g. No VAT / 9%"
                            value={item.remarks || ""}
                            title={item.remarks || ""}
                            onChange={(e) => handleBreakdownFieldChange(idx, "remarks", e.target.value)}
                            style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "4px 5px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 11.5 }}
                          />
                        </td>
                        <td style={{ padding: "5px 2px", textAlign: "center", whiteSpace: "nowrap" }}>
                          {canUpdateVatReturn && (
                            <button
                              type="button"
                              onClick={() => handleRemoveBreakdownLine(idx)}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "#dc2626",
                                cursor: "pointer",
                                fontWeight: 800,
                                padding: "2px 4px",
                              }}
                              title="Remove line"
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {breakdownDraft.length > 0 && (
                  <tfoot>
                    <tr style={{ background: "#f8fafc", borderTop: "2px solid #cbd5e1", fontWeight: 800 }}>
                      <td colSpan={5} style={{ padding: "9px 6px", whiteSpace: "nowrap" }}>
                        SHIPMENT BREAKDOWN TOTAL ({breakdownDraft.length} items)
                      </td>
                      <td style={{ padding: "9px 5px", textAlign: "right", whiteSpace: "nowrap" }}>
                        {breakdownDraft.reduce((s, i) => s + (Number(i.quantity) || 0), 0)}
                      </td>
                      <td />
                      <td style={{ padding: "9px 5px", textAlign: "right", color: "#0f172a", whiteSpace: "nowrap" }}>
                        {fmtMoney(
                          breakdownDraft.reduce((s, i) => s + (i.total_rmb_incl_vat || 0), 0),
                          "¥"
                        )}
                      </td>
                      <td colSpan={2} />
                      <td style={{ padding: "9px 5px", textAlign: "right", color: "#15803d", fontSize: 12.5, whiteSpace: "nowrap" }}>
                        {fmtMoney(
                          breakdownDraft.reduce((s, i) => s + (i.vat_to_be_returned || 0), 0),
                          "¥"
                        )}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid #e2e8f0",
                background: "#f8fafc",
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
              }}
            >
              <button
                type="button"
                onClick={() => setBreakdownRowKey(null)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontWeight: 600,
                  fontSize: 12.5,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
              {canUpdateVatReturn && (
                <button
                  type="button"
                  disabled={savingBreakdown}
                  onClick={handleSaveBreakdown}
                  style={{
                    padding: "8px 18px",
                    borderRadius: 6,
                    border: "none",
                    background: "#2563eb",
                    color: "#ffffff",
                    fontWeight: 700,
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  {savingBreakdown ? "Saving..." : "Save Breakdown & Sync VAT Total"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: Record VAT Refund Receipt (Full / Partial)
      ===================================================================== */}
      {receiptModalRow && (
        <div
          onClick={() => setReceiptModalRow(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveReceipt}
            style={{
              background: "#ffffff",
              borderRadius: 12,
              width: "100%",
              maxWidth: 480,
              boxShadow: "0 20px 45px rgba(15,23,42,0.25)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "15px 20px",
                background: "#0f172a",
                color: "#ffffff",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>
                  Record VAT Refund Receipt — {receiptModalRow.exp_no}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  Total VAT: {fmtMoney(receiptModalRow.total_vat_return_rmb, "¥")} | Balance:{" "}
                  {fmtMoney(receiptModalRow.balance_vat_rmb, "¥")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReceiptModalRow(null)}
                style={{ background: "transparent", border: "none", color: "#cbd5e1", fontSize: 18, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  VAT Receiving Date *
                </label>
                <input
                  type="date"
                  required
                  value={receiptDate}
                  onChange={(e) => setReceiptDate(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                />
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
                    Amount Received (RMB ¥) *
                  </label>
                  {receiptModalRow.balance_vat_rmb > 0 && (
                    <button
                      type="button"
                      onClick={() => setReceiptAmount(String(receiptModalRow.balance_vat_rmb))}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#2563eb",
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Fill Full Balance ({fmtMoney(receiptModalRow.balance_vat_rmb, "¥")})
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={receiptAmount}
                  onChange={(e) => setReceiptAmount(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  Tax Bureau Reference / Bank Slip No.
                </label>
                <input
                  type="text"
                  placeholder="Optional reference number"
                  value={receiptRefNo}
                  onChange={(e) => setReceiptRefNo(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  Remarks
                </label>
                <textarea
                  rows={2}
                  placeholder="Optional notes..."
                  value={receiptRemarks}
                  onChange={(e) => setReceiptRemarks(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                />
              </div>
            </div>

            <div
              style={{
                padding: "12px 20px",
                background: "#f8fafc",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
              }}
            >
              <button
                type="button"
                onClick={() => setReceiptModalRow(null)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingReceipt}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "none",
                  background: "#16a34a",
                  color: "#ffffff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {savingReceipt ? "Saving..." : "Save VAT Receipt"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: Receipt History Modal
      ===================================================================== */}
      {activeHistoryRow && (
        <div
          onClick={() => setHistoryModalRowKey(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#ffffff",
              borderRadius: 12,
              width: "100%",
              maxWidth: 640,
              boxShadow: "0 20px 45px rgba(15,23,42,0.25)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "15px 20px",
                background: "#0f172a",
                color: "#ffffff",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>
                  VAT Refund Receipt History — {activeHistoryRow.exp_no}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  Received: {fmtMoney(activeHistoryRow.received_vat_rmb, "¥")} of{" "}
                  {fmtMoney(activeHistoryRow.total_vat_return_rmb, "¥")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHistoryModalRowKey(null)}
                style={{ background: "transparent", border: "none", color: "#cbd5e1", fontSize: 18, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: 18 }}>
              {activeHistoryRow.receipts.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                  No VAT refund receipts recorded for this shipment yet.
                </div>
              ) : (
                <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #cbd5e1" }}>
                      <th style={{ padding: 8, textAlign: "left", width: "18%" }}>RECEIPT DATE</th>
                      <th style={{ padding: 8, textAlign: "right", width: "22%" }}>AMOUNT (¥)</th>
                      <th style={{ padding: 8, textAlign: "left", width: "20%" }}>REFERENCE</th>
                      <th style={{ padding: 8, textAlign: "left", width: "26%" }}>REMARKS</th>
                      <th style={{ padding: 8, textAlign: "center", width: "14%" }}>ACT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeHistoryRow.receipts.map((rec) => (
                      <tr key={rec.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: 8, whiteSpace: "nowrap" }}>{fmtDate(rec.receipt_date)}</td>
                        <td style={{ padding: 8, textAlign: "right", fontWeight: 700, color: "#16a34a", whiteSpace: "nowrap" }}>
                          {fmtMoney(rec.amount_rmb, "¥")}
                        </td>
                        <td style={{ padding: 8, whiteSpace: "normal", wordBreak: "break-word" }}>{rec.reference_no || "—"}</td>
                        <td style={{ padding: 8, whiteSpace: "normal", wordBreak: "break-word" }}>{rec.remarks || "—"}</td>
                        <td style={{ padding: 8, textAlign: "center", whiteSpace: "nowrap" }}>
                          {canManageVatReceipt && (
                            <button
                              type="button"
                              disabled={deletingReceiptId === rec.id}
                              onClick={() => handleDeleteReceipt(rec)}
                              style={{
                                background: "#fee2e2",
                                color: "#b91c1c",
                                border: "none",
                                borderRadius: 4,
                                padding: "4px 8px",
                                fontSize: 11.5,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {deletingReceiptId === rec.id ? "..." : "Delete"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div
              style={{
                padding: "12px 20px",
                background: "#f8fafc",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              {canManageVatReceipt ? (
                <button
                  type="button"
                  onClick={() => {
                    const r = activeHistoryRow;
                    setHistoryModalRowKey(null);
                    openReceiptModal(r);
                  }}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 6,
                    border: "none",
                    background: "#16a34a",
                    color: "#ffffff",
                    fontWeight: 700,
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  + Record Another Receipt
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setHistoryModalRowKey(null)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontWeight: 600,
                  fontSize: 12.5,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 4: Edit Filing Date / Status / Remarks
      ===================================================================== */}
      {editMetaRow && (
        <div
          onClick={() => setEditMetaRow(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveMeta}
            style={{
              background: "#ffffff",
              borderRadius: 12,
              width: "100%",
              maxWidth: 480,
              boxShadow: "0 20px 45px rgba(15,23,42,0.25)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "15px 20px",
                background: "#0f172a",
                color: "#ffffff",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800 }}>
                Edit VAT Return Details — {editMetaRow.exp_no}
              </div>
              <button
                type="button"
                onClick={() => setEditMetaRow(null)}
                style={{ background: "transparent", border: "none", color: "#cbd5e1", fontSize: 18, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  1st Tax Bureau Filing Date
                </label>
                <input
                  type="date"
                  value={metaFilingDate}
                  onChange={(e) => setMetaFilingDate(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  Status Override
                </label>
                <select
                  value={metaStatusOverride}
                  onChange={(e) => setMetaStatusOverride(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                >
                  <option value="PENDING">PENDING</option>
                  <option value="PARTIAL RECEIVED">PARTIAL RECEIVED</option>
                  <option value="RECEIVED">RECEIVED</option>
                  <option value="NO VAT">NO VAT (0% Export Rebate)</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  Total VAT Return Amount Override (RMB ¥)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={metaTotalVatOverride}
                  onChange={(e) => setMetaTotalVatOverride(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  VAT Receiving Date Text (e.g. 2025-05-06 / 2025-06-12)
                </label>
                <input
                  type="text"
                  value={metaReceivingDateText}
                  onChange={(e) => setMetaReceivingDateText(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  Remarks
                </label>
                <textarea
                  rows={3}
                  value={metaRemarks}
                  onChange={(e) => setMetaRemarks(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                />
              </div>
            </div>

            <div
              style={{
                padding: "12px 20px",
                background: "#f8fafc",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
              }}
            >
              <button
                type="button"
                onClick={() => setEditMetaRow(null)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingMeta}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "none",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {savingMeta ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          MODAL 5: Create New Standalone EXP Entry
      ===================================================================== */}
      {showNewModal && (
        <div
          onClick={() => setShowNewModal(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateManualEntry}
            style={{
              background: "#ffffff",
              borderRadius: 12,
              width: "100%",
              maxWidth: 490,
              boxShadow: "0 20px 45px rgba(15,23,42,0.25)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "15px 20px",
                background: "#0f172a",
                color: "#ffffff",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800 }}>+ New Export VAT Return Entry</div>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                style={{ background: "transparent", border: "none", color: "#cbd5e1", fontSize: 18, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 13 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                    EXP No. *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. EXP2026 - 05"
                    value={newExpNo}
                    onChange={(e) => setNewExpNo(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                    Invoice Date
                  </label>
                  <input
                    type="date"
                    value={newInvoiceDate}
                    onChange={(e) => setNewInvoiceDate(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                    Consignment Code
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. MUM 52"
                    value={newConsignment}
                    onChange={(e) => setNewConsignment(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                    Buyer Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Inhyma Mumbai"
                    value={newBuyerName}
                    onChange={(e) => setNewBuyerName(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                    Total VAT Return (¥)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newTotalVatRmb}
                    onChange={(e) => setNewTotalVatRmb(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                    Initial VAT Received (¥)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newReceivedVatRmb}
                    onChange={(e) => setNewReceivedVatRmb(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  1st Filing Date
                </label>
                <input
                  type="date"
                  value={newFilingDate}
                  onChange={(e) => setNewFilingDate(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                  Remarks
                </label>
                <textarea
                  rows={2}
                  value={newRemarks}
                  onChange={(e) => setNewRemarks(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                />
              </div>
            </div>

            <div
              style={{
                padding: "12px 20px",
                background: "#f8fafc",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
              }}
            >
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingNew}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "none",
                  background: "#0f172a",
                  color: "#ffffff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {creatingNew ? "Creating..." : "Create EXP Entry"}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
