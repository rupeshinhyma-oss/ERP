/**
 * Additional Charges master module.
 * Replicates the legacy ERP screen with Name, HSN, GST Percentage, and Status.
 */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge, dash } from "@/components/ui";
import { StatusSelectField, TextField } from "@/components/fields";
import type { AdditionalCharge } from "@/types";

const EMPTY: FormState = {
  name: "",
  hsn_number: "",
  gst_percent: "18",
  description: "",
  status: "active",
};

export function AdditionalChargesPage() {
  return (
    <MasterPage<AdditionalCharge>
      activeKey="masters-additional-charges"
      apiBase="/masters/additional-charges"
      permissionPrefix="additionalcharge"
      exportPermission="additionalcharge.export"
      bulkActionPermission="additionalcharge.bulk_action"
      liveModule="additional_charges"
      entityName="additional charge"
      heading="Additional Charges"
      subtitle="Manage freight, transport, packing & forwarding, and other additional charge rates."
      breadcrumbTrail={["Settings", "Masters", "Additional Charges"]}
      newButtonLabel="+ ADD NEW"
      searchPlaceholder="Search Name, HSN or Sr. No..."
      hideQuickAdd={true}
      columnHeaders={["Name", "HSN", "GST Percentage", "Status"]}
      columns={[
        {
          header: "Name",
          sortValue: (c) => c.name,
          render: (c) => (
            <span className="cell-primary" style={{ fontWeight: 600 }}>
              {c.name}
            </span>
          ),
        },
        {
          header: "HSN",
          sortValue: (c) => c.hsn_number ?? "",
          render: (c) => (
            <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: "13px" }}>
              {c.hsn_number || "—"}
            </span>
          ),
        },
        {
          header: "GST Percentage",
          sortValue: (c) => c.gst_percent,
          render: (c) => <span>{c.gst_percent}%</span>,
        },
        {
          header: "Status",
          sortValue: (c) => c.status,
          render: (c) => <StatusBadge status={c.status} />,
        },
      ]}
      importHeaders={[
        { key: "name", label: "Name", required: true },
        { key: "hsn_number", label: "HSN" },
        { key: "gst_percent", label: "GST Percentage", required: true },
        { key: "description", label: "Description" },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        name: item?.name ?? "",
        hsn_number: item?.hsn_number ?? "",
        gst_percent: item != null ? String(item.gst_percent) : "18",
        description: item?.description ?? "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => ({
        name: f.name.trim(),
        hsn_number: f.hsn_number ? f.hsn_number.trim() : null,
        gst_percent: parseFloat(f.gst_percent) || 0,
        description: f.description ? f.description.trim() : null,
        status: f.status,
      })}
      validateForm={(f) => {
        const errs: Record<string, string> = {};
        if (!f.name.trim()) {
          errs.name = "Name is required.";
        }
        if (f.gst_percent === "" || isNaN(parseFloat(f.gst_percent))) {
          errs.gst_percent = "GST Percentage is required.";
        } else {
          const num = parseFloat(f.gst_percent);
          if (num < 0 || num > 100) {
            errs.gst_percent = "GST Percentage must be between 0 and 100.";
          }
        }
        return errs;
      }}
      renderFields={(f, set, errors) => (
        <div className="form-grid">
          <TextField
            id="name"
            label="Name *"
            required
            maxLength={150}
            placeholder="e.g. Transport Charges"
            value={f.name}
            error={errors?.name}
            onChange={(v) => set("name", v)}
          />
          <TextField
            id="hsn_number"
            label="HSN / SAC Code"
            maxLength={50}
            placeholder="e.g. 996511"
            value={f.hsn_number}
            error={errors?.hsn_number}
            onChange={(v) => set("hsn_number", v)}
          />
          <TextField
            id="gst_percent"
            label="GST Percentage (%) *"
            required
            type="number"
            step="0.01"
            min={0}
            max={100}
            placeholder="e.g. 18"
            value={f.gst_percent}
            error={errors?.gst_percent}
            onChange={(v) => set("gst_percent", v)}
          />
          <StatusSelectField value={f.status} onChange={(v) => set("status", v)} />
          <div style={{ gridColumn: "1 / -1" }}>
            <TextField
              id="description"
              label="Description"
              maxLength={500}
              placeholder="Optional notes or remarks"
              value={f.description}
              onChange={(v) => set("description", v)}
            />
          </div>
        </div>
      )}
      detailFields={(c) => [
        { label: "Name", value: c.name, fullWidth: true },
        { label: "HSN / SAC Code", value: c.hsn_number || "—" },
        { label: "GST Percentage", value: `${c.gst_percent}%` },
        { label: "Current Status", value: <StatusBadge status={c.status} /> },
        { label: "Description", value: dash(c.description), fullWidth: true },
      ]}
      detailTitle={(c) => c.name}
      detailSubtitle={(c) => `HSN: ${c.hsn_number || "N/A"} | GST: ${c.gst_percent}%`}
    />
  );
}
