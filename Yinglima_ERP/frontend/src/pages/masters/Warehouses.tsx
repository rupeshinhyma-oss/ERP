/** Warehouses master page. Configurable warehouse / godown locations for Inward & Outward stock movements. */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge } from "@/components/ui";
import { TextField } from "@/components/fields";

export interface WarehouseItem {
  id: string;
  name: string;
  code: string;
  location?: string | null;
  description?: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

const EMPTY: FormState = { name: "", location: "", description: "", status: "active" };

export function WarehousesPage() {
  return (
    <MasterPage<WarehouseItem>
      activeKey="masters-warehouses"
      apiBase="/masters/warehouses"
      permissionPrefix="product"
      exportPermission="product.export"
      bulkActionPermission="product.bulk_action"
      entityName="warehouse"
      heading="Warehouses"
      newButtonLabel="+ New Warehouse"
      hideQuickAdd
      searchPlaceholder="Search warehouse name, code, location, or Sr. No..."
      columnHeaders={["Warehouse Name", "Location", "Status"]}
      columns={[
        { header: "Warehouse Name", render: (w) => <span className="cell-primary">{w.name}</span> },
        { header: "Location", render: (w) => <span style={{ color: "#475569" }}>{w.location || "—"}</span> },
        { header: "Status", render: (w) => <StatusBadge status={w.status} /> },
      ]}
      importHeaders={[
        { key: "name", label: "Warehouse Name", required: true },
        { key: "location", label: "Location" },
        { key: "description", label: "Description" },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        name: item?.name ?? "",
        location: item?.location ?? "",
        description: item?.description ?? "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => ({
        name: f.name.trim(),
        code: f.name.trim() ? `WH-${f.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 15)}` : "WH-GEN",
        location: f.location?.trim() || null,
        description: f.description?.trim() || null,
        status: f.status,
      })}
      renderFields={(f, set) => (
        <div className="form-grid">
          <TextField id="name" label="Warehouse Name *" required maxLength={150} value={f.name} onChange={(v) => set("name", v)} />
          <TextField id="location" label="Location / Address" maxLength={200} value={f.location ?? ""} onChange={(v) => set("location", v)} />
          <TextField id="description" label="Description / Remarks" maxLength={300} value={f.description ?? ""} onChange={(v) => set("description", v)} />
        </div>
      )}
      detailFields={(w) => [
        { label: "Warehouse Name", value: w.name, fullWidth: true },
        { label: "Warehouse Code", value: w.code || "—" },
        { label: "Location", value: w.location || "—" },
        { label: "Description", value: w.description || "—", fullWidth: true },
        { label: "Current Status", value: <StatusBadge status={w.status} /> },
      ]}
    />
  );
}

