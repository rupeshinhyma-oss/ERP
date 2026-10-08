import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { generateGatePassPdf } from "@/lib/gatePassPdf";
import { INITIAL_SALE_ORDERS } from "@/pages/sales/SaleProcessList";
import type { SaleOrder } from "@/types/saleProcess";
import { apiGet } from "@/lib/api";

export function GatePassPdfPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [liveItem, setLiveItem] = useState<SaleOrder | null>(null);

  // Find order item from static datasets or fallback
  const staticItem = useMemo(() => {
    const saleMatch = INITIAL_SALE_ORDERS.find(
      (it) =>
        it.id === id ||
        it.order_no === id ||
        it.gatepass_no === id ||
        (id && it.order_no.includes(id)) ||
        (id && it.id.includes(id))
    );
    if (saleMatch) return saleMatch;
    return INITIAL_SALE_ORDERS[0] || null;
  }, [id]);

  // Fetch live order from backend API
  useEffect(() => {
    let cancelled = false;
    if (id) {
      apiGet<SaleOrder>(`/sales/orders/${id}`)
        .then((res) => {
          if (!cancelled && res?.data) {
            setLiveItem(res.data);
          }
        })
        .catch(() => {
          // Fall back to static mock item
        });
    }
    return () => {
      cancelled = true;
    };
  }, [id]);

  const currentOrder = liveItem || staticItem;
  const gpNo = currentOrder?.gatepass_no || "GP-Outward";

  useEffect(() => {
    if (currentOrder) {
      const doc = generateGatePassPdf(currentOrder, {
        saveFile: false,
        openInNewTab: false,
      });
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);

      document.title = `Gate Pass: ${gpNo}`;

      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [currentOrder, gpNo]);

  const handleDownload = () => {
    if (currentOrder) {
      generateGatePassPdf(currentOrder, {
        saveFile: true,
        openInNewTab: false,
      });
    }
  };

  const handlePrint = () => {
    if (pdfUrl) {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = pdfUrl;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        iframe.contentWindow?.print();
      };
    }
  };

  const handleBack = () => {
    try {
      if (window.opener && !window.opener.closed) {
        window.close();
      }
    } catch {
      // Ignore
    }

    if (
      window.history.length > 1 &&
      document.referrer &&
      document.referrer.includes(window.location.host)
    ) {
      navigate(-1);
    } else {
      navigate("/sales/process");
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "#525659",
      }}
    >
      {/* Top Navbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 20px",
          backgroundColor: "#1e293b",
          color: "#ffffff",
          boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
          zIndex: 10,
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button
            type="button"
            onClick={handleBack}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              backgroundColor: "#334155",
              color: "#ffffff",
              border: "1px solid #475569",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            ← Back
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#f8fafc" }}>
              🚚 Outward Gate Pass: {gpNo}
            </h2>
            <div style={{ fontSize: "11px", color: "#94a3b8" }}>
              SO Ref: {currentOrder?.order_no || "—"} | Customer: {currentOrder?.company_name || currentOrder?.buyer_name || "—"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            type="button"
            onClick={handleDownload}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 16px",
              backgroundColor: "#0284c7",
              color: "#ffffff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            }}
          >
            📥 Download Gate Pass PDF
          </button>

          <button
            type="button"
            onClick={handlePrint}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 16px",
              backgroundColor: "#16a34a",
              color: "#ffffff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            }}
          >
            🖨️ Print
          </button>
        </div>
      </div>

      {/* Main PDF Viewer */}
      <div style={{ flex: 1, position: "relative" }}>
        {pdfUrl ? (
          <iframe
            src={`${pdfUrl}#toolbar=0`}
            style={{ width: "100%", height: "100%", border: "none" }}
            title={`Gate Pass PDF - ${gpNo}`}
          />
        ) : (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
              color: "#ffffff",
              fontSize: "15px",
            }}
          >
            Generating Gate Pass PDF preview…
          </div>
        )}
      </div>
    </div>
  );
}
