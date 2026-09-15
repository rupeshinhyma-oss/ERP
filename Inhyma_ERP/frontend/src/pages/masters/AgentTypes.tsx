/**
 * Agent Types master module.
 * Replicates the legacy ERP screen with Name, Status, and action triggers.
 */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge, dash } from "@/components/ui";
import { StatusSelectField, TextField } from "@/components/fields";
import type { AgentType } from "@/types";

const EMPTY: FormState = {
  name: "",
  description: "",
  status: "active",
};

export function AgentTypesPage() {
  return (
    <MasterPage<AgentType>
      activeKey="masters-agent-types"
      apiBase="/masters/agent-types"
      permissionPrefix="agenttype"
      exportPermission="agenttype.export"
      bulkActionPermission="agenttype.bulk_action"
      liveModule="agent_types"
      entityName="agent type"
      heading="Agent Types"
      subtitle="Configure agent classifications, roles, and partnership tiers."
      breadcrumbTrail={["Settings", "Masters", "Agent Types"]}
      newButtonLabel="+ ADD NEW"
      searchPlaceholder="Search Name or Sr. No..."
      hideQuickAdd={true}
      columnHeaders={["Name", "Status"]}
      columns={[
        {
          header: "Name",
          sortValue: (a) => a.name,
          render: (a) => (
            <span className="cell-primary" style={{ fontWeight: 600 }}>
              {a.name}
            </span>
          ),
        },
        {
          header: "Status",
          sortValue: (a) => a.status,
          render: (a) => <StatusBadge status={a.status} />,
        },
      ]}
      importHeaders={[
        { key: "name", label: "Name", required: true },
        { key: "description", label: "Description" },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        name: item?.name ?? "",
        description: item?.description ?? "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => ({
        name: f.name.trim(),
        description: f.description ? f.description.trim() : null,
        status: f.status,
      })}
      validateForm={(f) => {
        const errs: Record<string, string> = {};
        if (!f.name.trim()) {
          errs.name = "Name is required.";
        }
        return errs;
      }}
      renderFields={(f, set, errors) => (
        <div className="form-grid">
          <TextField
            id="name"
            label="Name *"
            required
            maxLength={100}
            placeholder="e.g. Sourcing Agent"
            value={f.name}
            error={errors?.name}
            onChange={(v) => set("name", v)}
          />
          <StatusSelectField value={f.status} onChange={(v) => set("status", v)} />
          <div style={{ gridColumn: "1 / -1" }}>
            <TextField
              id="description"
              label="Description"
              maxLength={500}
              placeholder="Optional notes or description"
              value={f.description}
              onChange={(v) => set("description", v)}
            />
          </div>
        </div>
      )}
      detailFields={(a) => [
        { label: "Name", value: a.name, fullWidth: true },
        { label: "Current Status", value: <StatusBadge status={a.status} /> },
        { label: "Description", value: dash(a.description), fullWidth: true },
      ]}
      detailTitle={(a) => a.name}
      detailSubtitle={() => "Agent Type"}
    />
  );
}
