import React, { useState, useEffect } from "react";

export interface AttachmentItem {
  id?: string;
  file_name: string;
  file_url: string;
  file_type?: string;
  file_size: number;
  uploaded_by?: string | null;
  uploader?: { full_name?: string | null; username?: string | null } | null;
  created_at?: string;
}

interface AttachmentListProps {
  attachments: AttachmentItem[];
  onDelete?: (item: AttachmentItem, index: number) => void;
  canDelete?: boolean;
  isDeleting?: boolean;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileIcon(fileName: string, mime?: string) {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const type = (mime || "").toLowerCase();

  if (type.includes("pdf") || ext === "pdf") {
    return {
      bg: "rgba(239, 68, 68, 0.1)",
      color: "#ef4444",
      label: "PDF",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
    };
  }

  if (type.includes("image") || ["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(ext)) {
    return {
      bg: "rgba(59, 130, 246, 0.1)",
      color: "#3b82f6",
      label: "IMG",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      ),
    };
  }

  if (type.includes("sheet") || type.includes("excel") || ["xls", "xlsx", "csv"].includes(ext)) {
    return {
      bg: "rgba(16, 185, 129, 0.1)",
      color: "#10b981",
      label: "XLS",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      ),
    };
  }

  if (type.includes("word") || ["doc", "docx", "txt", "md"].includes(ext)) {
    return {
      bg: "rgba(99, 102, 241, 0.1)",
      color: "#6366f1",
      label: "DOC",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      ),
    };
  }

  if (type.includes("zip") || ["zip", "rar", "tar", "gz", "7z"].includes(ext)) {
    return {
      bg: "rgba(245, 158, 11, 0.1)",
      color: "#f59e0b",
      label: "ZIP",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3m18 0v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8m18 0H3" />
          <path d="M10 12h4" />
        </svg>
      ),
    };
  }

  return {
    bg: "rgba(100, 116, 139, 0.1)",
    color: "#64748b",
    label: "FILE",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  };
}

