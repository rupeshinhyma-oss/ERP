import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiGet, errorMessage, API_BASE } from "@/lib/api";
import { Auth } from "@/lib/auth";
import { IMPORT_PURCHASE_API, mapImportPurchase, type ImportPurchaseRecord } from "@/lib/purchaseApi";

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function ImportPurchasePdfPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [currentItem, setCurrentItem] = useState<ImportPurchaseRecord | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileBlob, setFileBlob] = useState<Blob | null>(null);
  const [fileType, setFileType] = useState<"pdf" | "image" | "document" | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    apiGet<any>(`${IMPORT_PURCHASE_API}/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res?.data) {
          setLoadError("Consignment not found.");
          setIsLoading(false);
          return;
        }

        const item = mapImportPurchase(res.data, {});
        setCurrentItem(item);

        const fileName = item.bill_file || "";
        const fileUrlPath = item.bill_file_url || "";

        if (!fileName && !fileUrlPath) {
          // No invoice file was uploaded in Add New / Edit form for this consignment
          setIsLoading(false);
          document.title = `No Invoice - ${item.consignment_no || ""}`;
          return;
        }

        // Fetch the uploaded invoice file from backend
        try {
          const token = Auth.getAccessToken();
          const headers: Record<string, string> = {};
          if (token) headers["Authorization"] = `Bearer ${token}`;

          const fileEndpoint = `${API_BASE}/purchase/import-orders/${encodeURIComponent(id)}/bill-file`;
          const response = await fetch(fileEndpoint, { headers, credentials: "include" });

          if (!response.ok) {
            throw new Error(`Attached invoice file could not be loaded (${response.status} ${response.statusText})`);
          }

          const blob = await response.blob();
          if (cancelled) return;

          const objectUrl = URL.createObjectURL(blob);
          setFileBlob(blob);
          setFileUrl(objectUrl);

          const lowerName = fileName.toLowerCase();
          const isPdf = blob.type === "application/pdf" || lowerName.endsWith(".pdf");
          const isImg = blob.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/i.test(lowerName);

          if (isPdf) {
            setFileType("pdf");
          } else if (isImg) {
            setFileType("image");
          } else {
            setFileType("document");
          }

          document.title = `Bill File: ${fileName || item.consignment_no}`;
          setIsLoading(false);
        } catch (fetchErr: any) {
          if (!cancelled) {
            setLoadError(fetchErr?.message || "Failed to load attached invoice file.");
            setIsLoading(false);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(errorMessage(err));
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    return () => {
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
    };
  }, [fileUrl]);

  const consignmentNo = currentItem?.consignment_no || "";
  const fileName = currentItem?.bill_file || "";

  const handleDownload = () => {
    if (fileUrl && fileBlob) {
      const a = document.createElement("a");
      a.href = fileUrl;
      a.download = fileName || `${consignmentNo || "import_consignment"}_invoice.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handlePrint = () => {
    if (fileUrl) {
      if (fileType === "pdf") {
        const iframe = document.querySelector<HTMLIFrameElement>("iframe");
        if (iframe?.contentWindow) {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            return;
          } catch {
            // fallback if cross-origin
          }
        }
      }
      const printWindow = window.open(fileUrl, "_blank");
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.print();
        };
      }
    }
  };

  const handleBack = () => {
    try {
      if (window.opener && !window.opener.closed) {
        window.close();
        return;
      }
    } catch { }
    navigate("/purchase/importpurchase");
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
            Bill File: {consignmentNo} {fileName ? `(${fileName})` : ""}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {fileUrl && fileType === "pdf" && (
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
          )}
          {fileUrl && (
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
              ⬇️ Download {fileType === "pdf" ? "PDF" : "File"}
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, position: "relative", width: "100%", height: "calc(100vh - 54px)", overflow: "hidden" }}>
        {isLoading ? (
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
            Loading uploaded invoice file...
          </div>
        ) : loadError ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#ffffff",
              gap: "12px",
              padding: "20px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "36px" }}>⚠️</div>
            <div style={{ fontSize: "16px", fontWeight: 600, color: "#fca5a5" }}>{loadError}</div>
            <button
              type="button"
              onClick={handleBack}
              style={{
                marginTop: "8px",
                backgroundColor: "#475569",
                color: "#ffffff",
                border: "none",
                padding: "8px 18px",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Return to Import Purchase List
            </button>
          </div>
        ) : !currentItem?.bill_file && !currentItem?.bill_file_url ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#ffffff",
              gap: "12px",
              padding: "20px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "40px" }}>📁</div>
            <div style={{ fontSize: "17px", fontWeight: 600 }}>
              No invoice file was uploaded for consignment {consignmentNo}
            </div>
            <div style={{ fontSize: "13.5px", color: "#94a3b8", maxWidth: "420px" }}>
              Please attach an invoice file in the "Attach Invoice" field on the Add/Edit form.
            </div>
            <button
              type="button"
              onClick={handleBack}
              style={{
                marginTop: "12px",
                backgroundColor: "#0061f2",
                color: "#ffffff",
                border: "none",
                padding: "8px 20px",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              ← Back to Import Purchase List
            </button>
          </div>
        ) : fileType === "pdf" && fileUrl ? (
          <iframe
            title={`Import Bill File PDF: ${fileName || consignmentNo}`}
            data-testid="import-bill-file-iframe"
            src={fileUrl}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              backgroundColor: "#525659",
            }}
          />
        ) : fileType === "image" && fileUrl ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
              padding: "20px",
              overflow: "auto",
            }}
          >
            <img
              src={fileUrl}
              alt={fileName || "Uploaded Invoice"}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                borderRadius: "4px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
            />
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#ffffff",
              gap: "16px",
              padding: "20px",
            }}
          >
            <div
              style={{
                backgroundColor: "#323639",
                padding: "32px 40px",
                borderRadius: "8px",
                textAlign: "center",
                maxWidth: "500px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              }}
            >
              <div style={{ fontSize: "44px", marginBottom: "12px" }}>📄</div>
              <h3 style={{ fontSize: "17px", fontWeight: 600, margin: "0 0 6px 0", color: "#f8fafc" }}>
                {fileName}
              </h3>
              {fileBlob?.size ? (
                <div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "12px" }}>
                  Size: {formatBytes(fileBlob.size)}
                </div>
              ) : null}
              <p style={{ fontSize: "13px", color: "#cbd5e1", margin: "0 0 20px 0", lineHeight: 1.5 }}>
                Uploaded invoice document for consignment <strong>{consignmentNo}</strong>.
                <br />
                This document format cannot be rendered inline in the browser. Click below to download and view the original file.
              </p>
              <button
                type="button"
                onClick={handleDownload}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  backgroundColor: "#0061f2",
                  color: "#ffffff",
                  border: "none",
                  padding: "10px 22px",
                  borderRadius: "5px",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ⬇️ Download {fileName || "Document"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ImportPurchasePdfPage;