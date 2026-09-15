/**
 * Billing Company Master Module.
 * Faithfully replicates legacy screens:
 * - erp.inhymasolutions.com/company/list (Sr. No., Name, Email, Status, Register On, Action)
 * - erp.inhymasolutions.com/company/addedit (Company Detail, Name, Email, Mobile, Logo, Signature, Address, City, Zip, GST, PAN, SO Prefix, PI Prefix, Select Bank, Terms, Submit)
 */

import { useRef, type ChangeEvent } from "react";
import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge } from "@/components/ui";
import { SelectField, StatusSelectField, TextAreaField, TextField } from "@/components/fields";
import { useLookup } from "@/lib/lookups";
import type { BillingCompany, City } from "@/types";

const EMPTY: FormState = {
  name: "",
  email: "",
  mobile: "",
  logo_url: "",
  signature_url: "",
  address: "",
  city: "",
  zip_code: "",
  gst_no: "",
  pan_no: "",
  so_prefix: "",
  pi_prefix: "",
  bank_name: "",
  terms_and_conditions: "",
  status: "active",
};

const POPULAR_BANKS = [
  "HDFC Bank",
  "ICICI Bank",
  "State Bank of India",
  "Axis Bank",
  "Kotak Mahindra Bank",
  "Punjab National Bank",
  "Bank of Baroda",
  "IndusInd Bank",
  "Yes Bank",
  "Union Bank of India",
  "Canara Bank",
  "Standard Chartered Bank",
  "Citibank",
];

function formatRegisterOn(dateStr?: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    const strHours = String(hours).padStart(2, "0");
    return `${day}-${month}-${year} ${strHours}:${minutes} ${ampm}`;
  } catch {
    return dateStr;
  }
}

