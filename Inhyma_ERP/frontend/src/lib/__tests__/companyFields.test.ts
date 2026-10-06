import { describe, it, expect } from "vitest";
import {
  showsMonthlyTurnover,
  showsDirectImportCluster,
  showsImportSubFields,
  showsPotentialReason,
  showsPotentialBusinessPerMonth,
  clearInapplicableCompanyFields,
  computeAge,
} from "../companyFields";

describe("Company field visibility rules (Add Company spec)", () => {
  it("Monthly Turnover shows for B2B and B2C, not when Business Type is unset", () => {
    expect(showsMonthlyTurnover("B2B")).toBe(true);
    expect(showsMonthlyTurnover("B2C")).toBe(true);
    expect(showsMonthlyTurnover("")).toBe(false);
    expect(showsMonthlyTurnover("Something Else")).toBe(false);
  });

  it("the Direct Import from China cluster shows only for B2B", () => {
    expect(showsDirectImportCluster("B2B")).toBe(true);
    expect(showsDirectImportCluster("B2C")).toBe(false);
    expect(showsDirectImportCluster("")).toBe(false);
  });

  it("Monthly Import Volume / Products needed show only for B2B with Direct Import = Yes", () => {
    expect(showsImportSubFields("B2B", "Yes")).toBe(true);
    expect(showsImportSubFields("B2B", "No")).toBe(false);
    expect(showsImportSubFields("B2B", "")).toBe(false);
    expect(showsImportSubFields("B2C", "Yes")).toBe(false); // cluster itself is hidden for B2C
  });

  it("Potential = No shows a Reason field; Potential = Yes shows a monthly band instead", () => {
    expect(showsPotentialReason("no")).toBe(true);
    expect(showsPotentialReason("yes")).toBe(false);
    expect(showsPotentialReason("")).toBe(false);
    expect(showsPotentialBusinessPerMonth("yes")).toBe(true);
    expect(showsPotentialBusinessPerMonth("no")).toBe(false);
    expect(showsPotentialBusinessPerMonth("")).toBe(false);
  });
});

describe("clearInapplicableCompanyFields: never sends a stale value from a field the user can no longer see", () => {
  const full = {
    company_type: "B2B",
    potential: "yes",
    monthly_turnover: "25-50 L",
    potential_business_per_month: "2-5 L",
    direct_import_from_china: "Yes",
    monthly_import_volume: "10-25 L",
    products_needed_for_imports: "Flow wrap film",
  };

  it("keeps every field when every condition is met", () => {
    expect(clearInapplicableCompanyFields(full)).toEqual({
      monthly_turnover: "25-50 L",
      potential_business_per_month: "2-5 L",
      direct_import_from_china: "Yes",
      monthly_import_volume: "10-25 L",
      products_needed_for_imports: "Flow wrap film",
    });
  });

  it("clears the whole Direct Import cluster when Business Type is switched away from B2B", () => {
    const result = clearInapplicableCompanyFields({ ...full, company_type: "B2C" });
    expect(result.direct_import_from_china).toBe("");
    expect(result.monthly_import_volume).toBe("");
    expect(result.products_needed_for_imports).toBe("");
    expect(result.monthly_turnover).toBe("25-50 L"); // still applicable for B2C
  });

  it("clears Monthly Turnover when Business Type is blanked out", () => {
    expect(clearInapplicableCompanyFields({ ...full, company_type: "" }).monthly_turnover).toBe("");
  });

  it("clears Monthly Import Volume and Products Needed when Direct Import is switched to No", () => {
    const result = clearInapplicableCompanyFields({ ...full, direct_import_from_china: "No" });
    expect(result.monthly_import_volume).toBe("");
    expect(result.products_needed_for_imports).toBe("");
    expect(result.direct_import_from_china).toBe("No"); // the flag itself is still applicable (B2B)
  });

  it("clears Potential Business Per Month when Potential is switched to No", () => {
    expect(clearInapplicableCompanyFields({ ...full, potential: "no" }).potential_business_per_month).toBe("");
  });

  it("clears every conditional field at once for a brand-new, fully blank form", () => {
    const blank = {
      company_type: "", potential: "", monthly_turnover: "", potential_business_per_month: "",
      direct_import_from_china: "", monthly_import_volume: "", products_needed_for_imports: "",
    };
    expect(clearInapplicableCompanyFields(blank)).toEqual({
      monthly_turnover: "", potential_business_per_month: "", direct_import_from_china: "",
      monthly_import_volume: "", products_needed_for_imports: "",
    });
  });
});

describe("computeAge: contact Age is computed for display, never stored (spec)", () => {
  it("returns null when there is no birth date", () => {
    expect(computeAge(undefined)).toBeNull();
    expect(computeAge(null)).toBeNull();
    expect(computeAge("")).toBeNull();
  });

  it("returns null for an unparseable date rather than throwing", () => {
    expect(computeAge("not-a-date")).toBeNull();
  });

  it("computes whole years correctly, accounting for whether the birthday has passed this year", () => {
    const today = new Date();
    const y = today.getFullYear();
    // a birthday 30 years ago that has already occurred this year (or is today)
    const pastBirthday = new Date(y - 30, 0, 1);
    if (pastBirthday > today) pastBirthday.setFullYear(y - 31); // guard against Jan 1 edge case
    const iso = pastBirthday.toISOString().slice(0, 10);
    expect(computeAge(iso)).toBeGreaterThanOrEqual(29);

    // a birthday later in the year than today -- should not count this year yet
    const future = new Date(today);
    future.setDate(future.getDate() + 1);
    future.setFullYear(y - 25);
    expect(computeAge(future.toISOString().slice(0, 10))).toBe(24);
  });

  it("never returns a negative age for a future date", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 5);
    expect(computeAge(future.toISOString().slice(0, 10))).toBeNull();
  });
});
