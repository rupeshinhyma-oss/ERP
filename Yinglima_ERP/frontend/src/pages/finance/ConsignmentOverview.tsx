import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { apiDelete, apiGet, apiPatch, apiPostMultipart, errorMessage } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type {
  ConsignmentDocumentSlot,
  ConsignmentOverviewListResponse,
  ConsignmentOverviewRow,
  FinanceStage,
} from "@/types/finance";

let cachedOverviewList: ConsignmentOverviewListResponse | null = null;

function fmtAmt(val: number | undefined | null, symbol = "¥"): string {
  const n = Number(val || 0);
  return `${symbol} ${n.toLocaleString("en-US", {
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

function roleBadgeStyle(role: string): React.CSSProperties {
  if (role === "Supplier") {
    return {
      background: "#fef3c7",
      color: "#b45309",
      border: "1px solid #fde68a",
    };
  }
  if (role === "Customer") {
    return {
      background: "#dcfce7",
      color: "#15803d",
      border: "1px solid #bbf7d0",
    };
  }
  return {
    background: "#dbeafe",
    color: "#1d4ed8",
    border: "1px solid #bfdbfe",
  };
}

export function ConsignmentOverviewPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedKey = searchParams.get("key");

  const [data, setData] = useState<ConsignmentOverviewListResponse | null>(cachedOverviewList);
  const [loading, setLoading] = useState<boolean>(!cachedOverviewList);
  const [stageTab, setStageTab] = useState<FinanceStage>("all");
  const [branchTab, setBranchTab] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Detail state for uploading files & editing cargo remarks / dates
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [deletingSlot, setDeletingSlot] = useState<string | null>(null);
  const [remarksDraft, setRemarksDraft] = useState<string>("");
  const [etdDraft, setEtdDraft] = useState<string>("");
  const [etaDraft, setEtaDraft] = useState<string>("");
  const [forwarderDraft, setForwarderDraft] = useState<string>("");
  const [savingCargoMeta, setSavingCargoMeta] = useState<boolean>(false);

  const mutationSeqRef = useRef<number>(0);

  const applyOverviewUpdater = useCallback(
    (updater: (prev: ConsignmentOverviewListResponse) => ConsignmentOverviewListResponse) => {
      setData((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        cachedOverviewList = next;
        return next;
      });
    },
    []
  );

  const loadOverviews = useCallback(async (silent = false) => {
    const reqSeq = mutationSeqRef.current;
    if (!silent && !cachedOverviewList) {
      setLoading(true);
    }
    try {
      const res = await apiGet<ConsignmentOverviewListResponse>(
        "/finance/consignment-overview?stage=all"
      );
      if (reqSeq !== mutationSeqRef.current) return;
      if (res?.data) {
        cachedOverviewList = res.data;
        setData(res.data);
      }
    } catch (err) {
      if (!silent) {
        toast(errorMessage(err), "error");
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [toast]);

  useEffect(() => {
    void loadOverviews(Boolean(cachedOverviewList));
  }, [loadOverviews]);

  const allItems = useMemo(() => data?.items ?? [], [data]);

  // Unique branches for branch tabs (similar to warehouse/branch tabs in reference)
  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of allItems) {
      if (item.branch_name && item.branch_name.trim()) {
        set.add(item.branch_name.trim());
      }
    }
    return Array.from(set);
  }, [allItems]);

  // Currently selected consignment for Detail View
  const activeConsignment: ConsignmentOverviewRow | null = useMemo(() => {
    if (!selectedKey) return null;
    const norm = selectedKey.trim().toUpperCase();
    return (
      allItems.find((x) => x.consignment_key.trim().toUpperCase() === norm) ?? null
    );
  }, [allItems, selectedKey]);

  // Sync draft inputs when switching activeConsignment
  useEffect(() => {
    if (activeConsignment) {
      setRemarksDraft(activeConsignment.cargo_remarks ?? "");
      setEtdDraft(activeConsignment.etd_origin_date?.slice(0, 10) ?? "");
      setEtaDraft(activeConsignment.eta_port_date?.slice(0, 10) ?? "");
      setForwarderDraft(activeConsignment.forwarder_name ?? "");
    }
  }, [activeConsignment?.consignment_key]);

  // Filtered rows for List View
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allItems.filter((item) => {
      if (stageTab !== "all" && item.overall_stage !== stageTab) return false;
      if (branchTab !== "ALL" && (item.branch_name ?? "") !== branchTab) return false;
      if (!q) return true;
      return (
        item.display_title.toLowerCase().includes(q) ||
        item.invoice_or_order_summary.toLowerCase().includes(q) ||
        item.supplier_summary.toLowerCase().includes(q) ||
        (item.buyer_name || "").toLowerCase().includes(q) ||
        (item.branch_name || "").toLowerCase().includes(q) ||
        (item.forwarder_name || "").toLowerCase().includes(q) ||
        (item.cargo_remarks || "").toLowerCase().includes(q)
      );
    });
  }, [allItems, stageTab, branchTab, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, currentPage, pageSize]);

  // ---------------------------------------------------------------------------
  // Handlers for Detail View (0ms Optimistic Checklist Toggle + Supabase Upload)
  // ---------------------------------------------------------------------------

  const handleToggleChecklistItem = async (
    consignmentKey: string,
    checkKey: string,
    currentVal: boolean
  ) => {
    const nextVal = !currentVal;
    mutationSeqRef.current += 1;

    // 1. 0ms Optimistic UI update
    applyOverviewUpdater((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.consignment_key !== consignmentKey) return item;
        const nextChecklist = item.checklist.map((c) =>
          c.key === checkKey ? { ...c, value: nextVal } : c
        );
        return {
          ...item,
          checklist: nextChecklist,
          checklist_yes_count: nextChecklist.filter((c) => c.value).length,
        };
      }),
    }));

    // 2. Persist in background
    try {
      await apiPatch(
        `/finance/consignment-overview/checklist?key=${encodeURIComponent(consignmentKey)}`,
        {
          checklist: { [checkKey]: nextVal },
        }
      );
    } catch (err) {
      toast(errorMessage(err), "error");
      void loadOverviews(true);
    }
  };

  const handleSaveCargoMeta = async () => {
    if (!activeConsignment) return;
    const consignmentKey = activeConsignment.consignment_key;
    mutationSeqRef.current += 1;
    setSavingCargoMeta(true);

    // 1. 0ms Optimistic UI update
    applyOverviewUpdater((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.consignment_key !== consignmentKey) return item;
        return {
          ...item,
          cargo_remarks: remarksDraft.trim() || null,
          etd_origin_date: etdDraft || null,
          eta_port_date: etaDraft || null,
          forwarder_name: forwarderDraft.trim() || null,
        };
      }),
    }));

    try {
      await apiPatch(
        `/finance/consignment-overview/checklist?key=${encodeURIComponent(consignmentKey)}`,
        {
          cargo_remarks: remarksDraft.trim() || null,
          etd_origin_date: etdDraft || null,
          eta_port_date: etaDraft || null,
          forwarder_name: forwarderDraft.trim() || null,
        }
      );
      toast("Cargo status & shipment schedule saved.", "success");
    } catch (err) {
      toast(errorMessage(err), "error");
      void loadOverviews(true);
    } finally {
      setSavingCargoMeta(false);
    }
  };

  const handleUploadDocument = async (
    consignmentKey: string,
    slotKey: string,
    file: File | null
  ) => {
    if (!file) return;
    mutationSeqRef.current += 1;
    setUploadingSlot(slotKey);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiPostMultipart<ConsignmentDocumentSlot>(
        `/finance/consignment-overview/documents?key=${encodeURIComponent(
          consignmentKey
        )}&slot_key=${encodeURIComponent(slotKey)}`,
        formData
      );
      const uploadedSlot = res?.data;
      if (uploadedSlot) {
        applyOverviewUpdater((prev) => ({
          ...prev,
          items: prev.items.map((item) => {
            if (item.consignment_key !== consignmentKey) return item;
            const nextDocs: ConsignmentDocumentSlot[] = item.documents.map((d) =>
              d.slot_key === slotKey ? uploadedSlot : d
            );
            return {
              ...item,
              documents: nextDocs,
              docs_uploaded_count: nextDocs.filter((d) => Boolean(d.file_url)).length,
            };
          }),
        }));
        toast(`${uploadedSlot.label} uploaded to Supabase Storage.`, "success");
      }
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleDeleteDocument = async (consignmentKey: string, slotKey: string) => {
    mutationSeqRef.current += 1;
    setDeletingSlot(slotKey);

    // Optimistically clear slot
    applyOverviewUpdater((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.consignment_key !== consignmentKey) return item;
        const nextDocs = item.documents.map((d) =>
          d.slot_key === slotKey
            ? {
                ...d,
                file_url: null,
                filename: null,
                uploaded_at: null,
                uploaded_by: null,
                is_auto_linked: false,
              }
            : d
        );
        return {
          ...item,
          documents: nextDocs,
          docs_uploaded_count: nextDocs.filter((d) => Boolean(d.file_url)).length,
        };
      }),
    }));

    try {
      await apiDelete(
        `/finance/consignment-overview/documents?key=${encodeURIComponent(
          consignmentKey
        )}&slot_key=${encodeURIComponent(slotKey)}`
      );
      toast("Document removed from slot.", "success");
    } catch (err) {
      toast(errorMessage(err), "error");
      void loadOverviews(true);
    } finally {
      setDeletingSlot(null);
    }
  };

  // ===========================================================================
  // DETAIL VIEW RENDER (Matches User's Overview #13 + Gallery + Checklist Screenshots)
  // ===========================================================================
  if (selectedKey && activeConsignment) {
    return (
      <AppShell activeKey="consignment-overview">
        <div
          style={{
            padding: "18px 20px 36px",
            width: "100%",
            maxWidth: "none",
            boxSizing: "border-box",
          }}
        >
          {/* Top Bar: Title + Back Button */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
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
                }}
              >
                Overview — {activeConsignment.display_title}
              </h1>
              <p style={{ margin: "3px 0 0", fontSize: 13, color: "#64748b" }}>
                Unified Consignment Finance Planning, Export Document Gallery & Cargo Status Checklist
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => navigate("/finance/report")}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#1e293b",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Open Financial Report
              </button>
              <button
                type="button"
                onClick={() => setSearchParams({})}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#0f172a",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                ← Back
              </button>
            </div>
          </div>

          {/* Header Summary Metadata Strip (Matches Top Bar of Overview #13 Screenshot) */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              padding: "16px 20px",
              marginBottom: 20,
              boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))",
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                Invoice / Cons. No. & Date
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                {activeConsignment.display_title}
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                {activeConsignment.invoice_or_order_summary} • {fmtDate(activeConsignment.order_date)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                Supplier Name(s)
              </div>
              <div style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>
                {activeConsignment.supplier_summary}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                Buyer / Destination Branch
              </div>
              <div style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>
                {activeConsignment.buyer_name || activeConsignment.branch_name || "Main"}
              </div>
              {activeConsignment.branch_name && activeConsignment.buyer_name && (
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  {activeConsignment.branch_name}
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                Ordered Date
              </div>
              <div style={{ fontSize: 13, color: "#334155" }}>
                {fmtDate(activeConsignment.order_date)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                ETD Origin (China)
              </div>
              <input
                type="date"
                value={etdDraft}
                onChange={(e) => setEtdDraft(e.target.value)}
                onBlur={() => void handleSaveCargoMeta()}
                style={{
                  fontSize: 12.5,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  color: "#0f172a",
                  width: "100%",
                  maxWidth: 145,
                }}
              />
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                ETA Destination Port
              </div>
              <input
                type="date"
                value={etaDraft}
                onChange={(e) => setEtaDraft(e.target.value)}
                onBlur={() => void handleSaveCargoMeta()}
                style={{
                  fontSize: 12.5,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  color: "#0f172a",
                  width: "100%",
                  maxWidth: 145,
                }}
              />
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                Forwarder / Agent Name
              </div>
              <input
                type="text"
                placeholder="e.g. Shipping Agent"
                value={forwarderDraft}
                onChange={(e) => setForwarderDraft(e.target.value)}
                onBlur={() => void handleSaveCargoMeta()}
                style={{
                  fontSize: 12.5,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  color: "#0f172a",
                  width: "100%",
                }}
              />
            </div>
          </div>

          {/* ================================================================= */}
          {/* SECTION 1: FINANCE PLANNING                                       */}
          {/* ================================================================= */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              padding: "18px 20px",
              marginBottom: 20,
              boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 }}>
                Finance Planning
              </h2>
              <span style={{ fontSize: 12, color: "#64748b" }}>
                {activeConsignment.finance_rows.length} Linked Financial Record(s)
              </span>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr
                    style={{
                      background: "#f8fafc",
                      borderBottom: "1px solid #e2e8f0",
                      color: "#334155",
                      textAlign: "left",
                    }}
                  >
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Party Name</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Invoice / Cons. No.</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Payment Terms</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Total Amount</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Paid Amount</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Balance Terms</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Due Date</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activeConsignment.finance_rows.map((fin, idx) => {
                    const sym = fin.currency === "USD" ? "$" : "¥";
                    return (
                      <tr
                        key={fin.id}
                        style={{
                          background: idx % 2 === 0 ? "#f8fafc" : "#ffffff",
                          borderBottom: "1px solid #f1f5f9",
                        }}
                      >
                        <td style={{ padding: "12px" }}>
                          <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
                            {fin.party_name}
                          </div>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              ...roleBadgeStyle(fin.role),
                            }}
                          >
                            {fin.role}
                          </span>
                        </td>
                        <td style={{ padding: "12px", color: "#334155", fontWeight: 600 }}>
                          {fin.doc_no}
                        </td>
                        <td style={{ padding: "12px", color: "#334155" }}>
                          <div>{fin.payment_terms || "—"}</div>
                          {fin.attachment_url && (
                            <a
                              href={fin.attachment_url}
                              target="_blank"
                              rel="noreferrer"
                              title="Download / View Attached Invoice"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                marginTop: 4,
                                color: "#2563eb",
                                fontSize: 12,
                                fontWeight: 700,
                                textDecoration: "none",
                              }}
                            >
                              ⬇ View Bill
                            </a>
                          )}
                        </td>
                        <td style={{ padding: "12px", fontWeight: 700, color: "#0f172a" }}>
                          {fmtAmt(fin.total_amount, sym)}
                        </td>
                        <td style={{ padding: "12px", fontWeight: 700, color: "#15803d" }}>
                          {fmtAmt(fin.paid_amount, sym)}
                        </td>
                        <td
                          style={{
                            padding: "12px",
                            fontWeight: 700,
                            color: fin.balance_amount > 0 ? "#b91c1c" : "#475569",
                          }}
                        >
                          {fmtAmt(fin.balance_amount, sym)}
                        </td>
                        <td style={{ padding: "12px", color: "#334155" }}>
                          {fmtDate(fin.due_date)}
                        </td>
                        <td style={{ padding: "12px" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "3px 10px",
                              borderRadius: 6,
                              fontSize: 11.5,
                              fontWeight: 700,
                              background: fin.stage === "cleared" ? "#dbeafe" : "#fef3c7",
                              color: fin.stage === "cleared" ? "#1d4ed8" : "#b45309",
                            }}
                          >
                            {fin.stage === "cleared" ? "Cleared" : "Pending"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ================================================================= */}
          {/* SECTION 2: CONSIGNMENT GALLERY (16 Editable China/Global Slots)   */}
          {/* ================================================================= */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              padding: "18px 20px",
              marginBottom: 20,
              boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 }}>
                  Consignment Gallery
                </h2>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                  Upload or download export trade documents (stored in Supabase Storage).
                </p>
              </div>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  border: "1px solid #bfdbfe",
                }}
              >
                {activeConsignment.docs_uploaded_count} / {activeConsignment.docs_total_count} Uploaded
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(275px, 1fr))",
                gap: 14,
              }}
            >
              {activeConsignment.documents.map((doc) => {
                const isUploading = uploadingSlot === doc.slot_key;
                const isDeleting = deletingSlot === doc.slot_key;
                const hasFile = Boolean(doc.file_url);
                return (
                  <div
                    key={doc.slot_key}
                    style={{
                      border: hasFile ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: "14px 16px",
                      background: hasFile ? "#f8fbff" : "#ffffff",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                        {doc.label}
                      </div>
                      {doc.is_auto_linked && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: 4,
                            background: "#e0f2fe",
                            color: "#0369a1",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Auto-linked
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      {/* Cloud View / Download Button when a file exists */}
                      {hasFile && doc.file_url && (
                        <a
                          href={doc.file_url}
                          target="_blank"
                          rel="noreferrer"
                          title={`Open ${doc.label}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 36,
                            height: 32,
                            borderRadius: 6,
                            border: "1px solid #3b82f6",
                            background: "#ffffff",
                            color: "#2563eb",
                            textDecoration: "none",
                            fontSize: 15,
                            fontWeight: 700,
                          }}
                        >
                          ☁⬇
                        </a>
                      )}

                      {/* Choose File Input Box (matches reference Consignment Details modal) */}
                      <label
                        style={{
                          flex: 1,
                          display: "inline-flex",
                          alignItems: "center",
                          border: "1px solid #cbd5e1",
                          borderRadius: 6,
                          overflow: "hidden",
                          background: "#ffffff",
                          cursor: isUploading ? "wait" : "pointer",
                          fontSize: 12,
                          minWidth: 160,
                        }}
                      >
                        <span
                          style={{
                            padding: "6px 10px",
                            background: "#f1f5f9",
                            borderRight: "1px solid #cbd5e1",
                            color: "#334155",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {isUploading ? "Uploading..." : "Choose File"}
                        </span>
                        <span
                          style={{
                            padding: "6px 10px",
                            color: hasFile ? "#0f172a" : "#94a3b8",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: 140,
                          }}
                          title={doc.filename || "No file uploaded."}
                        >
                          {doc.filename || "No file uploaded."}
                        </span>
                        <input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
                          disabled={isUploading}
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            void handleUploadDocument(
                              activeConsignment.consignment_key,
                              doc.slot_key,
                              f
                            );
                            e.target.value = "";
                          }}
                        />
                      </label>

                      {/* Delete Button if manually uploaded */}
                      {hasFile && !doc.is_auto_linked && (
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() =>
                            void handleDeleteDocument(
                              activeConsignment.consignment_key,
                              doc.slot_key
                            )
                          }
                          title="Delete uploaded file"
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 6,
                            border: "1px solid #fecaca",
                            background: "#fff1f2",
                            color: "#dc2626",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 13,
                          }}
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ================================================================= */}
          {/* SECTION 3: CARGO STATUS (12 Editable Yes/No Shipment Checklists)  */}
          {/* ================================================================= */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              padding: "18px 20px",
              marginBottom: 20,
              boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 }}>
                  Cargo Status — Shipment Checklist Details
                </h2>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                  Click any checklist card to toggle between Yes (Completed) and No (Pending).
                </p>
              </div>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                  background:
                    activeConsignment.checklist_yes_count ===
                    activeConsignment.checklist_total_count
                      ? "#dcfce7"
                      : "#fef3c7",
                  color:
                    activeConsignment.checklist_yes_count ===
                    activeConsignment.checklist_total_count
                      ? "#15803d"
                      : "#b45309",
                }}
              >
                {activeConsignment.checklist_yes_count} / {activeConsignment.checklist_total_count} Completed
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
                gap: 12,
                marginBottom: 16,
              }}
            >
              {activeConsignment.checklist.map((item) => (
                <div
                  key={item.key}
                  onClick={() =>
                    void handleToggleChecklistItem(
                      activeConsignment.consignment_key,
                      item.key,
                      item.value
                    )
                  }
                  style={{
                    border: item.value ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
                    borderRadius: 10,
                    padding: "14px 16px",
                    background: item.value ? "#f0fdf4" : "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    cursor: "pointer",
                    userSelect: "none",
                    transition: "all 0.12s ease",
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#1e293b",
                    }}
                  >
                    {item.label}
                  </span>
                  <span
                    style={{
                      padding: "3px 10px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 800,
                      background: item.value ? "#16a34a" : "#fee2e2",
                      color: item.value ? "#ffffff" : "#dc2626",
                      minWidth: 38,
                      textAlign: "center",
                    }}
                  >
                    {item.value ? "Yes" : "No"}
                  </span>
                </div>
              ))}
            </div>

            {/* Editable Cargo Remark Bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                paddingTop: 10,
                borderTop: "1px solid #f1f5f9",
              }}
            >
              <label
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: "#334155",
                  minWidth: 110,
                }}
              >
                Cargo Remark:
              </label>
              <input
                type="text"
                placeholder="Add shipment / customs / container / BL remark..."
                value={remarksDraft}
                onChange={(e) => setRemarksDraft(e.target.value)}
                onBlur={() => void handleSaveCargoMeta()}
                style={{
                  flex: 1,
                  minWidth: 240,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                }}
              />
              <button
                type="button"
                disabled={savingCargoMeta}
                onClick={() => void handleSaveCargoMeta()}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {savingCargoMeta ? "Saving..." : "Save Cargo Info"}
              </button>
            </div>
          </div>

          {/* ================================================================= */}
          {/* SECTION 4: PRODUCT SUMMARY                                        */}
          {/* ================================================================= */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              padding: "18px 20px",
              boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
            }}
          >
            <h2
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: "#0f172a",
                margin: "0 0 14px",
              }}
            >
              Product Summary
            </h2>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr
                    style={{
                      background: "#f8fafc",
                      borderBottom: "1px solid #e2e8f0",
                      color: "#334155",
                      textAlign: "left",
                    }}
                  >
                    <th style={{ padding: "10px 12px", fontWeight: 700, width: 80 }}>Sr No.</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Product Name</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Supplier / Document</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Quantity</th>
                    <th style={{ padding: "10px 12px", fontWeight: 700 }}>Batch / Consignment No.</th>
                  </tr>
                </thead>
                <tbody>
                  {activeConsignment.products.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        style={{
                          padding: "20px",
                          textAlign: "center",
                          color: "#64748b",
                        }}
                      >
                        No product line items found for this consignment.
                      </td>
                    </tr>
                  ) : (
                    activeConsignment.products.map((prod, idx) => (
                      <tr
                        key={`${prod.sr_no}-${prod.product_name}`}
                        style={{
                          background: idx % 2 === 0 ? "#f1f5f9" : "#ffffff",
                          borderBottom: "1px solid #e2e8f0",
                        }}
                      >
                        <td style={{ padding: "12px", fontWeight: 600, color: "#334155" }}>
                          {prod.sr_no}
                        </td>
                        <td style={{ padding: "12px", fontWeight: 700, color: "#0f172a" }}>
                          {prod.product_name}
                          {prod.product_code && (
                            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>
                              Code: {prod.product_code}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "12px", color: "#475569" }}>
                          <div>{prod.supplier_name || "—"}</div>
                          {prod.source_doc_no && (
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              {prod.source_doc_no}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "12px" }}>
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>
                            {prod.quantity.toLocaleString("en-US")}
                          </div>
                          <div style={{ fontSize: 11, color: "#64748b" }}>{prod.uom}</div>
                        </td>
                        <td style={{ padding: "12px", fontWeight: 600, color: "#334155" }}>
                          {prod.consignment_code || activeConsignment.display_title}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  // ===========================================================================
  // LIST VIEW RENDER (Consignment Overview List — Combines Gallery & Cargo Status)
  // ===========================================================================
  return (
    <AppShell activeKey="consignment-overview">
      <div
        style={{
          padding: "18px 20px 36px",
          width: "100%",
          maxWidth: "none",
          boxSizing: "border-box",
        }}
      >
        {/* Page Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
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
              }}
            >
              Consignment Overview
            </h1>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "#64748b" }}>
              Unified view combining Finance Planning, Consignment Document Gallery & Cargo Status Checklist for all Confirmed Orders.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => void loadOverviews(false)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#1e293b",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Main Card Container */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            padding: "16px 20px",
            boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
          }}
        >
          {/* Branch / Warehouse Filter Tabs + Stage Pills */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: 10,
              marginBottom: 14,
            }}
          >
            {/* Branch Tabs (Like All | Main | Kikubo | Ordered in screenshot) */}
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  setBranchTab("ALL");
                  setCurrentPage(1);
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: "6px 4px",
                  fontSize: 13.5,
                  fontWeight: branchTab === "ALL" ? 700 : 500,
                  color: branchTab === "ALL" ? "#2563eb" : "#475569",
                  borderBottom:
                    branchTab === "ALL" ? "2px solid #2563eb" : "2px solid transparent",
                  cursor: "pointer",
                }}
              >
                All ({allItems.length})
              </button>
              {branchOptions.map((br) => (
                <button
                  key={br}
                  type="button"
                  onClick={() => {
                    setBranchTab(br);
                    setCurrentPage(1);
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: "6px 4px",
                    fontSize: 13.5,
                    fontWeight: branchTab === br ? 700 : 500,
                    color: branchTab === br ? "#2563eb" : "#475569",
                    borderBottom:
                      branchTab === br ? "2px solid #2563eb" : "2px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  {br}
                </button>
              ))}
            </div>

            {/* Stage Filter Pills */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {(
                [
                  ["all", `All (${data?.total_consignments ?? 0})`],
                  ["pending", `Pending (${data?.pending_consignments ?? 0})`],
                  ["cleared", `Cleared (${data?.cleared_consignments ?? 0})`],
                ] as const
              ).map(([st, label]) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    setStageTab(st);
                    setCurrentPage(1);
                  }}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 6,
                    border:
                      stageTab === st ? "1px solid #2563eb" : "1px solid #cbd5e1",
                    background: stageTab === st ? "#eff6ff" : "#ffffff",
                    color: stageTab === st ? "#1d4ed8" : "#475569",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Search & Page Size Controls */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 14,
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
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>items/page</span>
            </div>

            <input
              type="text"
              placeholder="Search consignment, invoice, supplier, buyer, forwarder..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                width: 340,
                maxWidth: "100%",
                padding: "7px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                fontSize: 13,
              }}
            />
          </div>

          {/* Consignment Overview Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr
                  style={{
                    background: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                    color: "#334155",
                    textAlign: "left",
                  }}
                >
                  <th style={{ padding: "11px 12px", fontWeight: 700 }}>
                    Invoice / Cons. No. & Date
                  </th>
                  <th style={{ padding: "11px 12px", fontWeight: 700 }}>Supplier Name(s)</th>
                  <th style={{ padding: "11px 12px", fontWeight: 700 }}>Branch / Warehouse</th>
                  <th style={{ padding: "11px 12px", fontWeight: 700 }}>Ordered Date</th>
                  <th style={{ padding: "11px 12px", fontWeight: 700 }}>ETD Origin</th>
                  <th style={{ padding: "11px 12px", fontWeight: 700 }}>ETA Port</th>
                  <th style={{ padding: "11px 12px", fontWeight: 700 }}>Forwarder</th>
                  <th style={{ padding: "11px 12px", fontWeight: 700 }}>Gallery Docs</th>
                  <th style={{ padding: "11px 12px", fontWeight: 700 }}>Cargo Checklist</th>
                  <th style={{ padding: "11px 12px", fontWeight: 700 }}>Finance Status</th>
                  <th style={{ padding: "11px 12px", fontWeight: 700, textAlign: "center" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && pagedItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={11}
                      style={{ padding: "32px", textAlign: "center", color: "#64748b" }}
                    >
                      Loading Consignment Overviews...
                    </td>
                  </tr>
                ) : pagedItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={11}
                      style={{ padding: "32px", textAlign: "center", color: "#64748b" }}
                    >
                      No consignments match your filter criteria.
                    </td>
                  </tr>
                ) : (
                  pagedItems.map((row, idx) => (
                    <tr
                      key={row.consignment_key}
                      style={{
                        background: idx % 2 === 0 ? "#f8fafc" : "#ffffff",
                        borderBottom: "1px solid #e2e8f0",
                      }}
                    >
                      <td style={{ padding: "12px" }}>
                        <button
                          type="button"
                          onClick={() =>
                            setSearchParams({ key: row.consignment_key })
                          }
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            color: "#2563eb",
                            fontWeight: 700,
                            fontSize: 13.5,
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          {row.display_title}
                        </button>
                        <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>
                          {row.invoice_or_order_summary} • {fmtDate(row.order_date)}
                        </div>
                      </td>

                      <td style={{ padding: "12px", color: "#334155", fontWeight: 600 }}>
                        <div>{row.supplier_summary}</div>
                        {row.buyer_name && (
                          <div style={{ fontSize: 11.5, color: "#15803d", marginTop: 2 }}>
                            Buyer: {row.buyer_name}
                          </div>
                        )}
                      </td>

                      <td style={{ padding: "12px", color: "#334155" }}>
                        {row.branch_name || "Main"}
                      </td>

                      <td style={{ padding: "12px", color: "#334155" }}>
                        {fmtDate(row.order_date)}
                      </td>

                      <td style={{ padding: "12px", color: "#334155" }}>
                        {fmtDate(row.etd_origin_date)}
                      </td>

                      <td style={{ padding: "12px", color: "#334155" }}>
                        {fmtDate(row.eta_port_date)}
                      </td>

                      <td style={{ padding: "12px", color: "#334155" }}>
                        {row.forwarder_name || "—"}
                      </td>

                      <td style={{ padding: "12px" }}>
                        <span
                          onClick={() => setSearchParams({ key: row.consignment_key })}
                          style={{
                            display: "inline-block",
                            padding: "3px 9px",
                            borderRadius: 6,
                            fontSize: 11.5,
                            fontWeight: 700,
                            background:
                              row.docs_uploaded_count > 0 ? "#eff6ff" : "#f1f5f9",
                            color:
                              row.docs_uploaded_count > 0 ? "#1d4ed8" : "#64748b",
                            cursor: "pointer",
                          }}
                        >
                          📄 {row.docs_uploaded_count} / {row.docs_total_count} Docs
                        </span>
                      </td>

                      <td style={{ padding: "12px" }}>
                        <span
                          onClick={() => setSearchParams({ key: row.consignment_key })}
                          style={{
                            display: "inline-block",
                            padding: "3px 9px",
                            borderRadius: 6,
                            fontSize: 11.5,
                            fontWeight: 700,
                            background:
                              row.checklist_yes_count > 0 ? "#dcfce7" : "#fee2e2",
                            color:
                              row.checklist_yes_count > 0 ? "#15803d" : "#dc2626",
                            cursor: "pointer",
                          }}
                        >
                          ✓ {row.checklist_yes_count} / {row.checklist_total_count} Yes
                        </span>
                      </td>

                      <td style={{ padding: "12px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 10px",
                            borderRadius: 6,
                            fontSize: 11.5,
                            fontWeight: 700,
                            background:
                              row.overall_stage === "cleared" ? "#dbeafe" : "#fef3c7",
                            color:
                              row.overall_stage === "cleared" ? "#1d4ed8" : "#b45309",
                          }}
                        >
                          {row.overall_stage === "cleared" ? "Cleared" : "Pending"}
                        </span>
                      </td>

                      <td style={{ padding: "12px", textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={() =>
                            setSearchParams({ key: row.consignment_key })
                          }
                          style={{
                            padding: "6px 12px",
                            borderRadius: 6,
                            border: "1px solid #bfdbfe",
                            background: "#eff6ff",
                            color: "#1d4ed8",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Open Overview
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 14,
              fontSize: 12.5,
              color: "#64748b",
            }}
          >
            <div>
              Showing {pagedItems.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{" "}
              {Math.min(currentPage * pageSize, filteredItems.length)} of{" "}
              {filteredItems.length} entries
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
                Previous
              </button>
              <span
                style={{
                  padding: "5px 11px",
                  borderRadius: 6,
                  background: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 700,
                }}
              >
                {currentPage}
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
      </div>
    </AppShell>
  );
}