export function BillingCompaniesPage() {
  const cities = useLookup<City>("/masters/cities", 300);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const sigInputRef = useRef<HTMLInputElement | null>(null);

  const handleImageUpload = (
    e: ChangeEvent<HTMLInputElement>,
    fieldKey: "logo_url" | "signature_url",
    setField: (id: string, value: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("Selected image exceeds 5MB size limit.");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = (ev.target?.result as string) || "";
      setField(fieldKey, base64);
    };
    reader.readAsDataURL(file);
  };

  return (
    <MasterPage<BillingCompany>
      activeKey="masters-billing-company"
      apiBase="/masters/billing-companies"
      permissionPrefix="billingcompany"
      exportPermission="billingcompany.export"
      bulkActionPermission="billingcompany.bulk_action"
      liveModule="billing_companies"
      entityName="Billing Company"
      heading="Billing Companies"
      subtitle="Manage corporate billing entities, tax registrations, invoices, and banking details."
      breadcrumbTrail={["Settings", "Masters", "Billing Company"]}
      newButtonLabel="+ ADD NEW"
      searchPlaceholder="Search..."
      hideQuickAdd={true}
      useFullPageForm={true}
      reloadToken={cities.loaded}
      columnHeaders={["Name", "Email", "Status", "Register On"]}
      columns={[
        {
          header: "Name",
          sortValue: (c) => c.name,
          render: (c) => (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {c.logo_url ? (
                <img
                  src={c.logo_url}
                  alt={c.name}
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "4px",
                    objectFit: "contain",
                    border: "1px solid #e2e8f0",
                  }}
                />
              ) : null}
              <span className="cell-primary" style={{ fontWeight: 600 }}>
                {c.name}
              </span>
            </div>
          ),
        },
        {
          header: "Email",
          sortValue: (c) => c.email || "",
          render: (c) => (
            <span style={{ color: "#334155" }}>
              {c.email || "—"}
            </span>
          ),
        },
        {
          header: "Status",
          sortValue: (c) => c.status,
          render: (c) => <StatusBadge status={c.status} />,
        },
        {
          header: "Register On",
          sortValue: (c) => c.created_at || "",
          render: (c) => (
            <span style={{ fontSize: "13px", color: "#475569", whiteSpace: "nowrap" }}>
              {formatRegisterOn(c.created_at)}
            </span>
          ),
        },
      ]}
      importHeaders={[
        { key: "name", label: "Billing Company Name", required: true },
        { key: "email", label: "Email" },
        { key: "mobile", label: "Mobile" },
        { key: "address", label: "Address" },
        { key: "city", label: "City", required: true },
        { key: "zip_code", label: "Zip Code" },
        { key: "gst_no", label: "GST No" },
        { key: "pan_no", label: "Pancard" },
        { key: "so_prefix", label: "Sale Order Prefix", required: true },
        { key: "pi_prefix", label: "Proforma Invoice Prefix", required: true },
        { key: "bank_name", label: "Select Bank", required: true },
        { key: "terms_and_conditions", label: "Sale Order Term And Condition" },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        name: item?.name ?? "",
        email: item?.email ?? "",
        mobile: item?.mobile ?? "",
        logo_url: item?.logo_url ?? "",
        signature_url: item?.signature_url ?? "",
        address: item?.address ?? "",
        city: item?.city ?? "",
        zip_code: item?.zip_code ?? "",
        gst_no: item?.gst_no ?? "",
        pan_no: item?.pan_no ?? "",
        so_prefix: item?.so_prefix ?? "",
        pi_prefix: item?.pi_prefix ?? "",
        bank_name: item?.bank_name ?? "",
        terms_and_conditions: item?.terms_and_conditions ?? "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => ({
        name: f.name.trim(),
        email: f.email.trim() || null,
        mobile: f.mobile.trim() || null,
        logo_url: f.logo_url || null,
        signature_url: f.signature_url || null,
        address: f.address.trim() || null,
        city: f.city.trim(),
        zip_code: f.zip_code.trim() || null,
        gst_no: f.gst_no.trim() || null,
        pan_no: f.pan_no.trim() || null,
        so_prefix: f.so_prefix.trim(),
        pi_prefix: f.pi_prefix.trim(),
        bank_name: f.bank_name.trim(),
        terms_and_conditions: f.terms_and_conditions.trim() || null,
        status: f.status,
      })}
      validateForm={(f) => {
        const errs: Record<string, string> = {};
        if (!f.name.trim()) errs.name = "Billing Company Name is required.";
        if (!f.city.trim()) errs.city = "City is required.";
        if (!f.so_prefix.trim()) errs.so_prefix = "Sale Order Prefix is required.";
        if (!f.pi_prefix.trim()) errs.pi_prefix = "Proforma Invoice Prefix is required.";
        if (!f.bank_name.trim()) errs.bank_name = "Select Bank is required.";
        return errs;
      }}
      renderFields={(f, set, errors) => (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <h3
            style={{
              fontSize: "18px",
              fontWeight: 600,
              color: "#0f172a",
              margin: 0,
              paddingBottom: "8px",
              borderBottom: "1px solid #e2e8f0",
            }}
          >
            Billing Company Detail
          </h3>

          {/* Row 1: Name, Email, Mobile (3 columns) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
            <TextField
              id="name"
              label="Billing Company Name *"
              required
              maxLength={150}
              placeholder="e.g. INHYMA SOLUTIONS LLP (M)"
              value={f.name}
              error={errors?.name}
              onChange={(v) => set("name", v)}
            />
            <TextField
              id="email"
              label="Email"
              type="email"
              maxLength={100}
              placeholder="e.g. Payment.Darsh@Gmail.Com"
              value={f.email}
              error={errors?.email}
              onChange={(v) => set("email", v)}
            />
            <TextField
              id="mobile"
              label="Mobile"
              maxLength={20}
              placeholder="e.g. 9876543210"
              value={f.mobile}
              error={errors?.mobile}
              onChange={(v) => set("mobile", v)}
            />
          </div>

          {/* Row 2: Logo and Signature (2 columns with Image Box & Select Button) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            {/* Logo Box */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <label style={{ fontSize: "14px", fontWeight: 500, color: "#334155" }}>Logo</label>
                <span
                  title="Upload company logo (PNG, JPG, max 5MB)"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    backgroundColor: "#3b82f6",
                    color: "#ffffff",
                    fontSize: "11px",
                    fontWeight: "bold",
                    cursor: "pointer",
                  }}
                >
                  i
                </span>
              </div>
              <div
                style={{
                  width: "140px",
                  height: "140px",
                  borderRadius: "8px",
                  border: "1px dashed #cbd5e1",
                  backgroundColor: "#f1f5f9",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                {f.logo_url ? (
                  <img
                    src={f.logo_url}
                    alt="Logo Preview"
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                ) : (
                  <svg
                    width="54"
                    height="54"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => handleImageUpload(e, "logo_url", set)}
              />
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  style={{
                    padding: "6px 14px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    background: "#ffffff",
                    color: "#475569",
                    fontSize: "13px",
                    fontWeight: 500,
                    cursor: "pointer",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                  }}
                >
                  Select Image
                </button>
                {f.logo_url && (
                  <button
                    type="button"
                    onClick={() => set("logo_url", "")}
                    style={{
                      padding: "6px 10px",
                      border: "1px solid #fca5a5",
                      borderRadius: "6px",
                      background: "#fee2e2",
                      color: "#dc2626",
                      fontSize: "13px",
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Signature Box */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <label style={{ fontSize: "14px", fontWeight: 500, color: "#334155" }}>Signature</label>
                <span
                  title="Upload authorized signatory image"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    backgroundColor: "#3b82f6",
                    color: "#ffffff",
                    fontSize: "11px",
                    fontWeight: "bold",
                    cursor: "pointer",
                  }}
                >
                  i
                </span>
              </div>
              <div
                style={{
                  width: "140px",
                  height: "140px",
                  borderRadius: "8px",
                  border: "1px dashed #cbd5e1",
                  backgroundColor: "#f1f5f9",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                {f.signature_url ? (
                  <img
                    src={f.signature_url}
                    alt="Signature Preview"
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                ) : (
                  <svg
                    width="54"
                    height="54"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                )}
              </div>
              <input
                ref={sigInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => handleImageUpload(e, "signature_url", set)}
              />
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => sigInputRef.current?.click()}
                  style={{
                    padding: "6px 14px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    background: "#ffffff",
                    color: "#475569",
                    fontSize: "13px",
                    fontWeight: 500,
                    cursor: "pointer",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                  }}
                >
                  Select Image
                </button>
                {f.signature_url && (
                  <button
                    type="button"
                    onClick={() => set("signature_url", "")}
                    style={{
                      padding: "6px 10px",
                      border: "1px solid #fca5a5",
                      borderRadius: "6px",
                      background: "#fee2e2",
                      color: "#dc2626",
                      fontSize: "13px",
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Row 3: Address (Full Width) */}
          <TextField
            id="address"
            label="Address"
            placeholder="Full physical address"
            value={f.address}
            error={errors?.address}
            onChange={(v) => set("address", v)}
          />

          {/* Row 4: City * and Zip Code (2 columns) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <SelectField
              id="city"
              label="City *"
              required
              value={f.city}
              error={errors?.city}
              onChange={(v) => set("city", v)}
            >
              <option value="">Select</option>
              {cities.items.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
              {/* Fallback default cities if cities lookup still loading */}
              {cities.items.length === 0 && (
                <>
                  <option value="Indore">Indore</option>
                  <option value="Ahmedabad">Ahmedabad</option>
                  <option value="Mumbai">Mumbai</option>
                  <option value="Delhi">Delhi</option>
                  <option value="Bangalore">Bangalore</option>
                </>
              )}
            </SelectField>
            <TextField
              id="zip_code"
              label="Zip Code"
              maxLength={20}
              placeholder="e.g. 452001"
              value={f.zip_code}
              error={errors?.zip_code}
              onChange={(v) => set("zip_code", v)}
            />
          </div>

          {/* Row 5: GST No and Pancard (2 columns) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <TextField
              id="gst_no"
              label="GST No"
              maxLength={30}
              placeholder="e.g. 23AABCI1234F1Z5"
              value={f.gst_no}
              error={errors?.gst_no}
              onChange={(v) => set("gst_no", v)}
            />
            <TextField
              id="pan_no"
              label="Pancard"
              maxLength={30}
              placeholder="e.g. AABCI1234F"
              value={f.pan_no}
              error={errors?.pan_no}
              onChange={(v) => set("pan_no", v)}
            />
          </div>

          {/* Row 6: Sale Order Prefix * and Proforma Invoice Prefix * (2 columns) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <TextField
              id="so_prefix"
              label="Sale Order Prefix *"
              required
              maxLength={30}
              placeholder="e.g. IN/MP/SO/"
              value={f.so_prefix}
              error={errors?.so_prefix}
              onChange={(v) => set("so_prefix", v)}
            />
            <TextField
              id="pi_prefix"
              label="Proforma Invoice Prefix *"
              required
              maxLength={30}
              placeholder="e.g. IN/MP/PI/"
              value={f.pi_prefix}
              error={errors?.pi_prefix}
              onChange={(v) => set("pi_prefix", v)}
            />
          </div>

          {/* Row 7: Select Bank * */}
          <div style={{ maxWidth: "50%" }}>
            <SelectField
              id="bank_name"
              label="Select Bank *"
              required
              value={f.bank_name}
              error={errors?.bank_name}
              onChange={(v) => set("bank_name", v)}
            >
              <option value="">Select</option>
              {POPULAR_BANKS.map((bank) => (
                <option key={bank} value={bank}>
                  {bank}
                </option>
              ))}
            </SelectField>
          </div>

          {/* Row 8: Sale Order Term And Condition */}
          <TextAreaField
            id="terms_and_conditions"
            label="Sale Order Term And Condition"
            rows={4}
            placeholder="Enter terms and conditions to print on sales orders..."
            value={f.terms_and_conditions}
            error={errors?.terms_and_conditions}
            onChange={(v) => set("terms_and_conditions", v)}
          />

          {/* Status Field */}
          <div style={{ maxWidth: "300px" }}>
            <StatusSelectField value={f.status} onChange={(v) => set("status", v)} />
          </div>
        </div>
      )}
      detailFields={(c) => [
        { label: "Billing Company Name", value: c.name, fullWidth: true },
        { label: "Email", value: c.email || "—" },
        { label: "Mobile", value: c.mobile || "—" },
        { label: "Address", value: c.address || "—", fullWidth: true },
        { label: "City", value: c.city },
        { label: "Zip Code", value: c.zip_code || "—" },
        { label: "GST No", value: c.gst_no || "—" },
        { label: "Pancard", value: c.pan_no || "—" },
        { label: "Sale Order Prefix", value: c.so_prefix },
        { label: "Proforma Invoice Prefix", value: c.pi_prefix },
        { label: "Bank", value: c.bank_name },
        { label: "Terms & Conditions", value: c.terms_and_conditions || "—", fullWidth: true },
        { label: "Current Status", value: <StatusBadge status={c.status} /> },
        { label: "Register On", value: formatRegisterOn(c.created_at) },
      ]}
      detailTitle={(c) => c.name}
      detailSubtitle={(c) => `${c.city} | GST: ${c.gst_no || "N/A"}`}
    />
  );
}
