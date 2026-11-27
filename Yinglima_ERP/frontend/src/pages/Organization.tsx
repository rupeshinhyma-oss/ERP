/**
 * Organization Settings. Ported from organization.html.
 *
 * Shows a read-only detail card by default and swaps to the form on Edit. If no
 * organization record exists yet the API answers 404 and the page opens straight
 * into the form -- there is nothing to "view" until one is created, and the same
 * form then POSTs instead of PATCHing.
 *
 * Saving invalidates the cached brand name so a rename shows up immediately in
 * the sidebar here, and on every other open tab's next navigation.
 */

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Banner, Can } from "@/components/ui";
import { SelectField, TextAreaField, TextField } from "@/components/fields";
import { apiDelete, apiGet, apiPatch, apiPost, apiPostMultipart, ApiError, errorMessage } from "@/lib/api";
import { invalidateBrandNameCache, resolveImageUrl, setBrandLogo, setBrandName, setCachedOrganizationProfile } from "@/lib/brand";
import { useToast } from "@/lib/toast";
import type { Organization, OrganizationFieldId } from "@/types";

const FIELD_IDS: OrganizationFieldId[] = [
  "company_name",
  "legal_name",
  "email",
  "phone",
  "website",
  "gst_number",
  "pan_number",
  "timezone",
  "currency",
  "status",
  "address",
  "city",
  "state",
  "country",
  "postal_code",
  "business_hours",
];

type OrgForm = Record<OrganizationFieldId, string>;

const EMPTY_FORM = FIELD_IDS.reduce((acc, id) => {
  acc[id] = id === "status" ? "ACTIVE" : "";
  return acc;
}, {} as OrgForm);

function DetailItem({
  label,
  value,
  fullWidth,
}: {
  label: string;
  value?: string | null;
  fullWidth?: boolean;
}) {
  return (
    <div style={fullWidth ? { gridColumn: "1 / -1" } : undefined}>
      <div className="label">{label}</div>
      <div className="value">{value || "—"}</div>
    </div>
  );
}

