import React, { useState, useEffect } from "react";
import { apiGet } from "@/lib/api";

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
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Chandigarh",
  "Puducherry",
  "Dadra and Nagar Haveli and Daman and Diu",
];

export interface AddCompanyDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (company: any) => void;
}

interface StateItem {
  id: string;
  name: string;
}

interface DistrictItem {
  id: string;
  name: string;
}

interface CityItem {
  id: string;
  name: string;
}

interface SalesPersonItem {
  id: string;
  full_name: string;
  username: string;
}

export function AddCompanyDrawer({ isOpen, onClose, onSuccess }: AddCompanyDrawerProps) {
  const [companyName, setCompanyName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [gstNo, setGstNo] = useState("");
  const [area, setArea] = useState("");
  const [stateId, setStateId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [cityId, setCityId] = useState("");
  const [salutation, setSalutation] = useState("Mr");
  const [fullName, setFullName] = useState("");
  const [designation, setDesignation] = useState("");
  const [contactIndiaMart, setContactIndiaMart] = useState("");
  const [contactDirect, setContactDirect] = useState("");
  const [whatsAppNumber, setWhatsAppNumber] = useState("");
  const [webpage, setWebpage] = useState("");
  const [salesPersonId, setSalesPersonId] = useState("");

  const [states, setStates] = useState<StateItem[]>([]);
  const [districts, setDistricts] = useState<DistrictItem[]>([]);
  const [cities, setCities] = useState<CityItem[]>([]);
  const [salesPersons, setSalesPersons] = useState<SalesPersonItem[]>([]);

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alertError, setAlertError] = useState<string | null>(null);

  // Reset form when drawer opens
  useEffect(() => {
    if (!isOpen) return;
    setCompanyName("");
    setBusinessType("");
    setGstNo("");
    setArea("");
    setStateId("");
    setDistrictId("");
    setCityId("");
    setSalutation("Mr");
    setFullName("");
    setDesignation("");
    setContactIndiaMart("");
    setContactDirect("");
    setWhatsAppNumber("");
    setWebpage("");
    setSalesPersonId("");
    setErrors({});
    setAlertError(null);
  }, [isOpen]);

  // Load States & Sales Persons on open
  useEffect(() => {
    if (!isOpen) return;

    void apiGet<any[]>("/masters/states?page_size=250&status=active")
      .then((res) => {
        if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
          setStates(res.data.map((s: any) => ({ id: String(s.id), name: s.name })));
        } else {
          setStates(DEFAULT_INDIAN_STATES.map((s, idx) => ({ id: String(idx + 1), name: s })));
        }
      })
      .catch(() => {
        setStates(DEFAULT_INDIAN_STATES.map((s, idx) => ({ id: String(idx + 1), name: s })));
      });

    void apiGet<any[]>("/companies/sales-persons")
      .then((res) => {
        if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
          setSalesPersons(res.data);
          const rupesh = res.data.find(
            (sp: any) => sp.full_name?.toLowerCase().includes("rupesh") || sp.username?.toLowerCase().includes("rupesh")
          );
          if (rupesh) {
            setSalesPersonId(String(rupesh.id));
          } else {
            setSalesPersonId(String(res.data[0].id));
          }
        } else {
          setSalesPersons([{ id: "rupesh-malla", full_name: "Rupesh Malla", username: "rupesh" }]);
          setSalesPersonId("rupesh-malla");
        }
      })
      .catch(() => {
        setSalesPersons([{ id: "rupesh-malla", full_name: "Rupesh Malla", username: "rupesh" }]);
        setSalesPersonId("rupesh-malla");
      });
  }, [isOpen]);

  // Load Districts when state changes
  useEffect(() => {
    if (!stateId) {
      setDistricts([]);
      setDistrictId("");
      return;
    }
    void apiGet<any[]>(`/masters/districts/lookup?state_id=${stateId}`)
      .then((res) => {
        setDistricts(res?.data && Array.isArray(res.data) ? res.data.map((d: any) => ({ id: String(d.id), name: d.name })) : []);
      })
      .catch(() => setDistricts([]));
  }, [stateId]);

  // Load Cities when district or state changes
  useEffect(() => {
    if (!stateId) {
      setCities([]);
      setCityId("");
      return;
    }
    const url = districtId
      ? `/masters/cities/lookup?district_id=${districtId}&state_id=${stateId}`
      : `/masters/cities/lookup?state_id=${stateId}`;
    void apiGet<any[]>(url)
      .then((res) => {
        setCities(res?.data && Array.isArray(res.data) ? res.data.map((c: any) => ({ id: String(c.id), name: c.name })) : []);
      })
      .catch(() => setCities([]));
  }, [stateId, districtId]);

  if (!isOpen) return null;

  const handleCopyPrimary = () => {
    const primary = contactDirect.trim() || contactIndiaMart.trim();
    if (primary) {
      setWhatsAppNumber(primary);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!companyName.trim()) {
      newErrors.company_name = "Company Name is required";
    }
    if (!gstNo.trim()) {
      newErrors.tax_id_number = "GST No Of Company is required";
    }
    if (!stateId) {
      newErrors.state_id = "State is required";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setAlertError("Please fill all required fields.");
      return;
    }

    setSaving(true);
    try {
      const selectedStateObj = states.find((s) => s.id === stateId);
      const selectedDistrictObj = districts.find((d) => d.id === districtId);
      const selectedCityObj = cities.find((c) => c.id === cityId);
      const selectedSalesPersonObj = salesPersons.find((sp) => sp.id === salesPersonId);

      const cityName = selectedCityObj?.name || cityId || "";
      const stateName = selectedStateObj?.name || "";
      const districtName = selectedDistrictObj?.name || "";

      const enrichedCompany = {
        id: `proforma-comp-${Date.now()}`,
        company_name: companyName.trim(),
        company_type: businessType || "B2C",
        tax_id_number: gstNo.trim().toUpperCase(),
        area: area.trim(),
        state_id: stateId,
        state: stateName,
        state_name: stateName,
        district_id: districtId,
        district: districtName,
        city_id: cityId,
        city: cityName,
        city_name: cityName,
        contact_salutation: salutation || "Mr",
        contact_full_name: fullName.trim(),
        contact_designation: designation.trim(),
        contact_indiamart_number: contactIndiaMart.trim(),
        contact_calling_number: contactDirect.trim(),
        contact_whatsapp_number: whatsAppNumber.trim(),
        primary_website: webpage.trim(),
        sales_person_id: salesPersonId,
        sales_person_name: selectedSalesPersonObj?.full_name || selectedSalesPersonObj?.username || "",
        is_proforma_only: true,
      };

      onSuccess(enrichedCompany);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: "36px",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    padding: "0 10px",
    fontSize: "13.5px",
    boxSizing: "border-box",
    outline: "none",
    background: "#ffffff",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "12.5px",
    fontWeight: 600,
    color: "#334155",
    marginBottom: "5px",
  };

  return (
    <div
      className="side-drawer-backdrop open"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        zIndex: 1500,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        className="side-drawer-card"
        style={{
          width: "100%",
          maxWidth: "700px",
          height: "100vh",
          background: "#ffffff",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-10px 0 25px rgba(0,0,0,0.15)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#ffffff",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "17.5px", fontWeight: 700, color: "#1e293b" }}>
            Add Company
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "22px",
              color: "#64748b",
              cursor: "pointer",
              lineHeight: 1,
              padding: "4px 8px",
            }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Alert Error */}
        {alertError && (
          <div
            style={{
              margin: "12px 24px 0",
              padding: "10px 14px",
              borderRadius: "4px",
              fontSize: "13px",
              fontWeight: 500,
              background: "#fef2f2",
              color: "#991b1b",
              border: "1px solid #fecaca",
            }}
          >
            {alertError}
          </div>
        )}

        {/* Form Body (2 columns matching screenshot) */}
        <form
          onSubmit={handleSubmit}
          style={{
            padding: "18px 24px 20px",
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            columnGap: "20px",
            rowGap: "14px",
            alignContent: "start",
            boxSizing: "border-box",
            width: "100%",
          }}
        >
          {/* 1. Company Name * (full width) */}
          <div style={{ gridColumn: "span 2", minWidth: 0 }}>
            <label htmlFor="drawer_company_name" style={labelStyle}>
              Company Name <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              type="text"
              id="drawer_company_name"
              placeholder=""
              style={{
                ...inputStyle,
                border: errors.company_name ? "1px solid #ef4444" : "1px solid #cbd5e1",
              }}
              value={companyName}
              onChange={(e) => {
                setCompanyName(e.target.value);
                if (errors.company_name) setErrors((p) => ({ ...p, company_name: "" }));
              }}
            />
            {errors.company_name && (
              <div style={{ color: "#ef4444", fontSize: "11.5px", marginTop: "3px" }}>
                {errors.company_name}
              </div>
            )}
          </div>

          {/* 2. Business Type (left) */}
          <div style={{ minWidth: 0 }}>
            <label htmlFor="drawer_business_type" style={labelStyle}>Business Type</label>
            <select
              id="drawer_business_type"
              style={inputStyle}
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
            >
              <option value="">Select</option>
              <option value="B2B">B2B</option>
              <option value="B2C">B2C</option>
            </select>
          </div>

          {/* 3. GST No Of Company * (right) */}
          <div style={{ minWidth: 0 }}>
            <label htmlFor="drawer_tax_id_number" style={labelStyle}>
              GST No Of Company <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              type="text"
              id="drawer_tax_id_number"
              style={{
                ...inputStyle,
                textTransform: "uppercase",
                border: errors.tax_id_number ? "1px solid #ef4444" : "1px solid #cbd5e1",
              }}
              value={gstNo}
              onChange={(e) => {
                setGstNo(e.target.value.toUpperCase());
                if (errors.tax_id_number) setErrors((p) => ({ ...p, tax_id_number: "" }));
              }}
            />
            {errors.tax_id_number && (
              <div style={{ color: "#ef4444", fontSize: "11.5px", marginTop: "3px" }}>
                {errors.tax_id_number}
              </div>
            )}
          </div>

          {/* 4. Area (left) */}
          <div style={{ minWidth: 0 }}>
            <label htmlFor="drawer_area" style={labelStyle}>Area</label>
            <input
              type="text"
              id="drawer_area"
              style={inputStyle}
              value={area}
              onChange={(e) => setArea(e.target.value)}
            />
          </div>

          {/* 5. State * (right) */}
          <div style={{ minWidth: 0 }}>
            <label htmlFor="drawer_state" style={labelStyle}>
              State <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <select
              id="drawer_state"
              style={{
                ...inputStyle,
                border: errors.state_id ? "1px solid #ef4444" : "1px solid #cbd5e1",
              }}
              value={stateId}
              onChange={(e) => {
                setStateId(e.target.value);
                setDistrictId("");
                setCityId("");
                if (errors.state_id) setErrors((p) => ({ ...p, state_id: "" }));
              }}
            >
              <option value="">Select</option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {errors.state_id && (
              <div style={{ color: "#ef4444", fontSize: "11.5px", marginTop: "3px" }}>
                {errors.state_id}
              </div>
            )}
          </div>

          {/* 6. District (left) */}
          <div style={{ minWidth: 0 }}>
            <label htmlFor="drawer_district" style={labelStyle}>District</label>
            <select
              id="drawer_district"
              style={inputStyle}
              value={districtId}
              onChange={(e) => {
                setDistrictId(e.target.value);
                setCityId("");
              }}
              disabled={!stateId || districts.length === 0}
            >
              <option value="">Select</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          {/* 7. City (right) */}
          <div style={{ minWidth: 0 }}>
            <label htmlFor="drawer_city" style={labelStyle}>City</label>
            <select
              id="drawer_city"
              style={inputStyle}
              value={cityId}
              onChange={(e) => setCityId(e.target.value)}
              disabled={!stateId}
            >
              <option value="">Select</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* 8. Full Name (IndiaMart Or Other) (left) */}
          <div style={{ minWidth: 0 }}>
            <label htmlFor="drawer_full_name" style={labelStyle}>
              Full Name <em>(IndiaMart Or Other)</em>
            </label>
            <div style={{ display: "flex", gap: "6px", width: "100%" }}>
              <select
                style={{
                  width: "68px",
                  flexShrink: 0,
                  height: "36px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  padding: "0 6px",
                  fontSize: "13.5px",
                  background: "#fff",
                  outline: "none",
                }}
                value={salutation}
                onChange={(e) => setSalutation(e.target.value)}
              >
                <option value="Mr">Mr</option>
                <option value="Mrs">Mrs</option>
                <option value="Ms">Ms</option>
                <option value="Dr">Dr</option>
              </select>
              <input
                type="text"
                id="drawer_full_name"
                style={{ ...inputStyle, flex: 1 }}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
          </div>

          {/* 9. Designation (right) */}
          <div style={{ minWidth: 0 }}>
            <label htmlFor="drawer_designation" style={labelStyle}>Designation</label>
            <input
              type="text"
              id="drawer_designation"
              style={inputStyle}
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
            />
          </div>

          {/* 10. Contact Number(IndiaMart) (left) */}
          <div style={{ minWidth: 0 }}>
            <label htmlFor="drawer_indiamart_number" style={labelStyle}>Contact Number(IndiaMart)</label>
            <input
              type="text"
              id="drawer_indiamart_number"
              style={inputStyle}
              value={contactIndiaMart}
              onChange={(e) => setContactIndiaMart(e.target.value)}
            />
          </div>

          {/* 11. Contact Number(Direct) (right) */}
          <div style={{ minWidth: 0 }}>
            <label htmlFor="drawer_direct_number" style={labelStyle}>Contact Number(Direct)</label>
            <input
              type="text"
              id="drawer_direct_number"
              style={inputStyle}
              value={contactDirect}
              onChange={(e) => setContactDirect(e.target.value)}
            />
          </div>

          {/* 12. WhatsApp Number (left) with Copy Primary */}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
              <label htmlFor="drawer_whatsapp_number" style={{ fontSize: "12.5px", fontWeight: 600, color: "#334155", margin: 0 }}>
                WhatsApp Number
              </label>
              <button
                type="button"
                onClick={handleCopyPrimary}
                style={{
                  background: "none",
                  border: "none",
                  color: "#0061f2",
                  fontSize: "12px",
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
              type="text"
              id="drawer_whatsapp_number"
              style={inputStyle}
              value={whatsAppNumber}
              onChange={(e) => setWhatsAppNumber(e.target.value)}
            />
          </div>

          {/* 13. Webpage (IndiaMart Or Other) (right) */}
          <div style={{ minWidth: 0 }}>
            <label htmlFor="drawer_webpage" style={labelStyle}>
              Webpage <em>(IndiaMart Or Other)</em>
            </label>
            <input
              type="text"
              id="drawer_webpage"
              style={inputStyle}
              value={webpage}
              onChange={(e) => setWebpage(e.target.value)}
            />
          </div>

          {/* 14. Sales Person (left) */}
          <div style={{ minWidth: 0 }}>
            <label htmlFor="drawer_sales_person" style={labelStyle}>Sales Person</label>
            <select
              id="drawer_sales_person"
              style={inputStyle}
              value={salesPersonId}
              onChange={(e) => setSalesPersonId(e.target.value)}
            >
              {salesPersons.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.full_name || sp.username}
                </option>
              ))}
            </select>
          </div>
        </form>

        {/* Sticky Action Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid #e2e8f0",
            background: "#ffffff",
            position: "sticky",
            bottom: 0,
            zIndex: 10,
          }}
        >
          <button
            type="button"
            data-testid="btn-drawer-submit-company"
            disabled={saving}
            onClick={() => handleSubmit()}
            style={{
              width: "100%",
              background: "#0061f2",
              color: "#ffffff",
              border: "none",
              borderRadius: "4px",
              padding: "11px 16px",
              fontWeight: 600,
              fontSize: "14px",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving..." : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
