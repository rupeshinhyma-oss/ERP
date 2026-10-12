/**
 * Conditional-visibility rules for the Company form fields added by the Add Company spec:
 * Monthly Turnover, Potential Business per month, and the Direct Import from China cluster.
 *
 * These are pure functions so the same rule is used by the save payload, the edit-load
 * mapping, and the detail drawer -- and so the rule can be unit-tested without rendering
 * the (very large) Companies page.
 */

export interface CompanyFieldsInput {
  company_type: string;
  potential: string;
  monthly_turnover: string;
  potential_business_per_month: string;
  direct_import_from_china: string;
  monthly_import_volume: string;
  products_needed_for_imports: string;
}

/** Monthly Turnover is shown once a Business Type (B2B or B2C) is chosen. */
export function showsMonthlyTurnover(companyType: string): boolean {
  return companyType === "B2B" || companyType === "B2C";
}

/** The Direct Import from China cluster is its own section, shown only for B2B. */
export function showsDirectImportCluster(companyType: string): boolean {
  return companyType === "B2B";
}

/** Monthly Import Volume / Products needed show only once Direct Import from China is Yes. */
export function showsImportSubFields(companyType: string, directImport: string): boolean {
  return showsDirectImportCluster(companyType) && directImport === "Yes";
}

/** Potential = No asks for a Reason; Potential = Yes asks for a monthly band instead. */
export function showsPotentialReason(potential: string): boolean {
  return potential === "no";
}
export function showsPotentialBusinessPerMonth(potential: string): boolean {
  return potential === "yes";
}

/**
 * Null out any field whose parent condition isn't met, so a value left over from an earlier
 * selection (e.g. switching Business Type away from B2B) is never sent to the server.
 */
export function clearInapplicableCompanyFields<T extends CompanyFieldsInput>(
  form: T
): Pick<
  T,
  "monthly_turnover" | "potential_business_per_month" | "direct_import_from_china" | "monthly_import_volume" | "products_needed_for_imports"
> {
  const directImportShown = showsDirectImportCluster(form.company_type);
  const importSubFieldsShown = showsImportSubFields(form.company_type, form.direct_import_from_china);
  return {
    monthly_turnover: (showsMonthlyTurnover(form.company_type) ? form.monthly_turnover : "") as T["monthly_turnover"],
    potential_business_per_month: (showsPotentialBusinessPerMonth(form.potential)
      ? form.potential_business_per_month
      : "") as T["potential_business_per_month"],
    direct_import_from_china: (directImportShown ? form.direct_import_from_china : "") as T["direct_import_from_china"],
    monthly_import_volume: (importSubFieldsShown ? form.monthly_import_volume : "") as T["monthly_import_volume"],
    products_needed_for_imports: (importSubFieldsShown
      ? form.products_needed_for_imports
      : "") as T["products_needed_for_imports"],
  };
}

/** Whole years from a DD-MM-YYYY or YYYY-MM-DD birth date, for display only -- never stored. */
export function computeAge(birthDate?: string | null): number | null {
  if (!birthDate) return null;
  const clean = birthDate.trim();
  if (!clean) return null;

  let dob: Date | null = null;
  // Match DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    dob = new Date(year, month, day);
  } else {
    dob = new Date(clean);
  }

  if (!dob || Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

