import React, { useState, useEffect } from "react";
import { apiGet, apiPost } from "@/lib/api";

export const DEFAULT_INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

export const GST_STATE_CODE_MAP: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

export interface CompanyForm1ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (company: {
    company_name: string;
    company_type?: string;
    contact_person?: string;
    contact_phone?: string;
    designation?: string;
    city?: string;
    state?: string;
    area?: string;
    district?: string;
  }) => void;
}

export function CompanyForm1Modal({ isOpen, onClose, onSuccess }: CompanyForm1ModalProps) {
  const [form, setForm] = useState({
    company_name: "",
    company_type: "B2B",
    tax_id_number: "",
    area: "",
    state_id: "",
    state_name: "",
    district: "",
    city: "",
    contact_salutation: "Mr",
    contact_full_name: "",
    contact_designation: "",
    contact_calling_number: "",
    contact_whatsapp_number: "",
    primary_website: "",
  });

  const [statesList, setStatesList] = useState<Array<{ id: string; name: string }>>([]);
  const [districtsList, setDistrictsList] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const res = await apiGet<any[]>("/masters/states?page_size=100");
        if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
          setStatesList(res.data.map((s: any) => ({ id: String(s.id), name: s.name })));
        } else {
          setStatesList(DEFAULT_INDIAN_STATES.map((s, idx) => ({ id: String(idx + 1), name: s })));
        }
      } catch {
        setStatesList(DEFAULT_INDIAN_STATES.map((s, idx) => ({ id: String(idx + 1), name: s })));
      }
    })();
  }, [isOpen]);

  useEffect(() => {
    if (!form.state_id) {
      setDistrictsList([]);
      return;
    }
    (async () => {
      try {
        const res = await apiGet<any[]>(`/masters/districts?state_id=${form.state_id}&page_size=100`);
        if (res?.data && Array.isArray(res.data)) {
          setDistrictsList(res.data.map((d: any) => ({ id: String(d.id), name: d.name })));
        } else {
          setDistrictsList([]);
        }
      } catch {
        setDistrictsList([]);
      }
    })();
  }, [form.state_id]);

  if (!isOpen) return null;

  const handleFetchGstData = () => {
    const raw = form.tax_id_number.trim().toUpperCase();
    if (!raw) {
      setErrorMsg("Please enter GST No to fetch state details.");
      return;
    }
    const code = raw.slice(0, 2);
    const matchedStateName = GST_STATE_CODE_MAP[code];
    if (matchedStateName) {
      const match = statesList.find(
        (s) =>
          s.name.toLowerCase() === matchedStateName.toLowerCase() ||
          s.name.toLowerCase().includes(matchedStateName.toLowerCase()) ||
          matchedStateName.toLowerCase().includes(s.name.toLowerCase())
      );
      if (match) {
        setForm((prev) => ({ ...prev, state_id: match.id, state_name: match.name, tax_id_number: raw }));
        setInfoMsg(`State auto-detected from GST: ${match.name}`);
        setErrorMsg(null);
      } else {
        setForm((prev) => ({ ...prev, state_name: matchedStateName, tax_id_number: raw }));
        setInfoMsg(`State auto-detected from GST: ${matchedStateName}`);
        setErrorMsg(null);
      }
    } else {
      setInfoMsg("GST recorded. Please select State manually.");
    }
  };

  const handleCopyPrimary = () => {
    if (form.contact_calling_number.trim()) {
      setForm((prev) => ({ ...prev, contact_whatsapp_number: prev.contact_calling_number.trim() }));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company_name.trim()) {
      setErrorMsg("Company Name is required.");
      return;
    }
    if (!form.tax_id_number.trim()) {
      setErrorMsg("GST No Of Company is required.");
      return;
    }
    if (!form.state_id && !form.state_name) {
      setErrorMsg("State is required.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);

    const stateObj = statesList.find((s) => s.id === form.state_id);
    const resolvedStateName = stateObj?.name || form.state_name;

    const payload = {
      company_name: form.company_name.trim(),
      company_type: form.company_type || null,
      tax_id_number: form.tax_id_number.trim().toUpperCase() || null,
      area: form.area.trim() || null,
      state_id: form.state_id || null,
      state: resolvedStateName || null,
      district: form.district.trim() || null,
      city: form.city.trim() || null,
      contact_salutation: form.contact_salutation || "Mr",
      contact_full_name: form.contact_full_name.trim() || null,
      contact_designation: form.contact_designation.trim() || null,
      contact_calling_number: form.contact_calling_number.trim() || null,
      contact_whatsapp_number: form.contact_whatsapp_number.trim() || null,
      primary_website: form.primary_website.trim() || null,
    };

    try {
      const res = await apiPost<any>("/companies", payload);
      const saved = res?.data || payload;
      onSuccess({
        company_name: saved.company_name || form.company_name,
        company_type: saved.company_type || form.company_type,
        contact_person: saved.contact_full_name || form.contact_full_name,
        contact_phone: saved.contact_calling_number || form.contact_calling_number,
        designation: saved.contact_designation || form.contact_designation,
        city: saved.city || form.city,
        state: saved.state || resolvedStateName,
        area: saved.area || form.area,
        district: saved.district || form.district,
      });
      onClose();
    } catch {
      // Local fallback for offline/testing
      onSuccess({
        company_name: form.company_name,
        company_type: form.company_type,
        contact_person: form.contact_full_name,
        contact_phone: form.contact_calling_number,
        designation: form.contact_designation,
        city: form.city,
        state: resolvedStateName,
        area: form.area,
        district: form.district,
      });
      onClose();
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
      id="company-form1-backdrop"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(2px)",
        zIndex: 2000,
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
        id="company-form1-modal"
        style={{
          width: "100%",
          maxWidth: "680px",
          maxHeight: "92vh",
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
            padding: "16px 20px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#f8fafc",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#1e293b" }}>
              Add Company (Form 1 - Prospect Master)
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#64748b" }}>
              Add new company on the fly to auto-populate form
            </p>
          </div>
          <button
            id="btn-close-form1-modal"
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

        {/* Alerts */}
        {errorMsg && (
          <div
            style={{
              margin: "12px 20px 0",
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
        {infoMsg && (
          <div
            style={{
              margin: "12px 20px 0",
              padding: "8px 12px",
              borderRadius: "4px",
              fontSize: "12.5px",
              background: "#eff6ff",
              color: "#1d4ed8",
              border: "1px solid #bfdbfe",
            }}
          >
            {infoMsg}
          </div>
        )}

        {/* Form Body */}
        <form
          id="company-form1"
          onSubmit={handleSave}
          style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}
        >
          <div
            style={{
              padding: "16px 20px",
              flex: 1,
              overflowY: "auto",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "14px",
            }}
          >
            {/* 1. Company Name * (full width) */}
            <div style={{ gridColumn: "span 2" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                Company Name <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                id="form1_company_name"
                data-testid="form1-company-name"
                type="text"
                required
                style={fInputStyle}
                placeholder="Enter company name"
                value={form.company_name}
                onChange={(e) => setForm((p) => ({ ...p, company_name: e.target.value }))}
              />
            </div>

            {/* 2. Business Type */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                Business Type
              </label>
              <select
                id="form1_company_type"
                style={fInputStyle}
                value={form.company_type}
                onChange={(e) => setForm((p) => ({ ...p, company_type: e.target.value }))}
              >
                <option value="B2B">B2B</option>
                <option value="B2C">B2C</option>
                <option value="Manufacturer">Manufacturer</option>
                <option value="Trader">Trader</option>
                <option value="OEM">OEM</option>
                <option value="Distributor">Distributor</option>
              </select>
            </div>

            {/* 3. GST No Of Company * */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                GST No Of Company <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  id="form1_tax_id_number"
                  data-testid="form1-tax-id"
                  type="text"
                  required
                  placeholder="24ABCDE1234F1Z5"
                  style={{ ...fInputStyle, flex: 1, textTransform: "uppercase" }}
                  value={form.tax_id_number}
                  onChange={(e) => setForm((p) => ({ ...p, tax_id_number: e.target.value.toUpperCase() }))}
                />
                <button
                  id="btn-form1-fetch-gst"
                  data-testid="btn-form1-fetch-gst"
                  type="button"
                  onClick={handleFetchGstData}
                  style={{
                    background: "#0061f2",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "4px",
                    padding: "0 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    height: "36px",
                  }}
                >
                  Fetch Data
                </button>
              </div>
            </div>

            {/* 4. Area */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                Area
              </label>
              <input
                id="form1_area"
                type="text"
                style={fInputStyle}
                placeholder="Industrial Area / GIDC"
                value={form.area}
                onChange={(e) => setForm((p) => ({ ...p, area: e.target.value }))}
              />
            </div>

            {/* 5. State * */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                State <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <select
                id="form1_state"
                data-testid="form1-state"
                required
                style={fInputStyle}
                value={form.state_id || form.state_name}
                onChange={(e) => {
                  const val = e.target.value;
                  const matched = statesList.find((s) => s.id === val || s.name === val);
                  if (matched) {
                    setForm((p) => ({ ...p, state_id: matched.id, state_name: matched.name, district: "" }));
                  } else {
                    setForm((p) => ({ ...p, state_id: "", state_name: val, district: "" }));
                  }
                }}
              >
                <option value="">Select State</option>
                {statesList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 6. District */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                District
              </label>
              {districtsList.length > 0 ? (
                <select
                  id="form1_district"
                  style={fInputStyle}
                  value={form.district}
                  onChange={(e) => setForm((p) => ({ ...p, district: e.target.value }))}
                >
                  <option value="">Select District</option>
                  {districtsList.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="form1_district"
                  type="text"
                  style={fInputStyle}
                  placeholder="Enter district"
                  value={form.district}
                  onChange={(e) => setForm((p) => ({ ...p, district: e.target.value }))}
                />
              )}
            </div>

            {/* 7. City */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                City
              </label>
              <input
                id="form1_city"
                type="text"
                style={fInputStyle}
                placeholder="Enter city"
                value={form.city}
                onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
              />
            </div>

            {/* 8. Full Name & Salutation */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                Contact Person Full Name
              </label>
              <div style={{ display: "flex", gap: "6px" }}>
                <select
                  style={{ ...fInputStyle, width: "70px", flexShrink: 0 }}
                  value={form.contact_salutation}
                  onChange={(e) => setForm((p) => ({ ...p, contact_salutation: e.target.value }))}
                >
                  <option value="Mr">Mr</option>
                  <option value="Mrs">Mrs</option>
                  <option value="Ms">Ms</option>
                  <option value="Dr">Dr</option>
                </select>
                <input
                  id="form1_contact_name"
                  type="text"
                  style={{ ...fInputStyle, flex: 1 }}
                  placeholder="Full name"
                  value={form.contact_full_name}
                  onChange={(e) => setForm((p) => ({ ...p, contact_full_name: e.target.value }))}
                />
              </div>
            </div>

            {/* 9. Designation */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                Designation
              </label>
              <input
                id="form1_contact_designation"
                type="text"
                style={fInputStyle}
                placeholder="e.g. Director / Purchase Head"
                value={form.contact_designation}
                onChange={(e) => setForm((p) => ({ ...p, contact_designation: e.target.value }))}
              />
            </div>

            {/* 10. Calling Number */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                Contact Calling Number
              </label>
              <input
                id="form1_contact_calling_number"
                type="text"
                style={fInputStyle}
                placeholder="Mobile / Office number"
                value={form.contact_calling_number}
                onChange={(e) => setForm((p) => ({ ...p, contact_calling_number: e.target.value }))}
              />
            </div>

            {/* 11. WhatsApp Number */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155", margin: 0 }}>
                  WhatsApp Number
                </label>
                <button
                  id="btn-form1-copy-primary"
                  type="button"
                  onClick={handleCopyPrimary}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#0061f2",
                    fontSize: "11.5px",
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline",
                  }}
                >
                  Copy Primary
                </button>
              </div>
              <input
                id="form1_contact_whatsapp_number"
                type="text"
                style={fInputStyle}
                placeholder="WhatsApp number"
                value={form.contact_whatsapp_number}
                onChange={(e) => setForm((p) => ({ ...p, contact_whatsapp_number: e.target.value }))}
              />
            </div>

            {/* 12. Primary Website (full width) */}
            <div style={{ gridColumn: "span 2" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                Primary Website / Catalog
              </label>
              <input
                id="form1_primary_website"
                type="text"
                style={fInputStyle}
                placeholder="https://example.com"
                value={form.primary_website}
                onChange={(e) => setForm((p) => ({ ...p, primary_website: e.target.value }))}
              />
            </div>
          </div>

          {/* Sticky Action Footer */}
          <div
            style={{
              padding: "14px 20px",
              borderTop: "1px solid #e2e8f0",
              background: "#f8fafc",
              display: "flex",
              justifyContent: "flex-end",
              gap: "10px",
            }}
          >
            <button
              id="btn-form1-cancel"
              type="button"
              onClick={onClose}
              style={{
                height: "36px",
                padding: "0 16px",
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#475569",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              id="btn-form1-save-company"
              data-testid="form1-save"
              type="submit"
              disabled={saving}
              style={{
                height: "36px",
                padding: "0 20px",
                borderRadius: "4px",
                border: "none",
                background: "#0061f2",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving..." : "Save Company"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
