/**
 * Districts Master.
 *
 * Scoped to Country and Province/State. Derives options dynamically from the
 * selected Country and State.
 */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge } from "@/components/ui";
import { SelectField, StatusSelectField, TextField } from "@/components/fields";
import { useLookup, useNameMap } from "@/lib/lookups";
import type { Country, District, State } from "@/types";

const EMPTY: FormState = { country_id: "", state_id: "", name: "", code: "", status: "active" };

export function DistrictsPage() {
  const countries = useLookup<Country>("/masters/countries", 250);
  const states = useLookup<State>("/masters/states", 1000);
  const countryName = useNameMap(countries.items, (c) => c.name);
  const stateName = useNameMap(states.items, (s) => s.name);

  return (
    <MasterPage<District>
      activeKey="masters-districts"
      apiBase="/masters/districts"
      permissionPrefix="district"
      exportPermission="district.export"
      bulkActionPermission="district.bulk_action"
      liveModule="districts"
      entityName="district"
      heading="District Master"
      subtitle="Administrative districts and divisions."
      breadcrumbTrail={["Master Data", "Districts"]}
      newButtonLabel="+ ADD NEW DISTRICT"
      searchPlaceholder="Search district name or Sr. No..."
      hideQuickAdd={true}
      reloadToken={`${countries.loaded}-${states.loaded}`}
      columnHeaders={["DISTRICT", "PROVINCE / STATE", "COUNTRY", "STATUS"]}
      columns={[
        { header: "DISTRICT", render: (d) => <span className="cell-primary">{d.name}</span> },
        { header: "PROVINCE / STATE", render: (d) => stateName(d.state_id) },
        { header: "COUNTRY", render: (d) => countryName(d.country_id) },
        { header: "STATUS", render: (d) => <StatusBadge status={d.status} /> },
      ]}
      importHeaders={[
        { key: "country_code", label: "Country Code", required: true },
        { key: "state_name", label: "Province / Region Name", required: true },
        { key: "name", label: "District Name", required: true },
        { key: "code", label: "District Code" },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        country_id: item?.country_id ?? "",
        state_id: item?.state_id ?? "",
        name: item?.name ?? "",
        code: item?.code ?? "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => {
        if (!f.country_id) throw new Error("Please select a valid Country.");
        if (!f.state_id) throw new Error("Please select a valid Province / State.");
        if (!f.name || !f.name.trim()) throw new Error("District Name is required.");
        return {
          country_id: f.country_id,
          state_id: f.state_id,
          name: f.name.trim(),
          code: f.code?.trim() || null,
          status: f.status,
        };
      }}
      renderFields={(f, set) => {
        const scopedStates = f.country_id
          ? states.items.filter((s) => s.country_id === f.country_id)
          : states.items;
        return (
          <div className="form-grid">
            <SelectField
              id="country_id"
              label="Country / National Level *"
              required
              value={f.country_id}
              onChange={(v) => {
                set("country_id", v);
                // Changing country invalidates the chosen province.
                set("state_id", "");
              }}
            >
              <option value="">
                {countries.items.length
                  ? "-- Select Country --"
                  : "-- No Countries Found! Create Country First --"}
              </option>
              {countries.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="state_id"
              label="Province / State *"
              required
              value={f.state_id}
              onChange={(v) => set("state_id", v)}
            >
              <option value="">
                {scopedStates.length
                  ? "-- Select Province / State --"
                  : "-- No Provinces Found! Create Province First --"}
              </option>
              {scopedStates.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectField>
            <TextField
              id="name"
              label="District Name *"
              required
              maxLength={150}
              value={f.name}
              onChange={(v) => set("name", v)}
            />
            <TextField
              id="code"
              label="District Code"
              maxLength={50}
              value={f.code}
              onChange={(v) => set("code", v)}
            />
            <StatusSelectField value={f.status} onChange={(v) => set("status", v)} />
          </div>
        );
      }}
      detailFields={(d) => [
        { label: "District Name", value: d.name, fullWidth: true },
        { label: "District Code", value: d.code || "—" },
        { label: "Province / State", value: stateName(d.state_id) },
        { label: "Country", value: countryName(d.country_id) },
        { label: "Current Status", value: <StatusBadge status={d.status} /> },
      ]}
    />
  );
}
export default DistrictsPage;
