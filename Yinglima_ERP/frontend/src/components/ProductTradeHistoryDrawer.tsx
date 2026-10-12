import { useEffect, useMemo, useState } from "react";
import { SideDrawer } from "@/components/SideDrawer";
import { apiGet } from "@/lib/api";

export interface PurchaseHistoryItem {
  record_type: "invoice" | "quote" | "catalog";
  item_id?: string | null;
  doc_id?: string | null;
  doc_number: string;
  record_date?: string | null;
  supplier_id?: string | null;
  supplier_name: string;
  quantity?: number | null;
  unit_rate: number;
  unit_landing_rate?: number | null;
  currency: string;
  total_amount?: number | null;
  status?: string | null;
  remarks?: string | null;
}

export interface SalesHistoryItem {
  record_type: "order" | "inquiry";
  item_id?: string | null;
  doc_id?: string | null;
  doc_number: string;
  consignment_code?: string | null;
  record_date?: string | null;
  buyer_id?: string | null;
  buyer_name: string;
  quantity: number;
  unit_rate: number;
  currency: string;
  item_total?: number | null;
  status?: string | null;
  margin_percent?: number | null;
  remarks?: string | null;
}

export interface TradeHistoryMetrics {
  latest_purchase_rate?: number | null;
  latest_purchase_currency?: string | null;
  latest_purchase_landing_rate?: number | null;
  latest_purchase_date?: string | null;
  latest_supplier_name?: string | null;
  latest_purchase_type?: string | null;

  latest_sales_rate?: number | null;
  latest_sales_currency?: string | null;
  latest_sales_date?: string | null;
  latest_buyer_name?: string | null;

  estimated_margin_percent?: number | null;
  estimated_profit_per_unit?: number | null;
  profit_currency?: string | null;

  total_purchased_qty: number;
  total_sold_qty: number;
}

export interface TradeHistoryData {
  product_id: string;
  product_code?: string | null;
  product_name: string;
  product_name_tally?: string | null;
  uom_code?: string | null;
  metrics: TradeHistoryMetrics;
  purchases: PurchaseHistoryItem[];
  sales: SalesHistoryItem[];
}

export interface ProductTradeHistoryDrawerProps {
  productId: string | null;
  productName?: string;
  productCode?: string | null;
  open: boolean;
  onClose: () => void;
}

