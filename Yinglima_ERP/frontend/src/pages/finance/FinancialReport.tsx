/**
 * Financial Report & Payment Planner Page (`/finance/report`).
 *
 * Automatically pulls all Confirmed Local Purchase orders (Supplier Outward Payables)
 * and Confirmed Sales Process orders (Buyer Export Receivables + Forwarder/Agent Freight Bills),
 * organizing each into Pending and Cleared payment stages with 3-dot (`⋮`) Add Payment,
 * Payment History, Financial/Agent Schedule editing, and multi-sheet Excel Planner export.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { ItemPopoverCell, TextPopoverCell } from "@/components/ItemPopoverCell";
import { apiDelete, apiGet, apiPatch, apiPost, downloadExport, errorMessage } from "@/lib/api";
import { Auth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useToast } from "@/lib/toast";
import type {
  FinanceMetaUpdatePayload,
  FinancePaymentCreatePayload,
  FinancePaymentItem,
  FinanceReportResponse,
  FinanceStage,
  LocalPurchaseFinanceRow,
  SaleOrderFinanceRow,
} from "@/types/finance";

type ActiveSection = "local_purchase" | "sale_order";

const PAYMENT_MODES = [
  "RMB A/C",
  "USD Transaction A/C",
  "USD Capital A/C",
  "TT / Wire Transfer",
  "Alipay / WeChat Pay",
  "Cash",
  "Other Bank A/C",
];

const PAYMENT_TERM_PRESETS = [
  "100% Advance",
  "30-70",
  "30% Advance / 70% Before Shipment",
  "50-50",
  "CAD",
  "100% Against BL Copy",
  "Credit 30 Days",
];

const BL_STATUS_OPTIONS = [
  "Pending",
  "Draft Approved",
  "Telex",
  "Telex Released",
  "Original Received",
  "Surrendered",
];

function fmtMoney(val: number | null | undefined, symbol = "¥"): string {
  const num = Number(val ?? 0);
  return `${symbol} ${num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const parts = d.slice(0, 10).split("-");
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return d;
}

let cachedFinanceReport: FinanceReportResponse | null = null;

function recomputeFinanceReportKpis(rep: FinanceReportResponse): FinanceReportResponse {
  const rate = rep.usd_to_rmb_rate > 0 ? rep.usd_to_rmb_rate : 7.2;
  const lps = rep.local_purchases || [];
  const sos = rep.sale_orders || [];

  const lpTotal = Number(lps.reduce((s, r) => s + (r.total_amount || 0), 0).toFixed(2));
  const lpPaid = Number(lps.reduce((s, r) => s + (r.paid_amount || 0), 0).toFixed(2));
  const lpBal = Number(lps.reduce((s, r) => s + (r.balance_amount || 0), 0).toFixed(2));

  const soTotal = Number(sos.reduce((s, r) => s + (r.total_amount || 0), 0).toFixed(2));
  const soPaid = Number(sos.reduce((s, r) => s + (r.paid_amount || 0), 0).toFixed(2));
  const soBal = Number(sos.reduce((s, r) => s + (r.balance_amount || 0), 0).toFixed(2));

  const agTotal = Number(sos.reduce((s, r) => s + (r.agent_inv_amount || 0), 0).toFixed(2));
  const agPaid = Number(
    sos
      .filter((r) => (r.bill_status || "").trim().toLowerCase() === "paid")
      .reduce((s, r) => s + (r.agent_inv_amount || 0), 0)
      .toFixed(2)
  );
  const agBal = Math.max(0, Number((agTotal - agPaid).toFixed(2)));

  const updated: FinanceReportResponse = {
    ...rep,
    local_purchase_kpi: {
      ...rep.local_purchase_kpi,
      total_records: lps.length,
      pending_records: lps.filter((r) => r.stage === "pending").length,
      cleared_records: lps.filter((r) => r.stage === "cleared").length,
      total_amount: lpTotal,
      paid_amount: lpPaid,
      balance_amount: lpBal,
      total_amount_secondary: Number((lpTotal / rate).toFixed(2)),
      paid_amount_secondary: Number((lpPaid / rate).toFixed(2)),
      balance_amount_secondary: Number((lpBal / rate).toFixed(2)),
    },
    sale_order_kpi: {
      ...rep.sale_order_kpi,
      total_records: sos.length,
      pending_records: sos.filter((r) => r.stage === "pending").length,
      cleared_records: sos.filter((r) => r.stage === "cleared").length,
      total_amount: soTotal,
      paid_amount: soPaid,
      balance_amount: soBal,
      total_amount_secondary: Number((soTotal * rate).toFixed(2)),
      paid_amount_secondary: Number((soPaid * rate).toFixed(2)),
      balance_amount_secondary: Number((soBal * rate).toFixed(2)),
    },
    agent_freight_kpi: {
      ...rep.agent_freight_kpi,
      total_records: sos.filter((r) => (r.agent_inv_amount || 0) > 0 || r.agent_name).length,
      pending_records: sos.filter(
        (r) => (r.agent_inv_amount || 0) > 0 && (r.bill_status || "").trim().toLowerCase() !== "paid"
      ).length,
      cleared_records: sos.filter(
        (r) => (r.agent_inv_amount || 0) > 0 && (r.bill_status || "").trim().toLowerCase() === "paid"
      ).length,
      total_amount: agTotal,
      paid_amount: agPaid,
      balance_amount: agBal,
      total_amount_secondary: Number((agTotal / rate).toFixed(2)),
      paid_amount_secondary: Number((agPaid / rate).toFixed(2)),
      balance_amount_secondary: Number((agBal / rate).toFixed(2)),
    },
  };
  cachedFinanceReport = updated;
  return updated;
}

export function FinancialReportPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();

  // Granular Action Permissions for Financial Report
  const canCreatePayment = Auth.hasPermission("finance_report.create");
  const canUpdateMeta = Auth.hasPermission("finance_report.update");
  const canDeletePayment = Auth.hasPermission("finance_report.delete");
  const canExportReport = Auth.hasPermission("finance_report.export");

  // Active Section ("local_purchase" | "sale_order") & Stage ("pending" | "cleared" | "all")
  const initialSection = (searchParams.get("section") as ActiveSection) || "local_purchase";
  const initialStage = (searchParams.get("stage") as FinanceStage) || "pending";

  const [activeSection, setActiveSection] = useState<ActiveSection>(
    initialSection === "sale_order" ? "sale_order" : "local_purchase"
  );
  const [activeStage, setActiveStage] = useState<FinanceStage>(
    initialStage === "cleared" || initialStage === "all" ? initialStage : "pending"
  );

  // Filters & Pagination
  const [showFilters, setShowFilters] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [partyFilter, setPartyFilter] = useState("");
  const [consignmentFilter, setConsignmentFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Data state (initialized from module-level cache for 0ms instant paint)
  const [report, setReport] = useState<FinanceReportResponse | null>(cachedFinanceReport);
  const [loading, setLoading] = useState<boolean>(!cachedFinanceReport);
  const [exporting, setExporting] = useState<boolean>(false);
  const mutationSeqRef = useRef<number>(0);

  // 3-Dot Action Menu state
  const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Add Payment Modal state
  const [paymentModalTarget, setPaymentModalTarget] = useState<
    LocalPurchaseFinanceRow | SaleOrderFinanceRow | null
  >(null);
  const [payAmount, setPayAmount] = useState<string>("");
  const [payDate, setPayDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [payCurrency, setPayCurrency] = useState<string>("RMB");
  const [payMode, setPayMode] = useState<string>("RMB A/C");
  const [payBankCharges, setPayBankCharges] = useState<string>("0");
  const [payRefNo, setPayRefNo] = useState<string>("");
  const [payNextDueDate, setPayNextDueDate] = useState<string>("");
  const [payTermsInput, setPayTermsInput] = useState<string>("");
  const [payRemarks, setPayRemarks] = useState<string>("");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  // Payment History Modal state
  const [historyModalTarget, setHistoryModalTarget] = useState<
    LocalPurchaseFinanceRow | SaleOrderFinanceRow | null
  >(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);

  // Edit Financial / Agent Meta Modal state
  const [metaModalTarget, setMetaModalTarget] = useState<
    LocalPurchaseFinanceRow | SaleOrderFinanceRow | null
  >(null);
  const [metaForm, setMetaForm] = useState<FinanceMetaUpdatePayload>({});
  const [savingMeta, setSavingMeta] = useState<boolean>(false);

  // Close 3-dot dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuRowId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchReport = useCallback(
    async (opts?: { silent?: boolean }) => {
      const seqAtStart = mutationSeqRef.current;
      if (!opts?.silent && !cachedFinanceReport) {
        setLoading(true);
      }
      try {
        const qs = new URLSearchParams();
        qs.set("stage", "all"); // Fetch all stages so Pending & Cleared tab counts and instant tab switching work seamlessly
        if (partyFilter.trim()) qs.set("party_name", partyFilter.trim());
        if (consignmentFilter.trim()) qs.set("consignment_code", consignmentFilter.trim());
        if (dateFrom) qs.set("date_from", dateFrom);
        if (dateTo) qs.set("date_to", dateTo);

        const res = await apiGet<FinanceReportResponse>(`/finance/report?${qs.toString()}`);
        // Only apply if no newer mutation happened while this GET was in flight
        if (res.data && seqAtStart === mutationSeqRef.current) {
          cachedFinanceReport = res.data;
          setReport(res.data);
        }
      } catch (err) {
        if (!opts?.silent) {
          toast(errorMessage(err), "error");
        }
      } finally {
        setLoading(false);
      }
    },
    [partyFilter, consignmentFilter, dateFrom, dateTo, toast]
  );

  useEffect(() => {
    void fetchReport({ silent: Boolean(cachedFinanceReport) });
  }, [fetchReport]);

  // Sync URL query params for section/stage
  const handleSectionChange = (sec: ActiveSection) => {
    setActiveSection(sec);
    setCurrentPage(1);
    setSearchParams({ section: sec, stage: activeStage }, { replace: true });
  };

  const handleStageChange = (st: FinanceStage) => {
    setActiveStage(st);
    setCurrentPage(1);
    setSearchParams({ section: activeSection, stage: st }, { replace: true });
  };

  const handleKpiSelect = (sec: ActiveSection, st: FinanceStage) => {
    setActiveSection(sec);
    setActiveStage(st);
    setCurrentPage(1);
    setSearchParams({ section: sec, stage: st }, { replace: true });
  };

  const handleResetFilters = () => {
    setSearchInput("");
    setPartyFilter("");
    setConsignmentFilter("");
    setDateFrom("");
    setDateTo("");
    setCurrentPage(1);
  };

  // Client-side search & stage filtering for instant response
  const filteredLocalPurchases = useMemo(() => {
    const rows = report?.local_purchases ?? [];
    const q = searchInput.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeStage !== "all" && r.stage !== activeStage) return false;
      if (!q) return true;
      const hay = [
        r.supplier_name,
        r.invoice_no,
        r.consignment_code,
        r.items_summary,
        r.payment_terms,
        r.remarks,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [report?.local_purchases, activeStage, searchInput]);

  const filteredSaleOrders = useMemo(() => {
    const rows = report?.sale_orders ?? [];
    const q = searchInput.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeStage !== "all" && r.stage !== activeStage) return false;
      if (!q) return true;
      const hay = [
        r.buyer_name,
        r.order_no,
        r.consignment_code,
        r.items_summary,
        r.payment_terms,
        r.bl_details,
        r.agent_name,
        r.remarks,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [report?.sale_orders, activeStage, searchInput]);

  // Stage counts for the currently active section
  const stageCounts = useMemo(() => {
    if (activeSection === "local_purchase") {
      const all = report?.local_purchases ?? [];
      return {
        pending: all.filter((r) => r.stage === "pending").length,
        cleared: all.filter((r) => r.stage === "cleared").length,
        all: all.length,
      };
    } else {
      const all = report?.sale_orders ?? [];
      return {
        pending: all.filter((r) => r.stage === "pending").length,
        cleared: all.filter((r) => r.stage === "cleared").length,
        all: all.length,
      };
    }
  }, [activeSection, report]);

  // Paginated rows
  const totalActiveRows =
    activeSection === "local_purchase"
      ? filteredLocalPurchases.length
      : filteredSaleOrders.length;
  const totalPages = Math.max(1, Math.ceil(totalActiveRows / pageSize));
  const pagedLocalPurchases = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredLocalPurchases.slice(start, start + pageSize);
  }, [filteredLocalPurchases, currentPage, pageSize]);

  const pagedSaleOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredSaleOrders.slice(start, start + pageSize);
  }, [filteredSaleOrders, currentPage, pageSize]);

  // Open Add Payment Modal
  const openAddPaymentModal = (row: LocalPurchaseFinanceRow | SaleOrderFinanceRow) => {
    setOpenMenuRowId(null);
    setPaymentModalTarget(row);
    const defaultAmt = row.balance_amount > 0 ? row.balance_amount.toFixed(2) : "";
    setPayAmount(defaultAmt);
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayCurrency(row.currency || (row.source_type === "local_purchase" ? "RMB" : "USD"));
    setPayMode(row.source_type === "local_purchase" ? "RMB A/C" : "USD Transaction A/C");
    setPayBankCharges("0");
    setPayRefNo("");
    setPayNextDueDate(row.due_date ?? "");
    setPayTermsInput(row.payment_terms ?? "");
    setPayRemarks("");
  };

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalTarget) return;
    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) {
      toast("Please enter a valid payment amount greater than 0.", "error");
      return;
    }
    const target = paymentModalTarget;
    const payload: FinancePaymentCreatePayload = {
      payment_date: payDate,
      amount: amt,
      currency: payCurrency,
      payment_mode: payMode || null,
      bank_charges: parseFloat(payBankCharges || "0") || 0,
      reference_no: payRefNo.trim() || null,
      remarks: payRemarks.trim() || null,
      next_due_date: payNextDueDate || null,
      payment_terms: payTermsInput.trim() || null,
    };

    // Optimistic 0ms UI update: close modal immediately and update row + KPIs in memory
    const tempPayment: FinancePaymentItem = {
      id: `temp-${Date.now()}`,
      source_type: target.source_type,
      source_id: target.source_id,
      payment_date: payDate,
      amount: amt,
      currency: payCurrency,
      payment_mode: payMode || null,
      bank_charges: parseFloat(payBankCharges || "0") || 0,
      reference_no: payRefNo.trim() || null,
      attachment_url: null,
      remarks: payRemarks.trim() || null,
      created_at: new Date().toISOString(),
    };

    const remainingAfter = Math.max(0, Number((target.balance_amount - amt).toFixed(2)));
    mutationSeqRef.current += 1;
    setPaymentModalTarget(null);
    setReport((prev) => {
      if (!prev) return prev;
      const rate = prev.usd_to_rmb_rate > 0 ? prev.usd_to_rmb_rate : 7.2;
      const updateRow = <T extends LocalPurchaseFinanceRow | SaleOrderFinanceRow>(r: T): T => {
        if (r.source_id !== target.source_id) return r;
        const newPayments = [tempPayment, ...(r.payments || [])];
        const newPaid = Number(newPayments.reduce((s, p) => s + (p.amount || 0), 0).toFixed(2));
        const newBal = Math.max(0, Number((r.total_amount - newPaid).toFixed(2)));
        const newStage: FinanceStage =
          (r.total_amount > 0 && newBal <= 0.01) || (r.total_amount === 0 && newPaid > 0)
            ? "cleared"
            : "pending";
        const updatedRow: any = {
          ...r,
          paid_amount: newPaid,
          balance_amount: newBal,
          stage: newStage,
          payments_count: newPayments.length,
          payments: newPayments,
          last_payment_date: payDate,
          due_date: payNextDueDate || r.due_date,
          payment_terms: payTermsInput.trim() || r.payment_terms,
        };
        if (r.source_type === "local_purchase") {
          updatedRow.paid_amount_usd = Number((newPaid / rate).toFixed(2));
          updatedRow.balance_amount_usd = Number((newBal / rate).toFixed(2));
        }
        return updatedRow;
      };
      return recomputeFinanceReportKpis({
        ...prev,
        local_purchases:
          target.source_type === "local_purchase"
            ? prev.local_purchases.map(updateRow)
            : prev.local_purchases,
        sale_orders:
          target.source_type === "sale_order"
            ? prev.sale_orders.map(updateRow)
            : prev.sale_orders,
      });
    });

    if (remainingAfter <= 0.01) {
      toast("Full payment completed! Entry moved to Cleared stage.", "success");
    } else {
      toast("Payment installment recorded successfully.", "success");
    }

    setSavingPayment(true);
    try {
      const res = await apiPost<FinancePaymentItem>(
        `/finance/${target.source_type}/${target.source_id}/payments`,
        payload
      );
      if (res.data) {
        const savedPayment = res.data;
        setReport((prev) => {
          if (!prev) return prev;
          const replaceTemp = <T extends LocalPurchaseFinanceRow | SaleOrderFinanceRow>(r: T): T =>
            r.source_id === target.source_id
              ? ({
                  ...r,
                  payments: (r.payments || []).map((p) => (p.id === tempPayment.id ? savedPayment : p)),
                } as T)
              : r;
          return recomputeFinanceReportKpis({
            ...prev,
            local_purchases: prev.local_purchases.map(replaceTemp),
            sale_orders: prev.sale_orders.map(replaceTemp),
          });
        });
      }
    } catch (err) {
      toast(errorMessage(err), "error");
      void fetchReport({ silent: true });
    } finally {
      setSavingPayment(false);
    }
  };

  // Open Payment History Modal
  const openHistoryModal = (row: LocalPurchaseFinanceRow | SaleOrderFinanceRow) => {
    setOpenMenuRowId(null);
    setHistoryModalTarget(row);
  };

  const handleDeletePayment = async (payment: FinancePaymentItem) => {
    const ok = await confirm({
      title: "Delete Payment Installment?",
      message: `Are you sure you want to delete this payment of ${payment.currency} ${payment.amount.toLocaleString()} dated ${fmtDate(payment.payment_date)}? The pending balance will be recalculated automatically.`,
      confirmLabel: "Delete Payment",
      variant: "danger",
    });
    if (!ok) return;
    setDeletingPaymentId(payment.id);
    mutationSeqRef.current += 1;

    // Optimistic 0ms update in modal + report table + KPIs
    setHistoryModalTarget((prev) => {
      if (!prev) return null;
      const updatedPayments = prev.payments.filter((p) => p.id !== payment.id);
      const newPaid = Number(updatedPayments.reduce((s, p) => s + p.amount, 0).toFixed(2));
      return {
        ...prev,
        payments: updatedPayments,
        payments_count: updatedPayments.length,
        paid_amount: newPaid,
        balance_amount: Math.max(0, Number((prev.total_amount - newPaid).toFixed(2))),
      };
    });
    setReport((prev) => {
      if (!prev) return prev;
      const rate = prev.usd_to_rmb_rate > 0 ? prev.usd_to_rmb_rate : 7.2;
      const updateRow = <T extends LocalPurchaseFinanceRow | SaleOrderFinanceRow>(r: T): T => {
        if (r.source_id !== payment.source_id) return r;
        const newPayments = (r.payments || []).filter((p) => p.id !== payment.id);
        const newPaid = Number(newPayments.reduce((s, p) => s + (p.amount || 0), 0).toFixed(2));
        const newBal = Math.max(0, Number((r.total_amount - newPaid).toFixed(2)));
        const newStage: FinanceStage =
          (r.total_amount > 0 && newBal <= 0.01) || (r.total_amount === 0 && newPaid > 0)
            ? "cleared"
            : "pending";
        const updatedRow: any = {
          ...r,
          paid_amount: newPaid,
          balance_amount: newBal,
          stage: newStage,
          payments_count: newPayments.length,
          payments: newPayments,
        };
        if (r.source_type === "local_purchase") {
          updatedRow.paid_amount_usd = Number((newPaid / rate).toFixed(2));
          updatedRow.balance_amount_usd = Number((newBal / rate).toFixed(2));
        }
        return updatedRow;
      };
      return recomputeFinanceReportKpis({
        ...prev,
        local_purchases: prev.local_purchases.map(updateRow),
        sale_orders: prev.sale_orders.map(updateRow),
      });
    });

    try {
      await apiDelete(`/finance/payments/${payment.id}`);
      toast("Payment deleted and balance recalculated.", "success");
    } catch (err) {
      toast(errorMessage(err), "error");
      void fetchReport({ silent: true });
    } finally {
      setDeletingPaymentId(null);
    }
  };

  // Open Edit Financial / Agent Meta Modal
  const openEditMetaModal = (row: LocalPurchaseFinanceRow | SaleOrderFinanceRow) => {
    setOpenMenuRowId(null);
    setMetaModalTarget(row);
    if (row.source_type === "local_purchase") {
      setMetaForm({
        payment_terms: row.payment_terms ?? "",
        expected_dispatch_date: row.expected_dispatch_date ?? null,
        due_date: row.due_date ?? null,
        delivery_status: row.delivery_status ?? "",
        attachment_url: row.attachment_url ?? "",
        remarks: row.remarks ?? "",
      });
    } else {
      setMetaForm({
        payment_terms: row.payment_terms ?? "",
        tt_received_date: row.tt_received_date ?? null,
        expected_stuffing_date: row.expected_stuffing_date ?? "",
        due_date: row.due_date ?? null,
        attachment_url: row.attachment_url ?? "",
        remarks: row.remarks ?? "",
        bl_details: row.bl_details ?? "",
        bl_status: row.bl_status ?? "Pending",
        bill_status: row.bill_status ?? "Pending",
        agent_name: row.agent_name ?? "",
        agent_local_charge: row.agent_local_charge ?? 0,
        agent_freight_charge: row.agent_freight_charge ?? 0,
        agent_inv_amount: row.agent_inv_amount ?? 0,
        agent_payment_date: row.agent_payment_date ?? null,
      });
    }
  };

  const handleSaveMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!metaModalTarget) return;
    const target = metaModalTarget;
    const cleaned: FinanceMetaUpdatePayload = {
      ...metaForm,
      expected_dispatch_date: metaForm.expected_dispatch_date || null,
      due_date: metaForm.due_date || null,
      tt_received_date: metaForm.tt_received_date || null,
      agent_payment_date: metaForm.agent_payment_date || null,
    };

    // Optimistic 0ms UI update: close modal immediately and update row + KPIs in memory
    mutationSeqRef.current += 1;
    setMetaModalTarget(null);
    setReport((prev) => {
      if (!prev) return prev;
      if (target.source_type === "local_purchase") {
        return recomputeFinanceReportKpis({
          ...prev,
          local_purchases: prev.local_purchases.map((r) =>
            r.source_id === target.source_id
              ? {
                  ...r,
                  payment_terms: cleaned.payment_terms ?? r.payment_terms,
                  expected_dispatch_date: cleaned.expected_dispatch_date ?? null,
                  due_date: cleaned.due_date ?? null,
                  delivery_status: cleaned.delivery_status ?? r.delivery_status,
                  attachment_url: cleaned.attachment_url ?? r.attachment_url,
                  remarks: cleaned.remarks ?? r.remarks,
                }
              : r
          ),
        });
      } else {
        return recomputeFinanceReportKpis({
          ...prev,
          sale_orders: prev.sale_orders.map((r) =>
            r.source_id === target.source_id
              ? {
                  ...r,
                  payment_terms: cleaned.payment_terms ?? r.payment_terms,
                  tt_received_date: cleaned.tt_received_date ?? null,
                  expected_stuffing_date: cleaned.expected_stuffing_date ?? r.expected_stuffing_date,
                  due_date: cleaned.due_date ?? null,
                  attachment_url: cleaned.attachment_url ?? r.attachment_url,
                  remarks: cleaned.remarks ?? r.remarks,
                  bl_details: cleaned.bl_details ?? r.bl_details,
                  bl_status: cleaned.bl_status ?? r.bl_status,
                  bill_status: cleaned.bill_status ?? r.bill_status,
                  agent_name: cleaned.agent_name ?? r.agent_name,
                  agent_local_charge: Number(cleaned.agent_local_charge ?? r.agent_local_charge ?? 0),
                  agent_freight_charge: Number(cleaned.agent_freight_charge ?? r.agent_freight_charge ?? 0),
                  agent_inv_amount: Number(cleaned.agent_inv_amount ?? r.agent_inv_amount ?? 0),
                  agent_payment_date: cleaned.agent_payment_date ?? null,
                }
              : r
          ),
        });
      }
    });
    toast("Financial & schedule details updated.", "success");

    setSavingMeta(true);
    try {
      await apiPatch(`/finance/${target.source_type}/${target.source_id}/meta`, cleaned);
    } catch (err) {
      toast(errorMessage(err), "error");
      void fetchReport({ silent: true });
    } finally {
      setSavingMeta(false);
    }
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const qs = new URLSearchParams();
      qs.set("stage", activeStage);
      if (searchInput.trim()) qs.set("search", searchInput.trim());
      if (partyFilter.trim()) qs.set("party_name", partyFilter.trim());
      if (consignmentFilter.trim()) qs.set("consignment_code", consignmentFilter.trim());
      if (dateFrom) qs.set("date_from", dateFrom);
      if (dateTo) qs.set("date_to", dateTo);

      await downloadExport(
        `/finance?${qs.toString()}`,
        "xlsx",
        "Financial_Planner_Report"
      );
      toast("Financial Planner Excel exported successfully.", "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setExporting(false);
    }
  };

  const lpKpi = report?.local_purchase_kpi;
  const soKpi = report?.sale_order_kpi;
  const agentKpi = report?.agent_freight_kpi;

  return (
    <AppShell activeKey="finance-report">
      <main className="page" style={{ width: "100%", maxWidth: "none", padding: "16px 24px" }}>
        {/* Page Header Bar */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                color: "#0f172a",
                letterSpacing: "-0.01em",
              }}
            >
              Finance Planning Report
            </h1>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {report?.usd_to_rmb_rate ? (
              <span
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  background: "#f1f5f9",
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#334155",
                }}
                title="Live USD to RMB conversion rate used for dual-currency equivalents"
              >
                1 USD = ¥{report.usd_to_rmb_rate.toFixed(2)} RMB
              </span>
            ) : null}

            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 6,
                border: "1px solid #3b82f6",
                background: showFilters ? "#1d4ed8" : "#2563eb",
                color: "#ffffff",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
              title="Toggle Filter Options"
            >
              <span>▼</span> Filter
            </button>

            {canExportReport && (
              <button
                type="button"
                onClick={() => void handleExportExcel()}
                disabled={exporting}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "1px solid #d97706",
                  background: "#f59e0b",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: exporting ? "not-allowed" : "pointer",
                  opacity: exporting ? 0.7 : 1,
                }}
              >
                <span>⬇</span> {exporting ? "Exporting..." : "Export"}
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Filter Panel */}
        {showFilters && (
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "16px 20px",
              marginBottom: 18,
              boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600, color: "#1e293b" }}>
                Filter Options
              </span>
              <button
                type="button"
                onClick={handleResetFilters}
                style={{
                  padding: "5px 12px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#475569",
                  cursor: "pointer",
                }}
              >
                Reset Filters
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 12,
              }}
            >
              <div>
                <label
                  style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}
                >
                  Party (Supplier / Buyer)
                </label>
                <input
                  type="text"
                  value={partyFilter}
                  onChange={(e) => setPartyFilter(e.target.value)}
                  placeholder="Filter by supplier or buyer..."
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    fontSize: 13,
                  }}
                />
              </div>
              <div>
                <label
                  style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}
                >
                  Consignment Code
                </label>
                <input
                  type="text"
                  value={consignmentFilter}
                  onChange={(e) => setConsignmentFilter(e.target.value)}
                  placeholder="e.g. MUM 48, EXP 34..."
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    fontSize: 13,
                  }}
                />
              </div>
              <div>
                <label
                  style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}
                >
                  Date From
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    fontSize: 13,
                  }}
                />
              </div>
              <div>
                <label
                  style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}
                >
                  Date To
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    fontSize: 13,
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Top 6 KPI Summary Cards (Left 3: Local Purchase RMB | Right 3: Sales Process USD) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
            gap: 12,
            marginBottom: 18,
          }}
        >
          {/* Local Purchase ALL */}
          <div
            onClick={() => handleKpiSelect("local_purchase", "all")}
            style={{
              background:
                activeSection === "local_purchase" && activeStage === "all"
                  ? "#f8fbff"
                  : "#ffffff",
              border:
                activeSection === "local_purchase" && activeStage === "all"
                  ? "1.5px solid #3b82f6"
                  : "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "14px 16px",
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
              LOCAL PURCHASE — ALL
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
              {fmtMoney(lpKpi?.total_amount, "¥")}{" "}
              <span style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>
                ({lpKpi?.total_records ?? 0})
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
              Eqv: {fmtMoney(lpKpi?.total_amount_secondary, "$")}
            </div>
          </div>

          {/* Local Purchase PAID */}
          <div
            onClick={() => handleKpiSelect("local_purchase", "cleared")}
            style={{
              background:
                activeSection === "local_purchase" && activeStage === "cleared"
                  ? "#f8fbff"
                  : "#ffffff",
              border:
                activeSection === "local_purchase" && activeStage === "cleared"
                  ? "1.5px solid #3b82f6"
                  : "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "14px 16px",
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
              LOCAL PURCHASE — PAID
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#16a34a", marginTop: 4 }}>
              {fmtMoney(lpKpi?.paid_amount, "¥")}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
              Cleared: {lpKpi?.cleared_records ?? 0} | Eqv: {fmtMoney(lpKpi?.paid_amount_secondary, "$")}
            </div>
          </div>

          {/* Local Purchase BALANCE */}
          <div
            onClick={() => handleKpiSelect("local_purchase", "pending")}
            style={{
              background:
                activeSection === "local_purchase" && activeStage === "pending"
                  ? "#f8fbff"
                  : "#ffffff",
              border:
                activeSection === "local_purchase" && activeStage === "pending"
                  ? "1.5px solid #3b82f6"
                  : "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "14px 16px",
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
              LOCAL PURCHASE — BALANCE
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#dc2626", marginTop: 4 }}>
              {fmtMoney(lpKpi?.balance_amount, "¥")}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
              Pending: {lpKpi?.pending_records ?? 0} | Eqv: {fmtMoney(lpKpi?.balance_amount_secondary, "$")}
            </div>
          </div>

          {/* Sales Process ALL */}
          <div
            onClick={() => handleKpiSelect("sale_order", "all")}
            style={{
              background:
                activeSection === "sale_order" && activeStage === "all"
                  ? "#f8fbff"
                  : "#ffffff",
              border:
                activeSection === "sale_order" && activeStage === "all"
                  ? "1.5px solid #3b82f6"
                  : "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "14px 16px",
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
              SALES PROCESS — ALL
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
              {fmtMoney(soKpi?.total_amount, "$")}{" "}
              <span style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>
                ({soKpi?.total_records ?? 0})
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
              Eqv: {fmtMoney(soKpi?.total_amount_secondary, "¥")}
            </div>
          </div>

          {/* Sales Process PAID / RECEIVED */}
          <div
            onClick={() => handleKpiSelect("sale_order", "cleared")}
            style={{
              background:
                activeSection === "sale_order" && activeStage === "cleared"
                  ? "#f8fbff"
                  : "#ffffff",
              border:
                activeSection === "sale_order" && activeStage === "cleared"
                  ? "1.5px solid #3b82f6"
                  : "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "14px 16px",
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
              SALES PROCESS — RECEIVED
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#16a34a", marginTop: 4 }}>
              {fmtMoney(soKpi?.paid_amount, "$")}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
              Cleared: {soKpi?.cleared_records ?? 0} | Eqv: {fmtMoney(soKpi?.paid_amount_secondary, "¥")}
            </div>
          </div>

          {/* Sales Process BALANCE */}
          <div
            onClick={() => handleKpiSelect("sale_order", "pending")}
            style={{
              background:
                activeSection === "sale_order" && activeStage === "pending"
                  ? "#f8fbff"
                  : "#ffffff",
              border:
                activeSection === "sale_order" && activeStage === "pending"
                  ? "1.5px solid #3b82f6"
                  : "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "14px 16px",
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
              SALES PROCESS — BALANCE
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#dc2626", marginTop: 4 }}>
              {fmtMoney(soKpi?.balance_amount, "$")}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
              Pending: {soKpi?.pending_records ?? 0} | Eqv: {fmtMoney(soKpi?.balance_amount_secondary, "¥")}
            </div>
          </div>
        </div>

        {/* Main Card Container */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
            overflow: " visible",
          }}
        >
          {/* Section Switcher Bar (1. Local Purchase vs 2. Sales Process) */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "14px 20px",
              background: "#f8fafc",
              borderBottom: "1px solid #e2e8f0",
              borderTopLeftRadius: 10,
              borderTopRightRadius: 10,
            }}
          >
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => handleSectionChange("local_purchase")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 18px",
                  borderRadius: 8,
                  border:
                    activeSection === "local_purchase"
                      ? "1.5px solid #2563eb"
                      : "1px solid #cbd5e1",
                  background: activeSection === "local_purchase" ? "#eff6ff" : "#ffffff",
                  color: activeSection === "local_purchase" ? "#1d4ed8" : "#334155",
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <span>📦</span>
                <span>Local Purchase (Supplier Payments)</span>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: activeSection === "local_purchase" ? "#2563eb" : "#e2e8f0",
                    color: activeSection === "local_purchase" ? "#ffffff" : "#475569",
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                >
                  {lpKpi?.total_records ?? 0}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleSectionChange("sale_order")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 18px",
                  borderRadius: 8,
                  border:
                    activeSection === "sale_order"
                      ? "1.5px solid #2563eb"
                      : "1px solid #cbd5e1",
                  background: activeSection === "sale_order" ? "#eff6ff" : "#ffffff",
                  color: activeSection === "sale_order" ? "#1d4ed8" : "#334155",
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <span>🚢</span>
                <span>Sales Process (Export &amp; Agent Schedule)</span>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: activeSection === "sale_order" ? "#2563eb" : "#e2e8f0",
                    color: activeSection === "sale_order" ? "#ffffff" : "#475569",
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                >
                  {soKpi?.total_records ?? 0}
                </span>
              </button>
            </div>

            {/* Agent Freight Summary Pill when on Sales Process tab */}
            {activeSection === "sale_order" && agentKpi && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "6px 14px",
                  borderRadius: 8,
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  fontSize: 12,
                  color: "#92400e",
                }}
              >
                <strong>Forwarder / Agent Bills (RMB):</strong>
                <span>Total: {fmtMoney(agentKpi.total_amount, "¥")}</span>
                <span style={{ color: "#15803d", fontWeight: 600 }}>
                  Paid: {fmtMoney(agentKpi.paid_amount, "¥")}
                </span>
                <span style={{ color: "#b91c1c", fontWeight: 600 }}>
                  Pending: {fmtMoney(agentKpi.balance_amount, "¥")}
                </span>
              </div>
            )}
          </div>

          {/* Stage Sub-Tabs (`Pending` | `Cleared` | `All`) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              padding: "0 20px",
              borderBottom: "1px solid #e2e8f0",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", gap: 24 }}>
              {(
                [
                  { key: "pending", label: `Pending (${stageCounts.pending})` },
                  { key: "cleared", label: `Cleared (${stageCounts.cleared})` },
                  { key: "all", label: `All (${stageCounts.all})` },
                ] as { key: FinanceStage; label: string }[]
              ).map((tab) => {
                const isActive = activeStage === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => handleStageChange(tab.key)}
                    style={{
                      padding: "14px 4px",
                      border: "none",
                      borderBottom: isActive
                        ? "2.5px solid #2563eb"
                        : "2.5px solid transparent",
                      background: "transparent",
                      color: isActive ? "#2563eb" : "#64748b",
                      fontSize: 13.5,
                      fontWeight: isActive ? 700 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div style={{ fontSize: 12, color: "#64748b", padding: "8px 0" }}>
              {activeSection === "local_purchase"
                ? activeStage === "pending"
                  ? "Showing Confirmed Local Purchases where supplier payment is pending from our side."
                  : activeStage === "cleared"
                  ? "Showing Confirmed Local Purchases where 100% supplier payment is completed."
                  : "Showing all Confirmed Local Purchases."
                : activeStage === "pending"
                ? "Showing Confirmed Sales Process orders where payment is not yet fully completed."
                : activeStage === "cleared"
                ? "Showing Confirmed Sales Process orders where 100% payment is completed."
                : "Showing all Confirmed Sales Process orders."}
            </div>
          </div>

          {/* Controls Row: Page Size + Search Input */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              padding: "14px 20px",
              borderBottom: "1px solid #f1f5f9",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475569" }}>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  background: "#ffffff",
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>items/page</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="text"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search party, invoice/exp no., consignment, items..."
                style={{
                  width: 310,
                  maxWidth: "100%",
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                }}
              />
            </div>
          </div>

          {/* Table Content */}
          {loading ? (
            <div style={{ padding: "48px 20px", textAlign: "center", color: "#64748b", fontSize: 14 }}>
              Loading Financial Report...
            </div>
          ) : activeSection === "local_purchase" ? (
            /* ============================================================
               SECTION 1 TABLE: LOCAL PURCHASE (SUPPLIER PAYMENTS)
               ============================================================ */
            <div style={{ overflowX: "auto", paddingBottom: openMenuRowId ? 180 : 0 }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    <th style={thStyle}>Party Name</th>
                    <th style={thStyle}>Invoice / Cons. No.</th>
                    <th style={thStyle}>Items &amp; Qty</th>
                    <th style={thStyle}>Invoice Attachment</th>
                    <th style={thStyle}>Payment Terms</th>
                    <th style={thStyle}>Expected Dispatch</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Total Amount</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Paid Amount</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Balance Amount</th>
                    <th style={thStyle}>Due Date</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Status</th>
                    <th style={{ ...thStyle, textAlign: "center", width: 70 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedLocalPurchases.length === 0 ? (
                    <tr>
                      <td colSpan={12} style={{ padding: "42px 20px", textAlign: "center", color: "#64748b" }}>
                        No Confirmed Local Purchase entries found in the{" "}
                        <strong>{activeStage.toUpperCase()}</strong> stage.
                      </td>
                    </tr>
                  ) : (
                    pagedLocalPurchases.map((row, idx) => {
                      const menuKey = `lp-${row.source_id}`;
                      return (
                        <tr
                          key={row.source_id}
                          style={{
                            background: idx % 2 === 1 ? "#f8fafc" : "#ffffff",
                            borderBottom: "1px solid #e2e8f0",
                          }}
                        >
                          {/* Party Name */}
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 600, color: "#0f172a" }}>{row.supplier_name}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                              <span
                                style={{
                                  padding: "1px 8px",
                                  borderRadius: 4,
                                  background: "#fef3c7",
                                  color: "#b45309",
                                  fontSize: 11,
                                  fontWeight: 600,
                                }}
                              >
                                Supplier
                              </span>
                              {row.branch_name && (
                                <span style={{ fontSize: 11, color: "#64748b" }}>{row.branch_name}</span>
                              )}
                            </div>
                          </td>

                          {/* Invoice / Consignment */}
                          <td style={tdStyle}>
                            <button
                              type="button"
                              onClick={() => navigate(`/purchase/local/${row.source_id}/edit`)}
                              style={{
                                border: "none",
                                background: "none",
                                padding: 0,
                                color: "#2563eb",
                                fontWeight: 600,
                                fontSize: 13,
                                cursor: "pointer",
                                textDecoration: "underline",
                              }}
                            >
                              {row.invoice_no}
                            </button>
                            {row.consignment_code && (
                              <div style={{ fontSize: 11.5, color: "#475569", marginTop: 2 }}>
                                Cons: <strong>{row.consignment_code}</strong>
                              </div>
                            )}
                            {row.invoice_date && (
                              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                                Date: {fmtDate(row.invoice_date)}
                              </div>
                            )}
                          </td>

                          {/* Items & Qty */}
                          <td style={{ ...tdStyle, maxWidth: 230 }}>
                            <div>
                              {(() => {
                                const itemsList =
                                  row.items_list && row.items_list.length > 0
                                    ? row.items_list
                                    : row.items_summary
                                    ? row.items_summary
                                        .replace(/\s*\(\+\d+\s+more\)$/i, "")
                                        .split(",")
                                        .map((s) => s.trim())
                                        .filter(Boolean)
                                    : [];

                                if (itemsList.length === 0) {
                                  return <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>;
                                }

                                if (itemsList.length === 1) {
                                  const cleanSingle = itemsList[0].replace(/\s*—\s*Qty:\s*[^\s]+$/i, "");
                                  return (
                                    <TextPopoverCell
                                      text={cleanSingle}
                                      maxLen={20}
                                      title={`Product (${row.invoice_no})`}
                                      icon="📦"
                                      maxWidth="150px"
                                    />
                                  );
                                }

                                const firstClean = itemsList[0].replace(/\s*—\s*Qty:\s*[^\s]+$/i, "");
                                const displayItems = [firstClean, ...itemsList.slice(1)];
                                return (
                                  <ItemPopoverCell
                                    items={displayItems}
                                    popoverItems={itemsList}
                                    icon="📦"
                                    itemIcon="📦"
                                    title={`📍 Products (${row.invoice_no})`}
                                    badgeIcon="📍"
                                    maxWidth="135px"
                                  />
                                );
                              })()}
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                              Qty: <strong>{row.total_quantity}</strong> ({row.items_count}{" "}
                              {row.items_count === 1 ? "item" : "items"})
                            </div>
                          </td>

                          {/* Invoice Attachment */}
                          <td style={tdStyle}>
                            {row.attachment_url ? (
                              <a
                                href={row.attachment_url}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  color: "#2563eb",
                                  fontWeight: 600,
                                  fontSize: 12,
                                  textDecoration: "none",
                                }}
                                title="Download / View Attachment"
                              >
                                ⬇ View Bill
                              </a>
                            ) : canUpdateMeta ? (
                              <button
                                type="button"
                                onClick={() => openEditMetaModal(row)}
                                style={{
                                  padding: "3px 8px",
                                  borderRadius: 4,
                                  border: "1px solid #86efac",
                                  background: "#f0fdf4",
                                  color: "#15803d",
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                              >
                                + Add
                              </button>
                            ) : (
                              <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>
                            )}
                          </td>

                          {/* Payment Terms */}
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 500, color: "#1e293b" }}>
                              {row.payment_terms || "—"}
                            </div>
                            {canUpdateMeta && (
                              <button
                                type="button"
                                onClick={() => openEditMetaModal(row)}
                                style={inlineEditBtnStyle}
                                title="Edit Payment Terms & Schedule"
                              >
                                ✎
                              </button>
                            )}
                          </td>

                          {/* Expected Dispatch */}
                          <td style={tdStyle}>
                            <span style={{ color: "#334155" }}>
                              {fmtDate(row.expected_dispatch_date)}
                            </span>
                          </td>

                          {/* Total Amount */}
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                            <div>{fmtMoney(row.total_amount, "¥")}</div>
                            <div style={{ fontSize: 11, fontWeight: 500, color: "#64748b" }}>
                              {fmtMoney(row.total_amount_usd, "$")}
                            </div>
                          </td>

                          {/* Paid Amount */}
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            <div style={{ fontWeight: 700, color: "#16a34a" }}>
                              {fmtMoney(row.paid_amount, "¥")}
                            </div>
                            {row.payments_count > 0 && (
                              <button
                                type="button"
                                onClick={() => openHistoryModal(row)}
                                style={{
                                  border: "none",
                                  background: "none",
                                  padding: 0,
                                  fontSize: 11,
                                  color: "#2563eb",
                                  cursor: "pointer",
                                  textDecoration: "underline",
                                }}
                              >
                                {row.payments_count} payment{row.payments_count > 1 ? "s" : ""}
                              </button>
                            )}
                          </td>

                          {/* Balance Amount */}
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            <div
                              style={{
                                fontWeight: 700,
                                color: row.balance_amount > 0 ? "#dc2626" : "#16a34a",
                              }}
                            >
                              {fmtMoney(row.balance_amount, "¥")}
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              {fmtMoney(row.balance_amount_usd, "$")}
                            </div>
                          </td>

                          {/* Due Date */}
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 500, color: "#1e293b" }}>
                              {fmtDate(row.due_date)}
                            </div>
                            {row.last_payment_date && (
                              <div style={{ fontSize: 11, color: "#64748b" }}>
                                Paid: {fmtDate(row.last_payment_date)}
                              </div>
                            )}
                          </td>

                          {/* Status */}
                          <td style={{ ...tdStyle, textAlign: "center" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 10px",
                                borderRadius: 6,
                                fontSize: 11.5,
                                fontWeight: 700,
                                background: row.stage === "cleared" ? "#dbeafe" : "#fef3c7",
                                color: row.stage === "cleared" ? "#1d4ed8" : "#b45309",
                              }}
                            >
                              {row.stage === "cleared" ? "Cleared" : "Pending"}
                            </span>
                            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 3 }}>
                              {row.source_status}
                            </div>
                          </td>

                          {/* 3-Dot Action Menu */}
                          <td style={{ ...tdStyle, textAlign: "center", position: "relative" }}>
                            <button
                              type="button"
                              onClick={() =>
                                setOpenMenuRowId((prev) => (prev === menuKey ? null : menuKey))
                              }
                              style={threeDotBtnStyle}
                              title="Actions"
                            >
                              ⋮
                            </button>
                            {openMenuRowId === menuKey && (
                              <div ref={menuRef} style={dropdownMenuStyle}>
                                {canCreatePayment && (
                                  <button
                                    type="button"
                                    onClick={() => openAddPaymentModal(row)}
                                    style={dropdownItemStyle}
                                  >
                                    <span>💳</span> Add Payment
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openHistoryModal(row)}
                                  style={dropdownItemStyle}
                                >
                                  <span>📜</span> Payment History ({row.payments_count})
                                </button>
                                {canUpdateMeta && (
                                  <button
                                    type="button"
                                    onClick={() => openEditMetaModal(row)}
                                    style={dropdownItemStyle}
                                  >
                                    <span>✏️</span> Edit Schedule / Terms
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => navigate(`/purchase/local/${row.source_id}/edit`)}
                                  style={dropdownItemStyle}
                                >
                                  <span>👁️</span> View Local Purchase
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* ============================================================
               SECTION 2 TABLE: SALES PROCESS (EXPORT & AGENT SCHEDULE)
               ============================================================ */
            <div style={{ overflowX: "auto", paddingBottom: openMenuRowId ? 180 : 0 }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    <th style={thStyle}>Customer / Buyer</th>
                    <th style={thStyle}>Exp No. / Consignment</th>
                    <th style={thStyle}>Stuffing / ETD / ETA</th>
                    <th style={thStyle}>TT Date &amp; Terms</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Total Amount</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Received Payment</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Balance Amount</th>
                    <th style={thStyle}>Due Date</th>
                    <th style={thStyle}>BL Details &amp; Status</th>
                    <th style={thStyle}>Agent &amp; Freight Bill (RMB)</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Status</th>
                    <th style={{ ...thStyle, textAlign: "center", width: 70 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSaleOrders.length === 0 ? (
                    <tr>
                      <td colSpan={12} style={{ padding: "42px 20px", textAlign: "center", color: "#64748b" }}>
                        No Confirmed Sales Process entries found in the{" "}
                        <strong>{activeStage.toUpperCase()}</strong> stage.
                      </td>
                    </tr>
                  ) : (
                    pagedSaleOrders.map((row, idx) => {
                      const menuKey = `so-${row.source_id}`;
                      const billPaid = (row.bill_status || "").toLowerCase() === "paid";
                      return (
                        <tr
                          key={row.source_id}
                          style={{
                            background: idx % 2 === 1 ? "#f8fafc" : "#ffffff",
                            borderBottom: "1px solid #e2e8f0",
                          }}
                        >
                          {/* Customer / Buyer */}
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 600, color: "#0f172a" }}>{row.buyer_name}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                              <span
                                style={{
                                  padding: "1px 8px",
                                  borderRadius: 4,
                                  background: "#e0f2fe",
                                  color: "#0369a1",
                                  fontSize: 11,
                                  fontWeight: 600,
                                }}
                              >
                                Customer
                              </span>
                              {row.buyer_branch_name && (
                                <span style={{ fontSize: 11, color: "#64748b" }}>
                                  {row.buyer_branch_name}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Exp No. / Consignment */}
                          <td style={tdStyle}>
                            <button
                              type="button"
                              onClick={() => navigate(`/sale/process/${row.source_id}/edit`)}
                              style={{
                                border: "none",
                                background: "none",
                                padding: 0,
                                color: "#2563eb",
                                fontWeight: 600,
                                fontSize: 13,
                                cursor: "pointer",
                                textDecoration: "underline",
                              }}
                            >
                              {row.order_no}
                            </button>
                            {row.consignment_code && (
                              <div style={{ fontSize: 11.5, color: "#475569", marginTop: 2 }}>
                                Cons: <strong>{row.consignment_code}</strong>
                              </div>
                            )}
                            {row.order_date && (
                              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                                Date: {fmtDate(row.order_date)}
                              </div>
                            )}
                          </td>

                          {/* Stuffing / ETD / ETA */}
                          <td style={{ ...tdStyle, fontSize: 12 }}>
                            <div>
                              <span style={{ color: "#64748b" }}>Stuffing:</span>{" "}
                              <strong>{row.expected_stuffing_date || "—"}</strong>
                            </div>
                            <div>
                              <span style={{ color: "#64748b" }}>ETD:</span>{" "}
                              {fmtDate(row.etd_origin_date)}
                            </div>
                            <div>
                              <span style={{ color: "#64748b" }}>ETA:</span>{" "}
                              {fmtDate(row.eta_port_date)}
                            </div>
                          </td>

                          {/* TT Received Date & Payment Terms */}
                          <td style={tdStyle}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>
                              {row.payment_terms || "—"}
                            </div>
                            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>
                              TT Date: {fmtDate(row.tt_received_date)}
                            </div>
                            {canUpdateMeta && (
                              <button
                                type="button"
                                onClick={() => openEditMetaModal(row)}
                                style={inlineEditBtnStyle}
                                title="Edit Payment Terms & TT Date"
                              >
                                ✎
                              </button>
                            )}
                          </td>

                          {/* Total Amount */}
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                            <div>{fmtMoney(row.total_amount, "$")}</div>
                            {row.ocean_freight_usd > 0 && (
                              <div style={{ fontSize: 11, fontWeight: 500, color: "#64748b" }}>
                                Freight: {fmtMoney(row.ocean_freight_usd, "$")}
                              </div>
                            )}
                          </td>

                          {/* Received Payment */}
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            <div style={{ fontWeight: 700, color: "#16a34a" }}>
                              {fmtMoney(row.paid_amount, "$")}
                            </div>
                            {row.payments_count > 0 && (
                              <button
                                type="button"
                                onClick={() => openHistoryModal(row)}
                                style={{
                                  border: "none",
                                  background: "none",
                                  padding: 0,
                                  fontSize: 11,
                                  color: "#2563eb",
                                  cursor: "pointer",
                                  textDecoration: "underline",
                                }}
                              >
                                {row.payments_count} payment{row.payments_count > 1 ? "s" : ""}
                              </button>
                            )}
                          </td>

                          {/* Balance Amount */}
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            <div
                              style={{
                                fontWeight: 700,
                                color: row.balance_amount > 0 ? "#dc2626" : "#16a34a",
                              }}
                            >
                              {fmtMoney(row.balance_amount, "$")}
                            </div>
                          </td>

                          {/* Due Date */}
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 500, color: "#1e293b" }}>
                              {fmtDate(row.due_date)}
                            </div>
                            {row.last_payment_date && (
                              <div style={{ fontSize: 11, color: "#64748b" }}>
                                Last TT: {fmtDate(row.last_payment_date)}
                              </div>
                            )}
                          </td>

                          {/* BL Details & Status */}
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 600, fontSize: 12, color: "#1e293b" }}>
                              {row.bl_details || "—"}
                            </div>
                            {row.bl_status && (
                              <span
                                style={{
                                  display: "inline-block",
                                  marginTop: 3,
                                  padding: "1px 7px",
                                  borderRadius: 4,
                                  background: "#f1f5f9",
                                  color: "#334155",
                                  fontSize: 11,
                                  fontWeight: 600,
                                }}
                              >
                                BL: {row.bl_status}
                              </span>
                            )}
                          </td>

                          {/* Forwarder / Agent & Freight Bill (Manager's Excel Tabs 3 & 4) */}
                          <td style={tdStyle}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <strong style={{ fontSize: 12.5, color: "#0f172a" }}>
                                {row.agent_name || "No Agent Set"}
                              </strong>
                              <span
                                style={{
                                  padding: "1px 6px",
                                  borderRadius: 4,
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  background: billPaid ? "#dcfce7" : "#fee2e2",
                                  color: billPaid ? "#15803d" : "#b91c1c",
                                }}
                              >
                                {billPaid ? "Bill Paid" : "Bill Pending"}
                              </span>
                            </div>
                            <div style={{ fontSize: 11.5, color: "#475569", marginTop: 2 }}>
                              Inv: <strong>{fmtMoney(row.agent_inv_amount, "¥")}</strong>{" "}
                              <span style={{ color: "#94a3b8" }}>
                                (Loc: ¥{row.agent_local_charge} + Frt: ¥{row.agent_freight_charge})
                              </span>
                            </div>
                            {row.agent_payment_date && (
                              <div style={{ fontSize: 11, color: "#15803d" }}>
                                Paid on: {fmtDate(row.agent_payment_date)}
                              </div>
                            )}
                          </td>

                          {/* Status */}
                          <td style={{ ...tdStyle, textAlign: "center" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 10px",
                                borderRadius: 6,
                                fontSize: 11.5,
                                fontWeight: 700,
                                background: row.stage === "cleared" ? "#dbeafe" : "#fef3c7",
                                color: row.stage === "cleared" ? "#1d4ed8" : "#b45309",
                              }}
                            >
                              {row.stage === "cleared" ? "Cleared" : "Pending"}
                            </span>
                            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 3 }}>
                              {row.source_status}
                            </div>
                          </td>

                          {/* 3-Dot Action Menu */}
                          <td style={{ ...tdStyle, textAlign: "center", position: "relative" }}>
                            <button
                              type="button"
                              onClick={() =>
                                setOpenMenuRowId((prev) => (prev === menuKey ? null : menuKey))
                              }
                              style={threeDotBtnStyle}
                              title="Actions"
                            >
                              ⋮
                            </button>
                            {openMenuRowId === menuKey && (
                              <div ref={menuRef} style={dropdownMenuStyle}>
                                {canCreatePayment && (
                                  <button
                                    type="button"
                                    onClick={() => openAddPaymentModal(row)}
                                    style={dropdownItemStyle}
                                  >
                                    <span>💳</span> Add Payment
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openHistoryModal(row)}
                                  style={dropdownItemStyle}
                                >
                                  <span>📜</span> Payment History ({row.payments_count})
                                </button>
                                {canUpdateMeta && (
                                  <button
                                    type="button"
                                    onClick={() => openEditMetaModal(row)}
                                    style={dropdownItemStyle}
                                  >
                                    <span>✏️</span> Edit BL &amp; Agent Bill
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => navigate(`/sale/process/${row.source_id}/edit`)}
                                  style={dropdownItemStyle}
                                >
                                  <span>👁️</span> View Sale Order
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 20px",
              borderTop: "1px solid #e2e8f0",
              fontSize: 13,
              color: "#64748b",
            }}
          >
            <div>
              Showing{" "}
              <strong>
                {totalActiveRows === 0 ? 0 : (currentPage - 1) * pageSize + 1}
              </strong>{" "}
              to{" "}
              <strong>{Math.min(currentPage * pageSize, totalActiveRows)}</strong> of{" "}
              <strong>{totalActiveRows}</strong> entries
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{
                  padding: "5px 12px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: currentPage <= 1 ? "#f8fafc" : "#ffffff",
                  color: currentPage <= 1 ? "#94a3b8" : "#334155",
                  cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                }}
              >
                Prev
              </button>
              <span style={{ padding: "5px 10px", fontWeight: 600, color: "#1e293b" }}>
                Page {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  padding: "5px 12px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
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
      </main>

      {/* =====================================================================
          MODAL 1: ADD PAYMENT (from 3-Dot Action Menu)
         ===================================================================== */}
      {paymentModalTarget && (
        <div style={modalBackdropStyle}>
          <div style={{ ...modalBoxStyle, maxWidth: 560 }}>
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0f172a" }}>
                  💳 Record Payment Installment
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "#64748b" }}>
                  {paymentModalTarget.source_type === "local_purchase"
                    ? `Supplier: ${paymentModalTarget.supplier_name} | Invoice: ${paymentModalTarget.invoice_no}`
                    : `Customer: ${paymentModalTarget.buyer_name} | Exp No.: ${paymentModalTarget.order_no}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPaymentModalTarget(null)}
                style={modalCloseBtnStyle}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePayment} style={{ padding: "18px 22px" }}>
              {/* Summary Banner */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 8,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  marginBottom: 16,
                  textAlign: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>TOTAL AMOUNT</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                    {fmtMoney(
                      paymentModalTarget.total_amount,
                      paymentModalTarget.source_type === "local_purchase" ? "¥" : "$"
                    )}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>ALREADY PAID</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#16a34a", marginTop: 2 }}>
                    {fmtMoney(
                      paymentModalTarget.paid_amount,
                      paymentModalTarget.source_type === "local_purchase" ? "¥" : "$"
                    )}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>PENDING BALANCE</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#dc2626", marginTop: 2 }}>
                    {fmtMoney(
                      paymentModalTarget.balance_amount,
                      paymentModalTarget.source_type === "local_purchase" ? "¥" : "$"
                    )}
                  </div>
                </div>
              </div>

              {/* Quick Percentage Fill Buttons */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Quick Fill:</span>
                {[
                  { label: "30% of Total", val: paymentModalTarget.total_amount * 0.3 },
                  { label: "50% of Total", val: paymentModalTarget.total_amount * 0.5 },
                  { label: "70% of Total", val: paymentModalTarget.total_amount * 0.7 },
                  { label: "100% Full Balance", val: paymentModalTarget.balance_amount },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setPayAmount(Math.max(0, preset.val).toFixed(2))}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: "1px solid #bfdbfe",
                      background: "#eff6ff",
                      color: "#1d4ed8",
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Payment Amount *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Payment Date *</label>
                  <input
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Payment Mode / Bank Account</label>
                  <select
                    value={payMode}
                    onChange={(e) => setPayMode(e.target.value)}
                    style={inputStyle}
                  >
                    {PAYMENT_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Bank Charges (if any)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={payBankCharges}
                    onChange={(e) => setPayBankCharges(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Reference / TT / UTR No.</label>
                  <input
                    type="text"
                    value={payRefNo}
                    onChange={(e) => setPayRefNo(e.target.value)}
                    placeholder="e.g. TT-20261102-01"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Next Due Date (Optional)</label>
                  <input
                    type="date"
                    value={payNextDueDate}
                    onChange={(e) => setPayNextDueDate(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Payment Terms (Optional Update)</label>
                <input
                  type="text"
                  list="payment-terms-list"
                  value={payTermsInput}
                  onChange={(e) => setPayTermsInput(e.target.value)}
                  placeholder="e.g. 30-70, 100% Advance, CAD..."
                  style={inputStyle}
                />
                <datalist id="payment-terms-list">
                  {PAYMENT_TERM_PRESETS.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Remarks</label>
                <textarea
                  rows={2}
                  value={payRemarks}
                  onChange={(e) => setPayRemarks(e.target.value)}
                  placeholder="Optional payment note (e.g. 30% Advance paid, balance before dispatch)..."
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setPaymentModalTarget(null)}
                  style={secondaryBtnStyle}
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingPayment} style={primaryBtnStyle}>
                  {savingPayment ? "Saving..." : "Save Payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: PAYMENT HISTORY (View & Delete Installments)
         ===================================================================== */}
      {historyModalTarget && (
        <div style={modalBackdropStyle}>
          <div style={{ ...modalBoxStyle, maxWidth: 720 }}>
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0f172a" }}>
                  📜 Payment History
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "#64748b" }}>
                  {historyModalTarget.source_type === "local_purchase"
                    ? `${historyModalTarget.supplier_name} — Invoice ${historyModalTarget.invoice_no}`
                    : `${historyModalTarget.buyer_name} — Exp No. ${historyModalTarget.order_no}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryModalTarget(null)}
                style={modalCloseBtnStyle}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "18px 22px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 14,
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div style={{ fontSize: 13 }}>
                  Total:{" "}
                  <strong>
                    {fmtMoney(
                      historyModalTarget.total_amount,
                      historyModalTarget.source_type === "local_purchase" ? "¥" : "$"
                    )}
                  </strong>{" "}
                  | Paid:{" "}
                  <strong style={{ color: "#16a34a" }}>
                    {fmtMoney(
                      historyModalTarget.paid_amount,
                      historyModalTarget.source_type === "local_purchase" ? "¥" : "$"
                    )}
                  </strong>{" "}
                  | Balance:{" "}
                  <strong style={{ color: "#dc2626" }}>
                    {fmtMoney(
                      historyModalTarget.balance_amount,
                      historyModalTarget.source_type === "local_purchase" ? "¥" : "$"
                    )}
                  </strong>
                </div>
                {canCreatePayment && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = historyModalTarget;
                      setHistoryModalTarget(null);
                      openAddPaymentModal(target);
                    }}
                    style={primaryBtnStyle}
                  >
                    + Add Payment
                  </button>
                )}
              </div>

              {historyModalTarget.payments.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "#64748b", fontSize: 13 }}>
                  No payments recorded yet for this entry.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #cbd5e1" }}>
                        <th style={thStyle}>Date</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Bank Charges</th>
                        <th style={thStyle}>Mode / Account</th>
                        <th style={thStyle}>Reference / TT No.</th>
                        <th style={thStyle}>Remarks</th>
                        {canDeletePayment && <th style={{ ...thStyle, textAlign: "center" }}>Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {historyModalTarget.payments.map((p) => (
                        <tr key={p.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                          <td style={tdStyle}>{fmtDate(p.payment_date)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#16a34a" }}>
                            {p.currency} {p.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            {p.bank_charges > 0 ? p.bank_charges.toFixed(2) : "—"}
                          </td>
                          <td style={tdStyle}>{p.payment_mode || "—"}</td>
                          <td style={tdStyle}>{p.reference_no || "—"}</td>
                          <td style={tdStyle}>{p.remarks || "—"}</td>
                          {canDeletePayment && (
                            <td style={{ ...tdStyle, textAlign: "center" }}>
                              <button
                                type="button"
                                disabled={deletingPaymentId === p.id}
                                onClick={() => void handleDeletePayment(p)}
                                style={{
                                  padding: "3px 8px",
                                  borderRadius: 4,
                                  border: "1px solid #fecaca",
                                  background: "#fef2f2",
                                  color: "#dc2626",
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                              >
                                Delete
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: EDIT FINANCIAL SCHEDULE / BL / AGENT FREIGHT BILL
         ===================================================================== */}
      {metaModalTarget && (
        <div style={modalBackdropStyle}>
          <div style={{ ...modalBoxStyle, maxWidth: 620 }}>
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0f172a" }}>
                  ✏️{" "}
                  {metaModalTarget.source_type === "local_purchase"
                    ? "Edit Payment Terms & Schedule"
                    : "Edit Export Financial & Agent Freight Bill Details"}
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "#64748b" }}>
                  {metaModalTarget.source_type === "local_purchase"
                    ? `${metaModalTarget.supplier_name} — ${metaModalTarget.invoice_no}`
                    : `${metaModalTarget.buyer_name} — ${metaModalTarget.order_no}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMetaModalTarget(null)}
                style={modalCloseBtnStyle}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveMeta} style={{ padding: "18px 22px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Payment Terms</label>
                  <input
                    type="text"
                    list="meta-payment-terms"
                    value={metaForm.payment_terms ?? ""}
                    onChange={(e) => setMetaForm((f) => ({ ...f, payment_terms: e.target.value }))}
                    placeholder="e.g. 30-70, 100% Advance, CAD..."
                    style={inputStyle}
                  />
                  <datalist id="meta-payment-terms">
                    {PAYMENT_TERM_PRESETS.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label style={labelStyle}>Estimated Due Date of Payment</label>
                  <input
                    type="date"
                    value={metaForm.due_date ?? ""}
                    onChange={(e) => setMetaForm((f) => ({ ...f, due_date: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              </div>

              {metaModalTarget.source_type === "local_purchase" ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={labelStyle}>Expected Dispatch Date</label>
                    <input
                      type="date"
                      value={metaForm.expected_dispatch_date ?? ""}
                      onChange={(e) =>
                        setMetaForm((f) => ({ ...f, expected_dispatch_date: e.target.value }))
                      }
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Delivery Status</label>
                    <input
                      type="text"
                      value={metaForm.delivery_status ?? ""}
                      onChange={(e) =>
                        setMetaForm((f) => ({ ...f, delivery_status: e.target.value }))
                      }
                      placeholder="e.g. Confirmed, Dispatched, Received..."
                      style={inputStyle}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={labelStyle}>Expected Stuffing Date</label>
                      <input
                        type="text"
                        value={metaForm.expected_stuffing_date ?? ""}
                        onChange={(e) =>
                          setMetaForm((f) => ({ ...f, expected_stuffing_date: e.target.value }))
                        }
                        placeholder="e.g. 2026-11-05"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>TT Received Date</label>
                      <input
                        type="date"
                        value={metaForm.tt_received_date ?? ""}
                        onChange={(e) =>
                          setMetaForm((f) => ({ ...f, tt_received_date: e.target.value }))
                        }
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  {/* Forwarder / Agent Freight Bill Section (Manager's Excel Tabs 3 & 4) */}
                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: 8,
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: "#1e293b",
                        marginBottom: 10,
                      }}
                    >
                      🚢 BL &amp; Forwarder / Agent Freight Bill (Manager Planner Schedule)
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                      <div>
                        <label style={labelStyle}>BL Details (BL No.)</label>
                        <input
                          type="text"
                          value={metaForm.bl_details ?? ""}
                          onChange={(e) =>
                            setMetaForm((f) => ({ ...f, bl_details: e.target.value }))
                          }
                          placeholder="e.g.SNKO020260201105"
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>BL Status</label>
                        <select
                          value={metaForm.bl_status ?? "Pending"}
                          onChange={(e) =>
                            setMetaForm((f) => ({ ...f, bl_status: e.target.value }))
                          }
                          style={inputStyle}
                        >
                          {BL_STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                      <div>
                        <label style={labelStyle}>Agent / Forwarder Name</label>
                        <input
                          type="text"
                          value={metaForm.agent_name ?? ""}
                          onChange={(e) =>
                            setMetaForm((f) => ({ ...f, agent_name: e.target.value }))
                          }
                          placeholder="e.g. Agnes, Apec, Wellines..."
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Agent Bill Status</label>
                        <select
                          value={metaForm.bill_status ?? "Pending"}
                          onChange={(e) =>
                            setMetaForm((f) => ({ ...f, bill_status: e.target.value }))
                          }
                          style={inputStyle}
                        >
                          <option value="Pending">Pending</option>
                          <option value="Paid">Paid</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                      <div>
                        <label style={labelStyle}>Local Charge (RMB ¥)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={metaForm.agent_local_charge ?? 0}
                          onChange={(e) => {
                            const loc = parseFloat(e.target.value || "0") || 0;
                            const frt = Number(metaForm.agent_freight_charge ?? 0);
                            setMetaForm((f) => ({
                              ...f,
                              agent_local_charge: loc,
                              agent_inv_amount: Number((loc + frt).toFixed(2)),
                            }));
                          }}
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Freight Charge (RMB ¥)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={metaForm.agent_freight_charge ?? 0}
                          onChange={(e) => {
                            const frt = parseFloat(e.target.value || "0") || 0;
                            const loc = Number(metaForm.agent_local_charge ?? 0);
                            setMetaForm((f) => ({
                              ...f,
                              agent_freight_charge: frt,
                              agent_inv_amount: Number((loc + frt).toFixed(2)),
                            }));
                          }}
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Total Inv Amount (RMB ¥)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={metaForm.agent_inv_amount ?? 0}
                          onChange={(e) =>
                            setMetaForm((f) => ({
                              ...f,
                              agent_inv_amount: parseFloat(e.target.value || "0") || 0,
                            }))
                          }
                          style={inputStyle}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={labelStyle}>Agent Payment Date</label>
                      <input
                        type="date"
                        value={metaForm.agent_payment_date ?? ""}
                        onChange={(e) =>
                          setMetaForm((f) => ({ ...f, agent_payment_date: e.target.value }))
                        }
                        style={inputStyle}
                      />
                    </div>
                  </div>
                </>
              )}

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Invoice / Bill Attachment URL</label>
                <input
                  type="text"
                  value={metaForm.attachment_url ?? ""}
                  onChange={(e) => setMetaForm((f) => ({ ...f, attachment_url: e.target.value }))}
                  placeholder="https://..."
                  style={inputStyle}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Remarks</label>
                <textarea
                  rows={2}
                  value={metaForm.remarks ?? ""}
                  onChange={(e) => setMetaForm((f) => ({ ...f, remarks: e.target.value }))}
                  placeholder="Financial planning notes..."
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setMetaModalTarget(null)}
                  style={secondaryBtnStyle}
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingMeta} style={primaryBtnStyle}>
                  {savingMeta ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const thStyle: React.CSSProperties = {
  padding: "11px 12px",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 700,
  color: "#334155",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "11px 12px",
  verticalAlign: "middle",
  color: "#1e293b",
};

const inlineEditBtnStyle: React.CSSProperties = {
  marginTop: 4,
  padding: "2px 6px",
  borderRadius: 4,
  border: "1px solid #86efac",
  background: "#f0fdf4",
  color: "#16a34a",
  fontSize: 11,
  cursor: "pointer",
};

const threeDotBtnStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 6,
  border: "1px solid #e2e8f0",
  background: "#ffffff",
  color: "#334155",
  fontSize: 16,
  fontWeight: 700,
  cursor: "pointer",
};

const dropdownMenuStyle: React.CSSProperties = {
  position: "absolute",
  right: 16,
  top: 38,
  zIndex: 50,
  minWidth: 205,
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  boxShadow: "0 10px 25px rgba(15, 23, 42, 0.14)",
  padding: "4px 0",
  textAlign: "left",
};

const dropdownItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "8px 14px",
  border: "none",
  background: "transparent",
  fontSize: 13,
  fontWeight: 500,
  color: "#1e293b",
  cursor: "pointer",
  textAlign: "left",
};

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "rgba(15, 23, 42, 0.48)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const modalBoxStyle: React.CSSProperties = {
  width: "100%",
  background: "#ffffff",
  borderRadius: 12,
  boxShadow: "0 20px 45px rgba(15, 23, 42, 0.22)",
  overflow: "hidden",
  maxHeight: "92vh",
  overflowY: "auto",
};

const modalHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 22px",
  borderBottom: "1px solid #e2e8f0",
  background: "#f8fafc",
};

const modalCloseBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 18,
  color: "#64748b",
  cursor: "pointer",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#334155",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  fontSize: 13,
  color: "#0f172a",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "1px solid #1d4ed8",
  background: "#2563eb",
  color: "#ffffff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#334155",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
