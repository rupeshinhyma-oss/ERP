/**
 * Technicians Master Module.
 * Replicates legacy screen erp.inhymasolutions.com/technician/list
 * with Sr. No., Name, Mobile, City, Status, and Action.
 * Cities are dynamically extracted from City master (/masters/cities).
 */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge } from "@/components/ui";
import { SelectField, StatusSelectField, TextField } from "@/components/fields";
import { useLookup } from "@/lib/lookups";
import type { City, Technician } from "@/types";

const EMPTY: FormState = {
  name: "",
  mobile: "",
  city: "",
  password: "",
  status: "active",
};

export function TechniciansPage() {
  const cities = useLookup<City>("/masters/cities", 300);

  return (
    <MasterPage<Technician>
      activeKey="masters-technicians"
      apiBase="/masters/technicians"
      permissionPrefix="technician"
      exportPermission="technician.export"
      bulkActionPermission="technician.bulk_action"
      liveModule="technicians"
      entityName="Technician"
      heading="Technicians"
      subtitle="Manage service engineers, field technicians, mobile contact numbers, and deployment cities."
      breadcrumbTrail={["Settings", "Masters", "Technicians"]}
      newButtonLabel="+ ADD NEW"
      searchPlaceholder="Search..."
      hideQuickAdd={true}
      reloadToken={cities.loaded}
      modalCardStyle={{ maxWidth: "480px", width: "100%" }}
      columnHeaders={["Name", "Mobile", "City", "Status"]}
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
          header: "Mobile",
          sortValue: (t) => t.mobile,
          render: (t) => (
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
          ),
        },
        {
          header: "City",
          sortValue: (t) => t.city,
          render: (t) => <span>{t.city}</span>,
        },
        {
          header: "Status",
          sortValue: (t) => t.status,
          render: (t) => <StatusBadge status={t.status} />,
        },
      ]}
      importHeaders={[
        { key: "name", label: "Name", required: true },
        { key: "mobile", label: "Mobile", required: true },
        { key: "city", label: "City", required: true },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        name: item?.name ?? "",
        mobile: item?.mobile ?? "",
        city: item?.city ?? "",
        password: "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => ({
        name: f.name.trim(),
        mobile: f.mobile.trim(),
        city: f.city.trim(),
        password: f.password ? f.password.trim() : null,
        status: f.status,
      })}
      validateForm={(f) => {
        const errs: Record<string, string> = {};
        if (!f.name.trim()) errs.name = "Name is required.";
        if (!f.mobile.trim()) errs.mobile = "Mobile is required.";
        if (!f.city.trim()) errs.city = "City is required.";
        return errs;
      }}
      renderFields={(f, set, errors) => (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <TextField
            id="name"
            label="Name *"
            required
            maxLength={100}
            placeholder="e.g. Mangal Pandey"
            value={f.name}
            error={errors?.name}
            onChange={(v) => set("name", v)}
          />
          <TextField
            id="mobile"
            label="Mobile *"
            required
            maxLength={20}
            placeholder="e.g. 7420960969"
            value={f.mobile}
            error={errors?.mobile}
            onChange={(v) => set("mobile", v)}
          />
          <SelectField
            id="city"
            label="City *"
            required
            value={f.city}
            error={errors?.city}
            onChange={(v) => set("city", v)}
          >
            <option value="">Select</option>
            {cities.items.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
            {/* Fallback default cities if cities lookup still loading */}
            {cities.items.length === 0 && (
              <>
                <option value="Mumbai">Mumbai</option>
                <option value="Ahmedabad">Ahmedabad</option>
                <option value="Indore">Indore</option>
                <option value="Delhi">Delhi</option>
                <option value="Bangalore">Bangalore</option>
              </>
            )}
          </SelectField>
          <TextField
            id="password"
            label="Password *"
            type="password"
            maxLength={128}
            placeholder="Enter technician login password or PIN"
            value={f.password}
            error={errors?.password}
            onChange={(v) => set("password", v)}
          />
          <StatusSelectField value={f.status} onChange={(v) => set("status", v)} />
        </div>
      )}
      detailFields={(t) => [
        { label: "Technician Name", value: t.name, fullWidth: true },
        { label: "Mobile Number", value: t.mobile },
        { label: "Assigned City", value: t.city },
        { label: "Current Status", value: <StatusBadge status={t.status} /> },
      ]}
      detailTitle={(t) => t.name}
      detailSubtitle={(t) => `${t.city} | ${t.mobile}`}
    />
  );
}