function formatPrice(val: number | null | undefined, curr = "CNY"): string {
  if (val == null) return "—";
  return `${curr} ${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ProductTradeHistoryDrawer({
  productId,
  productName,
  productCode,
  open,
  onClose,
}: ProductTradeHistoryDrawerProps) {
  const [activeTab, setActiveTab] = useState<"purchases" | "sales">("purchases");
  const [data, setData] = useState<TradeHistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!open || !productId) {
      setData(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    apiGet<TradeHistoryData>(`/inventory/product-prices/${productId}/history`)
      .then((res) => {
        if (!isMounted) return;
        setData(res.data);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || "Failed to load product trade history");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [open, productId]);

  const filteredPurchases = useMemo(() => {
    if (!data?.purchases) return [];
    if (!searchTerm.trim()) return data.purchases;
    const term = searchTerm.toLowerCase().trim();
    return data.purchases.filter(
      (p) =>
        p.supplier_name.toLowerCase().includes(term) ||
        p.doc_number.toLowerCase().includes(term) ||
        (p.remarks && p.remarks.toLowerCase().includes(term))
    );
  }, [data?.purchases, searchTerm]);

  const filteredSales = useMemo(() => {
    if (!data?.sales) return [];
    if (!searchTerm.trim()) return data.sales;
    const term = searchTerm.toLowerCase().trim();
    return data.sales.filter(
      (s) =>
        s.buyer_name.toLowerCase().includes(term) ||
        s.doc_number.toLowerCase().includes(term) ||
        (s.consignment_code && s.consignment_code.toLowerCase().includes(term)) ||
        (s.remarks && s.remarks.toLowerCase().includes(term))
    );
  }, [data?.sales, searchTerm]);

  const metrics = data?.metrics;

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      cardStyle={{
        width: isFullscreen ? "100vw" : "min(1680px, 96vw)",
        maxWidth: "100vw",
        boxShadow: "-16px 0 40px rgba(0,0,0,0.22)",
        transition: "width 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "20px" }}>📜</span>
          <span style={{ fontWeight: 700, fontSize: "17px" }}>Trade &amp; Price History</span>
          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: isFullscreen ? "#eff6ff" : "#f8fafc",
              color: isFullscreen ? "#2563eb" : "#475569",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              marginLeft: "6px",
            }}
            title={isFullscreen ? "Restore standard wide view" : "Expand to 100% full screen"}
          >
            {isFullscreen ? "🗗 Restore View" : "⛶ Full Screen"}
          </button>
        </div>
      }
      subtitle={
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
          <strong style={{ color: "#1e293b", fontSize: "14px" }}>
            {data?.product_name || productName || "Product"}
          </strong>
          {(data?.product_code || productCode) && (
            <span
              style={{
                background: "#f1f5f9",
                color: "#475569",
                padding: "2px 8px",
                borderRadius: "4px",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              {data?.product_code || productCode}
            </span>
          )}
          {data?.uom_code && (
            <span style={{ color: "#64748b", fontSize: "12px" }}>
              UOM: <strong>{data.uom_code}</strong>
            </span>
          )}
        </div>
      }
    >
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "20px" }}>
        {loading ? (
          <div style={{ padding: "60px 0", textAlign: "center", color: "#64748b" }}>
            <div style={{ fontSize: "28px", marginBottom: "12px" }}>⏳</div>
            <div style={{ fontSize: "14px", fontWeight: 600 }}>Loading trade history...</div>
          </div>
        ) : error ? (
          <div
            style={{
              padding: "20px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              color: "#b91c1c",
              textAlign: "center",
            }}
          >
            <p style={{ margin: 0, fontWeight: 600 }}>{error}</p>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => {
                if (productId) {
                  setLoading(true);
                  setError(null);
                  apiGet<TradeHistoryData>(`/inventory/product-prices/${productId}/history`)
                    .then((res) => setData(res.data))
                    .catch((err) => setError(err.message))
                    .finally(() => setLoading(false));
                }
              }}
              style={{ marginTop: "12px" }}
            >
              Retry
            </button>
          </div>
        ) : data ? (
          <>
            {/* Top KPI Summary Cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "14px",
              }}
            >
              {/* Card 1: Latest Purchase */}
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "14px 16px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  🛒 Latest Purchase / Cost
                </div>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", marginTop: "4px" }}>
                  {formatPrice(metrics?.latest_purchase_rate, metrics?.latest_purchase_currency || "CNY")}
                </div>
                <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {metrics?.latest_supplier_name || "No purchase recorded"}
                </div>
                {metrics?.latest_purchase_landing_rate && (
                  <div style={{ fontSize: "11px", color: "#2563eb", marginTop: "2px", fontWeight: 600 }}>
                    Landed: {formatPrice(metrics.latest_purchase_landing_rate, metrics.latest_purchase_currency || "CNY")}
                  </div>
                )}
                {metrics?.latest_purchase_date && (
                  <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
                    {metrics.latest_purchase_date}
                  </div>
                )}
              </div>

              {/* Card 2: Latest Sale */}
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "14px 16px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  🏷️ Latest Selling Rate
                </div>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", marginTop: "4px" }}>
                  {formatPrice(metrics?.latest_sales_rate, metrics?.latest_sales_currency || "RMB")}
                </div>
                <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {metrics?.latest_buyer_name || "No sales order yet"}
                </div>
                {metrics?.latest_sales_date && (
                  <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
                    {metrics.latest_sales_date}
                  </div>
                )}
              </div>

              {/* Card 3: Margin & Spread */}
              <div
                style={{
                  background:
                    metrics?.estimated_margin_percent != null && metrics.estimated_margin_percent > 0
                      ? "#f0fdf4"
                      : metrics?.estimated_margin_percent != null && metrics.estimated_margin_percent < 0
                      ? "#fef2f2"
                      : "#f8fafc",
                  border: `1px solid ${
                    metrics?.estimated_margin_percent != null && metrics.estimated_margin_percent > 0
                      ? "#bbf7d0"
                      : metrics?.estimated_margin_percent != null && metrics.estimated_margin_percent < 0
                      ? "#fecaca"
                      : "#e2e8f0"
                  }`,
                  borderRadius: "8px",
                  padding: "14px 16px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  📈 Gross Profit Margin
                </div>
                <div
                  style={{
                    fontSize: "20px",
                    fontWeight: 800,
                    marginTop: "4px",
                    color:
                      metrics?.estimated_margin_percent != null && metrics.estimated_margin_percent > 0
                        ? "#15803d"
                        : metrics?.estimated_margin_percent != null && metrics.estimated_margin_percent < 0
                        ? "#b91c1c"
                        : "#64748b",
                  }}
                >
                  {metrics?.estimated_margin_percent != null ? `${metrics.estimated_margin_percent > 0 ? "+" : ""}${metrics.estimated_margin_percent}%` : "—"}
                </div>
                <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px" }}>
                  {metrics?.estimated_profit_per_unit != null
                    ? `Spread: ${formatPrice(metrics.estimated_profit_per_unit, metrics.profit_currency || "USD")} / unit`
                    : "Need both buy & sell rate"}
                </div>
              </div>

              {/* Card 4: Quantity Volumes */}
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "14px 16px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  📦 Volume History
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginTop: "6px" }}>
                  <div>
                    <span style={{ fontSize: "11px", color: "#64748b", display: "block" }}>Bought</span>
                    <strong style={{ fontSize: "16px", color: "#0f172a" }}>
                      {Number(metrics?.total_purchased_qty || 0).toLocaleString()}
                    </strong>
                  </div>
                  <span style={{ color: "#cbd5e1" }}>/</span>
                  <div>
                    <span style={{ fontSize: "11px", color: "#64748b", display: "block" }}>Sold</span>
                    <strong style={{ fontSize: "16px", color: "#0f172a" }}>
                      {Number(metrics?.total_sold_qty || 0).toLocaleString()}
                    </strong>
                  </div>
                </div>
                <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "6px" }}>
                  Invoices: {data.purchases.filter((p) => p.record_type === "invoice").length} | Orders: {data.sales.filter((s) => s.record_type === "order").length}
                </div>
              </div>
            </div>

            {/* Navigation Tabs & Search */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "12px",
                borderBottom: "1px solid #e2e8f0",
                paddingBottom: "10px",
              }}
            >
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => setActiveTab("purchases")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "none",
                    fontWeight: 700,
                    fontSize: "13.5px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: activeTab === "purchases" ? "#2563eb" : "#f1f5f9",
                    color: activeTab === "purchases" ? "#ffffff" : "#475569",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span>🛒 Purchase History</span>
                  <span
                    style={{
                      background: activeTab === "purchases" ? "rgba(255,255,255,0.25)" : "#e2e8f0",
                      padding: "1px 6px",
                      borderRadius: "10px",
                      fontSize: "11.5px",
                    }}
                  >
                    {data.purchases.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("sales")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "none",
                    fontWeight: 700,
                    fontSize: "13.5px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: activeTab === "sales" ? "#2563eb" : "#f1f5f9",
                    color: activeTab === "sales" ? "#ffffff" : "#475569",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span>🏷️ Sales History</span>
                  <span
                    style={{
                      background: activeTab === "sales" ? "rgba(255,255,255,0.25)" : "#e2e8f0",
                      padding: "1px 6px",
                      borderRadius: "10px",
                      fontSize: "11.5px",
                    }}
                  >
                    {data.sales.length}
                  </span>
                </button>
              </div>

              {/* Filter Search */}
              <input
                type="text"
                placeholder={activeTab === "purchases" ? "Filter by supplier, invoice/quote no..." : "Filter by buyer, SO no, consignment..."}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  padding: "7px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "12.5px",
                  width: "260px",
                }}
              />
            </div>

            {/* Tab 1: Purchase History Table */}
            {activeTab === "purchases" && (
              <div>
                {filteredPurchases.length === 0 ? (
                  <div
                    style={{
                      padding: "40px 20px",
                      textAlign: "center",
                      background: "#f8fafc",
                      borderRadius: "8px",
                      border: "1px dashed #cbd5e1",
                    }}
                  >
                    <div style={{ fontSize: "28px", marginBottom: "8px" }}>🛒</div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#334155" }}>
                      No purchase records found
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                      {searchTerm ? "No records match your filter criteria." : "No supplier purchase invoices or quotes recorded for this product yet."}
                    </div>
                  </div>
                ) : (
                  <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "8px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569", textAlign: "left" }}>
                          <th style={{ padding: "10px 12px", fontWeight: 700 }}>Type</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700 }}>Date</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700 }}>Supplier Name</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700 }}>Doc / Ref #</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700, textAlign: "right" }}>Qty</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700, textAlign: "right" }}>Buy Rate</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700, textAlign: "right" }}>Landed Rate</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700, textAlign: "right" }}>Total</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700 }}>Status</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700 }}>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPurchases.map((p, idx) => {
                          const isInvoice = p.record_type === "invoice";
                          const isQuote = p.record_type === "quote";
                          const typeBadgeBg = isInvoice ? "#dbeafe" : isQuote ? "#f3e8ff" : "#f1f5f9";
                          const typeBadgeColor = isInvoice ? "#1e40af" : isQuote ? "#6b21a8" : "#475569";
                          const typeLabel = isInvoice ? "INVOICE" : isQuote ? "QUOTATION" : "CATALOG";

                          return (
                            <tr
                              key={`p-${idx}`}
                              style={{
                                borderBottom: "1px solid #f1f5f9",
                                background: idx % 2 === 0 ? "#ffffff" : "#fcfdfe",
                              }}
                            >
                              <td style={{ padding: "10px 12px" }}>
                                <span
                                  style={{
                                    background: typeBadgeBg,
                                    color: typeBadgeColor,
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    fontSize: "10.5px",
                                    fontWeight: 700,
                                    letterSpacing: "0.4px",
                                  }}
                                >
                                  {typeLabel}
                                </span>
                              </td>
                              <td style={{ padding: "10px 12px", color: "#475569", whiteSpace: "nowrap" }}>
                                {p.record_date || "—"}
                              </td>
                              <td style={{ padding: "10px 12px", fontWeight: 600, color: "#1e293b" }}>
                                {p.supplier_name}
                              </td>
                              <td style={{ padding: "10px 12px", color: "#2563eb", fontWeight: 600, whiteSpace: "nowrap" }}>
                                {p.doc_number}
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "right", color: "#334155", fontWeight: 600 }}>
                                {p.quantity != null ? Number(p.quantity).toLocaleString() : "—"}
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                                {formatPrice(p.unit_rate, p.currency)}
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "right", color: "#2563eb", fontWeight: 600 }}>
                                {p.unit_landing_rate != null ? formatPrice(p.unit_landing_rate, p.currency) : "—"}
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "right", color: "#475569" }}>
                                {p.total_amount != null ? formatPrice(p.total_amount, p.currency) : "—"}
                              </td>
                              <td style={{ padding: "10px 12px" }}>
                                <span
                                  style={{
                                    fontSize: "11px",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    background: "#f1f5f9",
                                    color: "#475569",
                                    fontWeight: 500,
                                  }}
                                >
                                  {p.status || "Recorded"}
                                </span>
                              </td>
                              <td style={{ padding: "10px 12px", color: "#64748b", fontSize: "11.5px", maxWidth: "200px" }}>
                                {p.remarks || "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Sales History Table */}
            {activeTab === "sales" && (
              <div>
                {filteredSales.length === 0 ? (
                  <div
                    style={{
                      padding: "40px 20px",
                      textAlign: "center",
                      background: "#f8fafc",
                      borderRadius: "8px",
                      border: "1px dashed #cbd5e1",
                    }}
                  >
                    <div style={{ fontSize: "28px", marginBottom: "8px" }}>🏷️</div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#334155" }}>
                      No sales records found
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                      {searchTerm ? "No records match your filter criteria." : "No confirmed sales orders or buyer inquiries recorded for this product yet."}
                    </div>
                  </div>
                ) : (
                  <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "8px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569", textAlign: "left" }}>
                          <th style={{ padding: "10px 12px", fontWeight: 700 }}>Type</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700 }}>Date</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700 }}>Buyer Name</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700 }}>Consignment</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700 }}>Order #</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700, textAlign: "right" }}>Qty</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700, textAlign: "right" }}>Sell Rate</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700, textAlign: "right" }}>Total</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700, textAlign: "center" }}>Margin %</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700 }}>Status</th>
                          <th style={{ padding: "10px 12px", fontWeight: 700 }}>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSales.map((s, idx) => {
                          const isOrder = s.record_type === "order";
                          const typeBadgeBg = isOrder ? "#dcfce7" : "#fef3c7";
                          const typeBadgeColor = isOrder ? "#166534" : "#92400e";
                          const typeLabel = isOrder ? "SALE ORDER" : "INQUIRY";

                          return (
                            <tr
                              key={`s-${idx}`}
                              style={{
                                borderBottom: "1px solid #f1f5f9",
                                background: idx % 2 === 0 ? "#ffffff" : "#fcfdfe",
                              }}
                            >
                              <td style={{ padding: "10px 12px" }}>
                                <span
                                  style={{
                                    background: typeBadgeBg,
                                    color: typeBadgeColor,
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    fontSize: "10.5px",
                                    fontWeight: 700,
                                    letterSpacing: "0.4px",
                                  }}
                                >
                                  {typeLabel}
                                </span>
                              </td>
                              <td style={{ padding: "10px 12px", color: "#475569", whiteSpace: "nowrap" }}>
                                {s.record_date || "—"}
                              </td>
                              <td style={{ padding: "10px 12px", fontWeight: 600, color: "#1e293b" }}>
                                {s.buyer_name}
                              </td>
                              <td style={{ padding: "10px 12px", color: "#64748b", fontWeight: 500 }}>
                                {s.consignment_code || "—"}
                              </td>
                              <td style={{ padding: "10px 12px", color: "#2563eb", fontWeight: 600, whiteSpace: "nowrap" }}>
                                {s.doc_number}
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "right", color: "#334155", fontWeight: 600 }}>
                                {Number(s.quantity).toLocaleString()}
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                                {s.unit_rate > 0 ? formatPrice(s.unit_rate, s.currency) : "Target / Req."}
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "right", color: "#475569" }}>
                                {s.item_total != null && s.item_total > 0 ? formatPrice(s.item_total, s.currency) : "—"}
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                {s.margin_percent != null ? (
                                  <span
                                    style={{
                                      padding: "2px 7px",
                                      borderRadius: "12px",
                                      fontSize: "11px",
                                      fontWeight: 700,
                                      background: s.margin_percent > 0 ? "#dcfce7" : "#fee2e2",
                                      color: s.margin_percent > 0 ? "#15803d" : "#b91c1c",
                                    }}
                                  >
                                    {s.margin_percent > 0 ? "+" : ""}
                                    {s.margin_percent}%
                                  </span>
                                ) : (
                                  <span style={{ color: "#94a3b8" }}>—</span>
                                )}
                              </td>
                              <td style={{ padding: "10px 12px" }}>
                                <span
                                  style={{
                                    fontSize: "11px",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    background: "#f1f5f9",
                                    color: "#475569",
                                    fontWeight: 500,
                                  }}
                                >
                                  {s.status || "Recorded"}
                                </span>
                              </td>
                              <td style={{ padding: "10px 12px", color: "#64748b", fontSize: "11.5px", maxWidth: "200px" }}>
                                {s.remarks || "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}
      </div>
    </SideDrawer>
  );
}
