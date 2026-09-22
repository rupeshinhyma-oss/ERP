import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { INITIAL_IMPORT_ORDERS, type ImportPurchaseRecord } from "@/pages/purchase/ImportPurchasePage";
import { generateImportPurchaseBillPdf } from "@/lib/importPurchasePdf";
import { apiGet } from "@/lib/api";

export function ImportPurchasePdfPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [liveItem, setLiveItem] = useState<ImportPurchaseRecord | null>(null);

  // Find item from localStorage or static INITIAL_IMPORT_ORDERS
  const staticItem = useMemo(() => {
    let orderPool = INITIAL_IMPORT_ORDERS;
    try {
      const saved = localStorage.getItem("inhyma_import_purchase_orders");
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
      const itemNo = item.consignment_no.toLowerCase();
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

  // Fetch live from API if available
  useEffect(() => {
    let cancelled = false;
    if (id) {
      apiGet<ImportPurchaseRecord>(`/purchase/import/orders/${id}`)
        .then((res) => {
          if (!cancelled && res?.data) {
            setLiveItem(res.data);
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [id]);

  const currentItem = liveItem || staticItem;
  const consignmentNo = currentItem?.consignment_no || "MUM51";

  useEffect(() => {
    if (currentItem) {
      const doc = generateImportPurchaseBillPdf(currentItem, { saveFile: false, openInNewTab: false });
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);

      document.title = `Bill File: ${consignmentNo}`;

      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [currentItem, consignmentNo]);

  const handleDownload = () => {
    if (currentItem) {
      generateImportPurchaseBillPdf(currentItem, { saveFile: true, openInNewTab: false });
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
        return;
      }
    } catch {}
    navigate("/purchase-order/import-purchase-list");
  };

  return (
    <div
      data-testid="import-purchase-pdf-page"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "#525659",
      }}
    >
      {/* Top action toolbar */}
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
            ← Back to Import Purchase List
          </button>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#f1f5f9" }}>
            Bill File: {consignmentNo}
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
            title="Import Bill File PDF Preview"
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
            Generating Import Bill File PDF...
          </div>
        )}
      </div>
    </div>
  );
}

export default ImportPurchasePdfPage;
