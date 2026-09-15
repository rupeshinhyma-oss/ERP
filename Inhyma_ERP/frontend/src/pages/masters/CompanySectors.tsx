/**
 * Company Sectors master module.
 * Replicates the legacy ERP screen with Sr. No., Name, Status, Action (+ ADD NEW, Edit, Delete),
 * and bulk operations.
 */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge } from "@/components/ui";
import { StatusSelectField, TextField } from "@/components/fields";
import type { CompanySector } from "@/types";

const EMPTY: FormState = {
  name: "",
  description: "",
  status: "active",
};

export function CompanySectorsPage() {
  return (
    <MasterPage<CompanySector>
      activeKey="masters-company-sectors"
      apiBase="/masters/company-sectors"
      permissionPrefix="companysector"
      exportPermission="companysector.export"
      bulkActionPermission="companysector.bulk_action"
      liveModule="company_sectors"
      entityName="company sector"
      heading="Company Sectors"
      subtitle="Manage business sectors, industry verticals, and trade domains."
      breadcrumbTrail={["Settings", "Masters", "Company Sectors"]}
      newButtonLabel="+ ADD NEW"
      searchPlaceholder="Search Name or Sr. No..."
      hideQuickAdd={true}
      columnHeaders={["Name", "Status"]}
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
          header: "Status",
          sortValue: (c) => c.status,
          render: (c) => <StatusBadge status={c.status} />,
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
            placeholder="e.g. Agriculture, FMCG, Chemical, Automobile"
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
              placeholder="Optional sector notes or details"
              value={f.description}
              onChange={(v) => set("description", v)}
            />
          </div>
        </div>
      )}
      detailFields={(c) => [
        { label: "Name", value: c.name, fullWidth: true },
        { label: "Current Status", value: <StatusBadge status={c.status} /> },
        ...(c.description ? [{ label: "Description", value: c.description, fullWidth: true }] : []),
      ]}
      detailTitle={(c) => c.name}
      detailSubtitle={() => "Company Sector"}
    />
  );
}
