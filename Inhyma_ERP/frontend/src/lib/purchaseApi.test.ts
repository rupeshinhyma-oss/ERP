import { describe, it, expect } from "vitest";
import { buildLocalPayload, mapLocalPurchase } from "./purchaseApi";
import type { WorkflowRules } from "./workflowRules";

const rules: WorkflowRules = { pending: { label: "Pending", next: ["confirmed"] }, confirmed: { label: "Confirmed", next: [] } };

const api = {
  id: "po-1", supplier_name: "Local Traders", supplier_id: "s1", warehouse: "Mumbai", invoice_no: "INV-1", invoice_date: "05-10-2026",
  invoice_value_ex_gst: 10000, invoice_value_inc_gst: 11800, packing_forwarding: 200, transport: 300, offloading: 500,
  total_expenses: 1000, loading_percent: 10, remarks: "r", bill_file_url: "/uploads/x.pdf", bill_file_name: "x.pdf",
  status: "pending", created_by: "marketing", created_date: "05-10-2026",
  supplier_address: "Addr", supplier_email: "a@b.c", supplier_phone: "1", supplier_gst: "G1",
  to_name: "Inhyma", to_address: "T addr", to_email: "t@i.c", to_phone: "2", to_gst: "G2",
  items: [{ id: "i1", product_name: "Roller", product_code: "R1", uom: "Nos", quantity: 10, unit_rate: 100, item_total: 1000, expense_per_unit: 10, unit_landing_value: 110 }],
};

describe("local purchase mapping", () => {
  it("maps API fields to the page's record, taking labels from the DB rules and keeping the status key", () => {
    const r = mapLocalPurchase(api, rules);
    expect(r).toMatchObject({
      id: "po-1", status: "Pending", status_key: "pending", basic_amount: 10000, invoice_total: 11800, transport_expense: 300,
      offloading_expense: 500, loading_expense_percent: 10, bill_file: "x.pdf", bill_file_url: "/uploads/x.pdf", added_on: "05-10-2026",
      supplier_gst: "G1", to_gst: "G2",
    });
    expect(r.items?.[0]).toMatchObject({ unit_landing_rate: 110, total_landing_rate: 1100, uom: "Nos" });
  });

  it("never invents party details: missing ones stay empty", () => {
    const r = mapLocalPurchase({ ...api, supplier_address: undefined, to_gst: undefined }, rules);
    expect(r.supplier_address).toBeUndefined();
    expect(r.to_gst).toBeUndefined();
  });

  it("builds a payload without totals, status or author", () => {
    const body = buildLocalPayload({
      supplier_name: "Local Traders", warehouse: "Mumbai", invoice_no: " INV-1 ", invoice_date: "05-10-2026", basic_amount: "10000",
      invoice_total: "11800", packing_forwarding: "200", transport: "", offloading: "500", remarks: " ",
      items: [{ product_name: " Roller ", quantity: 10, unit_rate: 100 }],
    });
    expect(body).toMatchObject({ invoice_no: "INV-1", invoice_value_ex_gst: 10000, transport: 0, offloading: 500, remarks: undefined });
    expect(body.items[0]).toEqual({ product_name: "Roller", product_code: undefined, uom: undefined, quantity: 10, unit_rate: 100 });
    for (const k of ["status", "created_by", "total_expenses", "loading_percent"]) expect(body).not.toHaveProperty(k);
  });
});

import { buildImportPayload, mapImportPurchase, type ImportFormValues } from "./purchaseApi";

const importRules: WorkflowRules = {
  pending: { label: "Pending", next: ["confirmed"], initial: true },
  confirmed: { label: "Confirmed", next: ["received"] },
};

