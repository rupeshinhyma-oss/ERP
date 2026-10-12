/**
 * Technician Spare Parts Gatepass, Wallet Management & Warranty Tracking.
 *
 * Implements Section 1.6:
 *  1. Technician Spare Parts Gatepass & Return Workflow:
 *     - Track spare parts taken out by technicians for service calls.
 *     - Partial return reconciliation: verify whether a Sales Order was created for consumed parts.
 *     - Outward gatepass issuance, return gatepass generation, and draft SO creation.
 *  2. Technician Payment & Wallet Management:
 *     - Record payments collected by technicians on field tasks (Cash, UPI, Cheque, Bank Transfer).
 *     - Track technician-wise cash/wallet balance ledger (Net Cash = Collections - Deposits - Expenses).
 *  3. Warranty Tracking System:
 *     - Warranty lifecycle tracking (under-warranty vs out-of-warranty validation based on serial number and invoice date).
 *     - Live machine serial validator widget.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Pagination } from "@/components/Pagination";
import { SideDrawer } from "@/components/SideDrawer";
import { Banner, Modal } from "@/components/ui";
import { apiGet, apiPost } from "@/lib/api";

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export interface MachineWarranty {
  id: string;
  serial_number: string;
  machine_model: string;
  product_id?: string | null;
  company_name: string;
  company_id?: string | null;
  invoice_number?: string | null;
  invoice_date: string;
  warranty_months: number;
  warranty_end_date: string;
  status: string;
  contact_person?: string | null;
  contact_phone?: string | null;
  installation_city?: string | null;
  notes?: string | null;
  created_at: string;
  is_currently_covered: boolean;
  days_remaining: number;
}

export interface WarrantyValidationResult {
  serial_number: string;
  is_registered: boolean;
  is_covered: boolean;
  status: string;
  company_name?: string | null;
  machine_model?: string | null;
  invoice_date?: string | null;
  warranty_end_date?: string | null;
  message: string;
}

export interface GatepassItem {
  id: string;
  gatepass_id: string;
  product_id?: string | null;
  product_code?: string | null;
  product_name: string;
  uom: string;
  quantity_issued: number;
  quantity_consumed: number;
  quantity_returned: number;
  unit_rate?: number | null;
  is_warranty_covered: boolean;
  sales_order_number?: string | null;
  item_status: string;
  remarks?: string | null;
}

export interface Gatepass {
  id: string;
  gatepass_number: string;
  technician_id?: string | null;
  technician_name: string;
  technician_mobile?: string | null;
  technical_task_id?: string | null;
  customer_name?: string | null;
  machine_serial_number?: string | null;
  is_warranty_service: boolean;
  issue_date: string;
  issued_by_name: string;
  purpose: string;
  status: string;
  so_required: boolean;
  so_number?: string | null;
  so_created: boolean;
  return_gatepass_number?: string | null;
  notes?: string | null;
  created_at: string;
  items: GatepassItem[];
  total_issued: number;
  total_consumed: number;
  total_returned: number;
  pending_return: number;
  reconciliation_message: string;
}

export interface WalletTransaction {
  id: string;
  transaction_number: string;
  technician_id?: string | null;
  technician_name: string;
  technical_task_id?: string | null;
  customer_name?: string | null;
  transaction_type: "COLLECTION" | "HANDOVER_DEPOSIT" | "FIELD_EXPENSE";
  amount: number;
  payment_mode: string;
  reference_no?: string | null;
  transaction_date: string;
  receipt_url?: string | null;
  status: string;
  notes?: string | null;
  created_at: string;
}

export interface TechnicianWalletSummary {
  technician_id?: string | null;
  technician_name: string;
  technician_mobile?: string | null;
  total_collected: number;
  total_deposited: number;
  total_expenses: number;
  net_wallet_balance: number;
  status: "CLEAR" | "PENDING_DEPOSIT" | "REIMBURSEMENT_DUE";
  last_transaction_date?: string | null;
}

export interface TechnicianOperationsMetrics {
  active_gatepasses: number;
  pending_reconciliations: number;
  pending_sales_orders: number;
  total_wallet_cash_held: number;
  total_warranties_active: number;
}

export interface DraftSOGenerationResponse {
  customer_name: string;
  machine_serial_number?: string | null;
  gatepass_number: string;
  items_to_bill: Array<{
    gatepass_item_id: string;
    product_id?: string | null;
    product_code?: string | null;
    product_name: string;
    uom: string;
    quantity: number;
    unit_rate: number;
    line_total: number;
    remarks?: string | null;
  }>;
  estimated_subtotal: number;
  message: string;
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return "—";
  return "₹ " + Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function TechnicianOperationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "gatepasses";

  // --- Global State & Metrics ---
  const [metrics, setMetrics] = useState<TechnicianOperationsMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- Tab 1: Gatepasses State ---
  const [gatepasses, setGatepasses] = useState<Gatepass[]>([]);
  const [gpStatusFilter, setGpStatusFilter] = useState<string>("");
  const [gpSearch, setGpSearch] = useState<string>("");
  const [gpPage, setGpPage] = useState<number>(1);
  const [gpTotal, setGpTotal] = useState<number>(0);
  const [gpTotalPages, setGpTotalPages] = useState<number>(1);

  // Modals for Gatepass
  const [openCreateGpModal, setOpenCreateGpModal] = useState<boolean>(false);
  const [openReturnModal, setOpenReturnModal] = useState<boolean>(false);
  const [selectedGpForReturn, setSelectedGpForReturn] = useState<Gatepass | null>(null);
  const [returnItemsState, setReturnItemsState] = useState<Array<{
    item_id: string;
    product_name: string;
    quantity_issued: number;
    quantity_returned: number;
    quantity_consumed: number;
    is_warranty_covered: boolean;
    item_status: string;
    remarks: string;
  }>>([]);
  const [returnGatepassNo, setReturnGatepassNo] = useState<string>("");
  const [returnNotes, setReturnNotes] = useState<string>("");

  // Link SO Modal
  const [openLinkSOModal, setOpenLinkSOModal] = useState<boolean>(false);
  const [selectedGpForSO, setSelectedGpForSO] = useState<Gatepass | null>(null);
  const [soNumberInput, setSoNumberInput] = useState<string>("");
  const [soNotesInput, setSoNotesInput] = useState<string>("");

  // Draft SO Drawer
  const [openDraftSODrawer, setOpenDraftSODrawer] = useState<boolean>(false);
  const [draftSOData, setDraftSOData] = useState<DraftSOGenerationResponse | null>(null);
  const [activeGpForDraft, setActiveGpForDraft] = useState<Gatepass | null>(null);

  // View Details Drawer
  const [openDetailDrawer, setOpenDetailDrawer] = useState<boolean>(false);
  const [activeGpDetail, setActiveGpDetail] = useState<Gatepass | null>(null);

  // Create Gatepass Form State
  const [newGpTechName, setNewGpTechName] = useState<string>("");
  const [newGpTechMobile, setNewGpTechMobile] = useState<string>("");
  const [newGpCustomer, setNewGpCustomer] = useState<string>("");
  const [newGpSerial, setNewGpSerial] = useState<string>("");
  const [newGpPurpose, setNewGpPurpose] = useState<string>("Field Breakdown Service Call");
  const [newGpNotes, setNewGpNotes] = useState<string>("");
  const [newGpItems, setNewGpItems] = useState<Array<{
    product_name: string;
    product_code: string;
    uom: string;
    quantity_issued: number;
    unit_rate: number;
    remarks: string;
  }>>([
    { product_name: "", product_code: "", uom: "NOS", quantity_issued: 1, unit_rate: 0, remarks: "" }
  ]);
  const [newGpWarrantyCheckMsg, setNewGpWarrantyCheckMsg] = useState<string | null>(null);

  // --- Tab 2: Wallets & Collections State ---
  const [walletSummaries, setWalletSummaries] = useState<TechnicianWalletSummary[]>([]);
  const [walletTransactions, setWalletTransactions] = useState<WalletTransaction[]>([]);
  const [walletFilterTech, setWalletFilterTech] = useState<string>("");
  const [walletFilterType, setWalletFilterType] = useState<string>("");
  const [walletPage, setWalletPage] = useState<number>(1);
  const [walletTotal, setWalletTotal] = useState<number>(0);
  const [walletTotalPages, setWalletTotalPages] = useState<number>(1);

  // Record Transaction Modal
  const [openWalletTxnModal, setOpenWalletTxnModal] = useState<boolean>(false);
  const [txnTechName, setTxnTechName] = useState<string>("");
  const [txnType, setTxnType] = useState<"COLLECTION" | "HANDOVER_DEPOSIT" | "FIELD_EXPENSE">("COLLECTION");
  const [txnAmount, setTxnAmount] = useState<string>("");
  const [txnPaymentMode, setTxnPaymentMode] = useState<string>("Cash");
  const [txnCustomer, setTxnCustomer] = useState<string>("");
  const [txnRefNo, setTxnRefNo] = useState<string>("");
  const [txnNotes, setTxnNotes] = useState<string>("");

  // --- Tab 3: Machine Warranty State ---
  const [warranties, setWarranties] = useState<MachineWarranty[]>([]);
  const [warrSearch, setWarrSearch] = useState<string>("");
  const [warrStatusFilter, setWarrStatusFilter] = useState<string>("");
  const [warrPage, setWarrPage] = useState<number>(1);
  const [warrTotal, setWarrTotal] = useState<number>(0);
  const [warrTotalPages, setWarrTotalPages] = useState<number>(1);

  // Serial Validator Widget State
  const [validatorSerialInput, setValidatorSerialInput] = useState<string>("");
  const [validationResult, setValidationResult] = useState<WarrantyValidationResult | null>(null);
  const [validating, setValidating] = useState<boolean>(false);

  // Register Warranty Modal
  const [openRegisterWarrModal, setOpenRegisterWarrModal] = useState<boolean>(false);
  const [regSerial, setRegSerial] = useState<string>("");
  const [regModel, setRegModel] = useState<string>("");
  const [regCompany, setRegCompany] = useState<string>("");
  const [regInvoiceNo, setRegInvoiceNo] = useState<string>("");
  const [regInvoiceDate, setRegInvoiceDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [regMonths, setRegMonths] = useState<number>(12);
  const [regContactPerson, setRegContactPerson] = useState<string>("");
  const [regContactPhone, setRegContactPhone] = useState<string>("");
  const [regCity, setRegCity] = useState<string>("");
  const [regNotes, setRegNotes] = useState<string>("");

  // -------------------------------------------------------------------------
  // Data Fetching
  // -------------------------------------------------------------------------

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await apiGet<TechnicianOperationsMetrics>("/technician-operations/metrics");
      if (res && res.data) {
        setMetrics(res.data);
      }
    } catch (err) {
      console.error("Failed to load operations metrics:", err);
    }
  }, []);

  const fetchGatepasses = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (gpStatusFilter) params.append("status", gpStatusFilter);
      if (gpSearch) params.append("search", gpSearch);
      params.append("page", String(gpPage));
      params.append("page_size", "25");

      const res = await apiGet<Gatepass[]>(`/technician-operations/gatepasses?${params.toString()}`);

      if (res && res.data) {
        setGatepasses(res.data);
        const p = res.meta?.pagination;
        if (p) {
          setGpTotal(p.total_records ?? p.total_items ?? 0);
          setGpTotalPages(p.total_pages ?? 1);
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load gatepasses");
    } finally {
      setLoading(false);
    }
  }, [gpStatusFilter, gpSearch, gpPage]);

  const fetchWalletData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch live technician summaries
      const sumRes = await apiGet<TechnicianWalletSummary[]>("/technician-operations/wallet/summaries");
      if (sumRes && sumRes.data) {
        setWalletSummaries(sumRes.data);
      }

      // 2. Fetch transactions ledger
      const params = new URLSearchParams();
      if (walletFilterTech) params.append("technician_name", walletFilterTech);
      if (walletFilterType) params.append("transaction_type", walletFilterType);
      params.append("page", String(walletPage));
      params.append("page_size", "25");

      const txnRes = await apiGet<WalletTransaction[]>(`/technician-operations/wallet/transactions?${params.toString()}`);

      if (txnRes && txnRes.data) {
        setWalletTransactions(txnRes.data);
        const p = txnRes.meta?.pagination;
        if (p) {
          setWalletTotal(p.total_records ?? p.total_items ?? 0);
          setWalletTotalPages(p.total_pages ?? 1);
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load wallet data");
    } finally {
      setLoading(false);
    }
  }, [walletFilterTech, walletFilterType, walletPage]);

  const fetchWarranties = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (warrSearch) params.append("search", warrSearch);
      if (warrStatusFilter) params.append("status", warrStatusFilter);
      params.append("page", String(warrPage));
      params.append("page_size", "25");

      const res = await apiGet<MachineWarranty[]>(`/technician-operations/warranty?${params.toString()}`);

      if (res && res.data) {
        setWarranties(res.data);
        const p = res.meta?.pagination;
        if (p) {
          setWarrTotal(p.total_records ?? p.total_items ?? 0);
          setWarrTotalPages(p.total_pages ?? 1);
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load warranty registry");
    } finally {
      setLoading(false);
    }
  }, [warrSearch, warrStatusFilter, warrPage]);

  // Initial and reactive loads
  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    if (currentTab === "gatepasses") {
      fetchGatepasses();
    } else if (currentTab === "wallets") {
      fetchWalletData();
    } else if (currentTab === "warranty") {
      fetchWarranties();
    }
  }, [currentTab, fetchGatepasses, fetchWalletData, fetchWarranties]);

  // Tab switch handler
  const handleTabChange = (tabKey: string) => {
    setSearchParams({ tab: tabKey });
    setError(null);
    setSuccess(null);
  };

  // -------------------------------------------------------------------------
  // Machine Serial Validator Action
  // -------------------------------------------------------------------------

  const handleValidateSerial = async (serialToTest?: string) => {
    const s = (serialToTest || validatorSerialInput).trim();
    if (!s) return;
    setValidating(true);
    try {
      const res = await apiGet<WarrantyValidationResult>(
        `/technician-operations/warranty/validate?serial=${encodeURIComponent(s)}`
      );
      if (res && res.data) {
        setValidationResult(res.data);
      }
    } catch (err: any) {
      setError(err?.message || "Serial validation failed");
    } finally {
      setValidating(false);
    }
  };

  // -------------------------------------------------------------------------
  // Gatepass Actions
  // -------------------------------------------------------------------------

  // Check warranty during Gatepass creation
  const handleCheckSerialForGp = async () => {
    if (!newGpSerial.trim()) return;
    try {
      const res = await apiGet<WarrantyValidationResult>(
        `/technician-operations/warranty/validate?serial=${encodeURIComponent(newGpSerial.trim())}`
      );
      if (res && res.data) {
        if (res.data.is_covered) {
          setNewGpWarrantyCheckMsg(`✓ Machine is UNDER WARRANTY (${res.data.machine_model || ""} - ${res.data.company_name || ""}). Spare parts replacement eligible for FOC warranty.`);
        } else if (res.data.is_registered) {
          setNewGpWarrantyCheckMsg(`⚠️ Machine Warranty EXPIRED on ${res.data.warranty_end_date}. Spare parts consumed MUST be billed via Sales Order.`);
        } else {
          setNewGpWarrantyCheckMsg(`⚠️ Machine Serial not registered. Replacement parts will be chargeable.`);
        }
      }
    } catch (err) {
      setNewGpWarrantyCheckMsg("Unable to verify machine warranty.");
    }
  };

  const handleCreateGatepass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGpTechName.trim()) {
      setError("Technician name is required");
      return;
    }
    const validItems = newGpItems.filter(i => i.product_name.trim() && i.quantity_issued > 0);
    if (validItems.length === 0) {
      setError("Please add at least one spare part item with quantity > 0");
      return;
    }

    try {
      setLoading(true);
      await apiPost("/technician-operations/gatepasses", {
        technician_name: newGpTechName.trim(),
        technician_mobile: newGpTechMobile.trim() || null,
        customer_name: newGpCustomer.trim() || null,
        machine_serial_number: newGpSerial.trim() || null,
        purpose: newGpPurpose.trim(),
        notes: newGpNotes.trim() || null,
        items: validItems.map(i => ({
          product_name: i.product_name.trim(),
          product_code: i.product_code.trim() || null,
          uom: i.uom || "NOS",
          quantity_issued: Number(i.quantity_issued),
          unit_rate: Number(i.unit_rate) || null,
          remarks: i.remarks.trim() || null,
        })),
      });

      setSuccess("Outward Gatepass created successfully");
      setOpenCreateGpModal(false);
      // Reset form
      setNewGpTechName("");
      setNewGpTechMobile("");
      setNewGpCustomer("");
      setNewGpSerial("");
      setNewGpNotes("");
      setNewGpWarrantyCheckMsg(null);
      setNewGpItems([{ product_name: "", product_code: "", uom: "NOS", quantity_issued: 1, unit_rate: 0, remarks: "" }]);

      fetchGatepasses();
      fetchMetrics();
    } catch (err: any) {
      setError(err?.message || "Failed to create gatepass");
    } finally {
      setLoading(false);
    }
  };

  // Open return modal and initialize return rows
  const handleOpenReturnModal = (gp: Gatepass) => {
    setSelectedGpForReturn(gp);
    const rows = gp.items.map(i => {
      // Default return: if already partially reconciled, show existing, else suggest returning balance
      const rem = Math.max(0, i.quantity_issued - (i.quantity_returned + i.quantity_consumed));
      return {
        item_id: i.id,
        product_name: i.product_name,
        quantity_issued: i.quantity_issued,
        quantity_returned: i.quantity_returned > 0 ? i.quantity_returned : rem,
        quantity_consumed: i.quantity_consumed,
        is_warranty_covered: i.is_warranty_covered || gp.is_warranty_service,
        item_status: i.item_status || "RETURNED_GOOD",
        remarks: i.remarks || "",
      };
    });
    setReturnItemsState(rows);
    setReturnGatepassNo(gp.return_gatepass_number || `RGP-TECH-${new Date().getFullYear()}-${gp.gatepass_number.split("-").pop()}`);
    setReturnNotes("");
    setOpenReturnModal(true);
  };

  const handleProcessReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGpForReturn) return;

    try {
      setLoading(true);
      await apiPost(`/technician-operations/gatepasses/${selectedGpForReturn.id}/return`, {
        return_gatepass_number: returnGatepassNo.trim() || null,
        notes: returnNotes.trim() || null,
        items: returnItemsState.map(i => ({
          item_id: i.item_id,
          quantity_returned: Number(i.quantity_returned),
          quantity_consumed: Number(i.quantity_consumed),
          is_warranty_covered: Boolean(i.is_warranty_covered),
          item_status: i.item_status,
          remarks: i.remarks || null,
        })),
      });

      setSuccess("Spare parts return processed and gatepass reconciled successfully");
      setOpenReturnModal(false);
      setSelectedGpForReturn(null);
      fetchGatepasses();
      fetchMetrics();
    } catch (err: any) {
      setError(err?.message || "Failed to process return");
    } finally {
      setLoading(false);
    }
  };

  // Open Link SO Modal
  const handleOpenLinkSOModal = (gp: Gatepass) => {
    setSelectedGpForSO(gp);
    setSoNumberInput(gp.so_number || "");
    setSoNotesInput("");
    setOpenLinkSOModal(true);
  };

  const handleLinkSO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGpForSO) return;
    if (!soNumberInput.trim()) {
      setError("Please enter the Sales Order number");
      return;
    }

    try {
      setLoading(true);
      await apiPost(`/technician-operations/gatepasses/${selectedGpForSO.id}/link-so`, {
        sales_order_number: soNumberInput.trim(),
        notes: soNotesInput.trim() || null,
      });

      setSuccess(`Sales Order '${soNumberInput.trim()}' linked and gatepass marked reconciled!`);
      setOpenLinkSOModal(false);
      setSelectedGpForSO(null);
      fetchGatepasses();
      fetchMetrics();
    } catch (err: any) {
      setError(err?.message || "Failed to link Sales Order");
    } finally {
      setLoading(false);
    }
  };

  // View Draft SO Payload
  const handleViewDraftSO = async (gp: Gatepass) => {
    setActiveGpForDraft(gp);
    try {
      setLoading(true);
      const res = await apiGet<DraftSOGenerationResponse>(
        `/technician-operations/gatepasses/${gp.id}/draft-so`
      );
      if (res && res.data) {
        setDraftSOData(res.data);
        setOpenDraftSODrawer(true);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to generate draft SO payload");
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Wallet Actions
  // -------------------------------------------------------------------------

  const handleRecordWalletTxn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txnTechName.trim()) {
      setError("Technician name is required");
      return;
    }
    const amt = parseFloat(txnAmount);
    if (isNaN(amt) || amt <= 0) {
      setError("Please enter a valid positive amount");
      return;
    }

    try {
      setLoading(true);
      await apiPost("/technician-operations/wallet/transactions", {
        technician_name: txnTechName.trim(),
        transaction_type: txnType,
        amount: amt,
        payment_mode: txnPaymentMode,
        customer_name: txnCustomer.trim() || null,
        reference_no: txnRefNo.trim() || null,
        notes: txnNotes.trim() || null,
      });

      setSuccess(`Wallet transaction of ₹${amt.toLocaleString("en-IN")} recorded successfully`);
      setOpenWalletTxnModal(false);
      // Reset
      setTxnTechName("");
      setTxnAmount("");
      setTxnCustomer("");
      setTxnRefNo("");
      setTxnNotes("");

      fetchWalletData();
      fetchMetrics();
    } catch (err: any) {
      setError(err?.message || "Failed to record wallet transaction");
    } finally {
      setLoading(false);
    }
  };

  // Fast trigger for technician wallet card
  const handleQuickTxn = (techName: string, type: "COLLECTION" | "HANDOVER_DEPOSIT" | "FIELD_EXPENSE") => {
    setTxnTechName(techName);
    setTxnType(type);
    setTxnAmount("");
    setTxnPaymentMode(type === "HANDOVER_DEPOSIT" ? "Cash Deposit" : "Cash");
    setTxnCustomer("");
    setTxnRefNo("");
    setTxnNotes(type === "HANDOVER_DEPOSIT" ? "Handed over cash collection to Accounts" : "");
    setOpenWalletTxnModal(true);
  };

  // -------------------------------------------------------------------------
  // Machine Warranty Actions
  // -------------------------------------------------------------------------

  const handleRegisterWarranty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regSerial.trim() || !regModel.trim() || !regCompany.trim()) {
      setError("Serial Number, Machine Model, and Customer Company are required");
      return;
    }

    try {
      setLoading(true);
      await apiPost("/technician-operations/warranty", {
        serial_number: regSerial.trim(),
        machine_model: regModel.trim(),
        company_name: regCompany.trim(),
        invoice_number: regInvoiceNo.trim() || null,
        invoice_date: regInvoiceDate,
        warranty_months: Number(regMonths),
        contact_person: regContactPerson.trim() || null,
        contact_phone: regContactPhone.trim() || null,
        installation_city: regCity.trim() || null,
        notes: regNotes.trim() || null,
      });

      setSuccess(`Machine Warranty for '${regSerial.trim()}' registered successfully`);
      setOpenRegisterWarrModal(false);
      // Reset
      setRegSerial("");
      setRegModel("");
      setRegCompany("");
      setRegInvoiceNo("");
      setRegNotes("");

      fetchWarranties();
      fetchMetrics();
    } catch (err: any) {
      setError(err?.message || "Failed to register machine warranty");
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <AppShell activeKey="technician-operations">
      <div className="container-fluid" style={{ padding: "20px 24px", maxWidth: "1600px" }}>
        {/* Breadcrumb Navigation */}
        <Breadcrumb trail={["Technical Tasks", "Technician Ops & Wallet"]} />

        {/* Global Notifications */}
        <Banner error={error} success={success} />

        {/* Page Header */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            marginBottom: "20px",
            paddingBottom: "16px",
            borderBottom: "1px solid var(--border-color, #e2e8f0)",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700, color: "var(--text-color, #1e293b)" }}>
              Technician Gatepass &amp; Wallet Management
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: "14px", color: "var(--text-muted, #64748b)" }}>
              Track field spare parts gatepasses, reconcile partial returns with Sales Orders, manage technician cash wallets, and track machine warranty lifecycles.
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {currentTab === "gatepasses" && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setOpenCreateGpModal(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "13px",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.06)",
                }}
              >
                <span>➕</span> Issue Outward Gatepass
              </button>
            )}

            {currentTab === "wallets" && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setTxnTechName("");
                  setTxnType("COLLECTION");
                  setTxnAmount("");
                  setOpenWalletTxnModal(true);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "13px",
                }}
              >
                <span>💳</span> Record Wallet Transaction
              </button>
            )}

            {currentTab === "warranty" && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setOpenRegisterWarrModal(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "13px",
                }}
              >
                <span>🛡️</span> Register Machine Warranty
              </button>
            )}
          </div>
        </div>

        {/* KPI Summary Ribbon */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          {/* Card 1: Active Gatepasses */}
          <div
            style={{
              background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)",
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
              padding: "16px 20px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "10px",
                background: "#eff6ff",
                color: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px",
              }}
            >
              🚚
            </div>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", color: "#64748b" }}>
                Active Gatepasses
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#1e293b", marginTop: "2px" }}>
                {metrics?.active_gatepasses ?? "—"}
              </div>
              <div style={{ fontSize: "12px", color: "#3b82f6", marginTop: "2px" }}>
                Spare parts currently in field
              </div>
            </div>
          </div>

          {/* Card 2: Pending SO Reconciliations */}
          <div
            style={{
              background: "linear-gradient(135deg, #fffbeb 0%, #ffffff 100%)",
              border: "1px solid #fef3c7",
              borderRadius: "10px",
              padding: "16px 20px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "10px",
                background: "#fef3c7",
                color: "#d97706",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px",
              }}
            >
              ⚠️
            </div>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", color: "#92400e" }}>
                Pending Sales Orders
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#b45309", marginTop: "2px" }}>
                {metrics?.pending_sales_orders ?? "—"}
              </div>
              <div style={{ fontSize: "12px", color: "#b45309", marginTop: "2px" }}>
                Consumed parts awaiting SO billing
              </div>
            </div>
          </div>

          {/* Card 3: Total Wallet Cash Held */}
          <div
            style={{
              background: "linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%)",
              border: "1px solid #dcfce7",
              borderRadius: "10px",
              padding: "16px 20px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "10px",
                background: "#dcfce7",
                color: "#16a34a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px",
              }}
            >
              💵
            </div>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", color: "#166534" }}>
                Cash in Hand (Technicians)
              </div>
              <div style={{ fontSize: "22px", fontWeight: 700, color: "#15803d", marginTop: "2px" }}>
                {formatCurrency(metrics?.total_wallet_cash_held ?? 0)}
              </div>
              <div style={{ fontSize: "12px", color: "#16a34a", marginTop: "2px" }}>
                Collected &amp; pending deposit
              </div>
            </div>
          </div>

          {/* Card 4: Machines Under Active Warranty */}
          <div
            style={{
              background: "linear-gradient(135deg, #f5f3ff 0%, #ffffff 100%)",
              border: "1px solid #ede9fe",
              borderRadius: "10px",
              padding: "16px 20px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "10px",
                background: "#ede9fe",
                color: "#7c3aed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px",
              }}
            >
              🛡️
            </div>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", color: "#5b21b6" }}>
                Active Machine Warranties
              </div>
              <div style={{ fontSize: "24px", fontWeight: 700, color: "#6d28d9", marginTop: "2px" }}>
                {metrics?.total_warranties_active ?? "—"}
              </div>
              <div style={{ fontSize: "12px", color: "#7c3aed", marginTop: "2px" }}>
                Registered equipment protected
              </div>
            </div>
          </div>
        </div>

        {/* Tab Selection Navigation */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            borderBottom: "2px solid #e2e8f0",
            marginBottom: "20px",
          }}
        >
          <button
            type="button"
            onClick={() => handleTabChange("gatepasses")}
            style={{
              padding: "10px 18px",
              border: "none",
              background: "none",
              borderBottom: currentTab === "gatepasses" ? "3px solid #2563eb" : "3px solid transparent",
              color: currentTab === "gatepasses" ? "#2563eb" : "#64748b",
              fontWeight: currentTab === "gatepasses" ? 700 : 500,
              fontSize: "14px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>📦</span> Spare Parts Gatepass &amp; Returns
            {metrics?.pending_sales_orders ? (
              <span
                style={{
                  background: "#fef3c7",
                  color: "#b45309",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  fontSize: "11px",
                  fontWeight: 700,
                }}
              >
                {metrics.pending_sales_orders} SO needed
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("wallets")}
            style={{
              padding: "10px 18px",
              border: "none",
              background: "none",
              borderBottom: currentTab === "wallets" ? "3px solid #2563eb" : "3px solid transparent",
              color: currentTab === "wallets" ? "#2563eb" : "#64748b",
              fontWeight: currentTab === "wallets" ? 700 : 500,
              fontSize: "14px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>👛</span> Technician Wallets &amp; Field Collections
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("warranty")}
            style={{
              padding: "10px 18px",
              border: "none",
              background: "none",
              borderBottom: currentTab === "warranty" ? "3px solid #2563eb" : "3px solid transparent",
              color: currentTab === "warranty" ? "#2563eb" : "#64748b",
              fontWeight: currentTab === "warranty" ? 700 : 500,
              fontSize: "14px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>🛡️</span> Machine Warranty Registry &amp; Validator
          </button>
        </div>

        {/* ================================================================= */}
        {/* TAB 1: SPARE PARTS GATEPASS & RETURNS                            */}
        {/* ================================================================= */}
        {currentTab === "gatepasses" && (
          <div>
            {/* Filter controls */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "12px",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "16px",
                background: "#f8fafc",
                padding: "12px 16px",
                borderRadius: "8px",
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Search Gatepass / Technician / Customer / Serial..."
                  value={gpSearch}
                  onChange={(e) => {
                    setGpSearch(e.target.value);
                    setGpPage(1);
                  }}
                  className="form-control"
                  style={{ width: "320px", fontSize: "13px" }}
                />

                <select
                  value={gpStatusFilter}
                  onChange={(e) => {
                    setGpStatusFilter(e.target.value);
                    setGpPage(1);
                  }}
                  className="form-control"
                  style={{ width: "190px", fontSize: "13px" }}
                >
                  <option value="">All Statuses</option>
                  <option value="ISSUED">ISSUED (In Field)</option>
                  <option value="PARTIALLY_RETURNED">PARTIALLY RETURNED</option>
                  <option value="RECONCILED">RECONCILED</option>
                  <option value="CLOSED">CLOSED</option>
                </select>

                {(gpSearch || gpStatusFilter) && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setGpSearch("");
                      setGpStatusFilter("");
                      setGpPage(1);
                    }}
                    style={{ fontSize: "12px", padding: "6px 12px" }}
                  >
                    Clear Filters
                  </button>
                )}
              </div>

              <div style={{ fontSize: "13px", color: "#64748b" }}>
                Showing <b>{gatepasses.length}</b> of <b>{gpTotal}</b> gatepasses
              </div>
            </div>

            {/* Gatepass Table */}
            <div className="table-responsive" style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <table className="table table-hover" style={{ margin: 0, fontSize: "13px" }}>
                <thead style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                  <tr>
                    <th style={{ padding: "12px 14px", fontWeight: 600 }}>Gatepass #</th>
                    <th style={{ padding: "12px 14px", fontWeight: 600 }}>Technician</th>
                    <th style={{ padding: "12px 14px", fontWeight: 600 }}>Customer &amp; Serial</th>
                    <th style={{ padding: "12px 14px", fontWeight: 600 }}>Issue Date</th>
                    <th style={{ padding: "12px 14px", fontWeight: 600, textAlign: "center" }}>Parts Issued</th>
                    <th style={{ padding: "12px 14px", fontWeight: 600, textAlign: "center" }}>Returned / Consumed</th>
                    <th style={{ padding: "12px 14px", fontWeight: 600 }}>SO &amp; Reconciliation Status</th>
                    <th style={{ padding: "12px 14px", fontWeight: 600, textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && gatepasses.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                        Loading technician gatepasses...
                      </td>
                    </tr>
                  ) : gatepasses.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                        No spare parts gatepasses found. Click <b>"Issue Outward Gatepass"</b> to create one.
                      </td>
                    </tr>
                  ) : (
                    gatepasses.map((gp) => {
                      const isPendingSO = gp.so_required && !gp.so_created;
                      return (
                        <tr key={gp.id} style={{ verticalAlign: "middle" }}>
                          {/* Gatepass Number */}
                          <td style={{ padding: "12px 14px" }}>
                            <div style={{ fontWeight: 700, color: "#1e293b" }}>{gp.gatepass_number}</div>
                            {gp.return_gatepass_number && (
                              <div style={{ fontSize: "11px", color: "#64748b" }}>
                                Ret: {gp.return_gatepass_number}
                              </div>
                            )}
                          </td>

                          {/* Technician */}
                          <td style={{ padding: "12px 14px" }}>
                            <div style={{ fontWeight: 600, color: "#1e293b" }}>{gp.technician_name}</div>
                            {gp.technician_mobile && (
                              <div style={{ fontSize: "11px", color: "#64748b" }}>📞 {gp.technician_mobile}</div>
                            )}
                          </td>

                          {/* Customer & Machine Serial */}
                          <td style={{ padding: "12px 14px" }}>
                            <div style={{ fontWeight: 600 }}>{gp.customer_name || "—"}</div>
                            {gp.machine_serial_number ? (
                              <div style={{ fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                <span>SN: <b>{gp.machine_serial_number}</b></span>
                                {gp.is_warranty_service ? (
                                  <span style={{ color: "#16a34a", fontWeight: 700 }}>[Warranty FOC]</span>
                                ) : (
                                  <span style={{ color: "#d97706", fontWeight: 600 }}>[Chargeable]</span>
                                )}
                              </div>
                            ) : (
                              <div style={{ fontSize: "11px", color: "#94a3b8" }}>No machine linked</div>
                            )}
                          </td>

                          {/* Issue Date */}
                          <td style={{ padding: "12px 14px", color: "#475569" }}>
                            {gp.issue_date}
                          </td>

                          {/* Issued count */}
                          <td style={{ padding: "12px 14px", textAlign: "center" }}>
                            <span
                              style={{
                                background: "#eff6ff",
                                color: "#1d4ed8",
                                padding: "3px 8px",
                                borderRadius: "6px",
                                fontWeight: 700,
                              }}
                            >
                              {gp.total_issued}
                            </span>
                          </td>

                          {/* Returned vs Consumed */}
                          <td style={{ padding: "12px 14px", textAlign: "center" }}>
                            <div style={{ display: "inline-flex", gap: "6px" }}>
                              <span
                                title="Quantity returned to warehouse"
                                style={{
                                  background: "#f0fdf4",
                                  color: "#15803d",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                }}
                              >
                                ↩ {gp.total_returned}
                              </span>
                              <span
                                title="Quantity consumed on machine"
                                style={{
                                  background: gp.total_consumed > 0 ? (gp.is_warranty_service ? "#f5f3ff" : "#fffbeb") : "#f1f5f9",
                                  color: gp.total_consumed > 0 ? (gp.is_warranty_service ? "#6d28d9" : "#b45309") : "#64748b",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                }}
                              >
                                ⚙ {gp.total_consumed}
                              </span>
                            </div>
                            {gp.pending_return > 0 && (
                              <div style={{ fontSize: "10px", color: "#ea580c", marginTop: "2px" }}>
                                {gp.pending_return} in field
                              </div>
                            )}
                          </td>

                          {/* Status & SO Verification */}
                          <td style={{ padding: "12px 14px" }}>
                            {isPendingSO ? (
                              <div>
                                <span
                                  style={{
                                    background: "#fef3c7",
                                    color: "#92400e",
                                    padding: "3px 8px",
                                    borderRadius: "6px",
                                    fontWeight: 700,
                                    fontSize: "11px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    border: "1px solid #fde68a",
                                  }}
                                >
                                  ⚠️ SO Required ({gp.total_consumed} consumed)
                                </span>
                                <div style={{ fontSize: "11px", color: "#b45309", marginTop: "3px" }}>
                                  Salesperson must bill parts
                                </div>
                              </div>
                            ) : gp.so_created ? (
                              <div>
                                <span
                                  style={{
                                    background: "#dcfce7",
                                    color: "#166534",
                                    padding: "3px 8px",
                                    borderRadius: "6px",
                                    fontWeight: 700,
                                    fontSize: "11px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                  }}
                                >
                                  ✓ SO: {gp.so_number}
                                </span>
                                <div style={{ fontSize: "11px", color: "#16a34a", marginTop: "2px" }}>
                                  Billed &amp; Reconciled
                                </div>
                              </div>
                            ) : gp.status === "CLOSED" ? (
                              <span
                                style={{
                                  background: "#f1f5f9",
                                  color: "#334155",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontWeight: 600,
                                  fontSize: "11px",
                                }}
                              >
                                ✓ Closed
                              </span>
                            ) : gp.is_warranty_service && gp.total_consumed > 0 ? (
                              <span
                                style={{
                                  background: "#f5f3ff",
                                  color: "#6d28d9",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontWeight: 600,
                                  fontSize: "11px",
                                }}
                              >
                                ✓ Warranty FOC Replacement
                              </span>
                            ) : (
                              <span
                                style={{
                                  background: gp.status === "ISSUED" ? "#eff6ff" : "#f8fafc",
                                  color: gp.status === "ISSUED" ? "#1d4ed8" : "#475569",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontWeight: 600,
                                  fontSize: "11px",
                                }}
                              >
                                {gp.status}
                              </span>
                            )}
                          </td>

                          {/* Row Actions */}
                          <td style={{ padding: "12px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                            <div style={{ display: "inline-flex", gap: "6px" }}>
                              {/* Record Return */}
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => handleOpenReturnModal(gp)}
                                title="Record unused spare parts return or consumed parts"
                                style={{ fontSize: "12px", padding: "4px 8px" }}
                              >
                                ↩ Return
                              </button>

                              {/* View / Copy Draft SO if parts consumed */}
                              {gp.total_consumed > 0 && !gp.is_warranty_service && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-warning"
                                  onClick={() => handleViewDraftSO(gp)}
                                  title="View draft Sales Order details for salesperson"
                                  style={{ fontSize: "12px", padding: "4px 8px" }}
                                >
                                  📄 Draft SO
                                </button>
                              )}

                              {/* Link SO button */}
                              {isPendingSO && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-warning"
                                  onClick={() => handleOpenLinkSOModal(gp)}
                                  title="Link Sales Order number created for consumed parts"
                                  style={{ fontSize: "12px", padding: "4px 8px", fontWeight: 600 }}
                                >
                                  🔗 Link SO
                                </button>
                              )}

                              {/* Detail Drawer */}
                              <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                onClick={() => {
                                  setActiveGpDetail(gp);
                                  setOpenDetailDrawer(true);
                                }}
                                style={{ fontSize: "12px", padding: "4px 8px" }}
                              >
                                Details
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Gatepasses Pagination */}
            {gpTotalPages > 1 && (
              <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
                <Pagination
                  pagination={{
                    current_page: gpPage,
                    total_pages: gpTotalPages,
                    total_records: gpTotal,
                    page_size: 25,
                  }}
                  pageSize={25}
                  onPageChange={setGpPage}
                />
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2: TECHNICIAN WALLETS & FIELD COLLECTIONS                    */}
        {/* ================================================================= */}
        {currentTab === "wallets" && (
          <div>
            {/* Top: Technician Cash-in-Hand Cards */}
            <div style={{ marginBottom: "24px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", marginBottom: "12px" }}>
                Technician Live Wallet Balances (Cash in Hand)
              </h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                  gap: "16px",
                }}
              >
                {walletSummaries.length === 0 ? (
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      background: "#f8fafc",
                      padding: "24px",
                      borderRadius: "8px",
                      textAlign: "center",
                      color: "#64748b",
                    }}
                  >
                    No technician wallet balances recorded yet. Click <b>"Record Wallet Transaction"</b> to start tracking field collections.
                  </div>
                ) : (
                  walletSummaries.map((tech) => {
                    const isPendingDeposit = tech.net_wallet_balance > 0;
                    return (
                      <div
                        key={tech.technician_name}
                        style={{
                          background: "#fff",
                          border: isPendingDeposit ? "1px solid #fed7aa" : "1px solid #e2e8f0",
                          borderRadius: "10px",
                          padding: "16px 18px",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: "15px", color: "#1e293b" }}>
                              {tech.technician_name}
                            </div>
                            {tech.technician_mobile && (
                              <div style={{ fontSize: "12px", color: "#64748b" }}>
                                📞 {tech.technician_mobile}
                              </div>
                            )}
                          </div>

                          <span
                            style={{
                              background: isPendingDeposit ? "#fff7ed" : "#f0fdf4",
                              color: isPendingDeposit ? "#c2410c" : "#15803d",
                              border: isPendingDeposit ? "1px solid #fed7aa" : "1px solid #bbf7d0",
                              padding: "2px 8px",
                              borderRadius: "12px",
                              fontSize: "11px",
                              fontWeight: 700,
                            }}
                          >
                            {isPendingDeposit ? "Cash in Hand" : tech.status}
                          </span>
                        </div>

                        {/* Financial Stats Grid */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr 1fr",
                            gap: "8px",
                            padding: "8px 10px",
                            background: "#f8fafc",
                            borderRadius: "6px",
                            marginBottom: "12px",
                            fontSize: "11px",
                          }}
                        >
                          <div>
                            <div style={{ color: "#64748b" }}>Collections</div>
                            <div style={{ fontWeight: 700, color: "#16a34a", fontSize: "12px" }}>
                              {formatCurrency(tech.total_collected)}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: "#64748b" }}>Handover Dep.</div>
                            <div style={{ fontWeight: 700, color: "#2563eb", fontSize: "12px" }}>
                              {formatCurrency(tech.total_deposited)}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: "#64748b" }}>Field Expenses</div>
                            <div style={{ fontWeight: 700, color: "#9333ea", fontSize: "12px" }}>
                              {formatCurrency(tech.total_expenses)}
                            </div>
                          </div>
                        </div>

                        {/* Net Wallet Balance Row */}
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "12px",
                            padding: "4px 0",
                            borderTop: "1px dashed #e2e8f0",
                          }}
                        >
                          <span style={{ fontSize: "13px", fontWeight: 600, color: "#475569" }}>
                            Net Wallet Balance:
                          </span>
                          <span
                            style={{
                              fontSize: "16px",
                              fontWeight: 800,
                              color: tech.net_wallet_balance > 0 ? "#ea580c" : (tech.net_wallet_balance < 0 ? "#dc2626" : "#16a34a"),
                            }}
                          >
                            {formatCurrency(tech.net_wallet_balance)}
                          </span>
                        </div>

                        {/* Quick action buttons */}
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-success"
                            onClick={() => handleQuickTxn(tech.technician_name, "COLLECTION")}
                            style={{ flex: 1, fontSize: "11px", padding: "5px" }}
                          >
                            ➕ Collect
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary"
                            onClick={() => handleQuickTxn(tech.technician_name, "HANDOVER_DEPOSIT")}
                            style={{ flex: 1, fontSize: "11px", padding: "5px" }}
                          >
                            📤 Handover
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => handleQuickTxn(tech.technician_name, "FIELD_EXPENSE")}
                            style={{ flex: 1, fontSize: "11px", padding: "5px" }}
                          >
                            🧾 Expense
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Bottom: Transaction History Ledger */}
            <div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "12px",
                }}
              >
                <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                  Wallet Transaction History Ledger
                </h2>

                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <input
                    type="text"
                    placeholder="Filter by technician..."
                    value={walletFilterTech}
                    onChange={(e) => {
                      setWalletFilterTech(e.target.value);
                      setWalletPage(1);
                    }}
                    className="form-control"
                    style={{ width: "200px", fontSize: "12px" }}
                  />

                  <select
                    value={walletFilterType}
                    onChange={(e) => {
                      setWalletFilterType(e.target.value);
                      setWalletPage(1);
                    }}
                    className="form-control"
                    style={{ width: "180px", fontSize: "12px" }}
                  >
                    <option value="">All Types</option>
                    <option value="COLLECTION">Collections</option>
                    <option value="HANDOVER_DEPOSIT">Handover Deposits</option>
                    <option value="FIELD_EXPENSE">Field Expenses</option>
                  </select>
                </div>
              </div>

              {/* Transactions Table */}
              <div className="table-responsive" style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <table className="table table-hover" style={{ margin: 0, fontSize: "13px" }}>
                  <thead style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                    <tr>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Txn #</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Date</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Technician</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Type</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Mode</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Customer / Notes</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, textAlign: "right" }}>Amount</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, textAlign: "center" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {walletTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: "center", padding: "30px", color: "#64748b" }}>
                          No wallet transactions found.
                        </td>
                      </tr>
                    ) : (
                      walletTransactions.map((tx) => (
                        <tr key={tx.id}>
                          <td style={{ padding: "10px 14px", fontWeight: 700, color: "#1e293b" }}>
                            {tx.transaction_number}
                          </td>
                          <td style={{ padding: "10px 14px", color: "#64748b" }}>
                            {tx.transaction_date}
                          </td>
                          <td style={{ padding: "10px 14px", fontWeight: 600 }}>
                            {tx.technician_name}
                          </td>
                          <td style={{ padding: "10px 14px" }}>
                            {tx.transaction_type === "COLLECTION" ? (
                              <span style={{ background: "#dcfce7", color: "#166534", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700 }}>
                                📥 COLLECTION
                              </span>
                            ) : tx.transaction_type === "HANDOVER_DEPOSIT" ? (
                              <span style={{ background: "#eff6ff", color: "#1e40af", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700 }}>
                                📤 HANDOVER
                              </span>
                            ) : (
                              <span style={{ background: "#f5f3ff", color: "#6b21a8", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700 }}>
                                🧾 EXPENSE
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "10px 14px", color: "#475569" }}>
                            {tx.payment_mode}
                            {tx.reference_no && <div style={{ fontSize: "10px", color: "#64748b" }}>Ref: {tx.reference_no}</div>}
                          </td>
                          <td style={{ padding: "10px 14px" }}>
                            {tx.customer_name && <b>{tx.customer_name}</b>}
                            {tx.notes && <div style={{ fontSize: "11px", color: "#64748b" }}>{tx.notes}</div>}
                          </td>
                          <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: tx.transaction_type === "COLLECTION" ? "#16a34a" : "#1e293b" }}>
                            {tx.transaction_type === "COLLECTION" ? "+ " : "- "}
                            {formatCurrency(tx.amount)}
                          </td>
                          <td style={{ padding: "10px 14px", textAlign: "center" }}>
                            <span style={{ background: "#f1f5f9", color: "#475569", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>
                              {tx.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {walletTotalPages > 1 && (
                <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
                  <Pagination
                    pagination={{
                      current_page: walletPage,
                      total_pages: walletTotalPages,
                      total_records: walletTotal,
                      page_size: 25,
                    }}
                    pageSize={25}
                    onPageChange={setWalletPage}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 3: MACHINE WARRANTY REGISTRY & VALIDATOR                     */}
        {/* ================================================================= */}
        {currentTab === "warranty" && (
          <div>
            {/* Quick Serial Validator Widget */}
            <div
              style={{
                background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)",
                border: "1px solid #cbd5e1",
                borderRadius: "10px",
                padding: "20px",
                marginBottom: "24px",
                boxShadow: "0 2px 4px rgba(0,0,0,0.03)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <span style={{ fontSize: "20px" }}>🔍</span>
                <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#1e293b" }}>
                  Live Machine Serial Warranty Validator
                </h2>
              </div>
              <p style={{ margin: "0 0 14px", fontSize: "13px", color: "#64748b" }}>
                Enter the customer's machine serial number before dispatching spare parts to verify whether replacement parts are Free-Of-Cost under warranty or require a chargeable Sales Order.
              </p>

              <div style={{ display: "flex", gap: "10px", maxWidth: "600px" }}>
                <input
                  type="text"
                  placeholder="Enter Serial Number (e.g. SN-INHYMA-1001)..."
                  value={validatorSerialInput}
                  onChange={(e) => setValidatorSerialInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleValidateSerial()}
                  className="form-control"
                  style={{ fontSize: "14px", fontWeight: 600 }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleValidateSerial()}
                  disabled={validating || !validatorSerialInput.trim()}
                  style={{ minWidth: "140px", fontWeight: 600 }}
                >
                  {validating ? "Checking..." : "Verify Serial"}
                </button>
              </div>

              {/* Validation Result Box */}
              {validationResult && (
                <div
                  style={{
                    marginTop: "16px",
                    padding: "16px 20px",
                    borderRadius: "8px",
                    background: validationResult.is_covered ? "#f0fdf4" : (validationResult.is_registered ? "#fef2f2" : "#f8fafc"),
                    border: validationResult.is_covered ? "1px solid #86efac" : (validationResult.is_registered ? "1px solid #fca5a5" : "1px solid #cbd5e1"),
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span style={{ fontSize: "20px" }}>
                      {validationResult.is_covered ? "✅" : (validationResult.is_registered ? "❌" : "ℹ️")}
                    </span>
                    <span
                      style={{
                        fontWeight: 800,
                        fontSize: "15px",
                        color: validationResult.is_covered ? "#15803d" : (validationResult.is_registered ? "#b91c1c" : "#475569"),
                      }}
                    >
                      {validationResult.is_covered
                        ? "MACHINE IS UNDER ACTIVE WARRANTY"
                        : (validationResult.is_registered ? "WARRANTY EXPIRED — CHARGEABLE PARTS" : "SERIAL NOT REGISTERED")}
                    </span>
                  </div>

                  <p style={{ margin: "0 0 10px", fontSize: "13px", color: "#334155" }}>
                    {validationResult.message}
                  </p>

                  {validationResult.is_registered && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", fontSize: "12px", color: "#475569" }}>
                      <div><b>Machine Model:</b> {validationResult.machine_model || "—"}</div>
                      <div><b>Customer:</b> {validationResult.company_name || "—"}</div>
                      <div><b>Invoice Date:</b> {validationResult.invoice_date || "—"}</div>
                      <div><b>Warranty Expiry:</b> {validationResult.warranty_end_date || "—"}</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Warranty Registry Table */}
            <div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "12px",
                }}
              >
                <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                  Machine Warranty Registry
                </h2>

                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <input
                    type="text"
                    placeholder="Search Serial / Model / Company..."
                    value={warrSearch}
                    onChange={(e) => {
                      setWarrSearch(e.target.value);
                      setWarrPage(1);
                    }}
                    className="form-control"
                    style={{ width: "260px", fontSize: "12px" }}
                  />

                  <select
                    value={warrStatusFilter}
                    onChange={(e) => {
                      setWarrStatusFilter(e.target.value);
                      setWarrPage(1);
                    }}
                    className="form-control"
                    style={{ width: "180px", fontSize: "12px" }}
                  >
                    <option value="">All Statuses</option>
                    <option value="UNDER_WARRANTY">UNDER WARRANTY</option>
                    <option value="OUT_OF_WARRANTY">OUT OF WARRANTY</option>
                    <option value="EXTENDED_AMC">EXTENDED AMC</option>
                  </select>
                </div>
              </div>

              <div className="table-responsive" style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <table className="table table-hover" style={{ margin: 0, fontSize: "13px" }}>
                  <thead style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                    <tr>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Serial Number</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Machine Model</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Customer Company</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Invoice Date</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Duration</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600 }}>Warranty Expiry</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, textAlign: "center" }}>Coverage Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warranties.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "30px", color: "#64748b" }}>
                          No machine warranties registered. Click <b>"Register Machine Warranty"</b> to add one.
                        </td>
                      </tr>
                    ) : (
                      warranties.map((w) => (
                        <tr key={w.id}>
                          <td style={{ padding: "10px 14px", fontWeight: 700, color: "#1e293b" }}>
                            {w.serial_number}
                          </td>
                          <td style={{ padding: "10px 14px", fontWeight: 600 }}>
                            {w.machine_model}
                          </td>
                          <td style={{ padding: "10px 14px" }}>
                            <b>{w.company_name}</b>
                            {w.installation_city && (
                              <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "4px" }}>
                                ({w.installation_city})
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "10px 14px", color: "#64748b" }}>
                            {w.invoice_date}
                            {w.invoice_number && (
                              <div style={{ fontSize: "10px" }}>Inv: {w.invoice_number}</div>
                            )}
                          </td>
                          <td style={{ padding: "10px 14px" }}>
                            {w.warranty_months} Months
                          </td>
                          <td style={{ padding: "10px 14px", fontWeight: 600 }}>
                            {w.warranty_end_date}
                          </td>
                          <td style={{ padding: "10px 14px", textAlign: "center" }}>
                            {w.is_currently_covered ? (
                              <span
                                style={{
                                  background: "#dcfce7",
                                  color: "#166534",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontWeight: 700,
                                  fontSize: "11px",
                                }}
                              >
                                ✓ Under Warranty ({w.days_remaining}d left)
                              </span>
                            ) : (
                              <span
                                style={{
                                  background: "#fee2e2",
                                  color: "#991b1b",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontWeight: 600,
                                  fontSize: "11px",
                                }}
                              >
                                Expired (Chargeable)
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {warrTotalPages > 1 && (
                <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
                  <Pagination
                    pagination={{
                      current_page: warrPage,
                      total_pages: warrTotalPages,
                      total_records: warrTotal,
                      page_size: 25,
                    }}
                    pageSize={25}
                    onPageChange={setWarrPage}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL: ISSUE OUTWARD GATEPASS                                    */}
        {/* ================================================================= */}
        <Modal
          open={openCreateGpModal}
          title="Issue Outward Spare Parts Gatepass"
          onClose={() => setOpenCreateGpModal(false)}
          variant="center"
          cardStyle={{ maxWidth: "800px", width: "100%" }}
        >
          <form onSubmit={handleCreateGatepass} style={{ padding: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Technician Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={newGpTechName}
                  onChange={(e) => setNewGpTechName(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Technician Mobile
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  value={newGpTechMobile}
                  onChange={(e) => setNewGpTechMobile(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Customer Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Apex Packaging Ltd"
                  value={newGpCustomer}
                  onChange={(e) => setNewGpCustomer(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Machine Serial Number
                </label>
                <div style={{ display: "flex", gap: "6px" }}>
                  <input
                    type="text"
                    placeholder="e.g. SN-INHYMA-1001"
                    value={newGpSerial}
                    onChange={(e) => setNewGpSerial(e.target.value)}
                    className="form-control"
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleCheckSerialForGp}
                    style={{ fontSize: "11px", whiteSpace: "nowrap" }}
                  >
                    Check
                  </button>
                </div>
              </div>
            </div>

            {newGpWarrantyCheckMsg && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  marginBottom: "14px",
                  background: newGpWarrantyCheckMsg.startsWith("✓") ? "#f0fdf4" : "#fef3c7",
                  color: newGpWarrantyCheckMsg.startsWith("✓") ? "#15803d" : "#b45309",
                  fontWeight: 600,
                }}
              >
                {newGpWarrantyCheckMsg}
              </div>
            )}

            <div style={{ marginBottom: "14px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                Purpose / Task Description
              </label>
              <input
                type="text"
                value={newGpPurpose}
                onChange={(e) => setNewGpPurpose(e.target.value)}
                className="form-control"
              />
            </div>

            {/* Line Items Section */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b" }}>
                  Spare Parts to Issue
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  onClick={() =>
                    setNewGpItems([
                      ...newGpItems,
                      { product_name: "", product_code: "", uom: "NOS", quantity_issued: 1, unit_rate: 0, remarks: "" }
                    ])
                  }
                  style={{ fontSize: "11px" }}
                >
                  + Add Part Row
                </button>
              </div>

              <div className="table-responsive" style={{ border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                <table className="table" style={{ margin: 0, fontSize: "12px" }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th style={{ width: "40%" }}>Part Name *</th>
                      <th style={{ width: "20%" }}>Part Code</th>
                      <th style={{ width: "15%" }}>Qty *</th>
                      <th style={{ width: "15%" }}>Unit Rate (₹)</th>
                      <th style={{ width: "10%" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {newGpItems.map((item, idx) => (
                      <tr key={idx}>
                        <td>
                          <input
                            type="text"
                            required
                            placeholder="e.g. Heating Element"
                            value={item.product_name}
                            onChange={(e) => {
                              const copy = [...newGpItems];
                              copy[idx].product_name = e.target.value;
                              setNewGpItems(copy);
                            }}
                            className="form-control form-control-sm"
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            placeholder="SP-001"
                            value={item.product_code}
                            onChange={(e) => {
                              const copy = [...newGpItems];
                              copy[idx].product_code = e.target.value;
                              setNewGpItems(copy);
                            }}
                            className="form-control form-control-sm"
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            required
                            min="0.1"
                            step="any"
                            value={item.quantity_issued}
                            onChange={(e) => {
                              const copy = [...newGpItems];
                              copy[idx].quantity_issued = parseFloat(e.target.value) || 0;
                              setNewGpItems(copy);
                            }}
                            className="form-control form-control-sm"
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={item.unit_rate}
                            onChange={(e) => {
                              const copy = [...newGpItems];
                              copy[idx].unit_rate = parseFloat(e.target.value) || 0;
                              setNewGpItems(copy);
                            }}
                            className="form-control form-control-sm"
                          />
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {newGpItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setNewGpItems(newGpItems.filter((_, i) => i !== idx))}
                              style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "16px" }}
                            >
                              &times;
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpenCreateGpModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Issuing..." : "Create & Issue Gatepass"}
              </button>
            </div>
          </form>
        </Modal>

        {/* ================================================================= */}
        {/* MODAL: RECORD PARTS RETURN & RECONCILE                           */}
        {/* ================================================================= */}
        <Modal
          open={openReturnModal}
          title={`Record Parts Return: ${selectedGpForReturn?.gatepass_number || ""}`}
          onClose={() => setOpenReturnModal(false)}
          variant="center"
          cardStyle={{ maxWidth: "850px", width: "100%" }}
        >
          <form onSubmit={handleProcessReturn} style={{ padding: "20px" }}>
            <div
              style={{
                background: "#f8fafc",
                padding: "12px",
                borderRadius: "6px",
                marginBottom: "16px",
                display: "flex",
                flexWrap: "wrap",
                gap: "16px",
                fontSize: "12px",
              }}
            >
              <div><b>Technician:</b> {selectedGpForReturn?.technician_name}</div>
              <div><b>Customer:</b> {selectedGpForReturn?.customer_name || "—"}</div>
              <div><b>Serial:</b> {selectedGpForReturn?.machine_serial_number || "—"}</div>
              <div>
                <b>Warranty:</b>{" "}
                {selectedGpForReturn?.is_warranty_service ? (
                  <span style={{ color: "#16a34a", fontWeight: 700 }}>YES (FOC Replacement)</span>
                ) : (
                  <span style={{ color: "#b45309", fontWeight: 700 }}>NO (Chargeable SO required for consumed)</span>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Return Gatepass Number
                </label>
                <input
                  type="text"
                  value={returnGatepassNo}
                  onChange={(e) => setReturnGatepassNo(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Return Remarks / Condition
                </label>
                <input
                  type="text"
                  placeholder="e.g. Unused items intact in packaging"
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>

            {/* Reconciliation Items Table */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b", marginBottom: "8px" }}>
                Reconcile Issued Parts: Returned vs Consumed
              </div>

              <div className="table-responsive" style={{ border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                <table className="table" style={{ margin: 0, fontSize: "12px" }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th>Part Name</th>
                      <th style={{ width: "90px", textAlign: "center" }}>Issued</th>
                      <th style={{ width: "110px" }}>Returned</th>
                      <th style={{ width: "110px" }}>Consumed</th>
                      <th style={{ width: "130px" }}>Warranty FOC?</th>
                      <th style={{ width: "140px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnItemsState.map((row, idx) => (
                      <tr key={row.item_id}>
                        <td style={{ fontWeight: 600 }}>{row.product_name}</td>
                        <td style={{ textAlign: "center", fontWeight: 700, color: "#2563eb" }}>
                          {row.quantity_issued}
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            max={row.quantity_issued}
                            step="any"
                            value={row.quantity_returned}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              const copy = [...returnItemsState];
                              copy[idx].quantity_returned = val;
                              // Auto calculate consumed if needed
                              copy[idx].quantity_consumed = Math.max(0, row.quantity_issued - val);
                              setReturnItemsState(copy);
                            }}
                            className="form-control form-control-sm"
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            max={row.quantity_issued}
                            step="any"
                            value={row.quantity_consumed}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              const copy = [...returnItemsState];
                              copy[idx].quantity_consumed = val;
                              setReturnItemsState(copy);
                            }}
                            className="form-control form-control-sm"
                          />
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={row.is_warranty_covered}
                            onChange={(e) => {
                              const copy = [...returnItemsState];
                              copy[idx].is_warranty_covered = e.target.checked;
                              setReturnItemsState(copy);
                            }}
                            style={{ width: "16px", height: "16px", cursor: "pointer" }}
                          />
                        </td>
                        <td>
                          <select
                            value={row.item_status}
                            onChange={(e) => {
                              const copy = [...returnItemsState];
                              copy[idx].item_status = e.target.value;
                              setReturnItemsState(copy);
                            }}
                            className="form-control form-control-sm"
                          >
                            <option value="RETURNED_GOOD">Returned Good</option>
                            <option value="RETURNED_DEFECTIVE">Returned Defective</option>
                            <option value="CONSUMED_BILLED">Consumed Billed</option>
                            <option value="CONSUMED_WARRANTY">Consumed FOC Warranty</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Warning banner about Sales Order requirement */}
            {returnItemsState.some(i => i.quantity_consumed > 0 && !i.is_warranty_covered) && (
              <div
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fef3c7",
                  borderRadius: "6px",
                  padding: "10px 14px",
                  fontSize: "12px",
                  color: "#92400e",
                  marginBottom: "16px",
                }}
              >
                ⚠️ <b>Sales Order Required:</b> Consumed parts detected that are NOT covered by warranty. A Sales Order must be created by the salesperson before this gatepass can be marked RECONCILED/CLOSED.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpenReturnModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Processing..." : "Confirm Return & Reconcile"}
              </button>
            </div>
          </form>
        </Modal>

        {/* ================================================================= */}
        {/* MODAL: LINK SALES ORDER                                          */}
        {/* ================================================================= */}
        <Modal
          open={openLinkSOModal}
          title={`Link Sales Order: ${selectedGpForSO?.gatepass_number || ""}`}
          onClose={() => setOpenLinkSOModal(false)}
          variant="center"
          cardStyle={{ maxWidth: "520px", width: "100%" }}
        >
          <form onSubmit={handleLinkSO} style={{ padding: "20px" }}>
            <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#64748b" }}>
              Enter the Sales Order number created by the sales team for the consumed parts to close reconciliation.
            </p>

            <div style={{ marginBottom: "14px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                Sales Order Number *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. SO-2026-0842"
                value={soNumberInput}
                onChange={(e) => setSoNumberInput(e.target.value)}
                className="form-control"
              />
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                Notes / Reference
              </label>
              <input
                type="text"
                placeholder="e.g. Invoiced to Apex Packaging via GST invoice"
                value={soNotesInput}
                onChange={(e) => setSoNotesInput(e.target.value)}
                className="form-control"
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpenLinkSOModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Linking..." : "Link SO & Close Reconciliation"}
              </button>
            </div>
          </form>
        </Modal>

        {/* ================================================================= */}
        {/* DRAWER: DRAFT SALES ORDER PAYLOAD FOR SALESPERSON                */}
        {/* ================================================================= */}
        <SideDrawer
          open={openDraftSODrawer}
          title={`Draft Sales Order (${activeGpForDraft?.gatepass_number || ""})`}
          onClose={() => setOpenDraftSODrawer(false)}
        >
          {draftSOData && (
            <div style={{ padding: "16px" }}>
              <div
                style={{
                  background: "#eff6ff",
                  padding: "12px 16px",
                  borderRadius: "6px",
                  marginBottom: "16px",
                  fontSize: "12px",
                  color: "#1e40af",
                }}
              >
                {draftSOData.message}
              </div>

              <div style={{ marginBottom: "16px", fontSize: "13px" }}>
                <div><b>Customer:</b> {draftSOData.customer_name}</div>
                {draftSOData.machine_serial_number && (
                  <div><b>Machine Serial:</b> {draftSOData.machine_serial_number}</div>
                )}
                <div><b>Gatepass Ref:</b> {draftSOData.gatepass_number}</div>
              </div>

              {/* Items Table */}
              <div className="table-responsive" style={{ border: "1px solid #e2e8f0", borderRadius: "6px", marginBottom: "16px" }}>
                <table className="table" style={{ margin: 0, fontSize: "12px" }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th>Spare Part</th>
                      <th style={{ width: "60px", textAlign: "center" }}>Qty</th>
                      <th style={{ width: "90px", textAlign: "right" }}>Rate</th>
                      <th style={{ width: "100px", textAlign: "right" }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftSOData.items_to_bill.map((it, i) => (
                      <tr key={i}>
                        <td>
                          <b>{it.product_name}</b>
                          {it.product_code && <div style={{ fontSize: "10px", color: "#64748b" }}>{it.product_code}</div>}
                        </td>
                        <td style={{ textAlign: "center" }}>{it.quantity} {it.uom}</td>
                        <td style={{ textAlign: "right" }}>{formatCurrency(it.unit_rate)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{formatCurrency(it.line_total)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
                      <td colSpan={3}>Estimated Subtotal (excl. GST):</td>
                      <td style={{ textAlign: "right", color: "#2563eb" }}>
                        {formatCurrency(draftSOData.estimated_subtotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Copy action */}
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={() => {
                  const summaryText = `Sales Order Draft for ${draftSOData.customer_name}\nGatepass: ${draftSOData.gatepass_number}\nItems:\n` +
                    draftSOData.items_to_bill.map(it => `- ${it.product_name}: ${it.quantity} ${it.uom} @ ₹${it.unit_rate} = ₹${it.line_total}`).join("\n") +
                    `\nEstimated Subtotal: ₹${draftSOData.estimated_subtotal}`;
                  navigator.clipboard.writeText(summaryText);
                  setSuccess("Draft SO copied to clipboard!");
                }}
                style={{ width: "100%", marginBottom: "16px", fontSize: "13px" }}
              >
                📋 Copy Draft SO to Clipboard
              </button>

              {/* Direct link SO form */}
              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "16px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                  Link Created Sales Order
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    placeholder="e.g. SO-2026-0842"
                    value={soNumberInput}
                    onChange={(e) => setSoNumberInput(e.target.value)}
                    className="form-control form-control-sm"
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={!soNumberInput.trim()}
                    onClick={async () => {
                      if (!activeGpForDraft || !soNumberInput.trim()) return;
                      try {
                        await apiPost(`/technician-operations/gatepasses/${activeGpForDraft.id}/link-so`, {
                          sales_order_number: soNumberInput.trim(),
                        });
                        setSuccess(`SO '${soNumberInput.trim()}' linked successfully!`);
                        setOpenDraftSODrawer(false);
                        fetchGatepasses();
                        fetchMetrics();
                      } catch (err: any) {
                        setError(err?.message || "Failed to link SO");
                      }
                    }}
                  >
                    Link
                  </button>
                </div>
              </div>
            </div>
          )}
        </SideDrawer>

        {/* ================================================================= */}
        {/* DRAWER: GATEPASS DETAILS                                         */}
        {/* ================================================================= */}
        <SideDrawer
          open={openDetailDrawer}
          title={`Gatepass Details: ${activeGpDetail?.gatepass_number || ""}`}
          onClose={() => setOpenDetailDrawer(false)}
        >
          {activeGpDetail && (
            <div style={{ padding: "16px", fontSize: "13px" }}>
              <div style={{ marginBottom: "14px" }}>
                <div><b>Technician:</b> {activeGpDetail.technician_name}</div>
                {activeGpDetail.technician_mobile && <div><b>Mobile:</b> {activeGpDetail.technician_mobile}</div>}
                <div><b>Customer:</b> {activeGpDetail.customer_name || "—"}</div>
                <div><b>Machine Serial:</b> {activeGpDetail.machine_serial_number || "—"}</div>
                <div><b>Issue Date:</b> {activeGpDetail.issue_date}</div>
                <div><b>Issued By:</b> {activeGpDetail.issued_by_name}</div>
                <div><b>Purpose:</b> {activeGpDetail.purpose}</div>
                <div><b>Status:</b> {activeGpDetail.status}</div>
                {activeGpDetail.so_number && <div><b>Linked SO:</b> {activeGpDetail.so_number}</div>}
              </div>

              <div style={{ fontWeight: 700, marginBottom: "8px", color: "#1e293b" }}>Issued Items</div>
              <div className="table-responsive" style={{ border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                <table className="table" style={{ margin: 0, fontSize: "12px" }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th>Part</th>
                      <th style={{ textAlign: "center" }}>Issued</th>
                      <th style={{ textAlign: "center" }}>Returned</th>
                      <th style={{ textAlign: "center" }}>Consumed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeGpDetail.items.map((it) => (
                      <tr key={it.id}>
                        <td>
                          <b>{it.product_name}</b>
                          {it.product_code && <div style={{ fontSize: "10px", color: "#64748b" }}>{it.product_code}</div>}
                        </td>
                        <td style={{ textAlign: "center" }}>{it.quantity_issued}</td>
                        <td style={{ textAlign: "center", color: "#16a34a" }}>{it.quantity_returned}</td>
                        <td style={{ textAlign: "center", color: "#d97706" }}>{it.quantity_consumed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {activeGpDetail.notes && (
                <div style={{ marginTop: "14px", background: "#f8fafc", padding: "10px", borderRadius: "6px" }}>
                  <b>Notes:</b>
                  <div style={{ whiteSpace: "pre-line", color: "#475569" }}>{activeGpDetail.notes}</div>
                </div>
              )}
            </div>
          )}
        </SideDrawer>

        {/* ================================================================= */}
        {/* MODAL: RECORD WALLET TRANSACTION                                 */}
        {/* ================================================================= */}
        <Modal
          open={openWalletTxnModal}
          title="Record Technician Wallet Transaction"
          onClose={() => setOpenWalletTxnModal(false)}
          variant="center"
          cardStyle={{ maxWidth: "550px", width: "100%" }}
        >
          <form onSubmit={handleRecordWalletTxn} style={{ padding: "20px" }}>
            <div style={{ marginBottom: "12px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                Technician Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Ramesh Kumar"
                value={txnTechName}
                onChange={(e) => setTxnTechName(e.target.value)}
                className="form-control"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Transaction Type *
                </label>
                <select
                  value={txnType}
                  onChange={(e) => setTxnType(e.target.value as any)}
                  className="form-control"
                >
                  <option value="COLLECTION">Field Collection (from Customer)</option>
                  <option value="HANDOVER_DEPOSIT">Handover Deposit (to Accounts)</option>
                  <option value="FIELD_EXPENSE">Approved Field Expense</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Amount (₹) *
                </label>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="any"
                  placeholder="e.g. 5000"
                  value={txnAmount}
                  onChange={(e) => setTxnAmount(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Payment Mode
                </label>
                <select
                  value={txnPaymentMode}
                  onChange={(e) => setTxnPaymentMode(e.target.value)}
                  className="form-control"
                >
                  <option value="Cash">Cash</option>
                  <option value="UPI / QR">UPI / QR</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Bank Transfer">Bank Transfer / NEFT</option>
                  <option value="Cash Deposit">Cash Deposit</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Reference / UTR / Cheque #
                </label>
                <input
                  type="text"
                  placeholder="Optional reference"
                  value={txnRefNo}
                  onChange={(e) => setTxnRefNo(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>

            {txnType === "COLLECTION" && (
              <div style={{ marginBottom: "12px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Customer Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Apex Packaging Ltd"
                  value={txnCustomer}
                  onChange={(e) => setTxnCustomer(e.target.value)}
                  className="form-control"
                />
              </div>
            )}

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                Notes / Remarks
              </label>
              <input
                type="text"
                placeholder="e.g. Collected for service breakdown visit"
                value={txnNotes}
                onChange={(e) => setTxnNotes(e.target.value)}
                className="form-control"
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpenWalletTxnModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Recording..." : "Record Transaction"}
              </button>
            </div>
          </form>
        </Modal>

        {/* ================================================================= */}
        {/* MODAL: REGISTER MACHINE WARRANTY                                 */}
        {/* ================================================================= */}
        <Modal
          open={openRegisterWarrModal}
          title="Register Machine Warranty Policy"
          onClose={() => setOpenRegisterWarrModal(false)}
          variant="center"
          cardStyle={{ maxWidth: "600px", width: "100%" }}
        >
          <form onSubmit={handleRegisterWarranty} style={{ padding: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Machine Serial Number *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SN-INHYMA-1001"
                  value={regSerial}
                  onChange={(e) => setRegSerial(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Machine Model *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SuperSealer 5000"
                  value={regModel}
                  onChange={(e) => setRegModel(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                Customer Company Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Apex Packaging Ltd"
                value={regCompany}
                onChange={(e) => setRegCompany(e.target.value)}
                className="form-control"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Invoice Number
                </label>
                <input
                  type="text"
                  placeholder="INV-2026-001"
                  value={regInvoiceNo}
                  onChange={(e) => setRegInvoiceNo(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Invoice Date *
                </label>
                <input
                  type="date"
                  required
                  value={regInvoiceDate}
                  onChange={(e) => setRegInvoiceDate(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Duration (Months) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  max="120"
                  value={regMonths}
                  onChange={(e) => setRegMonths(parseInt(e.target.value) || 12)}
                  className="form-control"
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Contact Person
                </label>
                <input
                  type="text"
                  placeholder="e.g. Plant Manager"
                  value={regContactPerson}
                  onChange={(e) => setRegContactPerson(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Contact Phone
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  value={regContactPhone}
                  onChange={(e) => setRegContactPhone(e.target.value)}
                  className="form-control"
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Installation City
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ahmedabad"
                  value={regCity}
                  onChange={(e) => setRegCity(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                Notes / Warranty Scope
              </label>
              <input
                type="text"
                placeholder="Covers motor, PLC, heating elements"
                value={regNotes}
                onChange={(e) => setRegNotes(e.target.value)}
                className="form-control"
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpenRegisterWarrModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Registering..." : "Register Warranty"}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </AppShell>
  );
}
