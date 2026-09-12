/**
 * Taxes master module.
 * Displays HSN Number, GST Percentage, Import Duty (%), and active status.
 */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge } from "@/components/ui";
import { StatusSelectField, TextField } from "@/components/fields";
import type { Tax } from "@/types";

const EMPTY: FormState = {
  hsn_number: "",
  gst_percent: "",
  import_duty_percent: "",
  status: "active",
};

export function TaxesPage() {
  return (
    <MasterPage<Tax>
      activeKey="masters-taxes"
      apiBase="/masters/taxes"
      permissionPrefix="tax"
      exportPermission="tax.export"
      bulkActionPermission="tax.bulk_action"
      liveModule="taxes"
      entityName="tax"
      heading="Taxes"
      subtitle="HSN Numbers, GST Percentages, and Import Duties."
      breadcrumbTrail={["Settings", "Masters", "Taxes"]}
      newButtonLabel="+ ADD NEW"
      searchPlaceholder="Search HSN Number or Sr. No..."
      hideQuickAdd={true}
      columnHeaders={["HSN Number", "GST (%)", "Import Duty", "Status"]}
      columns={[
        {
          header: "HSN Number",
          sortValue: (t) => t.hsn_number,
          render: (t) => (
            <span className="cell-primary" style={{ fontFamily: "monospace", fontWeight: 600, fontSize: "13px" }}>
              {t.hsn_number}
            </span>
          ),
        },
        {
          header: "GST (%)",
          sortValue: (t) => t.gst_percent,
          render: (t) => <span>{t.gst_percent}</span>,
        },
        {
          header: "Import Duty",
          sortValue: (t) => t.import_duty_percent,
          render: (t) => <span>{t.import_duty_percent != null ? Number(t.import_duty_percent).toFixed(2) : "0.00"}</span>,
        },
        {
          header: "Status",
          sortValue: (t) => t.status,
          render: (t) => <StatusBadge status={t.status} />,
        },
      ]}
      importHeaders={[
        { key: "hsn_number", label: "HSN Number", required: true },
        { key: "gst_percent", label: "GST Percentage", required: true },
        { key: "import_duty_percent", label: "Import Duty (%)", required: true },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        hsn_number: item?.hsn_number ?? "",
        gst_percent: item != null ? String(item.gst_percent) : "",
        import_duty_percent: item != null ? String(item.import_duty_percent) : "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => ({
        hsn_number: f.hsn_number.trim(),
        gst_percent: parseFloat(f.gst_percent) || 0,
        import_duty_percent: parseFloat(f.import_duty_percent) || 0,
        status: f.status,
      })}
      validateForm={(f) => {
        const errs: Record<string, string> = {};
        if (!f.hsn_number.trim()) {
          errs.hsn_number = "HSN Number is required.";
        }
        if (f.gst_percent === "" || isNaN(parseFloat(f.gst_percent))) {
          errs.gst_percent = "GST Percentage is required.";
        }
        if (f.import_duty_percent === "" || isNaN(parseFloat(f.import_duty_percent))) {
          errs.import_duty_percent = "Import Duty (%) is required.";
        }
        return errs;
      }}
      renderFields={(f, set, errors) => (
        <div className="form-grid">
          <TextField
            id="hsn_number"
            label="HSN Number *"
            required
            maxLength={50}
            placeholder="e.g. 8431.20.90"
            value={f.hsn_number}
            error={errors?.hsn_number}
            onChange={(v) => set("hsn_number", v)}
          />
          <TextField
            id="gst_percent"
            label="GST Percentage *"
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
          <TextField
            id="import_duty_percent"
            label="Import Duty (%) *"
            required
            type="number"
            step="0.01"
            min={0}
            max={100}
            placeholder="e.g. 8.25"
            value={f.import_duty_percent}
            error={errors?.import_duty_percent}
            onChange={(v) => set("import_duty_percent", v)}
          />
          <StatusSelectField value={f.status} onChange={(v) => set("status", v)} />
        </div>
      )}
      detailFields={(t) => [
        { label: "HSN Number", value: t.hsn_number, fullWidth: true },
        { label: "GST Percentage", value: `${t.gst_percent}%` },
        { label: "Import Duty (%)", value: `${t.import_duty_percent}%` },
        { label: "Current Status", value: <StatusBadge status={t.status} /> },
      ]}
      detailTitle={(t) => `HSN: ${t.hsn_number}`}
      detailSubtitle={(t) => `GST ${t.gst_percent}% | Import Duty ${t.import_duty_percent}%`}
    />
  );
}
