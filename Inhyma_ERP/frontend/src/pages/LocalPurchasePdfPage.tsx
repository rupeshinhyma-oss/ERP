import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { INITIAL_PURCHASE_ORDERS, type PurchaseOrderRecord } from "@/pages/purchase/LocalPurchasePage";
import { generateLocalPurchaseBillPdf } from "@/lib/localPurchasePdf";
import { apiGet } from "@/lib/api";

export function LocalPurchasePdfPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [liveItem, setLiveItem] = useState<PurchaseOrderRecord | null>(null);

  // Find item from localStorage or static INITIAL_PURCHASE_ORDERS
  const staticItem = useMemo(() => {
    let orderPool = INITIAL_PURCHASE_ORDERS;
    try {
      const saved = localStorage.getItem("inhyma_local_purchase_orders");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          orderPool = parsed;
        }
      }
    } catch {}

    if (!id) return orderPool[0];
    const decodedId = decodeURIComponent(id).trim().toLowerCase();

    const found = orderPool.find((item) => {
      const itemNo = item.invoice_no.toLowerCase();
      const itemId = item.id.toLowerCase();
      return (
        itemId === decodedId ||
        itemNo === decodedId ||
        itemNo.replace(/[\/\-_]/g, "") === decodedId.replace(/[\/\-_]/g, "") ||
        itemNo.includes(decodedId) ||
        decodedId.includes(itemNo)
      );
    });

    return found || orderPool[0];
  }, [id]);

  // Also attempt to fetch live from API if exists
  useEffect(() => {
    let cancelled = false;
    if (id) {
      apiGet<PurchaseOrderRecord>(`/purchase/orders/${id}`)
        .then((res) => {
          if (!cancelled && res?.data) {
            setLiveItem(res.data);
          }
        })
        .catch(() => {
          // Fallback to static item
        });
    }
    return () => {
      cancelled = true;
    };
  }, [id]);

  const currentItem = liveItem || staticItem;
  const invoiceNo = currentItem?.invoice_no || "2026-27/SO/1534";

  useEffect(() => {
    if (currentItem) {
      const doc = generateLocalPurchaseBillPdf(currentItem, { saveFile: false, openInNewTab: false });
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);

      // Set document title
      document.title = `Bill File: ${invoiceNo}`;

      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [currentItem, invoiceNo]);

  const handleDownload = () => {
    if (currentItem) {
      generateLocalPurchaseBillPdf(currentItem, { saveFile: true, openInNewTab: false });
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
    // If tab was opened from another window, attempt to close it first
    try {
      if (window.opener && !window.opener.closed) {
        window.close();
        return;
      }
    } catch {
      // Ignore if browser restricts window.close
    }
    navigate("/purchase-order/list");
  };

  return (
    <div
      data-testid="local-purchase-pdf-page"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "#525659",
      }}
    >
      {/* Top action toolbar matching browser viewer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 20px",
          backgroundColor: "#323639",
          color: "#ffffff",
          boxShadow: "0 2px 5px rgba(0,0,0,0.3)",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <button
            type="button"
            onClick={handleBack}
            style={{
              background: "transparent",
              border: "1px solid #717171",
              color: "#ffffff",
              padding: "5px 12px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "12.5px",
              fontWeight: 500,
            }}
          >
            ← Back to Purchase List
          </button>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#f1f5f9" }}>
            Bill File: {invoiceNo}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            type="button"
            onClick={handlePrint}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: "#475569",
              color: "#ffffff",
              border: "none",
              padding: "6px 14px",
              borderRadius: "4px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            🖨️ Print
          </button>
          <button
            type="button"
            onClick={handleDownload}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: "#0061f2",
              color: "#ffffff",
              border: "none",
              padding: "6px 16px",
              borderRadius: "4px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            }}
          >
            ⬇️ Download PDF
          </button>
        </div>
      </div>

      {/* PDF Viewer Container */}
      <div style={{ flex: 1, position: "relative", width: "100%", height: "calc(100vh - 54px)" }}>
        {pdfUrl ? (
          <iframe
            title="Bill File PDF Preview"
            src={pdfUrl}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              backgroundColor: "#525659",
            }}
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
            Generating Bill File PDF...
          </div>
        )}
      </div>
    </div>
  );
}

export default LocalPurchasePdfPage;
