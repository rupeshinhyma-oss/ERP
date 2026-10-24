import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiGet, errorMessage, API_BASE } from "@/lib/api";
import { Auth } from "@/lib/auth";
import { LOCAL_PURCHASE_API, mapLocalPurchase, type PurchaseOrderRecord } from "@/lib/purchaseApi";

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function LocalPurchasePdfPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [currentItem, setCurrentItem] = useState<PurchaseOrderRecord | null>(null);
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

    apiGet<any>(`${LOCAL_PURCHASE_API}/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res?.data) {
          setLoadError("Local purchase not found.");
          setIsLoading(false);
          return;
        }

        const item = mapLocalPurchase(res.data, {});
        setCurrentItem(item);

        const fileName = item.bill_file || "";
        const fileUrlPath = item.bill_file_url || "";

        if (!fileName && !fileUrlPath) {
          // No bill file was uploaded in Add New / Edit form for this purchase
          setIsLoading(false);
          document.title = `No Bill File - ${item.invoice_no || ""}`;
          return;
        }

        // Fetch the uploaded bill file from backend
        try {
          const token = Auth.getAccessToken();
          const headers: Record<string, string> = {};
          if (token) headers["Authorization"] = `Bearer ${token}`;

          const fileEndpoint = `${API_BASE}/purchase/local-orders/${encodeURIComponent(id)}/bill-file`;
          const response = await fetch(fileEndpoint, { headers, credentials: "include" });

          if (!response.ok) {
            throw new Error(`Attached bill file could not be loaded (${response.status} ${response.statusText})`);
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

          document.title = `Bill File: ${fileName || item.invoice_no}`;
          setIsLoading(false);
        } catch (fetchErr: any) {
          if (!cancelled) {
            setLoadError(fetchErr?.message || "Failed to load attached bill file.");
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

  const invoiceNo = currentItem?.invoice_no || "";
  const fileName = currentItem?.bill_file || "";

  const handleDownload = () => {
    if (fileUrl && fileBlob) {
      const a = document.createElement("a");
      a.href = fileUrl;
      a.download = fileName || `${invoiceNo || "local_purchase"}_bill.pdf`;
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
    } catch {}
    navigate("/purchase/localpurchase");
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
            ← Back to Purchase List
          </button>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#f1f5f9" }}>
            Bill File: {invoiceNo} {fileName ? `(${fileName})` : ""}
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

      {/* Main Preview Container */}
      <div style={{ flex: 1, position: "relative", width: "100%", height: "calc(100vh - 54px)", overflow: "hidden" }}>
        {isLoading ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#f1f5f9",
              gap: "12px",
            }}
          >
            <div
              style={{
                width: "36px",
                height: "36px",
                border: "3px solid rgba(255,255,255,0.2)",
                borderTopColor: "#3b82f6",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <div style={{ fontSize: "14px", fontWeight: 500 }}>Loading uploaded bill file...</div>
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          </div>
        ) : loadError ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#f87171",
              padding: "20px",
              textAlign: "center",
              gap: "12px",
            }}
          >
            <div style={{ fontSize: "36px" }}>⚠️</div>
            <div style={{ fontSize: "16px", fontWeight: 600 }}>{loadError}</div>
            <button
              type="button"
              onClick={handleBack}
              style={{
                marginTop: "12px",
                backgroundColor: "#475569",
                color: "#ffffff",
                border: "none",
                padding: "8px 20px",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              ← Back to Purchase List
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
              padding: "20px",
              textAlign: "center",
              gap: "12px",
            }}
          >
            <div style={{ fontSize: "48px", opacity: 0.8 }}>📁</div>
            <div style={{ fontSize: "17px", fontWeight: 600, color: "#f8fafc" }}>
              No bill file was uploaded for purchase order {invoiceNo}
            </div>
            <div style={{ fontSize: "13.5px", color: "#94a3b8", maxWidth: "420px" }}>
              Please attach a bill file in the &quot;Bill File&quot; field on the Add/Edit form.
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
              ← Back to Purchase List
            </button>
          </div>
        ) : fileType === "pdf" && fileUrl ? (
          <iframe
            title="Bill File PDF Preview"
            data-testid="local-bill-file-iframe"
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
              alt={fileName || "Uploaded Bill"}
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
                Uploaded bill document for purchase order <strong>{invoiceNo}</strong>.
              </p>
              <button
                type="button"
                onClick={handleDownload}
                style={{
                  backgroundColor: "#0061f2",
                  color: "#ffffff",
                  border: "none",
                  padding: "9px 22px",
                  borderRadius: "4px",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                ⬇️ Download {fileName}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default LocalPurchasePdfPage;