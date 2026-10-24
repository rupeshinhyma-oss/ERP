/** HSN Codes master. Ported from masters-hsn.html. */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge, dash } from "@/components/ui";
import { TextAreaField, TextField, nullIfBlank } from "@/components/fields";
import type { Hsn } from "@/types";

const EMPTY: FormState = {
  code: "",
  gst_percent: "",
  import_duty_percent: "",
  purchase_vat_percent: "",
  refund_vat_percent: "",
  description: "",
  status: "active",
};

export function HsnPage() {
  return (
    <MasterPage<Hsn>
      activeKey="masters-hsn"
      apiBase="/masters/hsn"
      permissionPrefix="hsn"
      exportPermission="hsn.export"
      bulkActionPermission="hsn.bulk_action"
      liveModule="hsn"
      entityName="HSN code"
      heading="HSN Codes"
      newButtonLabel="+ New HSN Code"
      searchPlaceholder="Search code or description or Sr. No..."
      hideQuickAdd={true}
      columnHeaders={["HSN Code", "Description", "GST %", "Import Duty %", "Purchase VAT %", "Refund VAT %", "Status"]}
      columns={[
        { header: "HSN Code", render: (h) => <span className="cell-primary">{h.code}</span> },
        { header: "Description", render: (h) => dash(h.description) },
        { header: "GST %", render: (h) => `${h.gst_percent}%` },
        { header: "Import Duty %", render: (h) => `${h.import_duty_percent ?? 0}%` },
        { header: "Purchase VAT %", render: (h) => `${h.purchase_vat_percent ?? 0}%` },
        { header: "Refund VAT %", render: (h) => `${h.refund_vat_percent ?? 0}%` },
        { header: "Status", render: (h) => <StatusBadge status={h.status} /> },
      ]}
      importHeaders={[
        { key: "code", label: "HSN Code", required: true },
        { key: "gst_percent", label: "GST %" },
        { key: "import_duty_percent", label: "Import Duty %" },
        { key: "purchase_vat_percent", label: "Purchase VAT %" },
        { key: "refund_vat_percent", label: "Refund VAT %" },
        { key: "description", label: "Description" },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        code: item?.code ?? "",
        gst_percent: item && item.gst_percent !== undefined && item.gst_percent !== null ? String(item.gst_percent) : "",
        import_duty_percent: item && item.import_duty_percent !== undefined && item.import_duty_percent !== null ? String(item.import_duty_percent) : "",
        purchase_vat_percent: item && item.purchase_vat_percent !== undefined && item.purchase_vat_percent !== null ? String(item.purchase_vat_percent) : "",
        refund_vat_percent: item && item.refund_vat_percent !== undefined && item.refund_vat_percent !== null ? String(item.refund_vat_percent) : "",
        description: item?.description ?? "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => ({
        code: f.code.trim(),
        gst_percent: parseFloat(f.gst_percent) || 0,
        import_duty_percent: parseFloat(f.import_duty_percent) || 0,
        purchase_vat_percent: parseFloat(f.purchase_vat_percent) || 0,
        refund_vat_percent: parseFloat(f.refund_vat_percent) || 0,
        description: nullIfBlank(f.description),
        status: f.status,
      })}
      renderFields={(f, set) => (
        <>
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <TextField id="code" label="HSN Code *" required maxLength={20} placeholder="e.g. 8422.10" value={f.code} onChange={(v) => set("code", v)} />
            <TextField id="gst_percent" label="GST %" type="number" min={0} max={100} step="0.01" placeholder="0" value={f.gst_percent} onChange={(v) => set("gst_percent", v)} />
            <TextField id="import_duty_percent" label="Import Duty %" type="number" min={0} max={100} step="0.01" placeholder="0" value={f.import_duty_percent} onChange={(v) => set("import_duty_percent", v)} />
            <TextField id="purchase_vat_percent" label="Purchase VAT %" type="number" min={0} max={100} step="0.01" placeholder="0" value={f.purchase_vat_percent} onChange={(v) => set("purchase_vat_percent", v)} />
            <TextField id="refund_vat_percent" label="Refund VAT %" type="number" min={0} max={100} step="0.01" placeholder="0" value={f.refund_vat_percent} onChange={(v) => set("refund_vat_percent", v)} />
          </div>
          <TextAreaField id="description" label="Description" placeholder="Optional description..." value={f.description} onChange={(v) => set("description", v)} />
        </>
      )}
      detailFields={(h) => [
        { label: "HSN Code", value: h.code, fullWidth: true },
        { label: "GST %", value: `${h.gst_percent}%` },
        { label: "Import Duty %", value: `${h.import_duty_percent ?? 0}%` },
        { label: "Purchase VAT %", value: `${h.purchase_vat_percent ?? 0}%` },
        { label: "Refund VAT %", value: `${h.refund_vat_percent ?? 0}%` },
        { label: "Current Status", value: <StatusBadge status={h.status} /> },
        { label: "Description", value: dash(h.description), fullWidth: true },
      ]}
    />
  );
}