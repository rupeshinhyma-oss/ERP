import { describe, it, expect } from "vitest";
import { generateImportPurchaseBillPdf } from "../importPurchasePdf";
import { generateLocalPurchaseBillPdf } from "../localPurchasePdf";
import { mapImportPurchase, mapLocalPurchase } from "../purchaseApi";

// Text that used to be printed on every bill whatever the record contained
const INVENTED = [
  "Yinglima Machinery", "Ningbo", "Nhava Sheva", "40 FT HC", "YGL-CHINA-01", "export@yinglima-pack.com", "+86-574", "IEC Code",
  "procurement@inhymasolutions.com", "27AAKFI9869H1ZL", "Supremus", "Akshata Wadekar", "Payment.Darsh", "24ACSF51727J1ZB", "S B Inks",
  "2026-27/SO/1534", "MUM51", "65.4", "12400", "Make all cheque payable", "G43 Online Printer", "Chapter 84", "archived in ERP",
];

const text = (doc: any) => doc.output() as string;

const importApi = {
  id: "ip-1", consignment_no: "EXP-86", supplier_name: "Shanghai Pack Ltd", warehouse: "Mumbai Ordered", ordered_date: "01-09-2026",
  etd_origin_date: "10-10-2026", eta_port_date: "25-10-2026", expected_arrival_date: "30-10-2026", conversion_rate: 80, customs_conversion_rate: 82,
  invoice_total_usd: 1000, invoice_total_inr: 80000, total_cbm: 20, total_import_duty: 6000, freight: 4000, insurance: 0, stamp_duty: 0,
  shipping_line_charges: 0, cfs_charges: 0, clearing_transport: 0, offloading: 0, misc_charges: 0, total_expenses: 4000, gross_total_landing: 90000,
  loading_percent_vb: 5, loading_amount_per_cbm: 200, status: "pending", created_by: "marketing", created_date: "05-10-2026",
  supplier_address: "Building 5, Pudong, Shanghai", supplier_email: "sales@shpack.test", supplier_phone: "+86 21 5555", supplier_gst: "SH-TAX-9",
  to_name: "Acme Importers", to_address: "Plot 9, Andheri, Mumbai", to_email: "buy@acme.test", to_phone: "9111111111", to_gst: "27ZZZZZ0000Z1Z0",
  items: [{ id: "i1", product_name: "Sealer", uom: "Nos", quantity: 10, pkg_unit_cbm: 0.5, pkg_qty: 1, item_total_cbm: 5, unit_rate_usd: 60, unit_rate_inr: 4800,
    item_total_usd: 600, duty_percent: 10, unit_import_duty: 492, item_total_duty: 4920, exp_per_unit_vb: 600, exp_per_unit_cb: 250,
    unit_landing_vb: 5892, unit_landing_cb: 5542, landing_diff: -350 }],
};

const localApi = {
  id: "po-1", invoice_no: "INV-77", invoice_date: "19-09-2026", supplier_name: "Local Traders", warehouse: "Ahmedabad",
  invoice_value_ex_gst: 10000, invoice_value_inc_gst: 11800, packing_forwarding: 0, transport: 0, offloading: 0, total_expenses: 0, loading_percent: 0,
  status: "confirmed", created_by: "accounts", created_date: "19-09-2026", supplier_address: "12 Ring Rd, Surat", supplier_email: "t@lt.test",
  supplier_gst: "24LTLTL0000L1Z1", to_name: "Acme Importers", to_address: "Plot 9, Andheri, Mumbai", to_email: "buy@acme.test", to_phone: "9111111111",
  to_gst: "27ZZZZZ0000Z1Z0", items: [{ id: "i1", product_name: "Roller", uom: "Nos", quantity: 10, unit_rate: 100, item_total: 1000, expense_per_unit: 0, unit_landing_value: 100 }],
};

describe("Import purchase PDF prints the record's own details only", () => {
  it("prints the real supplier, buyer, dates and rates", () => {
    const out = text(generateImportPurchaseBillPdf(mapImportPurchase(importApi, {}), { saveFile: false, openInNewTab: false }));
    for (const real of ["Shanghai Pack Ltd", "SH-TAX-9", "sales@shpack.test", "Acme Importers", "27ZZZZZ0000Z1Z0", "buy@acme.test", "EXP-86", "10-10-2026"]) {
      expect(out).toContain(real);
    }
    for (const fake of INVENTED) expect(out).not.toContain(fake);
  });

  it("prints blanks, never made-up values, when the record has no details", () => {
    const bare = mapImportPurchase({ ...importApi, supplier_name: "", supplier_address: "", supplier_email: "", supplier_phone: "", supplier_gst: "",
      to_name: "", to_address: "", to_email: "", to_phone: "", to_gst: "", consignment_no: "", ordered_date: "", etd_origin_date: null,
      eta_port_date: null, expected_arrival_date: null, total_cbm: 0, conversion_rate: 0, customs_conversion_rate: 0, remarks: null, items: [] }, {});
    const out = text(generateImportPurchaseBillPdf(bare, { saveFile: false, openInNewTab: false }));
    for (const fake of INVENTED) expect(out).not.toContain(fake);
  });
});

describe("Local purchase PDF prints the record's own details only", () => {
  it("prints the real supplier and buyer", () => {
    const out = text(generateLocalPurchaseBillPdf(mapLocalPurchase(localApi, {}), { saveFile: false, openInNewTab: false }));
    for (const real of ["Local Traders", "24LTLTL0000L1Z1", "Acme Importers", "27ZZZZZ0000Z1Z0", "INV-77", "Roller"]) expect(out).toContain(real);
    for (const fake of INVENTED) expect(out).not.toContain(fake);
  });

  it("prints blanks, never made-up values, when the record has no details", () => {
    const bare = mapLocalPurchase({ ...localApi, supplier_name: "", supplier_address: "", supplier_email: "", supplier_gst: "", to_name: "", to_address: "",
      to_email: "", to_phone: "", to_gst: "", invoice_no: "", invoice_date: "", warehouse: "", created_by: "", remarks: null, items: [] }, {});
    const out = text(generateLocalPurchaseBillPdf(bare, { saveFile: false, openInNewTab: false }));
    for (const fake of INVENTED) expect(out).not.toContain(fake);
  });
});
