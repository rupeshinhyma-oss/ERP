/**
 * Call Types Master Module.
 * Replicates legacy screen erp.inhymasolutions.com/call_type/list
 * with Sr. No., Name, Status, and Action.
 */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge } from "@/components/ui";
import { StatusSelectField, TextField } from "@/components/fields";
import type { CallType } from "@/types";

const EMPTY: FormState = {
  name: "",
  status: "active",
};

export function CallTypesPage() {
  return (
    <MasterPage<CallType>
      activeKey="masters-call-types"
      apiBase="/masters/call-types"
      permissionPrefix="call_type"
      exportPermission="call_type.export"
      bulkActionPermission="call_type.bulk_action"
      liveModule="call_types"
      entityName="Call Type"
      heading="Call Types"
      subtitle="Configure telecalling interaction types, client follow-up classifications, and inquiry logs."
      breadcrumbTrail={["Settings", "Masters", "Call Types"]}
      newButtonLabel="+ ADD NEW"
      searchPlaceholder="Search..."
      hideQuickAdd={true}
      modalCardStyle={{ maxWidth: "480px", width: "100%" }}
      columnHeaders={["Name", "Status"]}
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
          header: "Status",
          sortValue: (t) => t.status,
          render: (t) => <StatusBadge status={t.status} />,
        },
      ]}
      importHeaders={[
        { key: "name", label: "Name", required: true },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        name: item?.name ?? "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => ({
        name: f.name.trim(),
        status: f.status,
      })}
      validateForm={(f) => {
        const errs: Record<string, string> = {};
        if (!f.name.trim()) errs.name = "Name is required.";
        return errs;
      }}
      renderFields={(f, set, errors) => (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <TextField
            id="name"
            label="Name *"
            placeholder="e.g. Demo"
            value={f.name}
            onChange={(v) => set("name", v)}
            error={errors?.name}
            required
          />

          <StatusSelectField
            value={f.status}
            onChange={(v) => set("status", v)}
          />
        </div>
      )}
      detailFields={(t) => [
        { label: "Call Type Name", value: t.name, fullWidth: true },
        { label: "Status", value: <StatusBadge status={t.status} /> },
      ]}
      detailTitle={(t) => t.name}
    />
  );
}
