import React, { useState } from "react";

export interface QuickAddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyName?: string;
  onSuccess: (contact: {
    salutation?: string;
    person_name: string;
    designation?: string;
    phone?: string;
    email?: string;
  }) => void;
}

export function QuickAddContactModal({
  isOpen,
  onClose,
  companyName,
  onSuccess,
}: QuickAddContactModalProps) {
  const [salutation, setSalutation] = useState("Mr");
  const [personName, setPersonName] = useState("");
  const [designation, setDesignation] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!personName.trim()) {
      setErrorMsg("Contact person name is required.");
      return;
    }
    setErrorMsg(null);
    onSuccess({
      salutation,
      person_name: personName.trim(),
      designation: designation.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
    });
    // Reset form
    setPersonName("");
    setDesignation("");
    setPhone("");
    setEmail("");
    onClose();
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
      id="quick-add-contact-backdrop"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(2px)",
        zIndex: 2100,
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
        id="quick-add-contact-modal"
        style={{
          width: "100%",
          maxWidth: "480px",
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
              + Add New Contact Person
            </h3>
            {companyName && (
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#64748b" }}>
                Company: <span style={{ fontWeight: 600, color: "#334155" }}>{companyName}</span>
              </p>
            )}
          </div>
          <button
            id="btn-close-quick-contact-modal"
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: "16px 18px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* Person Name with Salutation */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                Contact Person Name <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <div style={{ display: "flex", gap: "6px" }}>
                <select
                  id="quick-contact-salutation"
                  style={{ ...fInputStyle, width: "70px", flexShrink: 0 }}
                  value={salutation}
                  onChange={(e) => setSalutation(e.target.value)}
                >
                  <option value="Mr">Mr</option>
                  <option value="Mrs">Mrs</option>
                  <option value="Ms">Ms</option>
                  <option value="Dr">Dr</option>
                </select>
                <input
                  id="quick-contact-name"
                  data-testid="quick-contact-name"
                  type="text"
                  required
                  style={{ ...fInputStyle, flex: 1 }}
                  placeholder="Full name"
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                />
              </div>
            </div>

            {/* Designation */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                Designation
              </label>
              <input
                id="quick-contact-designation"
                type="text"
                style={fInputStyle}
                placeholder="e.g. Purchase Manager"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
              />
            </div>

            {/* Phone */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                Contact Phone Number
              </label>
              <input
                id="quick-contact-phone"
                type="text"
                style={fInputStyle}
                placeholder="Mobile / Calling number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            {/* Email */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                Email Address
              </label>
              <input
                id="quick-contact-email"
                type="email"
                style={fInputStyle}
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          {/* Footer Actions */}
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
              id="btn-quick-contact-cancel"
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
              id="btn-quick-contact-save"
              data-testid="btn-quick-contact-save"
              type="submit"
              style={{
                height: "34px",
                padding: "0 16px",
                borderRadius: "4px",
                border: "none",
                background: "#0061f2",
                color: "#ffffff",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Save Contact Person
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
