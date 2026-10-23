import React, { useState, useEffect } from "react";
import { apiGet } from "@/lib/api";
import { DEFAULT_INDIAN_STATES } from "./AddCompanyDrawer";

export interface EditAddressData {
  company_name: string;
  tax_id_number: string;
  address: string;
  state: string;
  city: string;
  pincode: string;
  contact_person: string;
  contact_number: string;
  formatted_address: string;
}

export interface EditAddressDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  addressType: "Billing" | "Shipping";
  initialData?: Partial<EditAddressData>;
  onSave: (data: EditAddressData) => void;
}

interface StateItem {
  id: string;
  name: string;
}

interface CityItem {
  id: string;
  name: string;
}

export function EditAddressDrawer({
  isOpen,
  onClose,
  addressType,
  initialData,
  onSave,
}: EditAddressDrawerProps) {
  const [companyName, setCompanyName] = useState("");
  const [gstNo, setGstNo] = useState("");
  const [address, setAddress] = useState("");
  const [stateName, setStateName] = useState("");
  const [cityName, setCityName] = useState("");
  const [pincode, setPincode] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [contactNumber, setContactNumber] = useState("");

  const [states, setStates] = useState<StateItem[]>([]);
  const [cities, setCities] = useState<CityItem[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alertError, setAlertError] = useState<string | null>(null);

  // Sync initialData whenever drawer opens
  useEffect(() => {
    if (!isOpen) return;

    const rawAddress = initialData?.address || "";
    // If pincode is not provided directly, try to extract a 6-digit pin from address
    let detectedPin = initialData?.pincode || "";
    if (!detectedPin && rawAddress) {
      const pinMatch = rawAddress.match(/\b\d{6}\b/);
      if (pinMatch) detectedPin = pinMatch[0];
    }

    setCompanyName(initialData?.company_name || "");
    setGstNo(initialData?.tax_id_number && initialData.tax_id_number !== "-" ? initialData.tax_id_number : "");
    setAddress(rawAddress);
    setStateName(initialData?.state || "");
    setCityName(initialData?.city || "");
    setPincode(detectedPin);
    setContactPerson(initialData?.contact_person || "-");
    setContactNumber(initialData?.contact_number || "");
    setErrors({});
    setAlertError(null);
  }, [isOpen, initialData]);

  // Load States on open
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
  }, [isOpen]);

  // Load Cities when stateName or states change
  useEffect(() => {
    if (!stateName) {
      setCities([]);
      return;
    }

    const stateObj = states.find((s) => s.name.toLowerCase() === stateName.toLowerCase());
    const stateParam = stateObj ? `state_id=${stateObj.id}` : "";
    const url = stateParam ? `/masters/cities/lookup?${stateParam}` : `/masters/cities/lookup`;

    void apiGet<any[]>(url)
      .then((res) => {
        if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
          const list = res.data.map((c: any) => ({ id: String(c.id), name: c.name }));
          // Ensure current cityName is included in the options
          if (cityName && !list.some((c) => c.name.toLowerCase() === cityName.toLowerCase())) {
            list.unshift({ id: "current-city", name: cityName });
          }
          setCities(list);
        } else {
          setCities(cityName ? [{ id: "custom-city", name: cityName }] : []);
        }
      })
      .catch(() => {
        setCities(cityName ? [{ id: "custom-city", name: cityName }] : []);
      });
  }, [stateName, states]);

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};

    if (!companyName.trim()) newErrors.company_name = "Company name is required";
    if (!gstNo.trim()) newErrors.tax_id_number = "GST number is required";
    if (!address.trim()) newErrors.address = "Address is required";
    if (!stateName.trim()) newErrors.state = "State is required";
    if (!cityName.trim()) newErrors.city = "City is required";
    if (!pincode.trim()) newErrors.pincode = "Pin code is required";
    if (!contactNumber.trim()) newErrors.contact_number = "Contact number is required";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setAlertError("Please fill all required fields.");
      return;
    }

    const street = address.trim();
    const c = cityName.trim();
    const s = stateName.trim();
    const pin = pincode.trim();

    // Compose formatted address
    let formatted = street;
    if (c && !formatted.toLowerCase().includes(c.toLowerCase())) {
      formatted += `, ${c}`;
    }
    if (s && !formatted.toLowerCase().includes(s.toLowerCase())) {
      formatted += `, ${s}`;
    }
    if (pin && !formatted.includes(pin)) {
      formatted += ` - ${pin}`;
    }

    onSave({
      company_name: companyName.trim(),
      tax_id_number: gstNo.trim().toUpperCase(),
      address: street,
      state: s,
      city: c,
      pincode: pin,
      contact_person: contactPerson.trim() || "-",
      contact_number: contactNumber.trim(),
      formatted_address: formatted,
    });
    onClose();
  };

  if (!isOpen) return null;

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
    color: "#0f172a",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
    appearance: "none",
    backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 10px center",
    backgroundSize: "14px",
    paddingRight: "30px",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "12px",
    fontWeight: 600,
    color: "#334155",
    marginBottom: "5px",
  };

  return (
    <div
      className="side-drawer-backdrop open"
      data-testid="edit-address-drawer-backdrop"
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
        data-testid="edit-address-drawer-card"
        style={{
          width: "100%",
          maxWidth: "480px",
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
            padding: "16px 20px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#ffffff",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#1e293b" }}>
            Edit Address
          </h2>
          <button
            type="button"
            data-testid="btn-close-edit-address-drawer"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#64748b",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          style={{
            padding: "20px",
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          {alertError && (
            <div
              style={{
                background: "#fef2f2",
                color: "#b91c1c",
                padding: "8px 12px",
                borderRadius: "4px",
                fontSize: "12.5px",
                border: "1px solid #fecaca",
              }}
            >
              {alertError}
            </div>
          )}

          {/* Company Name */}
          <div>
            <label style={labelStyle}>
              Company Name <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              type="text"
              data-testid="input-edit-company-name"
              value={companyName}
              onChange={(e) => {
                setCompanyName(e.target.value);
                if (errors.company_name) setErrors((prev) => ({ ...prev, company_name: "" }));
              }}
              style={{
                ...inputStyle,
                borderColor: errors.company_name ? "#ef4444" : "#cbd5e1",
              }}
            />
            {errors.company_name && (
              <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                {errors.company_name}
              </span>
            )}
          </div>

          {/* GST No */}
          <div>
            <label style={labelStyle}>
              GST No <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              type="text"
              data-testid="input-edit-gst-no"
              value={gstNo}
              onChange={(e) => {
                setGstNo(e.target.value.toUpperCase());
                if (errors.tax_id_number) setErrors((prev) => ({ ...prev, tax_id_number: "" }));
              }}
              style={{
                ...inputStyle,
                borderColor: errors.tax_id_number ? "#ef4444" : "#cbd5e1",
              }}
            />
            {errors.tax_id_number && (
              <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                {errors.tax_id_number}
              </span>
            )}
          </div>

          {/* Address */}
          <div>
            <label style={labelStyle}>
              Address <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              type="text"
              data-testid="input-edit-address"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                if (errors.address) setErrors((prev) => ({ ...prev, address: "" }));
              }}
              style={{
                ...inputStyle,
                borderColor: errors.address ? "#ef4444" : "#cbd5e1",
              }}
            />
            {errors.address && (
              <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                {errors.address}
              </span>
            )}
          </div>

          {/* State & City (2 columns) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <label style={labelStyle}>
                State <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <select
                data-testid="select-edit-state"
                value={stateName}
                onChange={(e) => {
                  setStateName(e.target.value);
                  setCityName("");
                  if (errors.state) setErrors((prev) => ({ ...prev, state: "" }));
                }}
                style={{
                  ...selectStyle,
                  borderColor: errors.state ? "#ef4444" : "#cbd5e1",
                }}
              >
                <option value="">Select State</option>
                {states.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
              {errors.state && (
                <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                  {errors.state}
                </span>
              )}
            </div>

            <div>
              <label style={labelStyle}>
                City <span style={{ color: "#ef4444" }}>*</span>
              </label>
              {cities.length > 0 ? (
                <select
                  data-testid="select-edit-city"
                  value={cityName}
                  onChange={(e) => {
                    setCityName(e.target.value);
                    if (errors.city) setErrors((prev) => ({ ...prev, city: "" }));
                  }}
                  style={{
                    ...selectStyle,
                    borderColor: errors.city ? "#ef4444" : "#cbd5e1",
                  }}
                >
                  <option value="">Select City</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  data-testid="input-edit-city"
                  placeholder="Enter City"
                  value={cityName}
                  onChange={(e) => {
                    setCityName(e.target.value);
                    if (errors.city) setErrors((prev) => ({ ...prev, city: "" }));
                  }}
                  style={{
                    ...inputStyle,
                    borderColor: errors.city ? "#ef4444" : "#cbd5e1",
                  }}
                />
              )}
              {errors.city && (
                <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                  {errors.city}
                </span>
              )}
            </div>
          </div>

          {/* Pin Code (Left half) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <label style={labelStyle}>
                Pin Code <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="text"
                data-testid="input-edit-pincode"
                value={pincode}
                onChange={(e) => {
                  setPincode(e.target.value);
                  if (errors.pincode) setErrors((prev) => ({ ...prev, pincode: "" }));
                }}
                style={{
                  ...inputStyle,
                  borderColor: errors.pincode ? "#ef4444" : "#cbd5e1",
                }}
              />
              {errors.pincode && (
                <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                  {errors.pincode}
                </span>
              )}
            </div>
            <div />
          </div>

          {/* Contact Person & Contact Number (2 columns) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            {/* Contact Person */}
            <div>
              <label style={labelStyle}>
                Contact Person <em>({addressType})</em>
              </label>
              <div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <input
                  type="text"
                  data-testid="input-edit-contact-person"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  style={{
                    ...inputStyle,
                    paddingRight: "36px",
                  }}
                />
                {contactPerson && contactPerson !== "-" && (
                  <button
                    type="button"
                    title="Clear Contact Person"
                    aria-label="Clear Contact Person"
                    data-testid="btn-clear-contact-person"
                    onClick={() => setContactPerson("-")}
                    style={{
                      position: "absolute",
                      right: "6px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      padding: "4px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#475569",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Contact Number (Direct) *   Call */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>
                  Contact Number <em>(Direct)</em> <span style={{ color: "#ef4444" }}>*</span>
                </label>
                {contactNumber && (
                  <a
                    href={`tel:${contactNumber}`}
                    style={{
                      fontSize: "12px",
                      color: "#0061f2",
                      textDecoration: "none",
                      fontWeight: 500,
                    }}
                  >
                    Call
                  </a>
                )}
              </div>
              <input
                type="text"
                data-testid="input-edit-contact-number"
                value={contactNumber}
                onChange={(e) => {
                  setContactNumber(e.target.value);
                  if (errors.contact_number) setErrors((prev) => ({ ...prev, contact_number: "" }));
                }}
                style={{
                  ...inputStyle,
                  borderColor: errors.contact_number ? "#ef4444" : "#cbd5e1",
                }}
              />
              {errors.contact_number && (
                <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                  {errors.contact_number}
                </span>
              )}
            </div>
          </div>
        </form>

        {/* Sticky Action Footer */}
        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid #e2e8f0",
            background: "#ffffff",
            position: "sticky",
            bottom: 0,
            zIndex: 10,
          }}
        >
          <button
            type="button"
            data-testid="btn-submit-edit-address"
            onClick={handleSubmit}
            style={{
              width: "100%",
              background: "#0061f2",
              color: "#ffffff",
              border: "none",
              borderRadius: "4px",
              padding: "11px 16px",
              fontWeight: 600,
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