export const AttachmentList: React.FC<AttachmentListProps> = ({
  attachments,
  onDelete,
  canDelete = true,
  isDeleting = false,
}) => {
  const [previewItem, setPreviewItem] = useState<AttachmentItem | null>(null);

  // ESC key listener & body scroll lock for preview modal
  useEffect(() => {
    if (!previewItem) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPreviewItem(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [previewItem]);

  if (!attachments || attachments.length === 0) {
    return null;
  }

  const isImageFile = (fileName: string, fileType?: string): boolean => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    return ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext) || (fileType?.startsWith("image/") ?? false);
  };

  const isVideoFile = (fileName: string, fileType?: string): boolean => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    return ["mp4", "webm", "ogg", "mov"].includes(ext) || (fileType?.startsWith("video/") ?? false);
  };

  const isAudioFile = (fileName: string, fileType?: string): boolean => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    return ["mp3", "wav", "ogg", "webm"].includes(ext) || (fileType?.startsWith("audio/") ?? false);
  };

  const isPdfFile = (fileName: string, fileType?: string): boolean => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    return ext === "pdf" || fileType === "application/pdf";
  };

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: "10px",
          marginTop: "8px",
        }}
      >
        {attachments.map((item, idx) => {
          const fileMeta = getFileIcon(item.file_name, item.file_type);
          const uploaderName = item.uploader?.full_name || item.uploader?.username;

          return (
            <div
              key={item.id || `${item.file_name}-${idx}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                background: "var(--bg-card, #ffffff)",
                border: "1px solid var(--border-color, #e2e8f0)",
                borderRadius: "8px",
                gap: "8px",
                transition: "border-color 0.15s ease",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1, cursor: "pointer" }}
                onClick={() => setPreviewItem(item)}
                title="Click to preview file"
              >
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "6px",
                    background: fileMeta.bg,
                    color: fileMeta.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {fileMeta.icon}
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--text-color, #0f172a)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.file_name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--text-muted, #64748b)" }}>
                    <span>{formatBytes(item.file_size)}</span>
                    {uploaderName && <span>• {uploaderName}</span>}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                <a
                  href={item.file_url}
                  target="_blank"
                  rel="noreferrer"
                  download={item.file_name}
                  title="Download file"
                  style={{
                    padding: "4px",
                    color: "var(--text-muted, #64748b)",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textDecoration: "none",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </a>

                {canDelete && onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(item, idx)}
                    disabled={isDeleting}
                    title="Remove attachment"
                    style={{
                      padding: "4px",
                      background: "transparent",
                      border: "none",
                      color: "#94a3b8",
                      cursor: isDeleting ? "not-allowed" : "pointer",
                      borderRadius: "4px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Attachment Preview Modal */}
      {previewItem && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(4px)",
            zIndex: 10010,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
          onClick={() => setPreviewItem(null)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "14px",
              width: "780px",
              maxWidth: "100%",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.35)",
              overflow: "hidden",
              border: "1px solid #cbd5e1",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "14px 20px",
                borderBottom: "1px solid #e2e8f0",
                background: "#f8fafc",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                <span style={{ fontSize: "18px" }}>📎</span>
                <div style={{ minWidth: 0 }}>
                  <h3
                    style={{
                      margin: 0,
                      fontSize: "14px",
                      fontWeight: 700,
                      color: "#0f172a",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {previewItem.file_name}
                  </h3>
                  <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                    {formatBytes(previewItem.file_size)}
                    {previewItem.uploader?.full_name && ` • Uploaded by ${previewItem.uploader.full_name}`}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <a
                  href={previewItem.file_url}
                  download={previewItem.file_name}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary"
                  style={{ fontSize: "12px", padding: "5px 10px", textDecoration: "none" }}
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  style={{
                    background: "transparent",
                    border: "none",
                    fontSize: "18px",
                    cursor: "pointer",
                    color: "#64748b",
                    lineHeight: 1,
                    padding: "4px",
                  }}
                  title="Close preview"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body Preview Content */}
            <div
              style={{
                padding: "16px",
                flex: 1,
                overflowY: "auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#f1f5f9",
                minHeight: "260px",
              }}
            >
              {isImageFile(previewItem.file_name, previewItem.file_type) ? (
                <img
                  src={previewItem.file_url}
                  alt={previewItem.file_name}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "68vh",
                    objectFit: "contain",
                    borderRadius: "6px",
                    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
                  }}
                />
              ) : isVideoFile(previewItem.file_name, previewItem.file_type) ? (
                <video
                  src={previewItem.file_url}
                  controls
                  style={{
                    maxWidth: "100%",
                    maxHeight: "68vh",
                    borderRadius: "6px",
                  }}
                />
              ) : isAudioFile(previewItem.file_name, previewItem.file_type) ? (
                <div style={{ width: "100%", maxWidth: "480px", padding: "24px", background: "#ffffff", borderRadius: "10px" }}>
                  <audio src={previewItem.file_url} controls style={{ width: "100%" }} />
                </div>
              ) : isPdfFile(previewItem.file_name, previewItem.file_type) ? (
                <iframe
                  src={previewItem.file_url}
                  title={previewItem.file_name}
                  style={{
                    width: "100%",
                    height: "68vh",
                    border: "none",
                    borderRadius: "6px",
                    background: "#ffffff",
                  }}
                />
              ) : (
                <div
                  style={{
                    textAlign: "center",
                    padding: "32px",
                    background: "#ffffff",
                    borderRadius: "10px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                  }}
                >
                  <div style={{ fontSize: "40px", marginBottom: "12px" }}>📄</div>
                  <h4 style={{ margin: "0 0 6px", fontSize: "14px", color: "#1e293b" }}>
                    {previewItem.file_name}
                  </h4>
                  <p style={{ margin: "0 0 16px", fontSize: "12px", color: "#64748b" }}>
                    Direct inline preview not supported for this file type.
                  </p>
                  <a
                    href={previewItem.file_url}
                    download={previewItem.file_name}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary"
                    style={{ fontSize: "12.5px" }}
                  >
                    Download File ({formatBytes(previewItem.file_size)})
                  </a>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "10px 18px",
                borderTop: "1px solid #e2e8f0",
                background: "#f8fafc",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: "12.5px" }}
                onClick={() => setPreviewItem(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
