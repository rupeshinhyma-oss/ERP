import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { INITIAL_PROFORMA_ITEMS } from "@/pages/ProformaInvoicesPage";
import { generateProformaInvoicePdf } from "@/lib/proformaInvoicePdf";
import type { ProformaInvoice } from "@/types";
import { apiGet } from "@/lib/api";

export function ProformaInvoicePdfPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [liveItem, setLiveItem] = useState<ProformaInvoice | null>(null);

  // Find item from static INITIAL_PROFORMA_ITEMS
  const staticItem = useMemo(() => {
    if (!id) return INITIAL_PROFORMA_ITEMS[0];
    const found = INITIAL_PROFORMA_ITEMS.find(
      (item) =>
        item.id === id ||
        item.proforma_no === id ||
        item.proforma_no.includes(id) ||
        item.id === `pi-${id}`
    );
    return found || INITIAL_PROFORMA_ITEMS[0];
  }, [id]);

  // Also attempt to fetch live from API if exists
  useEffect(() => {
    let cancelled = false;
    if (id) {
      apiGet<ProformaInvoice>(`/proforma-invoice/${id}`)
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
  const piNo = currentItem?.proforma_no || "PI-MH/26-27/1714";

  useEffect(() => {
    if (currentItem) {
      const doc = generateProformaInvoicePdf(currentItem, { saveFile: false, openInNewTab: false });
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);

      // Set document title matching legacy screenshot tab: "PI No: PI-MH/26-27/1714"
      document.title = `PI No: ${piNo}`;

      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [currentItem, piNo]);

  const handleDownload = () => {
    if (currentItem) {
      generateProformaInvoicePdf(currentItem, { saveFile: true, openInNewTab: false });
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

  return (
    <div
      data-testid="proforma-pdf-page"
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
            onClick={() => navigate("/proforma-invoice/list")}
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
            ← Back to List
          </button>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#f1f5f9" }}>
            PI No: {piNo}
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
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Print
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
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
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

      {/* Main PDF Viewer Frame */}
      <div style={{ flex: 1, position: "relative", width: "100%", height: "calc(100vh - 54px)" }}>
        {pdfUrl ? (
          <iframe
            data-testid="proforma-pdf-frame"
            src={pdfUrl}
            title={`Proforma Invoice - ${piNo}`}
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#ffffff", fontSize: "14px" }}>
            Generating Proforma Invoice PDF…
          </div>
        )}
      </div>
    </div>
  );
}

export default ProformaInvoicePdfPage;
