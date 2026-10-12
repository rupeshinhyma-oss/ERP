import React, { useState, useEffect } from "react";
import { apiPost, apiPut } from "@/lib/api";
import type { Lead } from "@/types";

export interface AllotLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead | null;
  onSuccess: (leadId: string, allottedTo: string) => void;
  availableAssignees?: string[];
}

const DEFAULT_SALESPERSONS = [
  "Rupesh Malla",
  "Dhairya Shah",
  "Devendra Marade",
  "Vikram Rathod",
  "Pooja Vani",
  "Sales Team A",
  "Sales Team B",
  "Admin User",
];

export function AllotLeadModal({
  isOpen,
  onClose,
  lead,
  onSuccess,
  availableAssignees = DEFAULT_SALESPERSONS,
}: AllotLeadModalProps) {
  const assignees = availableAssignees && availableAssignees.length > 0 ? availableAssignees : DEFAULT_SALESPERSONS;
  const [selectedPerson, setSelectedPerson] = useState<string>("");
  const [customPerson, setCustomPerson] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (lead) {
      const current = lead.allotted_to || "";
      if (assignees.includes(current)) {
        setSelectedPerson(current);
        setCustomPerson("");
      } else if (current) {
        setSelectedPerson("OTHER");
        setCustomPerson(current);
      } else {
        setSelectedPerson(assignees[0] || "");
        setCustomPerson("");
      }
      setErrorMsg(null);
    }
  }, [lead, assignees]);

  if (!isOpen || !lead) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalAssignee = selectedPerson === "OTHER" ? customPerson.trim() : selectedPerson.trim();
    if (!finalAssignee) {
      setErrorMsg("Please select or enter a salesperson to allot this lead.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      try {
        await apiPost(`/leads/${lead.id}/allot`, { allotted_to: finalAssignee });
      } catch {
        // Fallback to PUT
        await apiPut(`/leads/${lead.id}`, { allotted_to: finalAssignee });
      }
      onSuccess(lead.id, finalAssignee);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to allot lead. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const fInputStyle: React.CSSProperties = {
    width: "100%",
    height: "36px",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    padding: "0 10px",
    fontSize: "13px",
    boxSizing: "border-box",
    outline: "none",
    background: "#ffffff",
  };

  return (
    <div
      id="allot-lead-backdrop"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(2px)",
        zIndex: 2050,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="allot-lead-modal"
        style={{
          width: "100%",
          maxWidth: "460px",
          background: "#ffffff",
          borderRadius: "8px",
          boxShadow: "0 20px 40px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#f8fafc",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#1e293b" }}>
              👤 Lead Allotment
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#64748b" }}>
              Assign sales representative for lead
            </p>
          </div>
          <button
            id="btn-close-allot-lead-modal"
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "18px",
              color: "#94a3b8",
              cursor: "pointer",
              padding: "4px",
              lineHeight: 1,
            }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Error */}
        {errorMsg && (
          <div
            style={{
              margin: "12px 18px 0",
              padding: "8px 12px",
              borderRadius: "4px",
              fontSize: "12.5px",
              background: "#fef2f2",
              color: "#dc2626",
              border: "1px solid #fecaca",
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* Body */}
        <form onSubmit={handleSave} style={{ padding: "16px 18px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* Company Info Box */}
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                padding: "10px 12px",
                fontSize: "12.5px",
              }}
            >
              <div style={{ color: "#64748b", marginBottom: "2px" }}>Company:</div>
              <div style={{ fontWeight: 700, color: "#1e293b", fontSize: "14px" }}>
                {lead.company_name}
              </div>
              <div style={{ marginTop: "4px", color: "#64748b" }}>
                Current Assignee:{" "}
                <span style={{ fontWeight: 600, color: lead.allotted_to ? "#0f172a" : "#94a3b8" }}>
                  {lead.allotted_to || "Unassigned"}
                </span>
              </div>
            </div>

            {/* Salesperson Selection */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                Allot To Salesperson <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <select
                id="allot-lead-select"
                data-testid="allot-lead-select"
                style={fInputStyle}
                value={selectedPerson}
                onChange={(e) => setSelectedPerson(e.target.value)}
              >
                {assignees.map((person) => (
                  <option key={person} value={person}>
                    {person}
                  </option>
                ))}
                <option value="OTHER">Other / Custom Name</option>
              </select>
            </div>

            {selectedPerson === "OTHER" && (
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                  Enter Salesperson Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  id="allot-lead-custom-input"
                  type="text"
                  required
                  style={fInputStyle}
                  placeholder="Enter employee / salesperson name"
                  value={customPerson}
                  onChange={(e) => setCustomPerson(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              marginTop: "16px",
              paddingTop: "12px",
              borderTop: "1px solid #e2e8f0",
              display: "flex",
              justifyContent: "flex-end",
              gap: "8px",
            }}
          >
            <button
              id="btn-allot-lead-cancel"
              type="button"
              onClick={onClose}
              style={{
                height: "34px",
                padding: "0 14px",
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#475569",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              id="btn-allot-lead-confirm"
              data-testid="btn-allot-lead-confirm"
              type="submit"
              disabled={saving}
              style={{
                height: "34px",
                padding: "0 16px",
                borderRadius: "4px",
                border: "none",
                background: "#16a34a",
                color: "#ffffff",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Allotting..." : "Confirm Allotment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
