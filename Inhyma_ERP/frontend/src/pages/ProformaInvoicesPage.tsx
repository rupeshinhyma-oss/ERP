/**
 * Proforma Invoices Page
 *
 * Matches erp.inhymasolutions.com/proforma-invoice/list -- the first
 * module built under the SALE nav section (Sales Process, Discount
 * Payments, and Quotation follow the same shell later).
 *
 * UI shell (AppShell, Breadcrumb, page-header, + ADD NEW button, table)
 * follows the same conventions as every other list page in this system
 * (Product Master, Stock Adjustment) per instruction -- only the fields
 * and columns are specific to Proforma, taken from the legacy ERP
 * screenshot: Proforma No., Warehouse, Lead Source, Exp. Deli. Date,
 * Company, City/State, Sales Person, Amount (Inc.GST), Discount,
 * Status, Action, plus the ALL/PENDING/ADMIN APPROVED/CONFIRMED/
 * CANCELLED status-tab summary cards.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import type { ProformaInvoice, ProformaTabCounts } from "@/types";

function formatIndianCurrency(amount: number): string {
  return "₹ " + (amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_TABS: { key: "all" | "pending" | "admin_approved" | "confirmed" | "cancelled"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "admin_approved", label: "Admin Approved" },
  { key: "confirmed", label: "Confirmed" },
  { key: "cancelled", label: "Cancelled" },
];

const SUMMARY_CARDS: { key: "all" | "pending" | "admin_approved" | "confirmed" | "cancelled"; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "pending", label: "PENDING" },
  { key: "admin_approved", label: "ADMIN APPROVED" },
  { key: "confirmed", label: "CONFIRMED" },
  { key: "cancelled", label: "CANCELLED" },
];

function statusBadgeClass(status: string): string {
  switch (status) {
    case "confirmed":
      return "badge badge-active";
    case "admin_approved":
      return "badge badge-warning";
    case "cancelled":
      return "badge badge-danger";
    default:
      return "badge badge-neutral";
  }
}

function statusLabel(status: string): string {
  const found = STATUS_TABS.find((t) => t.key === status);
  if (found) return found.label;
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const EMPTY_TAB_COUNTS: ProformaTabCounts = {
  all: { count: 0, amount: 0 },
  pending: { count: 0, amount: 0 },
  admin_approved: { count: 0, amount: 0 },
  confirmed: { count: 0, amount: 0 },
  cancelled: { count: 0, amount: 0 },
};

const DEFAULT_ITEM = { product_name: "", product_code: "", hsn_code: "", gst_rate: "18%", quantity: 1, uom: "Nos", rate: 0, amount: 0 };

export function ProformaInvoicesPage({ defaultAdd = false }: { defaultAdd?: boolean } = {}) {
  const navigate = useNavigate();

  const [items, setItems] = useState<ProformaInvoice[]>([]);
  const [tabCounts, setTabCounts] = useState<ProformaTabCounts>(EMPTY_TAB_COUNTS);
  const [activeTab, setActiveTab] = useState<typeof STATUS_TABS[number]["key"]>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [perPage, setPerPage] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(defaultAdd);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formState, setFormState] = useState({
    proforma_date: new Date().toLocaleDateString("en-GB").split("/").join("-"),
    expected_delivery_date: "",
    warehouse: "",
    lead_source: "",
    company_name: "",
    city: "",
    state: "",
    sales_person: "",
    discount: "0",
    status: "pending",
    remark: "",
  });
  const [formItems, setFormItems] = useState([{ ...DEFAULT_ITEM }]);

  const loadProformas = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const params = new URLSearchParams();
      if (activeTab !== "all") params.set("status", activeTab);
      if (searchTerm.trim()) params.set("search", searchTerm.trim());
      params.set("skip", String((currentPage - 1) * perPage));
      params.set("limit", String(perPage));

      const { data } = await apiGet<{ items: ProformaInvoice[]; tab_counts: ProformaTabCounts }>(
        `/proforma-invoice/list?${params.toString()}`
      );
      setItems(data?.items || []);
      setTabCounts(data?.tab_counts || EMPTY_TAB_COUNTS);
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to load proforma invoices.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProformas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, searchTerm, perPage, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm]);

  const totalItemsAmount = useMemo(
    () => formItems.reduce((sum, it) => sum + (parseFloat(String(it.amount)) || 0), 0),
    [formItems]
  );

  const handleUpdateItem = (idx: number, field: string, value: string) => {
    setFormItems((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const updated = { ...row, [field]: value } as any;
        if (field === "quantity" || field === "rate") {
          const qty = parseFloat(String(field === "quantity" ? value : row.quantity)) || 0;
          const rate = parseFloat(String(field === "rate" ? value : row.rate)) || 0;
          updated.amount = Math.round(qty * rate * 100) / 100;
        }
        return updated;
      })
    );
  };

  const handleAddItemRow = () => setFormItems((prev) => [...prev, { ...DEFAULT_ITEM }]);
  const handleDeleteItemRow = (idx: number) => setFormItems((prev) => prev.filter((_, i) => i !== idx));

  const handleOpenCreate = () => {
    setFormState({
      proforma_date: new Date().toLocaleDateString("en-GB").split("/").join("-"),
      expected_delivery_date: "",
      warehouse: "",
      lead_source: "",
      company_name: "",
      city: "",
      state: "",
      sales_person: "",
      discount: "0",
      status: "pending",
      remark: "",
    });
    setFormItems([{ ...DEFAULT_ITEM }]);
    setFormErrors({});
    setIsFormOpen(true);
  };

  const handleBack = () => {
    setIsFormOpen(false);
    if (location.pathname.toLowerCase().includes("add")) {
      navigate("/proforma-invoice/list");
    }
  };

  const handleSaveProforma = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!formState.warehouse.trim()) errs.warehouse = "Warehouse is required.";
    if (!formState.company_name.trim()) errs.company_name = "Company is required.";
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }

    setFormSubmitting(true);
    try {
      const payload = {
        proforma_date: formState.proforma_date,
        expected_delivery_date: formState.expected_delivery_date || undefined,
        warehouse: formState.warehouse.trim(),
        lead_source: formState.lead_source.trim() || undefined,
        company_name: formState.company_name.trim(),
        city: formState.city.trim() || undefined,
        state: formState.state.trim() || undefined,
        sales_person: formState.sales_person.trim() || undefined,
        discount: parseFloat(formState.discount) || 0,
        status: formState.status,
        remark: formState.remark.trim() || undefined,
        items: formItems
          .filter((it) => it.product_name.trim())
          .map((it) => ({
            product_name: it.product_name.trim(),
            product_code: it.product_code || undefined,
            hsn_code: it.hsn_code || undefined,
            gst_rate: it.gst_rate || undefined,
            quantity: parseFloat(String(it.quantity)) || 1,
            uom: it.uom || "Nos",
            rate: parseFloat(String(it.rate)) || 0,
            amount: parseFloat(String(it.amount)) || 0,
          })),
      };

      await apiPost("/proforma-invoice", payload);
      setIsFormOpen(false);
      navigate("/proforma-invoice/list");
      loadProformas();
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to save proforma invoice.");
    } finally {
      setFormSubmitting(false);
    }
  };

  if (isFormOpen) {
    return (
      <AppShell activeKey="proforma">
        <main className="page">
          <Breadcrumb trail={["Sale", "Proforma", "Add"]} />
          <div className="page-header">
            <div>
              <h1>Add Proforma Invoice</h1>
              <div className="page-subtitle">Create a new proforma invoice for a customer.</div>
            </div>
            <div className="page-header-actions">
              <button type="button" className="btn" onClick={handleBack}>
                ‹ Back
              </button>
            </div>
          </div>

          {errorMessage && (
            <div style={{ padding: "12px 16px", backgroundColor: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "6px", color: "#b91c1c", fontSize: "13px", marginBottom: "16px" }}>
              ⚠️ {errorMessage}
            </div>
          )}

          <div className="card">
            <form onSubmit={handleSaveProforma}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px 20px", marginBottom: "16px" }}>
                <div className="field">
                  <label>Proforma Date</label>
                  <input type="text" value={formState.proforma_date} onChange={(e) => setFormState({ ...formState, proforma_date: e.target.value })} />
                </div>
                <div className="field">
                  <label>Exp. Delivery Date</label>
                  <input type="text" placeholder="DD-MM-YYYY" value={formState.expected_delivery_date} onChange={(e) => setFormState({ ...formState, expected_delivery_date: e.target.value })} />
                </div>
                <div className="field">
                  <label>Warehouse *</label>
                  <input type="text" value={formState.warehouse} onChange={(e) => setFormState({ ...formState, warehouse: e.target.value })} />
                  {formErrors.warehouse && <span style={{ color: "#ef4444", fontSize: "12px" }}>{formErrors.warehouse}</span>}
                </div>

                <div className="field">
                  <label>Lead Source</label>
                  <input type="text" value={formState.lead_source} onChange={(e) => setFormState({ ...formState, lead_source: e.target.value })} />
                </div>
                <div className="field">
                  <label>Company *</label>
                  <input type="text" value={formState.company_name} onChange={(e) => setFormState({ ...formState, company_name: e.target.value })} />
                  {formErrors.company_name && <span style={{ color: "#ef4444", fontSize: "12px" }}>{formErrors.company_name}</span>}
                </div>
                <div className="field">
                  <label>Sales Person</label>
                  <input type="text" value={formState.sales_person} onChange={(e) => setFormState({ ...formState, sales_person: e.target.value })} />
                </div>

                <div className="field">
                  <label>City</label>
                  <input type="text" value={formState.city} onChange={(e) => setFormState({ ...formState, city: e.target.value })} />
                </div>
                <div className="field">
                  <label>State</label>
                  <input type="text" value={formState.state} onChange={(e) => setFormState({ ...formState, state: e.target.value })} />
                </div>
                <div className="field">
                  <label>Discount</label>
                  <input type="number" step="any" value={formState.discount} onChange={(e) => setFormState({ ...formState, discount: e.target.value })} />
                </div>

                <div className="field">
                  <label>Status</label>
                  <select value={formState.status} onChange={(e) => setFormState({ ...formState, status: e.target.value })}>
                    {STATUS_TABS.filter((t) => t.key !== "all").map((t) => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ gridColumn: "span 2" }}>
                  <label>Remark</label>
                  <input type="text" value={formState.remark} onChange={(e) => setFormState({ ...formState, remark: e.target.value })} />
                </div>
              </div>

              <h3 style={{ fontSize: "14.5px", fontWeight: 700, marginBottom: "10px" }}>Items</h3>
              <div style={{ overflowX: "auto", marginBottom: "12px" }}>
                <table style={{ width: "100%", minWidth: "800px" }}>
                  <thead>
                    <tr>
                      <th>Product Name</th>
                      <th style={{ width: "110px" }}>Qty</th>
                      <th style={{ width: "90px" }}>UOM</th>
                      <th style={{ width: "130px" }}>Rate</th>
                      <th style={{ width: "130px" }}>Amount</th>
                      <th style={{ width: "60px" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {formItems.map((row, idx) => (
                      <tr key={idx}>
                        <td>
                          <input type="text" style={{ width: "100%" }} value={row.product_name} onChange={(e) => handleUpdateItem(idx, "product_name", e.target.value)} />
                        </td>
                        <td>
                          <input type="number" step="any" style={{ width: "100%" }} value={row.quantity} onChange={(e) => handleUpdateItem(idx, "quantity", e.target.value)} />
                        </td>
                        <td>
                          <input type="text" style={{ width: "100%" }} value={row.uom} onChange={(e) => handleUpdateItem(idx, "uom", e.target.value)} />
                        </td>
                        <td>
                          <input type="number" step="any" style={{ width: "100%" }} value={row.rate} onChange={(e) => handleUpdateItem(idx, "rate", e.target.value)} />
                        </td>
                        <td>
                          <input type="number" step="any" style={{ width: "100%" }} value={row.amount} readOnly />
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {formItems.length > 1 && (
                            <button type="button" onClick={() => handleDeleteItemRow(idx)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontWeight: 700 }}>
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn" onClick={handleAddItemRow} style={{ marginBottom: "16px" }}>
                + Add Row
              </button>

              <div style={{ textAlign: "right", fontWeight: 700, fontSize: "14px", marginBottom: "16px" }}>
                Total (Inc. GST): {formatIndianCurrency(totalItemsAmount)}
              </div>

              <div style={{ display: "flex", gap: "12px" }}>
                <button type="submit" className="btn btn-add-new" disabled={formSubmitting}>
                  {formSubmitting ? "Saving..." : "Save Proforma Invoice"}
                </button>
                <button type="button" className="btn" onClick={handleBack}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
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
          <div className="page-header-actions">
            <button type="button" className="btn btn-add-new" onClick={handleOpenCreate}>
              + ADD NEW
            </button>
          </div>
        </div>

        {errorMessage && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "6px", color: "#b91c1c", fontSize: "13px", marginBottom: "16px" }}>
            ⚠️ {errorMessage}
          </div>
        )}

        {/* Summary cards: ALL / PENDING / ADMIN APPROVED / CONFIRMED / CANCELLED */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "16px" }}>
          {SUMMARY_CARDS.map((card) => {
            const c = tabCounts[card.key] || { count: 0, amount: 0 };
            return (
              <div key={card.key} className="card" style={{ margin: 0, cursor: "pointer" }} onClick={() => setActiveTab(card.key)}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", letterSpacing: "0.03em", marginBottom: "6px" }}>
                  {card.label}
                </div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                  {formatIndianCurrency(c.amount)} <span style={{ fontWeight: 500, fontSize: "13px", color: "#64748b" }}>({c.count})</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Status tabs */}
        <div style={{ display: "flex", gap: "20px", borderBottom: "1px solid #e2e8f0", marginBottom: "16px" }}>
          {STATUS_TABS.map((tab) => {
            const c = tabCounts[tab.key] || { count: 0, amount: 0 };
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: isActive ? "2px solid #0061f2" : "2px solid transparent",
                  color: isActive ? "#0061f2" : "#334155",
                  fontWeight: isActive ? 700 : 500,
                  fontSize: "13.5px",
                  padding: "8px 2px",
                  cursor: "pointer",
                }}
              >
                {tab.label} ({c.count})
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "10px" }}>
          <div className="field" style={{ margin: 0 }}>
            <select value={perPage} onChange={(e) => setPerPage(parseInt(e.target.value, 10))} style={{ width: "90px" }}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ maxWidth: "260px", border: "1px solid var(--color-border-strong)", borderRadius: "5px", padding: "8px 12px", fontSize: "13px" }}
          />
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Proforma No.</th>
                <th>Warehouse</th>
                <th>Lead Source</th>
                <th>Exp. Deli. Date</th>
                <th>Company</th>
                <th>City / State</th>
                <th>Sales Person</th>
                <th>Amount (Inc.GST)</th>
                <th>Discount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: "center", padding: "24px", color: "#64748b" }}>Loading…</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: "center", padding: "24px", color: "#64748b" }}>No proforma invoices found.</td>
                </tr>
              ) : (
                items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ color: "#0061f2", fontWeight: 600 }}>{p.proforma_no}</div>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>{p.proforma_date}</div>
                    </td>
                    <td>{p.warehouse}</td>
                    <td>{p.lead_source || "—"}</td>
                    <td>{p.expected_delivery_date || "—"}</td>
                    <td>{p.company_name}</td>
                    <td>
                      {p.city || "—"}
                      {p.state ? <div style={{ fontSize: "12px", color: "#64748b" }}>{p.state}</div> : null}
                    </td>
                    <td>{p.sales_person || "—"}</td>
                    <td>{formatIndianCurrency(p.amount_inc_gst)}</td>
                    <td>{formatIndianCurrency(p.discount)}</td>
                    <td>
                      <span className={statusBadgeClass(p.status)}>{statusLabel(p.status)}</span>
                      {p.remark && <div style={{ fontSize: "11.5px", color: "#dc2626", marginTop: "2px" }}>{p.remark}</div>}
                    </td>
                    <td>⋮</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </AppShell>
  );
}
