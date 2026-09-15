/**
 * Company Categories master module.
 * Replicates the legacy ERP screen with Name, Business Type (B2B / B2C), Status,
 * and bulk operations.
 */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge } from "@/components/ui";
import { SelectField, StatusSelectField, TextField } from "@/components/fields";
import type { CompanyCategory } from "@/types";

const EMPTY: FormState = {
  name: "",
  business_type: "B2B",
  description: "",
  status: "active",
};

export function CompanyCategoriesPage() {
  return (
    <MasterPage<CompanyCategory>
      activeKey="masters-company-categories"
      apiBase="/masters/company-categories"
      permissionPrefix="companycategory"
      exportPermission="companycategory.export"
      bulkActionPermission="companycategory.bulk_action"
      liveModule="company_categories"
      entityName="company category"
      heading="Company Categories"
      subtitle="Manage corporate tiers, business classifications (B2B/B2C), and company categories."
      breadcrumbTrail={["Settings", "Masters", "Company Categories"]}
      newButtonLabel="+ ADD NEW"
      searchPlaceholder="Search Name, Business Type or Sr. No..."
      hideQuickAdd={true}
      columnHeaders={["Name", "Business Type", "Status"]}
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
          header: "Business Type",
          sortValue: (c) => c.business_type,
          render: (c) => {
            const isB2B = c.business_type?.toUpperCase() === "B2B";
            return (
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: "12px",
                  fontWeight: 600,
                  letterSpacing: "0.5px",
                  backgroundColor: isB2B ? "#eff6ff" : "#fef3c7",
                  color: isB2B ? "#1d4ed8" : "#b45309",
                  border: isB2B ? "1px solid #bfdbfe" : "1px solid #fde68a",
                }}
              >
                {c.business_type || "B2B"}
              </span>
            );
          },
        },
        {
          header: "Status",
          sortValue: (c) => c.status,
          render: (c) => <StatusBadge status={c.status} />,
        },
      ]}
      importHeaders={[
        { key: "name", label: "Name", required: true },
        { key: "business_type", label: "Business Type", required: true },
        { key: "description", label: "Description" },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        name: item?.name ?? "",
        business_type: item?.business_type ?? "B2B",
        description: item?.description ?? "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => ({
        name: f.name.trim(),
        business_type: f.business_type?.trim() || "B2B",
        description: f.description ? f.description.trim() : null,
        status: f.status,
      })}
      validateForm={(f) => {
        const errs: Record<string, string> = {};
        if (!f.name.trim()) {
          errs.name = "Name is required.";
        }
        if (!f.business_type?.trim()) {
          errs.business_type = "Business Type is required.";
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
            placeholder="e.g. Corporate, SME, Traditional"
            value={f.name}
            error={errors?.name}
            onChange={(v) => set("name", v)}
          />
          <SelectField
            id="business_type"
            label="Business Type *"
            required
            value={f.business_type}
            error={errors?.business_type}
            onChange={(v) => set("business_type", v)}
          >
            <option value="B2B">B2B</option>
            <option value="B2C">B2C</option>
          </SelectField>
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
      detailFields={(c) => [
        { label: "Name", value: c.name, fullWidth: true },
        {
          label: "Business Type",
          value: (
            <span
              style={{
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: "4px",
                fontSize: "12px",
                fontWeight: 600,
                backgroundColor: c.business_type?.toUpperCase() === "B2B" ? "#eff6ff" : "#fef3c7",
                color: c.business_type?.toUpperCase() === "B2B" ? "#1d4ed8" : "#b45309",
              }}
            >
              {c.business_type || "B2B"}
            </span>
          ),
        },
        { label: "Current Status", value: <StatusBadge status={c.status} /> },
        ...(c.description ? [{ label: "Description", value: c.description, fullWidth: true }] : []),
      ]}
      detailTitle={(c) => c.name}
      detailSubtitle={(c) => `${c.business_type || "B2B"} Company Category`}
    />
  );
}
