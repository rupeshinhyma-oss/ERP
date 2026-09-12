/**
 * Cities master. Ported from masters-cities.html.
 *
 * Scoped dynamically:
 * Country -> State (scoped to Country) -> District (scoped to State).
 * Persists city name, district_id, state_id, and country_id.
 */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge } from "@/components/ui";
import { SelectField, StatusSelectField, TextField } from "@/components/fields";
import { useLookup, useNameMap } from "@/lib/lookups";
import type { City, Country, District, State } from "@/types";

const EMPTY: FormState = {
  country_id: "",
  state_id: "",
  district_id: "",
  name: "",
  status: "active",
};

export function CitiesPage() {
  const countries = useLookup<Country>("/masters/countries", 250);
  const states = useLookup<State>("/masters/states", 1000);
  const districts = useLookup<District>("/masters/districts", 2000);

  const countryName = useNameMap(countries.items, (c) => c.name);
  const stateName = useNameMap(states.items, (s) => s.name);
  const districtName = useNameMap(districts.items, (d) => d.name);

  return (
    <MasterPage<City>
      activeKey="masters-cities"
      apiBase="/masters/cities"
      permissionPrefix="city"
      exportPermission="city.export"
      bulkActionPermission="city.bulk_action"
      liveModule="cities"
      entityName="city"
      heading="City Master"
      subtitle="Administrative cities, prefectures, and districts."
      breadcrumbTrail={["Master Data", "Cities"]}
      newButtonLabel="+ ADD NEW CITY"
      searchPlaceholder="Search city name or Sr. No..."
      hideQuickAdd={true}
      reloadToken={`${countries.loaded}-${states.loaded}-${districts.loaded}`}
      columnHeaders={["CITY", "DISTRICT", "STATE", "COUNTRY", "STATUS"]}
      columns={[
        { header: "CITY", render: (c) => <span className="cell-primary">{c.name}</span> },
        { header: "DISTRICT", render: (c) => (c.district_id ? districtName(c.district_id) : "—") },
        { header: "STATE", render: (c) => stateName(c.state_id) },
        { header: "COUNTRY", render: (c) => countryName(c.country_id) },
        { header: "STATUS", render: (c) => <StatusBadge status={c.status} /> },
      ]}
      importHeaders={[
        { key: "country_code", label: "Country Code", required: true },
        { key: "state_name", label: "State Name", required: true },
        { key: "district_name", label: "District Name" },
        { key: "name", label: "City Name", required: true },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        country_id: item?.country_id ?? "",
        state_id: item?.state_id ?? "",
        district_id: item?.district_id ?? "",
        name: item?.name ?? "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => {
        if (!f.country_id) throw new Error("Please select a valid Country.");
        if (!f.state_id) throw new Error("Please select a valid State.");
        return {
          country_id: f.country_id,
          state_id: f.state_id,
          district_id: f.district_id || null,
          name: f.name.trim(),
          status: f.status,
        };
      }}
      renderFields={(f, set) => {
        const scopedStates = f.country_id
          ? states.items.filter((s) => s.country_id === f.country_id)
          : states.items;

        const scopedDistricts = f.state_id
          ? districts.items.filter((d) => d.state_id === f.state_id)
          : f.country_id
            ? districts.items.filter((d) => d.country_id === f.country_id)
            : districts.items;

        return (
          <div className="form-grid">
            <SelectField
              id="country_id"
              label="Country *"
              required
              value={f.country_id}
              onChange={(v) => {
                set("country_id", v);
                // Changing country invalidates the chosen state and district.
                set("state_id", "");
                set("district_id", "");
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
              label="State *"
              required
              value={f.state_id}
              onChange={(v) => {
                set("state_id", v);
                // Changing state invalidates the chosen district.
                set("district_id", "");
              }}
            >
              <option value="">
                {scopedStates.length
                  ? "-- Select State --"
                  : f.country_id
                    ? "-- No States Found for Country! Create State First --"
                    : "-- Select Country First --"}
              </option>
              {scopedStates.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectField>

            <SelectField
              id="district_id"
              label={
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                  <span>District</span>
                  <a
                    href="/masters/districts"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open District Master to add or edit districts"
                    style={{
                      fontSize: "11px",
                      color: "#0061f2",
                      fontWeight: 600,
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "2px",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    ✏️ Edit / Manage
                  </a>
                </div>
              }
              value={f.district_id}
              onChange={(v) => set("district_id", v)}
            >
              <option value="">
                {scopedDistricts.length
                  ? "-- Select District --"
                  : f.state_id
                    ? "-- No Districts Found for State! Create District First --"
                    : "-- Select State First --"}
              </option>
              {scopedDistricts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectField>

            <TextField
              id="name"
              label="City Name *"
              required
              maxLength={150}
              value={f.name}
              onChange={(v) => set("name", v)}
            />

            <StatusSelectField value={f.status} onChange={(v) => set("status", v)} />
          </div>
        );
      }}
      detailFields={(c) => [
        { label: "City Name", value: c.name, fullWidth: true },
        { label: "District", value: c.district_id ? districtName(c.district_id) : "—" },
        { label: "State", value: stateName(c.state_id) },
        { label: "Country", value: countryName(c.country_id) },
        { label: "Current Status", value: <StatusBadge status={c.status} /> },
      ]}
    />
  );
}

export default CitiesPage;