const apiImport = {
  id: "ip-1", consignment_no: "EXP-86", supplier_name: "Yinglima", warehouse: "Mumbai Ordered", ordered_date: "01-09-2026",
  etd_origin_date: "10-10-2026", eta_port_date: "25-10-2026", expected_arrival_date: "30-10-2026", invoice_date: null,
  conversion_rate: 80, customs_conversion_rate: 82, invoice_total_usd: 1000, invoice_total_inr: 80000, total_cbm: 20, total_import_duty: 6000,
  freight: 4000, insurance: 400, stamp_duty: 100, shipping_line_charges: 1000, cfs_charges: 1500, clearing_transport: 2000, offloading: 500,
  misc_charges: 500, misc_remarks: null, total_expenses: 10000, gross_total_landing: 96000, loading_percent_vb: 12.5, loading_amount_per_cbm: 500,
  remarks: null, bill_file_name: null, bill_file_url: null, status: "confirmed", created_by: "marketing", created_date: "05-10-2026",
  updated_date: "06-10-2026", supplier_gst: "YIN", to_name: "Inhyma",
  items: [{ id: "i1", product_name: "Sealer", uom: "Nos", quantity: 10, pkg_unit_cbm: 0.5, pkg_qty: 1, item_total_cbm: 5, unit_rate_usd: 60,
    unit_rate_inr: 4800, item_total_usd: 600, duty_percent: 10, unit_import_duty: 492, item_total_duty: 4920, exp_per_unit_vb: 600,
    exp_per_unit_cb: 250, unit_landing_vb: 5892, unit_landing_cb: 5542, landing_diff: -350 }],
};

describe("import purchase mapping", () => {
  it("maps the API record into the page's shape using the DB status label and key", () => {
    const r = mapImportPurchase(apiImport, importRules);
    expect(r).toMatchObject({
      id: "ip-1", status: "Confirmed", status_key: "confirmed", exchange_rate: 80, custom_con_rate_usd_to_inr: 82, total_imp_duty: 6000,
      invoice_total_inr: 80000, total_all_expenses: 10000, loading_expense_percent: 12.5, loading_amount_per_cbm: 500, gross_total_landing: 96000,
      freight_exp: 4000, offloading_exp: 500, exp_arri_date: "30-10-2026", added_on: "05-10-2026", supplier_gst: "YIN",
    });
    expect(r.items?.[0]).toMatchObject({
      sr_no: 1, total_cbm: 5, total_usd: 600, unit_id_inr: 492, item_total_id_inr: 4920, unit_landing_rate_vb: 5892,
      unit_landing_rate_cb: 5542, diff_cb_vb: -350, total_landing_inr: 58920,
    });
  });
});

describe("import purchase payload", () => {
  const form: ImportFormValues = {
    consignment_no: " EXP-86 ", supplier_name: "Yinglima", warehouse: "Mumbai Ordered", ordered_date: "01-09-2026", invoice_date: "15-09-2026", etd_origin_date: "10-10-2026",
    eta_port_date: "", expected_arrival_date: "30-10-2026", conversion_rate: "80", customs_conversion_rate: "82", invoice_total_usd: "1000",
    total_cbm: "20", total_import_duty: "6000", freight: "4000", insurance: "", stamp_duty: "100", shipping_line_charges: "1000", cfs_charges: "1500",
    clearing_transport: "2000", offloading: "500", misc_charges: "500", misc_remarks: " ", remarks: "", items: [
      { product_name: " Sealer ", quantity: "10", unit_rate_usd: "60" }, { product_name: "  ", quantity: 1, unit_rate_usd: 1 }],
  };

  it("sends the raw inputs only: no totals, status, author or calculated landing figures", () => {
    const body = buildImportPayload(form);
    expect(body).toMatchObject({ consignment_no: "EXP-86", invoice_date: "15-09-2026", conversion_rate: 80, customs_conversion_rate: 82, freight: 4000, insurance: 0,
      eta_port_date: undefined, misc_remarks: undefined, remarks: undefined });
    expect(body.items).toEqual([{ product_name: "Sealer", quantity: 10, unit_rate_usd: 60 }]);      // blank rows are dropped
    for (const k of ["status", "created_by", "invoice_total_inr", "total_expenses", "gross_total_landing", "loading_percent_vb"]) {
      expect(body).not.toHaveProperty(k);
    }
  });
});
