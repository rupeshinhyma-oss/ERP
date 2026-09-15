/**
 * Transport Master Module.
 * Replicates legacy screen erp.inhymasolutions.com/transport/list
 * with Sr. No., Name, GST Number, Mobile, Status, and Action.
 */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge } from "@/components/ui";
import { StatusSelectField, TextField } from "@/components/fields";
import type { Transport } from "@/types";

const EMPTY: FormState = {
  name: "",
  gst_number: "",
  mobile: "",
  status: "active",
};

export function TransportPage() {
  return (
    <MasterPage<Transport>
      activeKey="masters-transport"
      apiBase="/masters/transports"
      permissionPrefix="transport"
      exportPermission="transport.export"
      bulkActionPermission="transport.bulk_action"
      liveModule="transports"
      entityName="Transport"
      heading="Transport"
      subtitle="Manage logistics carriers, transport agencies, GST numbers, and contact details."
      breadcrumbTrail={["Settings", "Masters", "Transport"]}
      newButtonLabel="+ ADD NEW"
      searchPlaceholder="Search..."
      hideQuickAdd={true}
      modalCardStyle={{ maxWidth: "520px", width: "100%" }}
      columnHeaders={["Name", "GST Number", "Mobile", "Status"]}
      columns={[
        {
          header: "Name",
          sortValue: (t) => t.name,
          render: (t) => (
            <span className="cell-primary" style={{ fontWeight: 600 }}>
              {t.name}
            </span>
          ),
        },
        {
          header: "GST Number",
          sortValue: (t) => t.gst_number,
          render: (t) => (
            <span
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: "13px",
                color: "#1e293b",
                fontWeight: 500,
                letterSpacing: "0.5px",
              }}
            >
              {t.gst_number}
            </span>
          ),
        },
        {
          header: "Mobile",
          sortValue: (t) => t.mobile ?? "",
          render: (t) => (
            t.mobile ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  color: "#0284c7",
                  fontWeight: 500,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  style={{ flexShrink: 0 }}
                >
                  <path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1.02l-2.2 2.2z" />
                </svg>
                <span>{t.mobile}</span>
              </span>
            ) : (
              <span style={{ color: "#94a3b8" }}>—</span>
            )
          ),
        },
        {
          header: "Status",
          sortValue: (t) => t.status,
          render: (t) => <StatusBadge status={t.status} />,
        },
      ]}
      importHeaders={[
        { key: "name", label: "Name", required: true },
        { key: "gst_number", label: "GST Number", required: true },
        { key: "mobile", label: "Mobile" },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        name: item?.name ?? "",
        gst_number: item?.gst_number ?? "",
        mobile: item?.mobile ?? "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => ({
        name: f.name.trim(),
        gst_number: f.gst_number.trim().toUpperCase(),
        mobile: f.mobile ? f.mobile.trim() : null,
        status: f.status,
      })}
      validateForm={(f) => {
        const errs: Record<string, string> = {};
        if (!f.name.trim()) errs.name = "Name is required.";
        if (!f.gst_number.trim()) errs.gst_number = "GST Number is required.";
        return errs;
      }}
      renderFields={(f, set, errors) => (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <TextField
            id="name"
            label="Name *"
            placeholder="e.g. JETHABHAI DOONGARSHI TRANSPORT COMPANY"
            value={f.name}
            onChange={(v) => set("name", v)}
            error={errors?.name}
            required
          />

          <TextField
            id="gst_number"
            label="GST Number *"
            placeholder="e.g. 24AABFJ1234F1Z1"
            value={f.gst_number}
            onChange={(v) => set("gst_number", v)}
            error={errors?.gst_number}
            required
          />

          <TextField
            id="mobile"
            label="Mobile"
            placeholder="e.g. 9825012345"
            value={f.mobile}
            onChange={(v) => set("mobile", v)}
            error={errors?.mobile}
          />

          <StatusSelectField
            value={f.status}
            onChange={(v) => set("status", v)}
          />
        </div>
      )}
      detailFields={(t) => [
        { label: "Transport Name", value: t.name, fullWidth: true },
        { label: "GST Number", value: t.gst_number },
        { label: "Mobile Number", value: t.mobile || "—" },
        { label: "Status", value: <StatusBadge status={t.status} /> },
      ]}
      detailTitle={(t) => t.name}
      detailSubtitle={(t) => `GST: ${t.gst_number}`}
    />
  );
}