function OrganizationDetailSkeleton() {
  return (
    <div className="card">
      <div className="detail-grid">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i}>
            <div className="label"><div className="skeleton-line" style={{ width: "80px", height: "12px", marginBottom: "4px" }} /></div>
            <div className="value"><div className="skeleton-line" style={{ width: "140px", height: "16px" }} /></div>
          </div>
        ))}
      </div>
      <div className="section-title">Address</div>
      <div className="detail-grid">
        <div style={{ gridColumn: "1 / -1" }}>
          <div className="label"><div className="skeleton-line" style={{ width: "60px", height: "12px", marginBottom: "4px" }} /></div>
          <div className="value"><div className="skeleton-line" style={{ width: "80%", height: "16px" }} /></div>
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <div className="label"><div className="skeleton-line" style={{ width: "60px", height: "12px", marginBottom: "4px" }} /></div>
            <div className="value"><div className="skeleton-line" style={{ width: "110px", height: "16px" }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OrganizationPage() {
  const showToast = useToast();
  const [org, setOrg] = useState<Organization | null>(null);
  const [form, setForm] = useState<OrgForm>(EMPTY_FORM);
  const [mode, setMode] = useState<"create" | "update">("create");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [logoUploading, setLogoUploading] = useState(false);
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
  const [pendingLogoPreview, setPendingLogoPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewFileInputRef = useRef<HTMLInputElement>(null);

  const clearPendingLogo = () => {
    setPendingLogoFile(null);
    setPendingLogoPreview((prev) => {
      if (prev && prev.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(prev);
        } catch {
          /* ignore */
        }
      }
      return null;
    });
  };

  useEffect(() => {
    setPreviewError(false);
  }, [org?.logo_data, org?.logo_url, pendingLogoPreview]);

  const setField = (id: OrganizationFieldId, value: string) =>
    setForm((prev) => ({ ...prev, [id]: value }));

  function fillForm(source: Organization): OrgForm {
    return FIELD_IDS.reduce((acc, id) => {
      acc[id] = (source[id] as string | null | undefined) ?? "";
      return acc;
    }, {} as OrgForm);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiGet<Organization>("/organizations");
        if (cancelled) return;
        setOrg(data);
        setForm(fillForm(data));
        setMode("update");
        setEditing(false);
        setCachedOrganizationProfile(data);
        const serverLogo =
          (data.logo_data && data.logo_data.startsWith("data:") ? data.logo_data : data.logo_url) ||
          data.logo_data ||
          null;
        setBrandLogo(serverLogo, data.logo_url || null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          // No profile exists yet -- go straight to the form.
          setMode("create");
          setEditing(true);
        } else {
          setError(err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function readForm(): Record<string, string | null> {
    const payload: Record<string, string | null> = {};
    for (const id of FIELD_IDS) {
      const value = (form[id] || "").trim();
      payload[id] = value === "" ? null : value;
    }
    if (!payload.timezone) payload.timezone = "UTC";
    if (!payload.currency) payload.currency = "USD";
    return payload;
  }

  const validateLogoFile = (file: File): string | null => {
    const validExtensions = ["png", "jpg", "jpeg", "webp", "gif", "svg"];
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !validExtensions.includes(ext)) {
      return "Please select a valid image file (.png, .jpg, .jpeg, .webp, .svg). PNG is recommended for transparent logos.";
    }
    if (file.size > 5 * 1024 * 1024) {
      return "File size exceeds the 5 MB limit. Please choose a smaller image.";
    }
    return null;
  };

  const handleFileChosen = (file: File, autoUpload = false) => {
    const valError = validateLogoFile(file);
    if (valError) {
      const err = new Error(valError);
      setError(err);
      showToast(valError, "error");
      return;
    }
    setError(null);

    if (autoUpload) {
      uploadLogoDirectly(file);
      return;
    }

    setPendingLogoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPendingLogoPreview((prev) => {
      if (prev && prev.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(prev);
        } catch {
          /* ignore */
        }
      }
      return objectUrl;
    });
  };

  const uploadLogoDirectly = async (file: File) => {
    setLogoUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiPostMultipart<{ logo_url: string; logo_data?: string; organization: Organization }>(
        "/organizations/logo",
        formData
      );
      if (res?.data) {
        const updatedOrg = (res.data.organization || {
          ...(org || form),
          logo_url: res.data.logo_url,
          logo_data: res.data.logo_data,
        }) as Organization;
        setOrg(updatedOrg);
        setForm(fillForm(updatedOrg));
        setCachedOrganizationProfile(updatedOrg);
        const newLogo =
          (res.data.logo_data && res.data.logo_data.startsWith("data:") ? res.data.logo_data : res.data.logo_url) ||
          res.data.logo_data ||
          null;
        setBrandLogo(newLogo, res.data.logo_url || null);
        clearPendingLogo();
        showToast("Company logo updated successfully.", "success");
      }
    } catch (err) {
      setError(err);
      showToast(errorMessage(err), "error");
    } finally {
      setLogoUploading(false);
    }
  };

  const handleDeleteLogo = async () => {
    if (!window.confirm("Are you sure you want to remove the company logo?")) {
      return;
    }
    setLogoUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiDelete<{ logo_url: null; logo_data: null; organization: Organization }>("/organizations/logo");
      const updatedOrg = (res?.data?.organization || {
        ...(org || form),
        logo_url: null,
        logo_data: null,
      }) as Organization;
      setOrg(updatedOrg);
      setForm(fillForm(updatedOrg));
      setCachedOrganizationProfile(updatedOrg);
      setBrandLogo(null);
      clearPendingLogo();
      showToast("Company logo removed.", "success");
    } catch (err) {
      setError(err);
      showToast(errorMessage(err), "error");
    } finally {
      setLogoUploading(false);
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    const payload = readForm();

    try {
      let data: Organization;
      if (mode === "create") {
        ({ data } = await apiPost<Organization>("/organizations", payload));
        setMode("update");
      } else {
        ({ data } = await apiPatch<Organization>("/organizations", payload));
      }

      if (pendingLogoFile) {
        const formData = new FormData();
        formData.append("file", pendingLogoFile);
        const uploadRes = await apiPostMultipart<{ logo_url: string; logo_data?: string; organization: Organization }>(
          "/organizations/logo",
          formData
        );
        if (uploadRes?.data) {
          data = {
            ...data,
            logo_url: uploadRes.data.logo_url,
            logo_data: uploadRes.data.logo_data,
          };
        }
        clearPendingLogo();
      }

      setOrg(data);
      setForm(fillForm(data));
      setCachedOrganizationProfile(data);

      invalidateBrandNameCache();
      if (data?.company_name) {
        setBrandName(data.company_name);
      }
      const savedLogo =
        (data?.logo_data && data.logo_data.startsWith("data:") ? data.logo_data : data?.logo_url) ||
        data?.logo_data ||
        null;
      setBrandLogo(savedLogo, data?.logo_url || null);
      setSuccess("Saved.");
      showToast("Settings and branding saved successfully.", "success");
      setEditing(false);
    } catch (err) {
      setError(err);
      showToast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  const statusLabel =
    org?.status === "ACTIVE" ? "Active" : org?.status === "INACTIVE" ? "Inactive" : "—";

  const activeLogoSrc = org?.logo_data || org?.logo_url ? resolveImageUrl(org.logo_data || org.logo_url) : null;
  const hasStoredLogo = Boolean(activeLogoSrc);
  const editPreviewSrc = pendingLogoPreview || (hasStoredLogo ? activeLogoSrc : null);

  return (
    <AppShell activeKey="organization">
      <main className="page">
        <div className="page-header">
          <div>
            <h1>ERP Settings</h1>
          </div>
          {!editing && (
            <div className="page-header-actions">
              <Can permission="organization.manage">
                <button className="btn btn-primary" onClick={() => setEditing(true)}>
                  Edit
                </button>
              </Can>
            </div>
          )}
        </div>
        <Banner error={error} success={success} />

        {!editing && !org && <OrganizationDetailSkeleton />}

        {!editing && org && (
          <div className="card">
            <div className="detail-grid">
              <DetailItem label="Company Name" value={org.company_name} />
              <DetailItem label="Legal Name" value={org.legal_name} />
              <DetailItem label="Email" value={org.email} />
              <DetailItem label="Phone" value={org.phone} />
              <DetailItem label="Website" value={org.website} />
              <DetailItem label="GST Number" value={org.gst_number} />
              <DetailItem label="PAN Number" value={org.pan_number} />
              <DetailItem label="Timezone" value={org.timezone} />
              <DetailItem label="Currency" value={org.currency} />
              <DetailItem label="Status" value={statusLabel} />
            </div>
            <div className="section-title">Address</div>
            <div className="detail-grid">
              <DetailItem label="Address" value={org.address} fullWidth />
              <DetailItem label="City" value={org.city} />
              <DetailItem label="State" value={org.state} />
              <DetailItem label="Country" value={org.country} />
              <DetailItem label="Postal Code" value={org.postal_code} />
            </div>
            <div className="section-title">Other</div>
            <div className="detail-grid">
              <DetailItem label="Business Hours" value={org.business_hours} />
            </div>

            {/* Company Logo Uploader & Storage Preview */}
            <div className="section-title">Company Logo</div>
            <div
              style={{
                marginTop: "10px",
                padding: "20px",
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                background: "#ffffff",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "24px",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.02)",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "200px",
                  height: "90px",
                  borderRadius: "10px",
                  border: "1.5px solid #cbd5e1",
                  background:
                    activeLogoSrc && !previewError
                      ? "repeating-conic-gradient(#f8fafc 0% 25%, #ffffff 0% 50%) 50% / 16px 16px"
                      : "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  boxShadow: "inset 0 1px 3px rgba(0,0,0,0.05)",
                  flexShrink: 0,
                }}
              >
                {activeLogoSrc && !previewError ? (
                  <img
                    src={activeLogoSrc}
                    alt="Company Logo"
                    crossOrigin="anonymous"
                    onError={() => setPreviewError(true)}
                    style={{
                      maxHeight: "70px",
                      maxWidth: "180px",
                      objectFit: "contain",
                    }}
                  />
                ) : null}
              </div>

              <div style={{ flex: 1, minWidth: "260px" }}>
                <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "14px", fontWeight: 500 }}>
                  Max 5 MB
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <Can permission="organization.manage">
                    <input
                      type="file"
                      ref={viewFileInputRef}
                      style={{ display: "none" }}
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleFileChosen(file, true);
                        }
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={logoUploading}
                      onClick={() => viewFileInputRef.current?.click()}
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", padding: "7px 14px" }}
                    >
                      {logoUploading ? "Uploading to DB..." : activeLogoSrc ? "Change PNG Logo" : "Upload PNG Logo"}
                    </button>

                    {activeLogoSrc && (
                      <button
                        type="button"
                        className="btn"
                        disabled={logoUploading}
                        onClick={handleDeleteLogo}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "13px",
                          padding: "7px 14px",
                          color: "#dc2626",
                          borderColor: "#fecaca",
                        }}
                      >
                        Remove Logo
                      </button>
                    )}
                  </Can>
                </div>
              </div>
            </div>
          </div>
        )}

        {editing && (
          <div className="card">
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <TextField id="company_name" label="Company name *" required maxLength={200} value={form.company_name} onChange={(v) => setField("company_name", v)} />
                <TextField id="legal_name" label="Legal name" maxLength={200} value={form.legal_name} onChange={(v) => setField("legal_name", v)} />
                <TextField id="email" label="Email" type="email" value={form.email} onChange={(v) => setField("email", v)} />
                <TextField id="phone" label="Phone" maxLength={30} value={form.phone} onChange={(v) => setField("phone", v)} />
                <TextField id="website" label="Website" maxLength={255} value={form.website} onChange={(v) => setField("website", v)} />
                <TextField id="gst_number" label="GST number" maxLength={50} value={form.gst_number} onChange={(v) => setField("gst_number", v)} />
                <TextField id="pan_number" label="PAN number" maxLength={50} value={form.pan_number} onChange={(v) => setField("pan_number", v)} />
                <TextField id="timezone" label="Timezone" maxLength={50} placeholder="UTC" value={form.timezone} onChange={(v) => setField("timezone", v)} />
                <TextField id="currency" label="Currency" maxLength={10} placeholder="USD" value={form.currency} onChange={(v) => setField("currency", v)} />
                <SelectField id="status" label="Status" value={form.status} onChange={(v) => setField("status", v)}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </SelectField>
              </div>

              <TextAreaField id="address" label="Address" value={form.address} onChange={(v) => setField("address", v)} />
              <div className="form-grid">
                <TextField id="city" label="City" maxLength={100} value={form.city} onChange={(v) => setField("city", v)} />
                <TextField id="state" label="State" maxLength={100} value={form.state} onChange={(v) => setField("state", v)} />
                <TextField id="country" label="Country" maxLength={100} value={form.country} onChange={(v) => setField("country", v)} />
                <TextField id="postal_code" label="Postal code" maxLength={20} value={form.postal_code} onChange={(v) => setField("postal_code", v)} />
              </div>
              <TextField id="business_hours" label="Business hours" maxLength={255} placeholder="Mon–Fri, 9am–6pm" value={form.business_hours} onChange={(v) => setField("business_hours", v)} />

              <div className="section-title">Company Logo</div>
              <div
                style={{
                  marginTop: "10px",
                  padding: "20px",
                  border: isDragging ? "2px dashed #2563eb" : "1.5px dashed #cbd5e1",
                  borderRadius: "12px",
                  background: isDragging ? "#eff6ff" : "#f8fafc",
                  transition: "all 0.2s ease",
                  cursor: "pointer",
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileChosen(file);
                }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).tagName !== "BUTTON") {
                    fileInputRef.current?.click();
                  }
                }}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileChosen(file);
                    e.target.value = "";
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
                  <div
                    style={{
                      width: "180px",
                      height: "85px",
                      borderRadius: "10px",
                      border: "1.5px solid #cbd5e1",
                      background:
                        editPreviewSrc && !previewError
                          ? "repeating-conic-gradient(#f1f5f9 0% 25%, #ffffff 0% 50%) 50% / 14px 14px"
                          : "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                      boxShadow: "inset 0 1px 3px rgba(0,0,0,0.06)",
                      flexShrink: 0,
                    }}
                  >
                    {editPreviewSrc && !previewError ? (
                      <img
                        src={editPreviewSrc}
                        alt="Logo Preview"
                        crossOrigin="anonymous"
                        onError={() => setPreviewError(true)}
                        style={{
                          maxHeight: "68px",
                          maxWidth: "160px",
                          objectFit: "contain",
                        }}
                      />
                    ) : null}
                  </div>
                  <div style={{ flex: 1, minWidth: "220px" }}>
                    <div style={{ fontSize: "13px", color: "#64748b", marginBottom: "14px", fontWeight: 500 }}>
                      Max 5 MB
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        style={{ fontSize: "13px", padding: "6px 14px", background: "#ffffff" }}
                      >
                        Browse PNG / Image
                      </button>
                      {pendingLogoFile && (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={logoUploading}
                            onClick={(e) => {
                              e.stopPropagation();
                              uploadLogoDirectly(pendingLogoFile);
                            }}
                            style={{ fontSize: "13px", padding: "6px 14px" }}
                          >
                            {logoUploading ? "Uploading to DB..." : "Upload & Save to DB Now"}
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              clearPendingLogo();
                            }}
                            style={{ fontSize: "13px", padding: "6px 14px" }}
                          >
                            Cancel Selection
                          </button>
                        </>
                      )}
                      {!pendingLogoFile && (org?.logo_url || org?.logo_data) && (
                        <button
                          type="button"
                          className="btn"
                          disabled={logoUploading}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteLogo();
                          }}
                          style={{ fontSize: "13px", padding: "6px 14px", color: "#dc2626", borderColor: "#fecaca" }}
                        >
                          Remove Current Logo
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="form-actions" style={{ marginTop: "24px" }}>
                <button type="submit" className="btn btn-primary" disabled={saving || logoUploading}>
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setError(null);
                    setSuccess(null);
                    clearPendingLogo();
                    if (org) setForm(fillForm(org));
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </AppShell>
  );
}
