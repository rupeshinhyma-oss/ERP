/**
 * Sale Process Detail & Commercial Invoice Modal.
 *
 * Provides a comprehensive, print-ready Commercial Order & Packing Slip view,
 * complete with consignment details, container/BL/LR numbers, product breakdown,
 * currency calculations in RMB (¥), and workflow status transitions.
 */

import { useEffect, useState } from "react";
import { apiGet, apiPatch, errorMessage } from "@/lib/api";
import { Auth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import type { SaleOrder, SaleOrderStatus } from "@/types/saleProcess";

interface SaleProcessDetailModalProps {
  orderId: string;
  onClose: () => void;
  onStatusUpdated?: () => void;
}

export function SaleProcessDetailModal({
  orderId,
  onClose,
  onStatusUpdated,
}: SaleProcessDetailModalProps) {
  const toast = useToast();
  const [order, setOrder] = useState<SaleOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusRemark, setStatusRemark] = useState("");
  const [showStatusModal, setShowStatusModal] = useState<SaleOrderStatus | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [activeDocTab, setActiveDocTab] = useState<"overview" | "ci" | "pl">("overview");
  const [tradeDetails, setTradeDetails] = useState<any>(null);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [ciViewMode, setCiViewMode] = useState<"standard" | "costing">("costing");

  useEffect(() => {
    let mounted = true;
    async function fetchDetails() {
      setLoading(true);
      try {
        const [res, tradeRes] = await Promise.all([
          apiGet<SaleOrder>(`/sales/orders/${orderId}`),
          apiGet<any>(`/sales/orders/${orderId}/trade-details`).catch(() => ({ data: null })),
        ]);
        if (mounted && res.data) {
          setOrder(res.data);
        }
        if (mounted && tradeRes && tradeRes.data) {
          setTradeDetails(tradeRes.data);
        }
      } catch (err) {
        if (mounted) {
          toast(errorMessage(err), "error");
          onClose();
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchDetails();
    return () => {
      mounted = false;
    };
  }, [orderId]);

  const handleStatusChange = async (newStatus: SaleOrderStatus) => {
    setUpdatingStatus(true);
    try {
      const res = await apiPatch<SaleOrder>(`/sales/orders/${orderId}/status`, {
        status: newStatus,
        remarks: statusRemark.trim() || undefined,
      });
      if (res.data) {
        setOrder(res.data);
        toast(`Order status updated to ${newStatus.replace("_", " ").toUpperCase()}`, "success");
        setShowStatusModal(null);
        setStatusRemark("");
        if (onStatusUpdated) onStatusUpdated();
      }
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    let bg = "#f1f5f9";
    let color = "#475569";
    let border = "#cbd5e1";
    let text = status.toUpperCase().replace("_", " ");

    if (s === "pending") {
      bg = "#fef3c7";
      color = "#b45309";
      border = "#fde68a";
    } else if (s === "sales_confirmed") {
      bg = "#e0f2fe";
      color = "#0369a1";
      border = "#bae6fd";
    } else if (s === "admin_approved") {
      bg = "#dcfce7";
      color = "#15803d";
      border = "#bbf7d0";
    } else if (s === "dispatched") {
      bg = "#f3e8ff";
      color = "#7e22ce";
      border = "#e9d5ff";
    } else if (s === "lr") {
      bg = "#ede9fe";
      color = "#4338ca";
      border = "#ddd6fe";
    } else if (s === "cancelled") {
      bg = "#ffe4e6";
      color = "#be123c";
      border = "#fecdd3";
    }

    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "3px 10px",
          borderRadius: "12px",
          fontSize: "12px",
          fontWeight: 700,
          background: bg,
          color: color,
          border: `1px solid ${border}`,
        }}
      >
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: color }} />
        {text}
      </span>
    );
  };

  const currencySymbol = order?.currency === "USD" ? "$" : "¥";

  const handleExportExcel = async (mode?: "internal" | "customer") => {
    const selectedMode = mode || (ciViewMode === "costing" ? "internal" : "customer");
    setExportingExcel(true);
    try {
      const token = Auth.getAccessToken() || localStorage.getItem("erp_access_token") || "";
      const res = await fetch(`/api/v1/sales/orders/${orderId}/export-trade-docs?mode=${selectedMode}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error("Failed to generate Excel trade documents");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cleanCode = (order?.consignment_code || `Order_${order?.order_no || orderId}`).replace(/[/\\?%*:|"<> ]/g, "_");
      const prefix = selectedMode === "internal" ? "Yinglima_Costing_16Col" : "Yinglima_Customer_CI";
      a.download = `${prefix}_${cleanCode}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(
        selectedMode === "internal"
          ? "Internal 16-Column Costing Sheet & Packing List downloaded (.xlsx)"
          : "Customer Commercial Invoice & Packing List downloaded (.xlsx)",
        "success"
      );
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setExportingExcel(false);
    }
  };

  const handlePrintDoc = (tab?: "ci" | "pl") => {
    const targetTab = tab || (activeDocTab === "overview" ? "ci" : activeDocTab);
    const docData = effectiveDoc;
    if (!docData) {
      toast("Trade document data not ready", "error");
      return;
    }

    const isCI = targetTab === "ci";
    const isCostingMode = isCI && ciViewMode === "costing";
    const title = isCI
      ? (isCostingMode ? "COMMERCIAL INVOICE & INTERNAL COSTING SHEET" : "COMMERCIAL INVOICE")
      : "PACKING LIST";
    const docNoLabel = isCI ? "Commercial Invoice No" : "Packing List No";

    const costingParams = docData.totals?.costing || {
      ocean_freight_usd: Number(order?.ocean_freight_usd) || 0,
      local_charges_coc_usd: Number(order?.local_charges_coc_usd) || 0,
      usd_exchange_rate: Number(order?.usd_exchange_rate) || 6.70,
      profit_percent: Number(order?.profit_percent) || 3.0,
      total_container_cbm: Number(order?.total_container_cbm) || 0,
    };
    const totalFreightUsd = (Number(costingParams.ocean_freight_usd) || 0) + (Number(costingParams.local_charges_coc_usd) || 0);
    const containerCbm = Number(costingParams.total_container_cbm) || Number(docData.totals?.cbm) || 0;
    const freightPerCbm = containerCbm > 0 ? totalFreightUsd / containerCbm : 0;
    const totalSupplierPayableRmb = (docData.items || []).reduce(
      (sum: number, it: any) => sum + (Number(it.total_supplier_amount_rmb) || (Number(it.unit_price_rmb_with_vat || 0) * Number(it.quantity || 0))),
      0
    );
    const totalItemCbm = (docData.items || []).reduce((sum: number, it: any) => sum + (Number(it.total_cbm) || 0), 0);

    const itemsRows = isCI
      ? (isCostingMode
          ? docData.items
              .map(
                (it: any) => `
            <tr>
              <td style="text-align:center; padding: 4px 2px;">${it.sr_no}</td>
              <td style="padding: 4px 6px; font-weight:600;">${it.description}</td>
              <td style="text-align:center; padding: 4px 3px;">${it.hs_code || "—"}</td>
              <td style="text-align:center; padding: 4px 2px;">${it.uom}</td>
              <td style="text-align:right; padding: 4px 3px; font-weight:700;">${Number(it.quantity).toLocaleString()}</td>
              <td style="text-align:right; padding: 4px 3px;">$${Number(it.unit_price_usd).toFixed(2)}</td>
              <td style="text-align:right; padding: 4px 3px; font-weight:700; color:#1e3a8a;">$${Number(it.total_amount_usd).toFixed(2)}</td>
              <td style="text-align:right; padding: 4px 3px;">¥${Number(it.unit_price_rmb_with_vat || it.unit_price_rmb || 0).toFixed(2)}</td>
              <td style="text-align:right; padding: 4px 3px;">¥${Number(it.unit_price_rmb_ex_vat || (Number(it.unit_price_rmb_with_vat || it.unit_price_rmb || 0) / 1.13)).toFixed(2)}</td>
              <td style="text-align:right; padding: 4px 3px;">¥${Number(it.including_profit_rmb || (Number(it.unit_price_rmb_ex_vat || 0) * (1 + (costingParams.profit_percent || 3) / 100))).toFixed(2)}</td>
              <td style="text-align:right; padding: 4px 3px;">$${Number(it.fob_price_usd || 0).toFixed(3)}</td>
              <td style="text-align:right; padding: 4px 3px;">$${Number(it.freight_per_unit_usd || 0).toFixed(3)}</td>
              <td style="text-align:right; padding: 4px 3px; font-weight:700;">$${Number(it.cfr_price_usd || it.unit_price_usd || 0).toFixed(2)}</td>
              <td style="text-align:center; padding: 4px 3px; font-size:8px;">${it.supplier_name || "—"}</td>
              <td style="text-align:right; padding: 4px 3px;">${Number(it.total_cbm || 0).toFixed(3)}</td>
              <td style="text-align:right; padding: 4px 3px; font-weight:700;">¥${Number(it.total_supplier_amount_rmb || (Number(it.unit_price_rmb_with_vat || 0) * Number(it.quantity || 0))).toFixed(2)}</td>
            </tr>`
              )
              .join("")
          : docData.items
              .map(
                (it: any) => `
            <tr>
              <td style="text-align:center; padding: 5px 4px;">${it.sr_no}</td>
              <td style="padding: 5px 8px;">${it.description}</td>
              <td style="text-align:center; padding: 5px 6px;">${it.hs_code || "—"}</td>
              <td style="text-align:center; padding: 5px 6px;">${it.uom}</td>
              <td style="text-align:right; padding: 5px 6px;">${Number(it.quantity).toLocaleString()}</td>
              <td style="text-align:right; padding: 5px 6px;">$${Number(it.unit_price_usd).toFixed(2)}</td>
              <td style="text-align:right; padding: 5px 6px; font-weight:700;">$${Number(it.total_amount_usd).toFixed(2)}</td>
            </tr>`
              )
              .join("")
        )
      : docData.items
          .map(
            (it: any) => `
        <tr>
          <td style="text-align:center; padding: 5px 4px;">${it.sr_no}</td>
          <td style="padding: 5px 8px;">${it.description}</td>
          <td style="text-align:right; padding: 5px 6px;">${Number(it.quantity).toLocaleString()}</td>
          <td style="text-align:right; padding: 5px 6px;">${it.packages}</td>
          <td style="text-align:center; padding: 5px 6px;">${it.uom}</td>
          <td style="text-align:right; padding: 5px 6px;">${Number(it.net_weight).toFixed(2)}</td>
          <td style="text-align:right; padding: 5px 6px;">${Number(it.gross_weight).toFixed(2)}</td>
        </tr>`
          )
          .join("");

    const totalsRow = isCI
      ? (isCostingMode
          ? `
            <tr style="background:#fef08a; font-weight:800; font-size:9px;">
              <td colspan="4" style="text-align:right; padding: 6px 6px;">Total Price CIF INDIA:</td>
              <td style="text-align:right; padding: 6px 3px;">${Number(docData.totals.quantity).toLocaleString()}</td>
              <td style="text-align:right; padding: 6px 3px;"></td>
              <td style="text-align:right; padding: 6px 3px;">$${Number(docData.totals.total_amount_usd).toFixed(2)}</td>
              <td colspan="7" style="text-align:right; padding: 6px 3px;"></td>
              <td style="text-align:right; padding: 6px 3px;">${totalItemCbm.toFixed(3)} m³</td>
              <td style="text-align:right; padding: 6px 3px;">¥${totalSupplierPayableRmb.toFixed(2)}</td>
            </tr>`
          : `
            <tr style="background:#fef08a; font-weight:800;">
              <td colspan="4" style="text-align:center; padding: 6px 10px;">Total Price CIF INDIA:</td>
              <td style="text-align:right; padding: 6px 6px;">${Number(docData.totals.quantity).toLocaleString()}</td>
              <td style="text-align:right; padding: 6px 6px;"></td>
              <td style="text-align:right; padding: 6px 6px;">$${Number(docData.totals.total_amount_usd).toFixed(2)}</td>
            </tr>`
        )
      : `
        <tr style="background:#fef08a; font-weight:800;">
          <td colspan="2" style="text-align:center; padding: 6px 10px;">Total</td>
          <td style="text-align:right; padding: 6px 6px;">${Number(docData.totals.quantity).toLocaleString()}</td>
          <td style="text-align:right; padding: 6px 6px;">${Number(docData.totals.packages).toLocaleString()}</td>
          <td style="padding: 6px 6px;"></td>
          <td style="text-align:right; padding: 6px 6px;">${Number(docData.totals.net_weight).toFixed(2)}</td>
          <td style="text-align:right; padding: 6px 6px;">${Number(docData.totals.gross_weight).toFixed(2)}</td>
        </tr>`;

    const tableThead = isCI
      ? (isCostingMode
          ? `
            <thead>
              <tr style="background: #1e3a8a; color: #ffffff; text-align: center; font-size: 8.5px;">
                <th style="padding: 5px 2px; width: 3%;">SR.NO</th>
                <th style="padding: 5px 4px; text-align: left; width: 17%;">DESCRIPTION</th>
                <th style="padding: 5px 3px; width: 7%;">CHINA HS CODE</th>
                <th style="padding: 5px 2px; width: 4%;">UOM</th>
                <th style="padding: 5px 3px; width: 5%;">QUANTITY</th>
                <th style="padding: 5px 3px; width: 6%;">UNIT PRICE (USD)</th>
                <th style="padding: 5px 3px; width: 7%;">TOTAL AMOUNT (USD)</th>
                <th style="padding: 5px 3px; width: 6.5%;">UNIT PRICE (RMB) INCL VAT</th>
                <th style="padding: 5px 3px; width: 6.5%;">UNIT PRICE (RMB) EXCL VAT</th>
                <th style="padding: 5px 3px; width: 5%;">INCL. PROFIT ${costingParams.profit_percent || 3}%</th>
                <th style="padding: 5px 3px; width: 6%;">FOB PRICE (USD)</th>
                <th style="padding: 5px 3px; width: 6%;">FREIGHT/LOCAL</th>
                <th style="padding: 5px 3px; width: 6%;">CFR PRICE</th>
                <th style="padding: 5px 3px; width: 7%;">SUPPLIER</th>
                <th style="padding: 5px 3px; width: 5%;">TOTAL CBM</th>
                <th style="padding: 5px 3px; width: 7%;">TOTAL SUPPLIER (RMB)</th>
              </tr>
            </thead>`
          : `
            <thead>
              <tr style="background: #1e3a8a; color: #ffffff; text-align: center;">
                <th style="padding: 6px 4px; width: 5%;">SR.NO</th>
                <th style="padding: 6px 8px; text-align: left; width: 43%;">DESCRIPTION</th>
                <th style="padding: 6px 6px; width: 14%;">CHINA HS CODE</th>
                <th style="padding: 6px 6px; width: 8%;">UOM</th>
                <th style="padding: 6px 6px; width: 10%;">QUANTITY</th>
                <th style="padding: 6px 6px; width: 10%;">UNIT PRICE (USD)</th>
                <th style="padding: 6px 6px; width: 10%;">TOTAL AMOUNT (USD)</th>
              </tr>
            </thead>`
        )
      : `
        <thead>
          <tr style="background: #1e3a8a; color: #ffffff; text-align: center;">
            <th rowspan="2" style="padding: 6px 4px; width: 5%;">SR.NO</th>
            <th rowspan="2" style="padding: 6px 8px; text-align: left; width: 42%;">DESCRIPTION</th>
            <th rowspan="2" style="padding: 6px 6px; width: 15%;">QUANTITY (KGS/PCS)</th>
            <th rowspan="2" style="padding: 6px 6px; width: 10%;">PACKAGE</th>
            <th rowspan="2" style="padding: 6px 6px; width: 8%;">UOM</th>
            <th colspan="2" style="padding: 4px 6px; width: 20%;">TOTAL IN KG</th>
          </tr>
          <tr style="background: #1e3a8a; color: #ffffff; text-align: center;">
            <th style="padding: 4px 6px; width: 10%;">NET WEIGHT</th>
            <th style="padding: 4px 6px; width: 10%;">GR. WEIGHT</th>
          </tr>
        </thead>`;

    const termsHtml = isCI
      ? `
        <div style="border: 1px solid #94a3b8; padding: 6px 12px; margin-bottom: 10px; font-size: 11px; line-height: 1.6;">
          <div><strong>Terms of Payment:</strong> ${docData.payment_terms}</div>
          <div><strong>Shipping Terms:</strong> ${docData.shipping_terms}</div>
          <div><strong>Delivery Time:</strong> ${docData.delivery_time}</div>
        </div>`
      : `
        <div style="border: 1px solid #94a3b8; padding: 6px 12px; margin-bottom: 10px; font-size: 11px; line-height: 1.6;">
          <div><strong>Shipping Terms:</strong> ${docData.shipping_terms}</div>
        </div>`;

    const costingBannerHtml = isCostingMode
      ? `
        <div style="background: #f1f5f9; border: 1px solid #94a3b8; padding: 6px 10px; margin-bottom: 10px; font-size: 10px; display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; text-align: center;">
          <div><strong style="color:#64748b;">Ocean Freight:</strong> <span style="font-weight:700;">$${Number(costingParams.ocean_freight_usd || 0).toFixed(2)}</span></div>
          <div><strong style="color:#64748b;">Local & COC:</strong> <span style="font-weight:700;">$${Number(costingParams.local_charges_coc_usd || 0).toFixed(2)}</span></div>
          <div><strong style="color:#64748b;">USD Rate:</strong> <span style="font-weight:700;">¥${Number(costingParams.usd_exchange_rate || 6.70).toFixed(4)}</span></div>
          <div><strong style="color:#64748b;">Profit Margin:</strong> <span style="font-weight:700;">${costingParams.profit_percent || 3}%</span></div>
          <div><strong style="color:#64748b;">Container Volume:</strong> <span style="font-weight:700;">${containerCbm.toFixed(3)} m³</span></div>
          <div><strong style="color:#64748b;">Freight / CBM:</strong> <span style="font-weight:700; color:#1d4ed8;">$${freightPerCbm.toFixed(2)}/m³</span></div>
        </div>`
      : "";

    const sectionTitle = isCI
      ? (isCostingMode ? "SHIPMENT, COSTING & SUPPLIER BREAKDOWN" : "SHIPMENT & PRODUCT ITEMS")
      : "PACKING INFORMATION";

    const printDocHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${docData.consignment_code} - ${title}</title>
          <style>
            @page {
              size: ${isCostingMode ? "A4 landscape" : "A4 portrait"};
              margin: ${isCostingMode ? "8mm 6mm 8mm 6mm" : "12mm 10mm 12mm 10mm"};
            }
            * {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            body {
              font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
              color: #0f172a;
              background: #ffffff;
              margin: 0;
              padding: 0;
              font-size: ${isCostingMode ? "9.5px" : "11px"};
              line-height: 1.35;
            }
            .header {
              text-align: center;
              border-bottom: 2px solid #1e3a8a;
              padding-bottom: 8px;
              margin-bottom: 10px;
            }
            .company-name {
              font-size: ${isCostingMode ? "16px" : "17px"};
              font-weight: 800;
              color: #1e3a8a;
              letter-spacing: 0.5px;
              margin: 0 0 3px 0;
            }
            .company-contact {
              font-size: 10px;
              color: #475569;
              margin: 2px 0;
            }
            .doc-title {
              background: #f1f5f9;
              border: 1px solid #cbd5e1;
              text-align: center;
              font-size: ${isCostingMode ? "14px" : "15px"};
              font-weight: 800;
              letter-spacing: 1px;
              padding: 5px 0;
              margin-bottom: 10px;
              border-radius: 3px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 10px;
              font-size: ${isCostingMode ? "9px" : "11px"};
            }
            th, td {
              border: 1px solid #94a3b8;
              padding: ${isCostingMode ? "4px 3px" : "5px 6px"};
            }
            th {
              font-weight: 700;
            }
            .party-th {
              background: #e2e8f0;
              font-weight: 700;
              padding: 5px 10px;
              text-align: left;
              width: 50%;
            }
            .items-table {
              page-break-inside: auto;
            }
            .items-table thead {
              display: table-header-group;
            }
            .items-table tfoot {
              display: table-footer-group;
            }
            .items-table tr {
              page-break-inside: avoid;
              page-break-after: auto;
            }
            .items-table th {
              color: #ffffff !important;
            }
            .non-breaking {
              page-break-inside: avoid !important;
            }
            .bank-table {
              width: 100%;
              border-collapse: collapse;
              page-break-inside: avoid !important;
            }
          </style>
        </head>
        <body>
          <div class="non-breaking">
            <div class="header">
              <div class="company-name">${docData.shipper.company_name}</div>
              <div class="company-contact">
                Email: ${docData.shipper.email} | Mobile: ${docData.shipper.phone} | WeChat: ${docData.shipper.wechat}
              </div>
              <div class="company-contact">
                Address: ${docData.shipper.address}
              </div>
            </div>

            <div class="doc-title">${title}</div>

            <table>
              <tr>
                <td style="width: 25%; font-weight: 700; background: #f8fafc;">${docNoLabel}</td>
                <td style="width: 40%; font-weight: 700;">${docData.consignment_code}</td>
                <td style="width: 15%; font-weight: 700; background: #f8fafc; text-align: center;">Date</td>
                <td style="width: 20%; font-weight: 700; text-align: right;">${docData.order_date}</td>
              </tr>
            </table>

            <table>
              <tr>
                <th class="party-th">Shipper's Information</th>
                <th class="party-th">Recipient's Information</th>
              </tr>
              <tr>
                <td style="vertical-align: top; width: 50%;">
                  <strong>${docData.shipper.company_name}</strong><br />
                  ${docData.shipper.address}<br />
                  <strong>Contact:</strong> ${docData.shipper.contact_person}<br />
                  <strong>Phone:</strong> ${docData.shipper.phone}<br />
                  <strong>Email:</strong> ${docData.shipper.email}
                </td>
                <td style="vertical-align: top; width: 50%;">
                  <strong>${docData.recipient.company_name || "—"}</strong><br />
                  <span style="white-space: pre-line;">${docData.recipient.address || "—"}</span><br />
                  <strong>Contact:</strong> ${docData.recipient.contact_person || "—"}<br />
                  <strong>Phone:</strong> ${docData.recipient.phone || "—"}<br />
                  <strong>Email:</strong> ${docData.recipient.email || "—"}
                </td>
              </tr>
            </table>

            ${termsHtml}

            ${costingBannerHtml}

            <div style="background: #e2e8f0; padding: 5px 10px; font-weight: 700; border: 1px solid #94a3b8; border-bottom: none; font-size: 10.5px;">
              ${sectionTitle}
            </div>
          </div>

          <table class="items-table">
            ${tableThead}
            <tbody>
              ${itemsRows}
              ${totalsRow}
            </tbody>
          </table>

          <div class="non-breaking" style="margin-top: 12px;">
            <table class="bank-table">
              <tr>
                <td style="width: 58%; vertical-align: top; padding: 8px 12px; background: #fafafa;">
                  <div style="font-weight: 800; color: #1e3a8a; margin-bottom: 6px;">
                    BANK ACCOUNT DETAILS FOR INWARD REMITTANCE USD
                  </div>
                  <div><strong>RECEIVING BANK:</strong> ${docData.bank_details.bank_name}</div>
                  <div><strong>SWIFT/BIC:</strong> ${docData.bank_details.swift_bic}</div>
                  <div><strong>BENEFICIARY NAME:</strong> ${docData.bank_details.beneficiary_name}</div>
                  <div><strong>ADDRESS:</strong> ${docData.bank_details.address}</div>
                  <div><strong>A/C NO.:</strong> ${docData.bank_details.account_no}</div>
                </td>
                <td style="width: 42%; vertical-align: middle; text-align: center; padding: 8px;">
                  <div style="font-weight: 700; font-size: 11px; margin-bottom: 4px;">
                    Shipper's Signature and Stamp:
                  </div>
                  <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; margin-top: 2px;">
                    <img src="/yinglima_signature.png" alt="Signature" style="height: 38px; object-fit: contain;" />
                    <img src="/yinglima_stamp.jpeg" alt="Stamp" style="height: 48px; object-fit: contain;" />
                  </div>
                </td>
              </tr>
            </table>

            <div style="text-align: center; font-size: 10.5px; font-weight: 700; color: #334155; margin-top: 8px;">
              ${docData.declaration}
            </div>
          </div>
        </body>
      </html>
    `;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      window.print();
      return;
    }

    doc.open();
    doc.write(printDocHtml);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch (_) {}
      }, 1000);
    }, 300);
  };

  const effectiveDoc = tradeDetails || (order ? {
    order_no: order.order_no,
    consignment_code: order.consignment_code || `YL-EXP${new Date().getFullYear()}-${order.order_no.split("/").pop()}`,
    order_date: order.order_date,
    payment_terms: "Full Payment After Documents",
    shipping_terms: "CIF INDIA",
    delivery_time: "Within 25 Working Days",
    shipper: {
      company_name: "YINGLIMA IMPORT&EXPORT (WENZHOU) CO., LTD.",
      address: "Room 602, Sixth floor, Jinyu Business Building, Wenzhou Avenue, Nanhui Street, Lucheng District, Wenzhou City, Zhejiang Province",
      contact_person: "Mr. Pawan Parulekar",
      phone: "150-6827-0160",
      wechat: "+91 8108294930",
      email: "sales.yinglima@gmail.com",
    },
    recipient: {
      company_name: order.buyer_name || "",
      address: order.buyer_branch_name ? `${order.buyer_branch_name}` : "",
      contact_person: "",
      phone: "",
      email: "",
    },
    bank_details: {
      bank_name: "INDUSTRIAL AND COMMERCIAL BANK OF CHINA, ZHEJIANG BRANCH",
      swift_bic: "ICBKCNBJZJP",
      beneficiary_name: "YINGLIMA IMPORT&EXPORT (WENZHOU) CO., LTD.",
      address: "ROOM 1106 18, BUILDING 4, DEVELOPMENT BUILDING, NO.66, LINGRONG STREET, LINGKUN STREET, OUJIANGKOU INDUSTRIAL CLUSTER, WENZHOU, ZHEJIANG",
      account_no: "1203202009814645910",
    },
    declaration: "We hereby declare that above information is true and correct.",
    items: (order.items || []).map((it, idx) => ({
      sr_no: idx + 1,
      description: it.product_name,
      product_code: it.product_code || "",
      hs_code: it.hsn_code || "",
      uom: it.uom || "NOS",
      quantity: Number(it.quantity),
      unit_price_usd: Number(it.unit_rate),
      total_amount_usd: Number(it.item_total),
      unit_price_rmb: Number(it.unit_rate) * 7.14,
      packages: Math.max(1, Math.ceil(Number(it.quantity) || 1)),
      net_weight: 0,
      gross_weight: 0,
      cbm: Number(it.total_cbm) || 0,
      supplier_id: it.supplier_id || null,
      supplier_name: it.supplier_name || "—",
      unit_price_rmb_with_vat: Number(it.unit_price_rmb_with_vat) || 0,
      unit_price_rmb_ex_vat: Number(it.unit_price_rmb_ex_vat) || 0,
      profit_percent: Number(it.profit_percent) || 3.0,
      fob_price_usd: Number(it.fob_price_usd) || 0,
      freight_unit_usd: Number(it.freight_unit_usd) || 0,
      cfr_price_usd: Number(it.cfr_price_usd) || Number(it.unit_rate),
      cbm_per_unit: Number(it.cbm_per_unit) || 0,
      total_cbm: Number(it.total_cbm) || 0,
      total_supplier_amount_rmb: Number(it.total_supplier_amount_rmb) || 0,
      remarks: it.remarks || "",
    })),
    totals: {
      quantity: Number(order.total_quantity),
      packages: Math.max(1, Math.ceil(Number(order.total_quantity) || 1)),
      total_amount_usd: Number(order.total_amount),
      total_amount_rmb: Number(order.total_amount) * 7.14,
      net_weight: 0,
      gross_weight: 0,
      cbm: Number(order.total_container_cbm) || 0,
      costing: {
        ocean_freight_usd: Number(order.ocean_freight_usd) || 0,
        local_charges_coc_usd: Number(order.local_charges_coc_usd) || 0,
        usd_exchange_rate: Number(order.usd_exchange_rate) || 6.70,
        profit_percent: Number(order.profit_percent) || 3.0,
        total_container_cbm: Number(order.total_container_cbm) || 0,
      },
    },
  } : null);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        zIndex: 9999,
        padding: isFullScreen ? "0" : "20px 20px",
        boxSizing: "border-box",
        overflowY: "auto",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: isFullScreen ? "0" : "12px",
          width: "100%",
          maxWidth: isFullScreen ? "100vw" : "1350px",
          height: isFullScreen ? "100vh" : "calc(100vh - 40px)",
          maxHeight: isFullScreen ? "100vh" : "calc(100vh - 40px)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.35)",
          overflow: "hidden",
          transition: "all 0.15s ease-in-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            flexShrink: 0,
            padding: "14px 24px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#f8fafc",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                background: "#eff6ff",
                color: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "18px",
                fontWeight: 700,
              }}
            >
              📋
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                  Sale Process Order: {order?.order_no || "Loading..."}
                </h2>
                {order && getStatusBadge(order.status)}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                Consignment:{" "}
                <strong style={{ color: "#1e293b" }}>{order?.consignment_code || "N/A"}</strong> |
                Buyer: <strong style={{ color: "#1e293b" }}>{order?.buyer_name || "N/A"}</strong>
              </div>
            </div>
          </div>

          {/* Center Tabs: Order vs Official CI vs Official Packing List */}
          <div className="no-print" style={{ display: "flex", alignItems: "center", gap: "4px", background: "#f1f5f9", padding: "3px", borderRadius: "8px" }}>
            <button
              type="button"
              onClick={() => setActiveDocTab("overview")}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "none",
                background: activeDocTab === "overview" ? "#ffffff" : "transparent",
                color: activeDocTab === "overview" ? "#0f172a" : "#64748b",
                fontWeight: activeDocTab === "overview" ? 700 : 500,
                fontSize: "12.5px",
                cursor: "pointer",
                boxShadow: activeDocTab === "overview" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              📋 Order Overview
            </button>
            <button
              type="button"
              onClick={() => setActiveDocTab("ci")}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "none",
                background: activeDocTab === "ci" ? "#ffffff" : "transparent",
                color: activeDocTab === "ci" ? "#1e3a8a" : "#64748b",
                fontWeight: activeDocTab === "ci" ? 700 : 500,
                fontSize: "12.5px",
                cursor: "pointer",
                boxShadow: activeDocTab === "ci" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              📄 Commercial Invoice (CI)
            </button>
            <button
              type="button"
              onClick={() => setActiveDocTab("pl")}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "none",
                background: activeDocTab === "pl" ? "#ffffff" : "transparent",
                color: activeDocTab === "pl" ? "#1e3a8a" : "#64748b",
                fontWeight: activeDocTab === "pl" ? 700 : 500,
                fontSize: "12.5px",
                cursor: "pointer",
                boxShadow: activeDocTab === "pl" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              📦 Packing List (PL)
            </button>
          </div>

          {/* Action Toolbar */}
          <div className="no-print" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => handleExportExcel(ciViewMode === "costing" ? "internal" : "customer")}
              disabled={exportingExcel}
              style={{
                padding: "6px 13px",
                borderRadius: "6px",
                border: "1px solid #16a34a",
                background: "#f0fdf4",
                fontSize: "12.5px",
                fontWeight: 700,
                color: "#15803d",
                cursor: exportingExcel ? "wait" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
              title={
                ciViewMode === "costing"
                  ? "Download official 16-Column Costing Excel (.xlsx) with container formulas and Packing List"
                  : "Download clean 7-Column Customer Commercial Invoice & Packing List (.xlsx)"
              }
            >
              <span>📥</span>
              <span>
                {exportingExcel
                  ? "Generating..."
                  : activeDocTab === "ci"
                  ? (ciViewMode === "costing" ? "Download 16-Col Excel" : "Download Customer Excel")
                  : "Download Excel (.xlsx)"}
              </span>
            </button>

            {/* If on CI tab, offer 1-click button for the alternative export mode */}
            {activeDocTab === "ci" && (
              <button
                type="button"
                onClick={() => handleExportExcel(ciViewMode === "costing" ? "customer" : "internal")}
                disabled={exportingExcel}
                style={{
                  padding: "6px 10px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#475569",
                  cursor: exportingExcel ? "wait" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
                title={
                  ciViewMode === "costing"
                    ? "Export clean 7-column Customer Excel (safe to email to clients)"
                    : "Export full 16-column Internal Costing Excel (with factory costs and profit)"
                }
              >
                <span>{ciViewMode === "costing" ? "📄 Customer Excel" : "📊 16-Col Excel"}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handlePrintDoc()}
              style={{
                padding: "6px 13px",
                borderRadius: "6px",
                border: "1px solid #0284c7",
                background: "#f0f9ff",
                fontSize: "12.5px",
                fontWeight: 700,
                color: "#0369a1",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
              title={
                activeDocTab === "ci" && ciViewMode === "costing"
                  ? "Print full 16-column Costing Sheet in A4 Landscape mode"
                  : "Print clean document in A4 Portrait mode"
              }
            >
              <span>🖨️</span>
              <span>
                {activeDocTab === "ci" && ciViewMode === "costing"
                  ? "Print 16-Col Costing (Landscape)"
                  : activeDocTab === "ci"
                  ? "Print Customer CI (Portrait)"
                  : "Print / PDF (Portrait)"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsFullScreen(!isFullScreen)}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: isFullScreen ? "#eff6ff" : "#ffffff",
                fontSize: "13px",
                fontWeight: 600,
                color: isFullScreen ? "#1d4ed8" : "#334155",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
              }}
              title={isFullScreen ? "Restore standard size" : "Expand to full screen"}
            >
              <span>{isFullScreen ? "🗗" : "⛶"}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "6px",
                border: "1px solid #e2e8f0",
                background: "#ffffff",
                fontSize: "16px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#64748b",
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }}>
      {/* Print-specific style sheet: hides UI, expands document to 100% white paper */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-trade-doc, #printable-trade-doc * {
            visibility: visible !important;
          }
          #printable-trade-doc {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 8mm 12mm !important;
            box-shadow: none !important;
            border: none !important;
            background: #ffffff !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#64748b" }}>
              <div style={{ fontSize: "24px", marginBottom: "8px" }}>⏳</div>
              Loading order details...
            </div>
          ) : !order ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#ef4444" }}>
              Sale order not found.
            </div>
          ) : (
            <div>
              {activeDocTab === "overview" && (
                <div>
                  {/* Order Metadata Cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "14px",
                  marginBottom: "20px",
                }}
              >
                {/* Card 1: Buyer Info */}
                <div
                  style={{
                    padding: "14px",
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: "6px" }}>
                    Buyer Company
                  </div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>
                    {order.buyer_name}
                  </div>
                  {order.buyer_branch_name && (
                    <div style={{ fontSize: "12px", color: "#475569", marginTop: "2px" }}>
                      Branch: {order.buyer_branch_name}
                    </div>
                  )}
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
                    Supplier: {order.organization_name}
                  </div>
                </div>

                {/* Card 2: Consignment & Dates */}
                <div
                  style={{
                    padding: "14px",
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: "6px" }}>
                    Consignment & Timeline
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: "4px",
                        background: "#e0f2fe",
                        color: "#0369a1",
                        fontSize: "13px",
                        fontWeight: 700,
                      }}
                    >
                      {order.consignment_code || "Direct Sale"}
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", color: "#475569", marginTop: "6px" }}>
                    Order Date: <strong>{order.order_date}</strong>
                  </div>
                  {order.delivery_date && (
                    <div style={{ fontSize: "12px", color: "#475569" }}>
                      Delivery Target: <strong>{order.delivery_date}</strong>
                    </div>
                  )}
                </div>

                {/* Card 3: Logistics & Shipping */}
                <div
                  style={{
                    padding: "14px",
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: "6px" }}>
                    Logistics / Shipping
                  </div>
                  <div style={{ fontSize: "12px", color: "#334155" }}>
                    Container No: <strong>{order.container_no || "—"}</strong>
                  </div>
                  <div style={{ fontSize: "12px", color: "#334155" }}>
                    BL No: <strong>{order.bl_no || "—"}</strong> | LR No: <strong>{order.lr_no || "—"}</strong>
                  </div>
                  <div style={{ fontSize: "12px", color: "#334155" }}>
                    Transporter: <strong>{order.transporter_name || "—"}</strong>
                  </div>
                  {(order.port_of_loading || order.port_of_discharge) && (
                    <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                      {order.port_of_loading || "POL"} → {order.port_of_discharge || "POD"}
                    </div>
                  )}
                </div>

                {/* Card 4: Financial Summary */}
                <div
                  style={{
                    padding: "14px",
                    borderRadius: "8px",
                    border: "1px solid #bfdbfe",
                    background: "#eff6ff",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", marginBottom: "6px" }}>
                    Total Order Value
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#1e3a8a" }}>
                    {currencySymbol} {Number(order.total_amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: "11px", color: "#3b82f6", marginTop: "4px" }}>
                    Basic: {currencySymbol} {Number(order.total_basic).toFixed(2)} | Tax: {currencySymbol} {Number(order.total_tax).toFixed(2)}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                    Total Quantity: <strong>{Number(order.total_quantity).toLocaleString()} pcs</strong>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  overflow: "hidden",
                  marginBottom: "20px",
                }}
              >
                <div
                  style={{
                    padding: "10px 16px",
                    background: "#f1f5f9",
                    borderBottom: "1px solid #e2e8f0",
                    fontWeight: 700,
                    fontSize: "13px",
                    color: "#334155",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>Planned Products Breakdown ({order.items?.length || 0} line items)</span>
                  <span>Currency: {order.currency}</span>
                </div>
                <div
                  style={{
                    overflow: "auto",
                    maxHeight: isFullScreen ? "calc(100vh - 350px)" : "450px",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "separate",
                      borderSpacing: 0,
                      fontSize: "12px",
                      tableLayout: "auto",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "35px",
                            textAlign: "center",
                            position: "sticky",
                            top: 0,
                            left: 0,
                            zIndex: 15,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          #
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            minWidth: "220px",
                            position: "sticky",
                            top: 0,
                            left: "35px",
                            zIndex: 15,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                            borderRight: "1px solid #e2e8f0",
                          }}
                        >
                          Product Description
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "110px",
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          Item Code
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "85px",
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          HSN
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "85px",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          Quantity
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "100px",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          Rate ({currencySymbol})
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "65px",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          Tax %
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "105px",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          Tax Amount ({currencySymbol})
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            width: "115px",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          Total ({currencySymbol})
                        </th>
                        <th
                          style={{
                            padding: "9px 10px",
                            minWidth: "160px",
                            position: "sticky",
                            top: 0,
                            zIndex: 10,
                            background: "#f8fafc",
                            borderBottom: "2px solid #cbd5e1",
                          }}
                        >
                          Remarks
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items && order.items.length > 0 ? (
                        order.items.map((item, idx) => {
                          const rowBg = idx % 2 === 0 ? "#ffffff" : "#fcfdfe";
                          
  return (
                            <tr
                              key={item.id || idx}
                              style={{
                                backgroundColor: rowBg,
                              }}
                            >
                              <td
                                style={{
                                  padding: "8px 10px",
                                  color: "#64748b",
                                  textAlign: "center",
                                  position: "sticky",
                                  left: 0,
                                  zIndex: 5,
                                  background: rowBg,
                                  borderBottom: "1px solid #f1f5f9",
                                }}
                              >
                                {idx + 1}
                              </td>
                              <td
                                style={{
                                  padding: "8px 10px",
                                  fontWeight: 600,
                                  color: "#1e293b",
                                  position: "sticky",
                                  left: "35px",
                                  zIndex: 5,
                                  background: rowBg,
                                  borderBottom: "1px solid #f1f5f9",
                                  borderRight: "1px solid #e2e8f0",
                                }}
                              >
                                {item.product_name}
                              </td>
                              <td style={{ padding: "8px 10px", color: "#64748b", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                                {item.product_code || "—"}
                              </td>
                              <td style={{ padding: "8px 10px", color: "#64748b", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                                {item.hsn_code || "—"}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                                {Number(item.quantity).toLocaleString()}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: "#334155", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                                {Number(item.unit_rate).toFixed(2)}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: "#64748b", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                                {Number(item.tax_percent)}%
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: "#64748b", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                                {Number(item.tax_amount).toFixed(2)}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                                {Number(item.item_total).toFixed(2)}
                              </td>
                              <td style={{ padding: "8px 10px", color: "#64748b", fontStyle: item.remarks ? "normal" : "italic", borderBottom: "1px solid #f1f5f9" }}>
                                {item.remarks || "—"}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={10} style={{ textAlign: "center", padding: "20px", color: "#94a3b8" }}>
                            No line items recorded.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr
                        style={{
                          background: "#f8fafc",
                          fontWeight: 700,
                          position: "sticky",
                          bottom: 0,
                          zIndex: 10,
                          boxShadow: "0 -2px 4px rgba(0,0,0,0.05)",
                        }}
                      >
                        <td
                          colSpan={2}
                          style={{
                            padding: "8px 10px",
                            textAlign: "right",
                            position: "sticky",
                            left: 0,
                            zIndex: 15,
                            background: "#f8fafc",
                            borderTop: "2px solid #cbd5e1",
                            borderRight: "1px solid #e2e8f0",
                          }}
                        >
                          Totals:
                        </td>
                        <td colSpan={2} style={{ borderTop: "2px solid #cbd5e1" }}></td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#0f172a", whiteSpace: "nowrap", borderTop: "2px solid #cbd5e1" }}>
                          {Number(order.total_quantity).toLocaleString()}
                        </td>
                        <td colSpan={2} style={{ borderTop: "2px solid #cbd5e1" }}></td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#64748b", whiteSpace: "nowrap", borderTop: "2px solid #cbd5e1" }}>
                          {currencySymbol} {Number(order.total_tax).toFixed(2)}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#1d4ed8", fontSize: "14px", whiteSpace: "nowrap", borderTop: "2px solid #cbd5e1" }}>
                          {currencySymbol} {Number(order.total_amount).toFixed(2)}
                        </td>
                        <td style={{ borderTop: "2px solid #cbd5e1" }}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Order Remarks */}
              {order.remarks && (
                <div
                  style={{
                    padding: "12px 16px",
                    borderRadius: "6px",
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                    fontSize: "12px",
                    color: "#475569",
                    marginBottom: "20px",
                  }}
                >
                  <strong style={{ color: "#1e293b" }}>Order Remarks / Notes:</strong>
                  <pre style={{ margin: "4px 0 0 0", fontFamily: "inherit", whiteSpace: "pre-wrap" }}>
                    {order.remarks}
                  </pre>
                </div>
              )}

              {/* Status Update Actions Bar */}
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: "8px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>
                    Workflow Stage Transitions
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>
                    Current Status: <strong style={{ textTransform: "uppercase" }}>{order.status}</strong>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {order.status === "pending" && (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => setShowStatusModal("sales_confirmed")}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        background: "#0284c7",
                        color: "#ffffff",
                        border: "none",
                        fontWeight: 600,
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      ✓ Confirm Sales
                    </button>
                  )}

                  {(order.status === "pending" || order.status === "sales_confirmed") && (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => setShowStatusModal("admin_approved")}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        background: "#16a34a",
                        color: "#ffffff",
                        border: "none",
                        fontWeight: 600,
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      ★ Admin Approve
                    </button>
                  )}

                  {order.status === "admin_approved" && (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => setShowStatusModal("dispatched")}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        background: "#9333ea",
                        color: "#ffffff",
                        border: "none",
                        fontWeight: 600,
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      🚚 Mark Dispatched
                    </button>
                  )}

                  {order.status === "dispatched" && (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => setShowStatusModal("lr")}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        background: "#4f46e5",
                        color: "#ffffff",
                        border: "none",
                        fontWeight: 600,
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      📄 LR Received / Complete
                    </button>
                  )}

                  {order.status !== "cancelled" && (
                    <button
                      type="button"
                      disabled={updatingStatus}
                      onClick={() => setShowStatusModal("cancelled")}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        background: "#ffffff",
                        color: "#dc2626",
                        border: "1px solid #fca5a5",
                        fontWeight: 600,
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      ✕ Cancel Order
                    </button>
                  )}
                </div>
              </div>
            </div>
            )}

            {/* TAB: COMMERCIAL INVOICE (CI) */}
            {activeDocTab === "ci" && effectiveDoc && (() => {
              const costingParams = effectiveDoc.totals?.costing || {
                ocean_freight_usd: Number(order?.ocean_freight_usd) || 0,
                local_charges_coc_usd: Number(order?.local_charges_coc_usd) || 0,
                usd_exchange_rate: Number(order?.usd_exchange_rate) || 6.70,
                profit_percent: Number(order?.profit_percent) || 3.0,
                total_container_cbm: Number(order?.total_container_cbm) || 0,
              };
              const totalFreightUsd = (Number(costingParams.ocean_freight_usd) || 0) + (Number(costingParams.local_charges_coc_usd) || 0);
              const containerCbm = Number(costingParams.total_container_cbm) || Number(effectiveDoc.totals.cbm) || 0;
              const freightPerCbm = containerCbm > 0 ? totalFreightUsd / containerCbm : 0;
              const totalSupplierPayableRmb = (effectiveDoc.items || []).reduce(
                (sum: number, it: any) => sum + (Number(it.total_supplier_amount_rmb) || (Number(it.unit_price_rmb_with_vat || 0) * Number(it.quantity || 0))),
                0
              );
              const totalItemCbm = (effectiveDoc.items || []).reduce((sum: number, it: any) => sum + (Number(it.total_cbm) || 0), 0);
              const totalCfrAmountUsd = (effectiveDoc.items || []).reduce(
                (sum: number, it: any) => sum + ((Number(it.cfr_price_usd) || Number(it.unit_price_usd) || 0) * Number(it.quantity || 0)),
                0
              );

              return (
                <div style={{ maxWidth: ciViewMode === "costing" ? "100%" : "960px", margin: "0 auto 30px auto", width: "100%" }}>
                  {/* View Mode Toggle Bar (No Print) */}
                  <div
                    className="no-print"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "14px",
                      background: "#ffffff",
                      padding: "8px 14px",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      flexWrap: "wrap",
                      gap: "10px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "#334155", marginRight: "4px" }}>
                        CI View Mode:
                      </span>
                      <button
                        type="button"
                        onClick={() => setCiViewMode("costing")}
                        style={{
                          padding: "5px 12px",
                          borderRadius: "6px",
                          border: ciViewMode === "costing" ? "1px solid #1e3a8a" : "1px solid #cbd5e1",
                          background: ciViewMode === "costing" ? "#1e3a8a" : "#ffffff",
                          color: ciViewMode === "costing" ? "#ffffff" : "#475569",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                        }}
                      >
                        📊 Full Costing & Supplier Engine (16 Columns - Excel Replica)
                      </button>
                      <button
                        type="button"
                        onClick={() => setCiViewMode("standard")}
                        style={{
                          padding: "5px 12px",
                          borderRadius: "6px",
                          border: ciViewMode === "standard" ? "1px solid #1e3a8a" : "1px solid #cbd5e1",
                          background: ciViewMode === "standard" ? "#1e3a8a" : "#ffffff",
                          color: ciViewMode === "standard" ? "#ffffff" : "#475569",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                        }}
                      >
                        📄 Standard Customer CI (7 Columns)
                      </button>
                    </div>
                    <div style={{ fontSize: "11.5px", color: "#059669", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>✓ Supplier & Price sourced from Confirmed Local Purchase</span>
                      <span style={{ color: "#94a3b8" }}>|</span>
                      <span>HSN Refund VAT: 13.00%</span>
                    </div>
                  </div>

                  <div
                    id="printable-trade-doc"
                    style={{
                      background: "#ffffff",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      padding: ciViewMode === "costing" ? "20px 24px" : "36px 40px",
                      boxShadow: "0 4px 15px rgba(0,0,0,0.06)",
                      color: "#0f172a",
                      fontFamily: "'Segoe UI', Roboto, sans-serif",
                      overflowX: "auto",
                    }}
                  >
                    {/* Header Letterhead */}
                    <div style={{ textAlign: "center", borderBottom: "2px solid #1e3a8a", paddingBottom: "12px", marginBottom: "16px" }}>
                      <h1 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#1e3a8a", letterSpacing: "0.5px" }}>
                        {effectiveDoc.shipper.company_name}
                      </h1>
                      <div style={{ fontSize: "11px", color: "#475569", marginTop: "4px" }}>
                        Email: {effectiveDoc.shipper.email} | Mobile: {effectiveDoc.shipper.phone} | WeChat: {effectiveDoc.shipper.wechat}
                      </div>
                      <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px" }}>
                        Address: {effectiveDoc.shipper.address}
                      </div>
                    </div>

                    {/* Document Title Banner */}
                    <div style={{ background: "#f1f5f9", padding: "8px 0", textAlign: "center", borderRadius: "4px", marginBottom: "14px", border: "1px solid #e2e8f0" }}>
                      <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 800, letterSpacing: "1px", color: "#0f172a" }}>
                        COMMERCIAL INVOICE {ciViewMode === "costing" && "(COSTING & CFR CALCULATION ENGINE)"}
                      </h2>
                    </div>

                    {/* Invoice No & Date */}
                    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "12px", fontSize: "12px" }}>
                      <tbody>
                        <tr>
                          <td style={{ border: "1px solid #94a3b8", padding: "6px 10px", width: "25%", fontWeight: 700, background: "#f8fafc" }}>
                            Commercial Invoice No
                          </td>
                          <td style={{ border: "1px solid #94a3b8", padding: "6px 10px", width: "40%", fontWeight: 700 }}>
                            {effectiveDoc.consignment_code}
                          </td>
                          <td style={{ border: "1px solid #94a3b8", padding: "6px 10px", width: "15%", fontWeight: 700, background: "#f8fafc", textAlign: "center" }}>
                            Date
                          </td>
                          <td style={{ border: "1px solid #94a3b8", padding: "6px 10px", width: "20%", fontWeight: 700, textAlign: "right" }}>
                            {effectiveDoc.order_date}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {/* Shipper & Recipient 2-Column Box */}
                    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "12px", fontSize: "11.5px" }}>
                      <thead>
                        <tr style={{ background: "#e2e8f0", fontWeight: 700 }}>
                          <th colSpan={2} style={{ border: "1px solid #94a3b8", padding: "6px 10px", textAlign: "left", width: "50%" }}>
                            Shipper's Information
                          </th>
                          <th colSpan={2} style={{ border: "1px solid #94a3b8", padding: "6px 10px", textAlign: "left", width: "50%" }}>
                            Recipient's Information
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, width: "18%", background: "#f8fafc" }}>Company Name</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", width: "32%" }}>{effectiveDoc.shipper.company_name}</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, width: "18%", background: "#f8fafc" }}>Company Name</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", width: "32%", fontWeight: 700 }}>{effectiveDoc.recipient.company_name || "—"}</td>
                        </tr>
                        <tr>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Address</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontSize: "10.5px" }}>{effectiveDoc.shipper.address}</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Address</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontSize: "10.5px", whiteSpace: "pre-line" }}>{effectiveDoc.recipient.address || "—"}</td>
                        </tr>
                        <tr>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Contact Person</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.shipper.contact_person}</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Contact Person</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.recipient.contact_person || "—"}</td>
                        </tr>
                        <tr>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Phone Number</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.shipper.phone}</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Phone Number</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.recipient.phone || "—"}</td>
                        </tr>
                        <tr>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Email</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.shipper.email}</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Email ID</td>
                          <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.recipient.email || "—"}</td>
                        </tr>
                      </tbody>
                    </table>

                    {/* Trade Terms */}
                    <div style={{ border: "1px solid #94a3b8", padding: "6px 12px", marginBottom: "12px", fontSize: "11px", lineHeight: "1.6" }}>
                      <div><strong>Terms of Payment:</strong> {effectiveDoc.payment_terms}</div>
                      <div><strong>Shipping Terms:</strong> {effectiveDoc.shipping_terms}</div>
                      <div><strong>Delivery Time:</strong> {effectiveDoc.delivery_time}</div>
                    </div>

                    {/* Costing Engine Parameters Banner */}
                    {ciViewMode === "costing" && (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                          gap: "8px",
                          background: "#f8fafc",
                          border: "1px solid #cbd5e1",
                          borderRadius: "6px",
                          padding: "10px 14px",
                          marginBottom: "14px",
                          fontSize: "11px",
                        }}
                      >
                        <div>
                          <span style={{ color: "#64748b", display: "block" }}>Ocean Freight:</span>
                          <strong style={{ color: "#0f172a" }}>${Number(costingParams.ocean_freight_usd || 0).toLocaleString()}</strong>
                        </div>
                        <div>
                          <span style={{ color: "#64748b", display: "block" }}>Local Charges / COC:</span>
                          <strong style={{ color: "#0f172a" }}>${Number(costingParams.local_charges_coc_usd || 0).toLocaleString()}</strong>
                        </div>
                        <div>
                          <span style={{ color: "#64748b", display: "block" }}>Total Freight:</span>
                          <strong style={{ color: "#0284c7" }}>${Number(totalFreightUsd).toLocaleString()}</strong>
                        </div>
                        <div>
                          <span style={{ color: "#64748b", display: "block" }}>Container CBM:</span>
                          <strong style={{ color: "#0f172a" }}>{Number(containerCbm).toFixed(3)} m³</strong>
                        </div>
                        <div>
                          <span style={{ color: "#64748b", display: "block" }}>Freight / CBM:</span>
                          <strong style={{ color: "#0284c7" }}>${freightPerCbm.toFixed(2)} / m³</strong>
                        </div>
                        <div>
                          <span style={{ color: "#64748b", display: "block" }}>USD Exch. Rate:</span>
                          <strong style={{ color: "#0f172a" }}>{Number(costingParams.usd_exchange_rate || 6.70).toFixed(2)}</strong>
                        </div>
                        <div>
                          <span style={{ color: "#64748b", display: "block" }}>Default Profit:</span>
                          <strong style={{ color: "#16a34a" }}>{Number(costingParams.profit_percent || 3.0).toFixed(1)}%</strong>
                        </div>
                        <div>
                          <span style={{ color: "#64748b", display: "block" }}>Total Supplier Payable:</span>
                          <strong style={{ color: "#059669" }}>
                            ¥ {totalSupplierPayableRmb.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </strong>
                        </div>
                      </div>
                    )}

                    {/* Items Table: 16 Columns (Costing) or 7 Columns (Standard) */}
                    {ciViewMode === "costing" ? (
                      <div style={{ overflowX: "auto", marginBottom: "14px" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10.5px", whiteSpace: "nowrap" }}>
                          <thead>
                            <tr style={{ background: "#1e3a8a", color: "#ffffff", textAlign: "center" }}>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 4px", width: "35px" }}>Sr.No</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 8px", textAlign: "left", minWidth: "180px" }}>Description</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", minWidth: "80px", whiteSpace: "normal", lineHeight: 1.25 }}>HS CODE AS<br />PER CHINA</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", minWidth: "70px" }}>UOM</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", minWidth: "55px" }}>Quantity</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", minWidth: "80px", whiteSpace: "normal", lineHeight: 1.25 }}>Unit Price<br />(USD)</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", minWidth: "95px", whiteSpace: "normal", lineHeight: 1.25 }}>Total Amount<br />(USD)</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", minWidth: "90px", whiteSpace: "normal", lineHeight: 1.25 }}>Unit Price(RMB)<br />Including VAT</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", minWidth: "90px", whiteSpace: "normal", lineHeight: 1.25 }}>Unit Price(RMB)<br />Excluding VAT</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", minWidth: "80px", whiteSpace: "normal", lineHeight: 1.25 }}>Including<br />Profit {Number(costingParams.profit_percent || 3).toFixed(0)}%</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", minWidth: "90px", whiteSpace: "normal", lineHeight: 1.25 }}>FOB PRICE<br />(USD Conversion @{Number(costingParams.usd_exchange_rate || 6.7)})</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", minWidth: "85px", whiteSpace: "normal", lineHeight: 1.25 }}>Freight, Local<br />charges, COC</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", minWidth: "80px", whiteSpace: "normal", lineHeight: 1.25 }}>CFR<br />Price/Unit</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 8px", textAlign: "left", minWidth: "130px" }}>Supplier</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", minWidth: "60px", whiteSpace: "normal", lineHeight: 1.25 }}>Total<br />CBM</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", minWidth: "100px", whiteSpace: "normal", lineHeight: 1.25 }}>Total Supplier<br />Amount</th>
                              <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", minWidth: "100px" }}>Remarks</th>
                            </tr>
                          </thead>
                          <tbody>
                            {effectiveDoc.items.map((item: any, i: number) => {
                              const qty = Number(item.quantity) || 0;
                              const rmbInclVat = Number(item.unit_price_rmb_with_vat) || 0;
                              const rmbExVat = Number(item.unit_price_rmb_ex_vat) || (rmbInclVat > 0 ? Math.round((rmbInclVat / 1.13) * 100) / 100 : 0);
                              const profitPct = Number(item.profit_percent) || 3.0;
                              const priceWithProfit = Math.round(rmbExVat * (1 + profitPct / 100) * 100) / 100;
                              const exchRate = Number(costingParams.usd_exchange_rate) || 6.70;
                              const fobUsd = Number(item.fob_price_usd) || (exchRate > 0 ? Math.round((priceWithProfit / exchRate) * 10000) / 10000 : 0);
                              const itemCbm = Number(item.total_cbm) || Number(item.cbm) || 0;
                              const freightUnitUsd = Number(item.freight_unit_usd) || (qty > 0 && freightPerCbm > 0 ? Math.round((freightPerCbm * itemCbm / qty) * 10000) / 10000 : 0);
                              const cfrUnitUsd = Number(item.cfr_price_usd) || (fobUsd + freightUnitUsd);
                              const unitPriceUsd = Number(item.unit_price_usd) || cfrUnitUsd;
                              const totalAmountUsd = Math.round(unitPriceUsd * qty * 100) / 100;
                              const totalSupRmb = Number(item.total_supplier_amount_rmb) || Math.round(rmbInclVat * qty * 100) / 100;
                              const cell = { border: "1px solid #cbd5e1", padding: "5px 6px", textAlign: "right" as const };

                              return (
                                <tr key={i} style={{ background: i % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                                  <td style={{ ...cell, textAlign: "center" }}>{item.sr_no}</td>
                                  <td style={{ ...cell, textAlign: "left", fontWeight: 600 }}>{item.description}</td>
                                  <td style={{ ...cell, textAlign: "center", color: "#64748b" }}>{item.hs_code || "—"}</td>
                                  <td style={{ ...cell, textAlign: "center" }}>{item.uom || "NOS"}</td>
                                  <td style={{ ...cell, fontWeight: 700 }}>{qty.toLocaleString()}</td>
                                  <td style={{ ...cell, fontWeight: 700, color: "#1d4ed8" }}>USD {unitPriceUsd.toFixed(2)}</td>
                                  <td style={{ ...cell, fontWeight: 700, color: "#1d4ed8" }}>
                                    USD {totalAmountUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                  <td style={{ ...cell, background: "#fef9c3" }}>¥ {rmbInclVat.toFixed(2)}</td>
                                  <td style={{ ...cell, color: "#64748b" }}>¥ {rmbExVat.toFixed(2)}</td>
                                  <td style={{ ...cell, color: "#16a34a" }}>¥ {priceWithProfit.toFixed(2)}</td>
                                  <td style={{ ...cell, color: "#0284c7" }}>USD {fobUsd.toFixed(3)}</td>
                                  <td style={{ ...cell, color: "#64748b" }}>USD {freightUnitUsd.toFixed(3)}</td>
                                  <td style={{ ...cell, fontWeight: 700, color: "#1d4ed8" }}>USD {cfrUnitUsd.toFixed(2)}</td>
                                  <td style={{ ...cell, textAlign: "left", padding: "5px 8px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                      <span style={{ fontWeight: 600, color: "#0f172a" }}>{item.supplier_name || "—"}</span>
                                      {item.supplier_name && item.supplier_name !== "—" && rmbInclVat > 0 && (
                                        <span style={{ fontSize: "9px", background: "#ecfdf5", color: "#059669", padding: "1px 4px", borderRadius: "3px", fontWeight: 700 }}>
                                          ✓ Local Purchase
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td style={{ ...cell, color: "#0891b2" }}>{itemCbm.toFixed(3)}</td>
                                  <td style={{ ...cell, fontWeight: 700, color: "#059669" }}>
                                    ¥ {totalSupRmb.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                  <td style={{ ...cell, textAlign: "left", fontSize: "10px", color: "#64748b" }}>{item.remarks || "—"}</td>
                                </tr>
                              );
                            })}
                            {/* Costing Totals Row */}
                            <tr style={{ background: "#fef08a", fontWeight: 800 }}>
                              <td colSpan={4} style={{ border: "1px solid #94a3b8", padding: "6px 8px", textAlign: "right" }}>
                                TOTALS:
                              </td>
                              <td style={{ border: "1px solid #94a3b8", padding: "6px 6px", textAlign: "right" }}>
                                {Number(effectiveDoc.totals.quantity).toLocaleString()}
                              </td>
                              <td style={{ border: "1px solid #94a3b8", padding: "6px 6px" }}></td>
                              <td style={{ border: "1px solid #94a3b8", padding: "6px 6px", textAlign: "right", color: "#1d4ed8" }}>
                                USD {totalCfrAmountUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td colSpan={7} style={{ border: "1px solid #94a3b8", padding: "6px 6px" }}></td>
                              <td style={{ border: "1px solid #94a3b8", padding: "6px 6px", textAlign: "right", color: "#0891b2" }}>
                                {totalItemCbm.toFixed(3)} m³
                              </td>
                              <td style={{ border: "1px solid #94a3b8", padding: "6px 6px", textAlign: "right", color: "#059669" }}>
                                ¥ {totalSupplierPayableRmb.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td style={{ border: "1px solid #94a3b8", padding: "6px 6px" }}></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      /* Standard 7 Columns Table */
                      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "14px", fontSize: "11px" }}>
                        <thead>
                          <tr style={{ background: "#1e3a8a", color: "#ffffff", textAlign: "center" }}>
                            <th style={{ border: "1px solid #94a3b8", padding: "6px 4px", width: "5%" }}>Sr.No</th>
                            <th style={{ border: "1px solid #94a3b8", padding: "6px 8px", textAlign: "left", width: "42%" }}>Description</th>
                            <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", width: "15%" }}>China HS Code</th>
                            <th style={{ border: "1px solid #94a3b8", padding: "6px 4px", width: "8%" }}>UOM</th>
                            <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", width: "10%" }}>Quantity</th>
                            <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", width: "10%" }}>Unit Price (USD)</th>
                            <th style={{ border: "1px solid #94a3b8", padding: "6px 6px", width: "10%" }}>Total Amount (USD)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {effectiveDoc.items.map((item: any, i: number) => (
                            <tr key={i}>
                              <td style={{ border: "1px solid #94a3b8", padding: "5px 4px", textAlign: "center" }}>{item.sr_no}</td>
                              <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{item.description}</td>
                              <td style={{ border: "1px solid #94a3b8", padding: "5px 6px", textAlign: "center" }}>{item.hs_code || "—"}</td>
                              <td style={{ border: "1px solid #94a3b8", padding: "5px 4px", textAlign: "center" }}>{item.uom}</td>
                              <td style={{ border: "1px solid #94a3b8", padding: "5px 6px", textAlign: "right" }}>{Number(item.quantity).toLocaleString()}</td>
                              <td style={{ border: "1px solid #94a3b8", padding: "5px 6px", textAlign: "right" }}>${Number(item.unit_price_usd).toFixed(2)}</td>
                              <td style={{ border: "1px solid #94a3b8", padding: "5px 6px", textAlign: "right", fontWeight: 700 }}>${Number(item.total_amount_usd).toFixed(2)}</td>
                            </tr>
                          ))}
                          {/* Total Row */}
                          <tr style={{ background: "#fef08a", fontWeight: 800 }}>
                            <td colSpan={4} style={{ border: "1px solid #94a3b8", padding: "6px 10px", textAlign: "right" }}>
                              Total Price CIF INDIA:
                            </td>
                            <td style={{ border: "1px solid #94a3b8", padding: "6px 6px", textAlign: "right" }}>
                              {Number(effectiveDoc.totals.quantity).toLocaleString()}
                            </td>
                            <td style={{ border: "1px solid #94a3b8", padding: "6px 6px" }}></td>
                            <td style={{ border: "1px solid #94a3b8", padding: "6px 6px", textAlign: "right" }}>
                              ${Number(effectiveDoc.totals.total_amount_usd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    )}

                    {/* Bank Details & Signature Grid */}
                    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "14px", border: "1px solid #94a3b8", padding: "12px", marginBottom: "10px", fontSize: "10.5px" }}>
                      <div>
                        <div style={{ fontWeight: 800, color: "#1e3a8a", marginBottom: "4px" }}>
                          BANK ACCOUNT DETAILS FOR INWARD REMITTANCE USD
                        </div>
                        <div><strong>RECEIVING BANK:</strong> {effectiveDoc.bank_details.bank_name}</div>
                        <div><strong>SWIFT BIC:</strong> {effectiveDoc.bank_details.swift_bic}</div>
                        <div><strong>BENEFICIARY NAME:</strong> {effectiveDoc.bank_details.beneficiary_name}</div>
                        <div><strong>A/C NO:</strong> {effectiveDoc.bank_details.account_no}</div>
                        <div style={{ fontSize: "9.5px", color: "#475569", marginTop: "2px" }}>{effectiveDoc.bank_details.address}</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "flex-end", textAlign: "right" }}>
                        <div style={{ fontWeight: 700 }}>Shipper's Signature and Stamp:</div>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "6px" }}>
                          <img src="/yinglima_signature.png" alt="Signature" style={{ height: "48px", objectFit: "contain" }} />
                          <img src="/yinglima_stamp.jpeg" alt="Stamp" style={{ height: "55px", objectFit: "contain" }} />
                        </div>
                      </div>
                    </div>

                    {/* Declaration */}
                    <div style={{ textAlign: "center", fontSize: "11px", fontWeight: 700, color: "#334155", marginTop: "8px" }}>
                      {effectiveDoc.declaration}
                    </div>
                  </div>
                </div>
              );
            })()}
            {/* TAB: PACKING LIST (PL) */}

            {/* TAB: PACKING LIST (PL) */}
            {activeDocTab === "pl" && effectiveDoc && (
              <div
                id="printable-trade-doc"
                style={{
                  background: "#ffffff",
                  border: "1px solid #cbd5e1",
                  borderRadius: "8px",
                  padding: "36px 40px",
                  maxWidth: "960px",
                  margin: "0 auto 30px auto",
                  boxShadow: "0 4px 15px rgba(0,0,0,0.06)",
                  color: "#0f172a",
                  fontFamily: "'Segoe UI', Roboto, sans-serif",
                }}
              >
                {/* Header Letterhead */}
                <div style={{ textAlign: "center", borderBottom: "2px solid #1e3a8a", paddingBottom: "12px", marginBottom: "16px" }}>
                  <h1 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#1e3a8a", letterSpacing: "0.5px" }}>
                    {effectiveDoc.shipper.company_name}
                  </h1>
                  <div style={{ fontSize: "11px", color: "#475569", marginTop: "4px" }}>
                    Email: {effectiveDoc.shipper.email} | Mobile: {effectiveDoc.shipper.phone} | WeChat: {effectiveDoc.shipper.wechat}
                  </div>
                  <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px" }}>
                    Address: {effectiveDoc.shipper.address}
                  </div>
                </div>

                {/* Document Title Banner */}
                <div style={{ background: "#f1f5f9", padding: "8px 0", textAlign: "center", borderRadius: "4px", marginBottom: "14px", border: "1px solid #e2e8f0" }}>
                  <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 800, letterSpacing: "1px", color: "#0f172a" }}>
                    PACKING LIST
                  </h2>
                </div>

                {/* Packing List No & Date */}
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "12px", fontSize: "12px" }}>
                  <tbody>
                    <tr>
                      <td style={{ border: "1px solid #94a3b8", padding: "6px 10px", width: "25%", fontWeight: 700, background: "#f8fafc" }}>
                        Packing List No
                      </td>
                      <td style={{ border: "1px solid #94a3b8", padding: "6px 10px", width: "40%", fontWeight: 700 }}>
                        {effectiveDoc.consignment_code}
                      </td>
                      <td style={{ border: "1px solid #94a3b8", padding: "6px 10px", width: "15%", fontWeight: 700, background: "#f8fafc", textAlign: "center" }}>
                        Date
                      </td>
                      <td style={{ border: "1px solid #94a3b8", padding: "6px 10px", width: "20%", fontWeight: 700, textAlign: "right" }}>
                        {effectiveDoc.order_date}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Shipper & Recipient */}
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "12px", fontSize: "11.5px" }}>
                  <thead>
                    <tr style={{ background: "#e2e8f0", fontWeight: 700 }}>
                      <th colSpan={2} style={{ border: "1px solid #94a3b8", padding: "6px 10px", textAlign: "left", width: "50%" }}>
                        Shipper's Information
                      </th>
                      <th colSpan={2} style={{ border: "1px solid #94a3b8", padding: "6px 10px", textAlign: "left", width: "50%" }}>
                        Recipient's Information
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, width: "18%", background: "#f8fafc" }}>Company Name</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", width: "32%" }}>{effectiveDoc.shipper.company_name}</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, width: "18%", background: "#f8fafc" }}>Company Name</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", width: "32%", fontWeight: 700 }}>{effectiveDoc.recipient.company_name || "—"}</td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Address</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontSize: "10.5px" }}>{effectiveDoc.shipper.address}</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Address</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontSize: "10.5px", whiteSpace: "pre-line" }}>{effectiveDoc.recipient.address || "—"}</td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Contact Person</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.shipper.contact_person}</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Contact Person</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.recipient.contact_person || "—"}</td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Phone Number</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.shipper.phone}</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Phone Number</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.recipient.phone || "—"}</td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Email</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.shipper.email}</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Email ID</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.recipient.email || "—"}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Trade Terms */}
                <div style={{ border: "1px solid #94a3b8", padding: "6px 12px", marginBottom: "12px", fontSize: "11px", lineHeight: "1.6" }}>
                  <div><strong>Shipping Terms:</strong> {effectiveDoc.shipping_terms}</div>
                </div>

                {/* Packing Information Table */}
                <div style={{ background: "#e2e8f0", padding: "6px 10px", fontWeight: 700, fontSize: "11.5px", border: "1px solid #94a3b8", borderBottom: "none" }}>
                  PACKING INFORMATION
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "14px", fontSize: "11px" }}>
                  <thead>
                    <tr style={{ background: "#1e3a8a", color: "#ffffff", textAlign: "center" }}>
                      <th rowSpan={2} style={{ border: "1px solid #94a3b8", padding: "6px 4px", width: "5%" }}>Sr.No</th>
                      <th rowSpan={2} style={{ border: "1px solid #94a3b8", padding: "6px 8px", textAlign: "left", width: "42%" }}>Description</th>
                      <th rowSpan={2} style={{ border: "1px solid #94a3b8", padding: "6px 6px", width: "15%" }}>Quantity (KGS/PCS)</th>
                      <th rowSpan={2} style={{ border: "1px solid #94a3b8", padding: "6px 6px", width: "10%" }}>PACKAGE</th>
                      <th rowSpan={2} style={{ border: "1px solid #94a3b8", padding: "6px 6px", width: "8%" }}>UOM</th>
                      <th colSpan={2} style={{ border: "1px solid #94a3b8", padding: "4px 6px", width: "20%" }}>Total in KG</th>
                    </tr>
                    <tr style={{ background: "#1e3a8a", color: "#ffffff", textAlign: "center" }}>
                      <th style={{ border: "1px solid #94a3b8", padding: "4px 6px", width: "10%" }}>Net Weight</th>
                      <th style={{ border: "1px solid #94a3b8", padding: "4px 6px", width: "10%" }}>Gr. Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {effectiveDoc.items.map((item: any, i: number) => (
                      <tr key={i}>
                        <td style={{ border: "1px solid #94a3b8", padding: "5px 4px", textAlign: "center" }}>{item.sr_no}</td>
                        <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{item.description}</td>
                        <td style={{ border: "1px solid #94a3b8", padding: "5px 6px", textAlign: "right" }}>{Number(item.quantity).toLocaleString()}</td>
                        <td style={{ border: "1px solid #94a3b8", padding: "5px 6px", textAlign: "right" }}>{item.packages}</td>
                        <td style={{ border: "1px solid #94a3b8", padding: "5px 6px", textAlign: "center" }}>{item.uom}</td>
                        <td style={{ border: "1px solid #94a3b8", padding: "5px 6px", textAlign: "right" }}>{Number(item.net_weight).toFixed(2)}</td>
                        <td style={{ border: "1px solid #94a3b8", padding: "5px 6px", textAlign: "right" }}>{Number(item.gross_weight).toFixed(2)}</td>
                      </tr>
                    ))}
                    {/* Total Row */}
                    <tr style={{ background: "#fef08a", fontWeight: 800 }}>
                      <td colSpan={2} style={{ border: "1px solid #94a3b8", padding: "6px 10px", textAlign: "center" }}>
                        Total
                      </td>
                      <td style={{ border: "1px solid #94a3b8", padding: "6px 6px", textAlign: "right" }}>
                        {Number(effectiveDoc.totals.quantity).toLocaleString()}
                      </td>
                      <td style={{ border: "1px solid #94a3b8", padding: "6px 6px", textAlign: "right" }}>
                        {Number(effectiveDoc.totals.packages).toLocaleString()}
                      </td>
                      <td style={{ border: "1px solid #94a3b8", padding: "6px 6px" }}></td>
                      <td style={{ border: "1px solid #94a3b8", padding: "6px 6px", textAlign: "right" }}>
                        {Number(effectiveDoc.totals.net_weight).toFixed(2)}
                      </td>
                      <td style={{ border: "1px solid #94a3b8", padding: "6px 6px", textAlign: "right" }}>
                        {Number(effectiveDoc.totals.gross_weight).toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Signature & Stamp */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", border: "1px solid #94a3b8", padding: "12px", marginBottom: "10px" }}>
                  <div style={{ fontWeight: 700, fontSize: "11px" }}>Shipper's Signature and Stamp:</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <img src="/yinglima_signature.png" alt="Signature" style={{ height: "48px", objectFit: "contain" }} />
                    <img src="/yinglima_stamp.jpeg" alt="Stamp" style={{ height: "55px", objectFit: "contain" }} />
                  </div>
                </div>

                {/* Declaration */}
                <div style={{ textAlign: "center", fontSize: "11px", fontWeight: 700, color: "#334155", marginTop: "8px" }}>
                  {effectiveDoc.declaration}
                </div>
              </div>
            )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "12px 24px",
            borderTop: "1px solid #e2e8f0",
            background: "#ffffff",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 18px",
              borderRadius: "6px",
              background: "#e2e8f0",
              color: "#334155",
              border: "none",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>

      {/* Confirmation Sub-Modal for Status Change */}
      {showStatusModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: "16px",
          }}
          onClick={() => setShowStatusModal(null)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "10px",
              width: "100%",
              maxWidth: "450px",
              padding: "20px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 10px 0", fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
              Confirm Status Change: {showStatusModal.toUpperCase().replace("_", " ")}
            </h3>
            <p style={{ margin: "0 0 14px 0", fontSize: "13px", color: "#64748b" }}>
              Are you sure you want to transition this sale process order to{" "}
              <strong>{showStatusModal.toUpperCase().replace("_", " ")}</strong>?
            </p>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#334155", marginBottom: "4px" }}>
                Optional Remarks / Note:
              </label>
              <textarea
                value={statusRemark}
                onChange={(e) => setStatusRemark(e.target.value)}
                placeholder="Reason or dispatch notes..."
                rows={3}
                style={{
                  width: "100%",
                  padding: "8px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setShowStatusModal(null)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "6px",
                  background: "#e2e8f0",
                  color: "#334155",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={updatingStatus}
                onClick={() => handleStatusChange(showStatusModal)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  background: showStatusModal === "cancelled" ? "#dc2626" : "#0061f2",
                  color: "#ffffff",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {updatingStatus ? "Updating..." : "Confirm Update"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
