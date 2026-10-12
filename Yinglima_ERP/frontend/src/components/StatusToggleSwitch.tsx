import React, { useEffect, useState } from "react";
import { apiPost } from "@/lib/api";
import { useToast } from "@/lib/toast";

interface StatusToggleSwitchProps {
  id: string;
  status: "active" | "inactive" | string;
  name?: string;
  apiBase: string; // e.g. "/masters/products"
  onStatusChanged?: (newStatus: "active" | "inactive") => void;
  disabled?: boolean;
}

export function StatusToggleSwitch({
  id,
  status,
  name,
  apiBase,
  onStatusChanged,
  disabled = false,
}: StatusToggleSwitchProps) {
  const [currentStatus, setCurrentStatus] = useState<"active" | "inactive">(
    status === "inactive" ? "inactive" : "active"
  );
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setCurrentStatus(status === "inactive" ? "inactive" : "active");
  }, [status]);

  const isActive = currentStatus === "active";

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled || loading) return;

    const nextStatus: "active" | "inactive" = isActive ? "inactive" : "active";
    const action = nextStatus === "active" ? "activate" : "deactivate";

    // Optimistic UI state
    setCurrentStatus(nextStatus);
    setLoading(true);

    try {
      await apiPost(`${apiBase}/${id}/${action}`);
      toast(
        name
          ? `"${name}" marked as ${nextStatus === "active" ? "Active" : "Inactive"}.`
          : `Status updated to ${nextStatus === "active" ? "Active" : "Inactive"}.`,
        "success"
      );
      onStatusChanged?.(nextStatus);
    } catch (err: any) {
      console.error("Failed to toggle status:", err);
      // Revert optimistic update
      setCurrentStatus(isActive ? "active" : "inactive");
      toast(
        `Failed to update status: ${err?.message || "Server error"}`,
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      onClick={handleToggle}
      title={disabled ? undefined : `Click to toggle: currently ${isActive ? "Active" : "Inactive"}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: loading ? 0.7 : 1,
        userSelect: "none",
        padding: "2px 0",
      }}
    >
      {/* Pill Track */}
      <div
        style={{
          width: "38px",
          height: "20px",
          borderRadius: "10px",
          background: isActive ? "#16a34a" : "#cbd5e1",
          position: "relative",
          transition: "background 0.25s ease, box-shadow 0.25s ease",
          boxShadow: isActive
            ? "0 1px 3px rgba(22, 163, 74, 0.35)"
            : "inset 0 1px 2px rgba(0, 0, 0, 0.1)",
          flexShrink: 0,
        }}
      >
        {/* Sliding Thumb Knob */}
        <div
          style={{
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            background: "#ffffff",
            position: "absolute",
            top: "2px",
            left: isActive ? "20px" : "2px",
            transition: "left 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        />
      </div>

      {/* Label Text with Dot */}
      <span
        style={{
          fontSize: "12.5px",
          fontWeight: 700,
          color: isActive ? "#15803d" : "#64748b",
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          minWidth: "54px",
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: isActive ? "#16a34a" : "#94a3b8",
            display: "inline-block",
          }}
        />
        {isActive ? "Active" : "Inactive"}
      </span>
    </div>
  );
}
