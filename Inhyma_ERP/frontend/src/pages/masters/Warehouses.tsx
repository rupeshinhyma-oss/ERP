/**
 * Warehouses Master Module.
 * Replicates legacy screen erp.inhymasolutions.com/warehouse/list
 * with Sr. No., Name, Billing Company, Over Selling, Is Primary, Status, Added On, and Action.
 */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge } from "@/components/ui";
import { SelectField, StatusSelectField, TextAreaField, TextField } from "@/components/fields";
import { useLookup } from "@/lib/lookups";
import type { Warehouse } from "@/types";

const EMPTY: FormState = {
  name: "",
  address: "",
  billing_company: "INHYMA SOLUTIONS LLP (M)",
  over_selling: "No",
  is_primary: "No",
  main_warehouse_id: "",
  color: "#2563EB",
  status: "active",
};

const BILLING_COMPANIES = [
  "INHYMA SOLUTIONS LLP (M)",
  "INHYMA SOLUTIONS LLP (G)",
  "INHYMA SOLUTIONS LLP (MP)",
  "INHYMA SOLUTIONS LLP",
];

function formatAddedOn(dateStr?: string | null): string {
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

export function WarehousesPage() {
  const warehouses = useLookup<Warehouse>("/masters/warehouses", 200);

  return (
    <MasterPage<Warehouse>
      activeKey="masters-warehouses"
      apiBase="/masters/warehouses"
      permissionPrefix="warehouse"
      exportPermission="warehouse.export"
      bulkActionPermission="warehouse.bulk_action"
      liveModule="warehouses"
      entityName="warehouse"
      heading="Warehouses"
      subtitle="Manage inventory facilities, transit depots, storage hubs, and fulfillment centers."
      breadcrumbTrail={["Settings", "Masters", "Warehouses"]}
      newButtonLabel="+ ADD NEW"
      searchPlaceholder="Search Name, Billing Company or Sr. No..."
      hideQuickAdd={true}
      reloadToken={warehouses.loaded}
      columnHeaders={["Name", "Billing Company", "Over Selling", "Is Primary", "Status", "Added On"]}
      columns={[
        {
          header: "Name",
          sortValue: (w) => w.name,
          render: (w) => (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  backgroundColor: w.color || "#2563EB",
                  display: "inline-block",
                  flexShrink: 0,
                  boxShadow: "0 0 0 1px rgba(0,0,0,0.1)",
                }}
                title={w.color}
              />
              <span className="cell-primary" style={{ fontWeight: 600 }}>
                {w.name}
              </span>
            </div>
          ),
        },
        {
          header: "Billing Company",
          sortValue: (w) => w.billing_company,
          render: (w) => <span style={{ fontWeight: 500 }}>{w.billing_company}</span>,
        },
        {
          header: "Over Selling",
          sortValue: (w) => (w.over_selling ? "Yes" : "No"),
          render: (w) => (
            <span
              style={{
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: "4px",
                fontSize: "12px",
                fontWeight: 600,
                backgroundColor: w.over_selling ? "#ecfdf5" : "#f1f5f9",
                color: w.over_selling ? "#059669" : "#64748b",
                border: w.over_selling ? "1px solid #a7f3d0" : "1px solid #e2e8f0",
              }}
            >
              {w.over_selling ? "Yes" : "No"}
            </span>
          ),
        },
        {
          header: "Is Primary",
          sortValue: (w) => (w.is_primary ? "Yes" : "No"),
          render: (w) => (
            <span
              style={{
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: "4px",
                fontSize: "12px",
                fontWeight: 600,
                backgroundColor: w.is_primary ? "#eff6ff" : "#f1f5f9",
                color: w.is_primary ? "#2563eb" : "#64748b",
                border: w.is_primary ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
              }}
            >
              {w.is_primary ? "Yes" : "No"}
            </span>
          ),
        },
        {
          header: "Status",
          sortValue: (w) => w.status,
          render: (w) => <StatusBadge status={w.status} />,
        },
        {
          header: "Added On",
          sortValue: (w) => w.created_at,
          render: (w) => (
            <span style={{ fontSize: "13px", color: "#475569", whiteSpace: "nowrap" }}>
              {formatAddedOn(w.created_at)}
            </span>
          ),
        },
      ]}
      importHeaders={[
        { key: "name", label: "Name", required: true },
        { key: "address", label: "Address", required: true },
        { key: "billing_company", label: "Billing Company", required: true },
        { key: "over_selling", label: "Over Selling" },
        { key: "is_primary", label: "Is Primary" },
        { key: "color", label: "Color" },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        name: item?.name ?? "",
        address: item?.address ?? "",
        billing_company: item?.billing_company ?? "INHYMA SOLUTIONS LLP (M)",
        over_selling: item?.over_selling ? "Yes" : "No",
        is_primary: item?.is_primary ? "Yes" : "No",
        main_warehouse_id: item?.main_warehouse_id ?? "",
        color: item?.color ?? "#2563EB",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => ({
        name: f.name.trim(),
        address: f.address.trim(),
        billing_company: f.billing_company.trim(),
        over_selling: f.over_selling === "Yes",
        is_primary: f.is_primary === "Yes",
        main_warehouse_id: f.main_warehouse_id || null,
        color: f.color || "#2563EB",
        status: f.status,
      })}
      validateForm={(f) => {
        const errs: Record<string, string> = {};
        if (!f.name.trim()) {
          errs.name = "Name is required.";
        }
        if (!f.address.trim()) {
          errs.address = "Address is required.";
        }
        if (!f.billing_company.trim()) {
          errs.billing_company = "Billing Company is required.";
        }
        return errs;
      }}
      renderFields={(f, set, errors) => (
        <div className="form-grid" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <TextField
            id="name"
            label="Name *"
            required
            maxLength={100}
            placeholder="e.g. Mumbai, Indore Ordered, Ahmedabad Transit"
            value={f.name}
            error={errors?.name}
            onChange={(v) => set("name", v)}
          />
          <TextAreaField
            id="address"
            label="Address *"
            rows={3}
            placeholder="Full physical address or facility location"
            value={f.address}
            error={errors?.address}
            onChange={(v) => set("address", v)}
          />
          <SelectField
            id="billing_company"
            label="Billing Company *"
            required
            value={f.billing_company}
            error={errors?.billing_company}
            onChange={(v) => set("billing_company", v)}
          >
            {BILLING_COMPANIES.map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </SelectField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <SelectField
              id="over_selling"
              label="Over Selling"
              value={f.over_selling}
              onChange={(v) => set("over_selling", v)}
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </SelectField>
            <SelectField
              id="is_primary"
              label="Is Primary"
              value={f.is_primary}
              onChange={(v) => set("is_primary", v)}
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </SelectField>
          </div>
          <SelectField
            id="main_warehouse_id"
            label="Select Main Warehouse"
            value={f.main_warehouse_id}
            onChange={(v) => set("main_warehouse_id", v)}
          >
            <option value="">(None - This is Main Warehouse)</option>
            {warehouses.items
              .filter((w) => w.name !== f.name)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} {w.is_primary ? "(Primary)" : ""}
                </option>
              ))}
          </SelectField>
          <div className="field">
            <label htmlFor="color">Select Color *</label>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <input
                type="color"
                id="color"
                value={f.color || "#2563EB"}
                onChange={(e) => set("color", e.target.value)}
                style={{
                  width: "42px",
                  height: "38px",
                  padding: "2px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  cursor: "pointer",
                  background: "#ffffff",
                }}
              />
              <input
                type="text"
                value={f.color || "#2563EB"}
                onChange={(e) => set("color", e.target.value)}
                placeholder="#2563EB"
                maxLength={20}
                style={{
                  flex: 1,
                  height: "38px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "14px",
                }}
              />
            </div>
          </div>
          <StatusSelectField value={f.status} onChange={(v) => set("status", v)} />
        </div>
      )}
      detailFields={(w) => [
        { label: "Name", value: w.name, fullWidth: true },
        { label: "Billing Company", value: w.billing_company, fullWidth: true },
        { label: "Address", value: w.address, fullWidth: true },
        { label: "Over Selling", value: w.over_selling ? "Yes" : "No" },
        { label: "Is Primary", value: w.is_primary ? "Yes" : "No" },
        { label: "Main Warehouse", value: w.main_warehouse_name || "—" },
        {
          label: "Color",
          value: (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  width: "16px",
                  height: "16px",
                  borderRadius: "4px",
                  backgroundColor: w.color || "#2563EB",
                  display: "inline-block",
                }}
              />
              <code>{w.color}</code>
            </div>
          ),
        },
        { label: "Current Status", value: <StatusBadge status={w.status} /> },
        { label: "Added On", value: formatAddedOn(w.created_at) },
      ]}
      detailTitle={(w) => w.name}
      detailSubtitle={(w) => `${w.billing_company} | ${w.is_primary ? "Primary Warehouse" : "Sub Warehouse"}`}
    />
  );
}
