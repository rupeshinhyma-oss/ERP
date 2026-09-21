import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { INITIAL_ADJUSTMENTS } from "@/pages/StockAdjustmentPage";
import { generateStockAdjustmentPdf } from "@/lib/stockAdjustmentPdf";

export function AdjustmentOrderPdfPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const currentItem = useMemo(() => {
    if (!id) return INITIAL_ADJUSTMENTS[0];
    const found = INITIAL_ADJUSTMENTS.find(
      (item) => item.id === id || item.adjustment_no === id || item.id === `adj-${id}`
    );
    return found || INITIAL_ADJUSTMENTS[0];
  }, [id]);

  useEffect(() => {
    if (currentItem) {
      const doc = generateStockAdjustmentPdf(currentItem, { saveFile: false, openInNewTab: false });
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);

      // Set document title matching screenshot tab
      const adjNo = currentItem.adjustment_no || currentItem.id.replace(/\D/g, "") || "492";
      document.title = `Adjustment No: ${adjNo}`;

      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [currentItem]);

  const handleDownload = () => {
    if (currentItem) {
      generateStockAdjustmentPdf(currentItem, { saveFile: true, openInNewTab: false });
    }
  };

  const adjNo = currentItem?.adjustment_no || currentItem?.id.replace(/\D/g, "") || "492";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", backgroundColor: "#525659" }}>
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
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            type="button"
            onClick={() => navigate("/adjustment/list")}
            style={{
              background: "transparent",
              border: "1px solid #717171",
              color: "#ffffff",
              padding: "4px 10px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            ← Back to List
          </button>
          <span style={{ fontSize: "14px", fontWeight: 600 }}>Adjustment No: {adjNo}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            type="button"
            onClick={handleDownload}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: "#0284c7",
              color: "#ffffff",
              border: "none",
              padding: "6px 14px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download PDF
          </button>
        </div>
      </div>

      {/* Embedded PDF Viewer */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {pdfUrl ? (
          <iframe
            src={pdfUrl}
            title={`Adjustment No: ${adjNo}`}
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#cbd5e1" }}>
            Generating Stock Adjustment PDF...
          </div>
        )}
      </div>
    </div>
  );
}

export default AdjustmentOrderPdfPage;
