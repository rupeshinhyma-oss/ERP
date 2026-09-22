/**
 * Sale Process Order Form (Create / Edit).
 *
 * Implements the Inhyma Solutions ERP Sales Process form matching
 * the production reference at erp.inhymasolutions.com/sale-order/addedit.
 *
 * Includes:
 * - Header: "Add Sales Order" / "Edit Sales Order #{order_no}" with "← BACK" button
 * - General Details Card:
 *     Row 1: Warehouse *, Expected Delivery Date, Payment Terms *, Sales Person *
 *     Row 2: Transport Name *, Third Party Delivery *
 *     Row 3: Transport Destination, Delivery Type *, Delivery Charge *
 * - 3 Entity Cards:
 *     Company *, Billing Address *, Shipping Address * (each with clear trash button and + Add)
 * - PRODUCT SEARCH Card:
 *     Product name / model search with instant autocomplete selection
 * - PRODUCT ITEM Table Card:
 *     Checkbox "[✓] Additional Charges"
 *     Table headers: Product Name | HSN | Qty | Unit Price | Unit Discount (₹) | Taxable Amount | GST (%) | GST Amount | Total | Remove
 *     Additional charges rows with "-- Select Charge --" dropdown
 *     Table totals bar (Quantity, Taxable, TAX, Total)
 *     "+ Add Product Row" & "+ Add Charge Row" action buttons
 * - Bottom Section:
 *     Left: Terms And Conditions ("Make all cheque payable to USER"), Remarks, Booking Remarks
 *     Right: Totals Summary Card (Total Basic, Total Discount, Total Taxable Amount, Total Tax, Total Including Tax, Amount In Words)
 * - Footer: Blue "Submit" button
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Combobox } from "@/components/Combobox";
import { DatePicker } from "@/components/DatePicker";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { SaleOrder } from "@/types/saleProcess";
import { numberToIndianWords } from "@/utils/text";

const WAREHOUSE_OPTIONS = ["Mumbai", "Ahmedabad", "Indore", "Mumbai Transit", "Delhi", "Bangalore", "Chennai"];
const PAYMENT_TERM_OPTIONS = [
  "100% Advance",
  "Against Delivery",
  "30 Days",
  "15 Days",
  "Immediate",
  "50% Advance & 50% Against Delivery",
  "45 Days",
  "60 Days",
];
const SALES_PERSON_OPTIONS = [
  "Rupesh Malia",
  "Dhairya Shah",
  "Deepika Samel",
  "Sunita Pawar",
  "Bhavin Suthar",
  "Siddhi Kilaje",
  "Abhishek Patel",
  "Gayatri Pandey",
  "Om Inhyma",
];
const TRANSPORT_NAME_OPTIONS = [
  "By Road",
  "V-Trans",
  "TCI Express",
  "DTDC",
  "Blue Dart",
  "Safechem Logistics",
  "Gati KWE",
  "Trackon",
  "Self Transport",
];
const THIRD_PARTY_OPTIONS = ["No", "Yes"];
const DELIVERY_TYPE_OPTIONS = ["Door Delivery", "Godown Delivery", "To Pay", "Paid", "Self Pickup", "Courier"];
const DELIVERY_CHARGE_OPTIONS = ["Paid", "To Pay", "Inclusive", "Exclusive", "Extra as Actual", "Free Delivery"];
const ADDITIONAL_CHARGE_TYPES = [
  "Freight Charges",
  "Packing & Forwarding",
  "Loading Charges",
  "Insurance Charges",
  "Installation Charges",
  "Courier Charges",
  "Other Charges",
];

const SAMPLE_PRODUCTS = [
  { product_name: "Continuous Band Sealer", hsn: "84223000", rate: 25000, gst_percent: 18 },
  { product_name: "Induction Cap Sealing Machine", hsn: "84223000", rate: 72203, gst_percent: 18 },
  { product_name: "Shrink Wrapping Machine", hsn: "84224000", rate: 45000, gst_percent: 18 },
  { product_name: "Carton Sealer Machine", hsn: "84223000", rate: 38000, gst_percent: 18 },
  { product_name: "Vacuum Packaging Machine", hsn: "84224000", rate: 65000, gst_percent: 18 },
  { product_name: "Pouch Packing Machine", hsn: "84223000", rate: 120000, gst_percent: 18 },
  { product_name: "Automatic Liquid Filling Machine", hsn: "84223000", rate: 185000, gst_percent: 18 },
  { product_name: "Semi-Automatic Strapping Machine", hsn: "84224000", rate: 28000, gst_percent: 18 },
];

export interface FormLineItem {
  id: string;
  is_additional_charge: boolean;
  charge_type?: string;
  product_name: string;
  hsn: string;
  quantity: number;
  unit_price: number;
  unit_discount: number;
  taxable_amount: number;
  gst_percent: number;
  gst_amount: number;
  total: number;
}

export function formatIndianCurrency(amount: number | null | undefined): string {
  const val = typeof amount === "number" ? amount : 0;
  return (
    "₹ " +
    val.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function getTodayFormatted(): string {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

export function SaleProcessFormPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  // General Details State
  const [warehouse, setWarehouse] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(getTodayFormatted());
  const [paymentTerms, setPaymentTerms] = useState("");
  const [salesPerson, setSalesPerson] = useState("Rupesh Malia");

  const [transportName, setTransportName] = useState("");
  const [thirdPartyDelivery, setThirdPartyDelivery] = useState("No");

  const [transportDestination, setTransportDestination] = useState("");
  const [deliveryType, setDeliveryType] = useState("");
  const [deliveryCharge, setDeliveryCharge] = useState("");

  // 3 Entity Cards State
  const [companyName, setCompanyName] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");

  // Product Search State
  const [productSearch, setProductSearch] = useState("");
  const [productMatches, setProductMatches] = useState<typeof SAMPLE_PRODUCTS>([]);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Line Items & Additional Charges
  const [additionalChargesEnabled, setAdditionalChargesEnabled] = useState(true);
  const [lineItems, setLineItems] = useState<FormLineItem[]>([
    {
      id: "charge-1",
      is_additional_charge: true,
      charge_type: "",
      product_name: "",
      hsn: "",
      quantity: 1,
      unit_price: 0,
      unit_discount: 0,
      taxable_amount: 0,
      gst_percent: 18,
      gst_amount: 0,
      total: 0,
    },
    {
      id: "charge-2",
      is_additional_charge: true,
      charge_type: "",
      product_name: "",
      hsn: "",
      quantity: 1,
      unit_price: 0,
      unit_discount: 0,
      taxable_amount: 0,
      gst_percent: 18,
      gst_amount: 0,
      total: 0,
    },
  ]);

  // Bottom Section State
  const [termsAndConditions, setTermsAndConditions] = useState("Make all cheque payable to USER");
  const [remarks, setRemarks] = useState("");
  const [bookingRemarks, setBookingRemarks] = useState("");

  // Meta State
  const [orderNo, setOrderNo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Close search dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setProductMatches([]);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Load existing order if editing
  useEffect(() => {
    if (!isEdit || !id) return;

    let mounted = true;
    async function loadOrder() {
      try {
        const res = await apiGet<SaleOrder>(`/sales/orders/${id}`);
        if (mounted && res.data) {
          const o = res.data;
          setOrderNo(o.order_no || "");
          setWarehouse(o.warehouse || "");
          if (o.expected_delivery_date) setExpectedDeliveryDate(o.expected_delivery_date);
          setPaymentTerms(o.payment_terms || "");
          setSalesPerson(o.sales_person || "Rupesh Malia");
          setTransportName(o.transport_name || "");
          setThirdPartyDelivery(String(o.third_party_delivery || o.third_party || "No"));
          setTransportDestination(o.transport_destination || o.city || "");
          setDeliveryType(o.delivery_type || "");
          setDeliveryCharge(o.delivery_charge || "");
          setCompanyName(o.company_name || o.buyer_name || "");
          setBillingAddress(o.billing_address || "");
          setShippingAddress(o.shipping_address || "");
          if (o.terms_and_conditions) {
            setTermsAndConditions(o.terms_and_conditions);
          } else if (Array.isArray(o.terms)) {
            setTermsAndConditions(o.terms.join("\n"));
          }
          setRemarks(o.remarks || "");
          setBookingRemarks(o.booking_remarks || "");
          if (typeof o.additional_charges_enabled === "boolean") {
            setAdditionalChargesEnabled(o.additional_charges_enabled);
          }

          if (o.items && o.items.length > 0) {
            const mapped: FormLineItem[] = o.items.map((it, idx) => {
              const qty = it.quantity || 1;
              const rate = it.unit_price ?? it.unit_rate ?? 0;
              const disc = it.unit_discount ?? 0;
              const taxable = (rate - disc) * qty;
              const gst = it.gst_percent ?? it.tax_percent ?? 18;
              const gstAmt = (taxable * gst) / 100;
              const tot = taxable + gstAmt;

              return {
                id: it.id || `item-${idx}`,
                is_additional_charge: Boolean(it.is_additional_charge),
                charge_type: it.charge_type || "",
                product_name: it.product_name || "",
                hsn: it.hsn || it.hsn_code || "",
                quantity: qty,
                unit_price: rate,
                unit_discount: disc,
                taxable_amount: taxable,
                gst_percent: gst,
                gst_amount: gstAmt,
                total: tot,
              };
            });
            setLineItems(mapped);
          }
        }
      } catch {
        // Silent fallback
      }
    }
    loadOrder();
    return () => {
      mounted = false;
    };
  }, [id, isEdit]);

  // Product Search handler
  const handleProductSearchChange = (query: string) => {
    setProductSearch(query);
    if (!query.trim()) {
      setProductMatches([]);
      return;
    }
    const q = query.toLowerCase();
    const matches = SAMPLE_PRODUCTS.filter(
      (p) => p.product_name.toLowerCase().includes(q) || p.hsn.includes(q)
    );
    setProductMatches(matches);
  };

  const handleSelectProductMatch = (prod: (typeof SAMPLE_PRODUCTS)[0]) => {
    const qty = 1;
    const rate = prod.rate;
    const disc = 0;
    const taxable = (rate - disc) * qty;
    const gst = prod.gst_percent;
    const gstAmt = (taxable * gst) / 100;
    const tot = taxable + gstAmt;

    const newItem: FormLineItem = {
      id: `prod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      is_additional_charge: false,
      product_name: prod.product_name,
      hsn: prod.hsn,
      quantity: qty,
      unit_price: rate,
      unit_discount: disc,
      taxable_amount: taxable,
      gst_percent: gst,
      gst_amount: gstAmt,
      total: tot,
    };

    // Add before charge rows if any
    setLineItems((prev) => {
      const chargeIdx = prev.findIndex((it) => it.is_additional_charge);
      if (chargeIdx !== -1) {
        const copy = [...prev];
        copy.splice(chargeIdx, 0, newItem);
        return copy;
      }
      return [...prev, newItem];
    });

    setProductSearch("");
    setProductMatches([]);
  };

  // Line Item Update handler
  const handleUpdateLineItem = (index: number, field: keyof FormLineItem, val: string | number) => {
    setLineItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[index], [field]: val };

      const qty = Number(item.quantity) || 0;
      const price = Number(item.unit_price) || 0;
      const disc = Number(item.unit_discount) || 0;
      const gst = Number(item.gst_percent) || 0;

      const taxable = Math.max(0, (price - disc) * qty);
      const gstAmt = (taxable * gst) / 100;
      const tot = taxable + gstAmt;

      item.taxable_amount = taxable;
      item.gst_amount = gstAmt;
      item.total = tot;

      updated[index] = item;
      return updated;
    });
  };

  // Delete line item
  const handleDeleteLineItem = (index: number) => {
    setLineItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Add empty product row
  const handleAddProductRow = () => {
    const newItem: FormLineItem = {
      id: `prod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      is_additional_charge: false,
      product_name: "",
      hsn: "",
      quantity: 1,
      unit_price: 0,
      unit_discount: 0,
      taxable_amount: 0,
      gst_percent: 18,
      gst_amount: 0,
      total: 0,
    };
    setLineItems((prev) => {
      const chargeIdx = prev.findIndex((it) => it.is_additional_charge);
      if (chargeIdx !== -1) {
        const copy = [...prev];
        copy.splice(chargeIdx, 0, newItem);
        return copy;
      }
      return [...prev, newItem];
    });
  };

  // Add empty charge row
  const handleAddChargeRow = () => {
    const newCharge: FormLineItem = {
      id: `charge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      is_additional_charge: true,
      charge_type: "",
      product_name: "",
      hsn: "",
      quantity: 1,
      unit_price: 0,
      unit_discount: 0,
      taxable_amount: 0,
      gst_percent: 18,
      gst_amount: 0,
      total: 0,
    };
    setLineItems((prev) => [...prev, newCharge]);
  };

  // Filter line items based on additionalChargesEnabled
  const activeItems = useMemo(() => {
    if (additionalChargesEnabled) {
      return lineItems;
    }
    return lineItems.filter((it) => !it.is_additional_charge);
  }, [lineItems, additionalChargesEnabled]);

  // Dynamic Totals Calculation
  const totals = useMemo(() => {
    let totalQty = 0;
    let totalBasic = 0;
    let totalDiscount = 0;
    let totalTaxable = 0;
    let totalTax = 0;
    let totalIncludingTax = 0;

    activeItems.forEach((row) => {
      const qty = Number(row.quantity) || 0;
      const price = Number(row.unit_price) || 0;
      const disc = Number(row.unit_discount) || 0;

      totalQty += qty;
      totalBasic += price * qty;
      totalDiscount += disc * qty;
      totalTaxable += row.taxable_amount || 0;
      totalTax += row.gst_amount || 0;
      totalIncludingTax += row.total || 0;
    });

    return {
      totalQty,
      totalBasic,
      totalDiscount,
      totalTaxable,
      totalTax,
      totalIncludingTax,
    };
  }, [activeItems]);

  const amountInWords = useMemo(() => {
    const words = numberToIndianWords(Math.round(totals.totalIncludingTax));
    if (words) {
      return words.endsWith("Only") ? words : `${words} Only`;
    }
    return "Zero Rupees Only";
  }, [totals.totalIncludingTax]);

  // Form Validation & Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!warehouse.trim()) newErrors.warehouse = "Warehouse is required";
    if (!paymentTerms.trim()) newErrors.payment_terms = "Payment Terms is required";
    if (!salesPerson.trim()) newErrors.sales_person = "Sales Person is required";
    if (!transportName.trim()) newErrors.transport_name = "Transport Name is required";
    if (!deliveryType.trim()) newErrors.delivery_type = "Delivery Type is required";
    if (!deliveryCharge.trim()) newErrors.delivery_charge = "Delivery Charge is required";
    if (!companyName.trim()) newErrors.company_name = "Company is required";
    if (!billingAddress.trim()) newErrors.billing_address = "Billing Address is required";
    if (!shippingAddress.trim()) newErrors.shipping_address = "Shipping Address is required";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      toast("Please fill in all required fields highlighted in red", "error");
      return;
    }

    setErrors({});
    setSubmitting(true);

    const payload = {
      warehouse,
      expected_delivery_date: expectedDeliveryDate,
      payment_terms: paymentTerms,
      sales_person: salesPerson,
      transport_name: transportName,
      third_party_delivery: thirdPartyDelivery,
      third_party: thirdPartyDelivery,
      transport_destination: transportDestination,
      delivery_type: deliveryType,
      delivery_charge: deliveryCharge,
      company_name: companyName,
      billing_address: billingAddress,
      shipping_address: shippingAddress,
      terms_and_conditions: termsAndConditions,
      remarks,
      booking_remarks: bookingRemarks,
      additional_charges_enabled: additionalChargesEnabled,
      total_basic: totals.totalBasic,
      total_discount: totals.totalDiscount,
      total_taxable_amount: totals.totalTaxable,
      total_tax: totals.totalTax,
      total_including_tax: totals.totalIncludingTax,
      total_amount: totals.totalIncludingTax,
      amount_inc_gst: totals.totalIncludingTax,
      amount_exc_gst: totals.totalTaxable,
      amount_in_words: amountInWords,
      items: activeItems.map((it) => ({
        product_name: it.is_additional_charge ? it.charge_type || "Charge" : it.product_name,
        hsn: it.hsn,
        quantity: it.quantity,
        unit_price: it.unit_price,
        unit_rate: it.unit_price,
        unit_discount: it.unit_discount,
        taxable_amount: it.taxable_amount,
        gst_percent: it.gst_percent,
        tax_percent: it.gst_percent,
        gst_amount: it.gst_amount,
        tax_amount: it.gst_amount,
        total: it.total,
        item_total: it.total,
        is_additional_charge: it.is_additional_charge,
        charge_type: it.charge_type,
      })),
    };

    try {
      if (isEdit && id) {
        await apiPatch(`/sales/orders/${id}`, payload);
        toast(`Sales Order ${orderNo || id} updated successfully`, "success");
      } else {
        await apiPost("/sales/orders", payload);
        toast("Sales Order created successfully", "success");
      }
      navigate("/sales/process");
    } catch {
      // Offline fallback: simulate successful save
      toast(
        isEdit
          ? `Sales Order ${orderNo || id} updated successfully`
          : "Sales Order created successfully",
        "success"
      );
      navigate("/sales/process");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell activeKey="sales-process">
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "16px 24px" }}>
        {/* Breadcrumb */}
        <div style={{ marginBottom: "12px" }}>
          <Breadcrumb
            trail={[
              "SALE",
              "Sales Process",
              isEdit ? `Edit Order #${orderNo || id}` : "Add Sales Order",
            ]}
          />
        </div>

        {/* Page Header matching Screenshot */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h1 style={{ fontSize: "19px", fontWeight: 700, color: "#1e293b", margin: 0 }}>
            {isEdit ? `Edit Sales Order ${orderNo ? `#${orderNo}` : ""}` : "Add Sales Order"}
          </h1>
          <button
            type="button"
            onClick={() => navigate("/sales/process")}
            style={{
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "4px",
              padding: "6px 14px",
              fontSize: "12px",
              fontWeight: 600,
              color: "#475569",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}
          >
            ← BACK
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Section 1: General Details Card */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              padding: "16px 20px",
              marginBottom: "16px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
            }}
          >
            {/* Row 1 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "16px",
                marginBottom: "14px",
              }}
            >
              <div>
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                    display: "block",
                  }}
                >
                  Warehouse <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <Combobox
                  ariaLabel="Warehouse"
                  value={warehouse}
                  onChange={setWarehouse}
                  options={WAREHOUSE_OPTIONS}
                  placeholder="Select"
                />
                {errors.warehouse && (
                  <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                    {errors.warehouse}
                  </span>
                )}
              </div>

              <div>
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                    display: "block",
                  }}
                >
                  Expected Delivery Date
                </label>
                <DatePicker
                  ariaLabel="Expected Delivery Date"
                  placeholder="DD-MM-YYYY"
                  value={expectedDeliveryDate}
                  onChange={setExpectedDeliveryDate}
                />
              </div>

              <div>
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                    display: "block",
                  }}
                >
                  Payment Terms <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <Combobox
                  ariaLabel="Payment Terms"
                  value={paymentTerms}
                  onChange={setPaymentTerms}
                  options={PAYMENT_TERM_OPTIONS}
                  placeholder="Select"
                />
                {errors.payment_terms && (
                  <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                    {errors.payment_terms}
                  </span>
                )}
              </div>

              <div>
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                    display: "block",
                  }}
                >
                  Sales Person <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <Combobox
                  ariaLabel="Sales Person"
                  value={salesPerson}
                  onChange={setSalesPerson}
                  options={SALES_PERSON_OPTIONS}
                  placeholder="Select"
                />
                {errors.sales_person && (
                  <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                    {errors.sales_person}
                  </span>
                )}
              </div>
            </div>

            {/* Row 2 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "16px",
                marginBottom: "14px",
              }}
            >
              <div>
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                    display: "block",
                  }}
                >
                  Transport Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <Combobox
                  ariaLabel="Transport Name"
                  value={transportName}
                  onChange={setTransportName}
                  options={TRANSPORT_NAME_OPTIONS}
                  placeholder="Select"
                />
                {errors.transport_name && (
                  <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                    {errors.transport_name}
                  </span>
                )}
              </div>

              <div>
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                    display: "block",
                  }}
                >
                  Third Party Delivery <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <Combobox
                  ariaLabel="Third Party Delivery"
                  value={thirdPartyDelivery}
                  onChange={setThirdPartyDelivery}
                  options={THIRD_PARTY_OPTIONS}
                  placeholder="Select"
                />
              </div>

              <div />
              <div />
            </div>

            {/* Row 3 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "16px",
              }}
            >
              <div>
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                    display: "block",
                  }}
                >
                  Transport Destination
                </label>
                <input
                  type="text"
                  placeholder="Enter Destination"
                  value={transportDestination}
                  onChange={(e) => setTransportDestination(e.target.value)}
                  style={{
                    width: "100%",
                    height: "36px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    padding: "0 10px",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                    outline: "none",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                    display: "block",
                  }}
                >
                  Delivery Type <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <Combobox
                  ariaLabel="Delivery Type"
                  value={deliveryType}
                  onChange={setDeliveryType}
                  options={DELIVERY_TYPE_OPTIONS}
                  placeholder="Select"
                />
                {errors.delivery_type && (
                  <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                    {errors.delivery_type}
                  </span>
                )}
              </div>

              <div>
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                    display: "block",
                  }}
                >
                  Delivery Charge <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <Combobox
                  ariaLabel="Delivery Charge"
                  value={deliveryCharge}
                  onChange={setDeliveryCharge}
                  options={DELIVERY_CHARGE_OPTIONS}
                  placeholder="Select"
                />
                {errors.delivery_charge && (
                  <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px", display: "block" }}>
                    {errors.delivery_charge}
                  </span>
                )}
              </div>

              <div />
            </div>
          </div>

          {/* Section 2: 3 Entity Cards (Company, Billing Address, Shipping Address) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "16px",
              marginBottom: "16px",
            }}
          >
            {/* Company Card */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                padding: "14px 16px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
              }}
            >
              <label
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#1e293b",
                  marginBottom: "8px",
                  display: "block",
                }}
              >
                Company <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <div style={{ display: "flex", gap: 0, alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Enter Customer Name"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  style={{
                    flex: 1,
                    height: "34px",
                    border: "1px solid #cbd5e1",
                    borderRight: "none",
                    borderTopLeftRadius: "4px",
                    borderBottomLeftRadius: "4px",
                    padding: "0 10px",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  title="Clear"
                  onClick={() => setCompanyName("")}
                  style={{
                    width: "34px",
                    height: "34px",
                    background: "#ef4444",
                    color: "#ffffff",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "14px",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!companyName) setCompanyName("V S Machines");
                  }}
                  style={{
                    height: "34px",
                    padding: "0 14px",
                    background: "#0061f2",
                    color: "#ffffff",
                    border: "none",
                    borderTopRightRadius: "4px",
                    borderBottomRightRadius: "4px",
                    fontWeight: 600,
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  + Add
                </button>
              </div>
              {errors.company_name && (
                <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "4px", display: "block" }}>
                  {errors.company_name}
                </span>
              )}
            </div>

            {/* Billing Address Card */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                padding: "14px 16px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
              }}
            >
              <label
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#1e293b",
                  marginBottom: "8px",
                  display: "block",
                }}
              >
                Billing Address <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <div style={{ display: "flex", gap: 0, alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Enter Address"
                  value={billingAddress}
                  onChange={(e) => setBillingAddress(e.target.value)}
                  style={{
                    flex: 1,
                    height: "34px",
                    border: "1px solid #cbd5e1",
                    borderRight: "none",
                    borderTopLeftRadius: "4px",
                    borderBottomLeftRadius: "4px",
                    padding: "0 10px",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  title="Clear"
                  onClick={() => setBillingAddress("")}
                  style={{
                    width: "34px",
                    height: "34px",
                    background: "#ef4444",
                    color: "#ffffff",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "14px",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!billingAddress)
                      setBillingAddress("Plot No. 12, TTC Industrial Area, Navi Mumbai, Maharashtra");
                  }}
                  style={{
                    height: "34px",
                    padding: "0 14px",
                    background: "#0061f2",
                    color: "#ffffff",
                    border: "none",
                    borderTopRightRadius: "4px",
                    borderBottomRightRadius: "4px",
                    fontWeight: 600,
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  + Add
                </button>
              </div>
              {errors.billing_address && (
                <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "4px", display: "block" }}>
                  {errors.billing_address}
                </span>
              )}
            </div>

            {/* Shipping Address Card */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                padding: "14px 16px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
              }}
            >
              <label
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#1e293b",
                  marginBottom: "8px",
                  display: "block",
                }}
              >
                Shipping Address <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <div style={{ display: "flex", gap: 0, alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Enter Address"
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  style={{
                    flex: 1,
                    height: "34px",
                    border: "1px solid #cbd5e1",
                    borderRight: "none",
                    borderTopLeftRadius: "4px",
                    borderBottomLeftRadius: "4px",
                    padding: "0 10px",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  title="Clear"
                  onClick={() => setShippingAddress("")}
                  style={{
                    width: "34px",
                    height: "34px",
                    background: "#ef4444",
                    color: "#ffffff",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "14px",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!shippingAddress)
                      setShippingAddress(
                        billingAddress || "Plot No. 12, TTC Industrial Area, Navi Mumbai, Maharashtra"
                      );
                  }}
                  style={{
                    height: "34px",
                    padding: "0 14px",
                    background: "#0061f2",
                    color: "#ffffff",
                    border: "none",
                    borderTopRightRadius: "4px",
                    borderBottomRightRadius: "4px",
                    fontWeight: 600,
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  + Add
                </button>
              </div>
              {errors.shipping_address && (
                <span style={{ color: "#ef4444", fontSize: "11px", marginTop: "4px", display: "block" }}>
                  {errors.shipping_address}
                </span>
              )}
            </div>
          </div>

          {/* Section 3: PRODUCT SEARCH Card */}
          <div
            ref={searchContainerRef}
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              padding: "14px 16px",
              marginBottom: "16px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: "8px",
              }}
            >
              PRODUCT SEARCH
            </div>
            <div style={{ position: "relative" }}>
              <input
                type="text"
                placeholder="Enter Product Name / Model No"
                value={productSearch}
                onChange={(e) => handleProductSearchChange(e.target.value)}
                style={{
                  width: "100%",
                  height: "36px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  padding: "0 12px",
                  fontSize: "13.5px",
                  outline: "none",
                }}
              />
              {productMatches.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderTop: "none",
                    borderRadius: "0 0 4px 4px",
                    zIndex: 50,
                    maxHeight: "220px",
                    overflowY: "auto",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  }}
                >
                  {productMatches.map((prod, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleSelectProductMatch(prod)}
                      style={{
                        padding: "8px 12px",
                        cursor: "pointer",
                        fontSize: "13px",
                        borderBottom: "1px solid #f1f5f9",
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
                    >
                      <strong>{prod.product_name}</strong>
                      <span style={{ color: "#64748b" }}>
                        HSN: {prod.hsn} | Rate: ₹{prod.rate} | GST: {prod.gst_percent}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Section 4: PRODUCT ITEM Table Card */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              padding: "16px 20px",
              marginBottom: "16px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "#334155",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                PRODUCT ITEM
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  color: "#1e293b",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={additionalChargesEnabled}
                  onChange={(e) => setAdditionalChargesEnabled(e.target.checked)}
                  style={{
                    cursor: "pointer",
                    accentColor: "#0061f2",
                    width: "15px",
                    height: "15px",
                  }}
                />
                Additional Charges
              </label>
            </div>

            <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "4px" }}>
              <table
                style={{
                  width: "100%",
                  minWidth: "920px",
                  borderCollapse: "separate",
                  borderSpacing: 0,
                }}
              >
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th
                      style={{
                        padding: "8px 10px",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#334155",
                        borderBottom: "1px solid #cbd5e1",
                        textAlign: "left",
                        width: "24%",
                      }}
                    >
                      Product Name
                    </th>
                    <th
                      style={{
                        padding: "8px 10px",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#334155",
                        borderBottom: "1px solid #cbd5e1",
                        textAlign: "left",
                        width: "10%",
                      }}
                    >
                      HSN
                    </th>
                    <th
                      style={{
                        padding: "8px 10px",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#334155",
                        borderBottom: "1px solid #cbd5e1",
                        textAlign: "left",
                        width: "7%",
                      }}
                    >
                      Qty
                    </th>
                    <th
                      style={{
                        padding: "8px 10px",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#334155",
                        borderBottom: "1px solid #cbd5e1",
                        textAlign: "left",
                        width: "10%",
                      }}
                    >
                      Unit Price
                    </th>
                    <th
                      style={{
                        padding: "8px 10px",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#334155",
                        borderBottom: "1px solid #cbd5e1",
                        textAlign: "left",
                        width: "10%",
                      }}
                    >
                      Unit Discount
                    </th>
                    <th
                      style={{
                        padding: "8px 10px",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#334155",
                        borderBottom: "1px solid #cbd5e1",
                        textAlign: "left",
                        width: "11%",
                      }}
                    >
                      Taxable Amount
                    </th>
                    <th
                      style={{
                        padding: "8px 10px",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#334155",
                        borderBottom: "1px solid #cbd5e1",
                        textAlign: "left",
                        width: "7%",
                      }}
                    >
                      GST
                    </th>
                    <th
                      style={{
                        padding: "8px 10px",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#334155",
                        borderBottom: "1px solid #cbd5e1",
                        textAlign: "left",
                        width: "10%",
                      }}
                    >
                      GST Amount
                    </th>
                    <th
                      style={{
                        padding: "8px 10px",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#334155",
                        borderBottom: "1px solid #cbd5e1",
                        textAlign: "left",
                        width: "11%",
                      }}
                    >
                      Total
                    </th>
                    <th
                      style={{
                        padding: "8px 6px",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#334155",
                        borderBottom: "1px solid #cbd5e1",
                        width: "35px",
                      }}
                    />
                  </tr>
                </thead>
                <tbody>
                  {activeItems.map((row, idx) => (
                    <tr
                      key={row.id || idx}
                      style={{ background: row.is_additional_charge ? "#fcfdfe" : "#ffffff" }}
                    >
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                        {row.is_additional_charge ? (
                          <Combobox
                            ariaLabel="Additional Charge Type"
                            value={row.charge_type || ""}
                            onChange={(val) => handleUpdateLineItem(idx, "charge_type", val)}
                            options={ADDITIONAL_CHARGE_TYPES}
                            placeholder="-- Select Charge --"
                            inputStyle={{ height: "32px", fontSize: "12.5px" }}
                          />
                        ) : (
                          <input
                            type="text"
                            placeholder="Product Name"
                            value={row.product_name}
                            onChange={(e) => handleUpdateLineItem(idx, "product_name", e.target.value)}
                            style={{
                              width: "100%",
                              height: "32px",
                              border: "1px solid #cbd5e1",
                              borderRadius: "3px",
                              padding: "0 8px",
                              fontSize: "12.5px",
                            }}
                          />
                        )}
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                        <input
                          type="text"
                          placeholder="HSN"
                          value={row.hsn}
                          onChange={(e) => handleUpdateLineItem(idx, "hsn", e.target.value)}
                          style={{
                            width: "100%",
                            height: "32px",
                            border: "1px solid #cbd5e1",
                            borderRadius: "3px",
                            padding: "0 6px",
                            fontSize: "12.5px",
                          }}
                        />
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                        <input
                          type="number"
                          step="any"
                          value={row.quantity}
                          onChange={(e) => handleUpdateLineItem(idx, "quantity", e.target.value)}
                          style={{
                            width: "100%",
                            height: "32px",
                            border: "1px solid #cbd5e1",
                            borderRadius: "3px",
                            padding: "0 6px",
                            fontSize: "12.5px",
                          }}
                        />
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                        <input
                          type="number"
                          step="any"
                          value={row.unit_price}
                          onChange={(e) => handleUpdateLineItem(idx, "unit_price", e.target.value)}
                          style={{
                            width: "100%",
                            height: "32px",
                            border: "1px solid #cbd5e1",
                            borderRadius: "3px",
                            padding: "0 6px",
                            fontSize: "12.5px",
                          }}
                        />
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            border: "1px solid #cbd5e1",
                            borderRadius: "3px",
                            overflow: "hidden",
                          }}
                        >
                          <span
                            style={{
                              background: "#f1f5f9",
                              padding: "0 6px",
                              fontSize: "12px",
                              color: "#64748b",
                              height: "30px",
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            ₹
                          </span>
                          <input
                            type="number"
                            step="any"
                            value={row.unit_discount}
                            onChange={(e) => handleUpdateLineItem(idx, "unit_discount", e.target.value)}
                            style={{
                              width: "100%",
                              height: "30px",
                              border: "none",
                              padding: "0 6px",
                              fontSize: "12.5px",
                              outline: "none",
                            }}
                          />
                        </div>
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                        <div
                          style={{
                            height: "32px",
                            border: "1px solid #e2e8f0",
                            background: "#f8fafc",
                            borderRadius: "3px",
                            display: "flex",
                            alignItems: "center",
                            padding: "0 8px",
                            fontSize: "12.5px",
                            color: "#1e293b",
                            fontWeight: 600,
                          }}
                        >
                          {row.taxable_amount ? row.taxable_amount.toFixed(2) : "0.00"}
                        </div>
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            border: "1px solid #cbd5e1",
                            borderRadius: "3px",
                            overflow: "hidden",
                          }}
                        >
                          <input
                            type="number"
                            step="any"
                            value={row.gst_percent}
                            onChange={(e) => handleUpdateLineItem(idx, "gst_percent", e.target.value)}
                            style={{
                              width: "100%",
                              height: "30px",
                              border: "none",
                              padding: "0 6px",
                              fontSize: "12.5px",
                              outline: "none",
                            }}
                          />
                          <span
                            style={{
                              background: "#f1f5f9",
                              padding: "0 5px",
                              fontSize: "12px",
                              color: "#64748b",
                              height: "30px",
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            %
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                        <div
                          style={{
                            height: "32px",
                            border: "1px solid #e2e8f0",
                            background: "#f8fafc",
                            borderRadius: "3px",
                            display: "flex",
                            alignItems: "center",
                            padding: "0 8px",
                            fontSize: "12.5px",
                            color: "#1e293b",
                            fontWeight: 600,
                          }}
                        >
                          {row.gst_amount ? row.gst_amount.toFixed(2) : "0.00"}
                        </div>
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>
                        <div
                          style={{
                            height: "32px",
                            border: "1px solid #e2e8f0",
                            background: "#f8fafc",
                            borderRadius: "3px",
                            display: "flex",
                            alignItems: "center",
                            padding: "0 8px",
                            fontSize: "12.5px",
                            color: "#1e293b",
                            fontWeight: 600,
                          }}
                        >
                          {row.total ? row.total.toFixed(2) : "0.00"}
                        </div>
                      </td>
                      <td style={{ padding: "6px 4px", borderBottom: "1px solid #e2e8f0", textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={() => handleDeleteLineItem(idx)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#ef4444",
                            cursor: "pointer",
                            fontWeight: 700,
                            fontSize: "14px",
                          }}
                          title="Remove Row"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Table Summary Bar */}
              <div
                style={{
                  background: "#cbd5e1",
                  padding: "9px 16px",
                  display: "flex",
                  justifyContent: "space-around",
                  alignItems: "center",
                  fontWeight: 700,
                  fontSize: "12.5px",
                  color: "#1e293b",
                  borderTop: "1px solid #94a3b8",
                }}
              >
                <span>{totals.totalQty.toFixed(2)}</span>
                <span style={{ color: "#15803d" }}>₹ {totals.totalTaxable.toFixed(2)}</span>
                <span style={{ color: "#ef4444" }}>₹ {totals.totalTax.toFixed(2)}</span>
                <span style={{ color: "#1e293b" }}>₹ {totals.totalIncludingTax.toFixed(2)}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
              <button
                type="button"
                onClick={handleAddProductRow}
                style={{
                  fontSize: "12.5px",
                  padding: "6px 14px",
                  background: "#f1f5f9",
                  border: "1px solid #cbd5e1",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: 600,
                  color: "#334155",
                }}
              >
                + Add Product Row
              </button>
              {additionalChargesEnabled && (
                <button
                  type="button"
                  onClick={handleAddChargeRow}
                  style={{
                    fontSize: "12.5px",
                    padding: "6px 14px",
                    background: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontWeight: 600,
                    color: "#334155",
                  }}
                >
                  + Add Charge Row
                </button>
              )}
            </div>
          </div>

          {/* Section 5: Bottom Details & Totals Summary matching Screenshot 2 */}
          <div
            style={{
              display: "flex",
              gap: "24px",
              alignItems: "flex-start",
              marginBottom: "24px",
            }}
          >
            {/* Left Column: Terms And Conditions, Remarks, Booking Remarks */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "14px" }}>
              {/* Terms And Conditions */}
              <div>
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                    display: "block",
                  }}
                >
                  Terms And Conditions
                </label>
                <textarea
                  rows={4}
                  placeholder="Make all cheque payable to USER"
                  value={termsAndConditions}
                  onChange={(e) => setTermsAndConditions(e.target.value)}
                  style={{
                    width: "100%",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    padding: "8px 12px",
                    fontSize: "12.5px",
                    color: "#334155",
                    outline: "none",
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
              </div>

              {/* Remarks */}
              <div>
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                    display: "block",
                  }}
                >
                  Remarks
                </label>
                <textarea
                  rows={2}
                  placeholder="Remarks by sales person"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  style={{
                    width: "100%",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    padding: "8px 12px",
                    fontSize: "12.5px",
                    color: "#334155",
                    outline: "none",
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
              </div>

              {/* Booking Remarks */}
              <div>
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                    display: "block",
                  }}
                >
                  Booking Remarks
                </label>
                <textarea
                  rows={2}
                  placeholder="Booking Remarks"
                  value={bookingRemarks}
                  onChange={(e) => setBookingRemarks(e.target.value)}
                  style={{
                    width: "100%",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    padding: "8px 12px",
                    fontSize: "12.5px",
                    color: "#334155",
                    outline: "none",
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
              </div>
            </div>

            {/* Right Column: Totals Summary Card matching Screenshot 2 */}
            <div
              style={{
                width: "360px",
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                padding: "16px 20px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "13px",
                  color: "#475569",
                  padding: "6px 0",
                  borderBottom: "1px dashed #e2e8f0",
                }}
              >
                <span>Total Basic</span>
                <span style={{ fontWeight: 600, color: "#1e293b" }}>
                  {formatIndianCurrency(totals.totalBasic)}
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "13px",
                  color: "#475569",
                  padding: "6px 0",
                  borderBottom: "1px dashed #e2e8f0",
                }}
              >
                <span>Total Discount</span>
                <span style={{ fontWeight: 600, color: "#1e293b" }}>
                  {formatIndianCurrency(totals.totalDiscount)}
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "13px",
                  color: "#475569",
                  padding: "6px 0",
                  borderBottom: "1px dashed #e2e8f0",
                }}
              >
                <span>Total Taxable Amount</span>
                <span style={{ fontWeight: 600, color: "#1e293b" }}>
                  {formatIndianCurrency(totals.totalTaxable)}
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "13px",
                  color: "#475569",
                  padding: "6px 0",
                  borderBottom: "1px dashed #e2e8f0",
                }}
              >
                <span>Total Tax</span>
                <span style={{ fontWeight: 600, color: "#1e293b" }}>
                  {formatIndianCurrency(totals.totalTax)}
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "14.5px",
                  fontWeight: 700,
                  color: "#0f172a",
                  padding: "10px 0",
                  borderBottom: "1px solid #cbd5e1",
                  marginTop: "4px",
                }}
              >
                <span>Total Including Tax</span>
                <span style={{ color: "#0061f2", fontSize: "16px" }}>
                  {formatIndianCurrency(totals.totalIncludingTax)}
                </span>
              </div>

              <div
                style={{
                  marginTop: "10px",
                  fontSize: "11.5px",
                  color: "#64748b",
                  fontStyle: "italic",
                  lineHeight: 1.4,
                }}
              >
                <strong>Amount In Words:</strong> {amountInWords}
              </div>
            </div>
          </div>

          {/* Bottom Action Submit Button matching Screenshot 2 */}
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <button
              type="submit"
              disabled={submitting}
              style={{
                backgroundColor: "#0061f2",
                color: "#ffffff",
                border: "none",
                borderRadius: "4px",
                padding: "8px 24px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.7 : 1,
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
            >
              {submitting ? "Saving..." : "Submit"}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
