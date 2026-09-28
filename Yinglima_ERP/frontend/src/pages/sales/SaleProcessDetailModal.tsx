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

  const handleExportExcel = async () => {
    setExportingExcel(true);
    try {
      const token = Auth.getAccessToken() || localStorage.getItem("erp_access_token") || "";
      const res = await fetch(`/api/v1/sales/orders/${orderId}/export-trade-docs`, {
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
      a.download = `Yinglima_CI_PL_${cleanCode}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("Commercial Invoice & Packing List downloaded (.xlsx)", "success");
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
    const title = isCI ? "COMMERCIAL INVOICE" : "PACKING LIST";
    const docNoLabel = isCI ? "Commercial Invoice No" : "Packing List No";

    const itemsRows = isCI
      ? docData.items
          .map(
            (it: any) => `
        <tr>
          <td style="text-align:center; padding: 5px 4px;">${it.sr_no}</td>
          <td style="padding: 5px 8px;">${it.description}</td>
          <td style="text-align:center; padding: 5px 6px;">${it.hs_code}</td>
          <td style="text-align:center; padding: 5px 6px;">${it.uom}</td>
          <td style="text-align:right; padding: 5px 6px;">${Number(it.quantity).toLocaleString()}</td>
          <td style="text-align:right; padding: 5px 6px;">$${Number(it.unit_price_usd).toFixed(2)}</td>
          <td style="text-align:right; padding: 5px 6px; font-weight:700;">$${Number(it.total_amount_usd).toFixed(2)}</td>
        </tr>`
          )
          .join("")
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
      ? `
        <tr style="background:#fef08a; font-weight:800;">
          <td colspan="4" style="text-align:center; padding: 6px 10px;">Total Price CIF INDIA:</td>
          <td style="text-align:right; padding: 6px 6px;">${Number(docData.totals.quantity).toLocaleString()}</td>
          <td style="text-align:right; padding: 6px 6px;"></td>
          <td style="text-align:right; padding: 6px 6px;">$${Number(docData.totals.total_amount_usd).toFixed(2)}</td>
        </tr>`
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
      ? `
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
        <div style="border: 1px solid #94a3b8; padding: 6px 12px; margin-bottom: 12px; font-size: 11px; line-height: 1.6;">
          <div><strong>Terms of Payment:</strong> ${docData.payment_terms}</div>
          <div><strong>Shipping Terms:</strong> ${docData.shipping_terms}</div>
          <div><strong>Delivery Time:</strong> ${docData.delivery_time}</div>
        </div>`
      : `
        <div style="border: 1px solid #94a3b8; padding: 6px 12px; margin-bottom: 12px; font-size: 11px; line-height: 1.6;">
          <div><strong>Shipping Terms:</strong> ${docData.shipping_terms}</div>
        </div>`;

    const sectionTitle = isCI ? "SHIPMENT & PRODUCT ITEMS" : "PACKING INFORMATION";

    const printDocHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${docData.consignment_code} - ${title}</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 12mm 10mm 12mm 10mm;
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
              font-size: 11px;
              line-height: 1.4;
            }
            .header {
              text-align: center;
              border-bottom: 2px solid #1e3a8a;
              padding-bottom: 10px;
              margin-bottom: 12px;
            }
            .company-name {
              font-size: 17px;
              font-weight: 800;
              color: #1e3a8a;
              letter-spacing: 0.5px;
              margin: 0 0 4px 0;
            }
            .company-contact {
              font-size: 10.5px;
              color: #475569;
              margin: 2px 0;
            }
            .doc-title {
              background: #f1f5f9;
              border: 1px solid #cbd5e1;
              text-align: center;
              font-size: 15px;
              font-weight: 800;
              letter-spacing: 1px;
              padding: 6px 0;
              margin-bottom: 12px;
              border-radius: 3px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 12px;
              font-size: 11px;
            }
            th, td {
              border: 1px solid #94a3b8;
              padding: 5px 6px;
            }
            th {
              font-weight: 700;
            }
            .party-th {
              background: #e2e8f0;
              font-weight: 700;
              padding: 6px 10px;
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
                  <strong>${docData.recipient.company_name}</strong><br />
                  <span style="white-space: pre-line;">${docData.recipient.address}</span><br />
                  <strong>Contact:</strong> ${docData.recipient.contact_person}<br />
                  <strong>Phone:</strong> ${docData.recipient.phone}<br />
                  <strong>Email:</strong> ${docData.recipient.email}
                </td>
              </tr>
            </table>

            ${termsHtml}

            <div style="background: #e2e8f0; padding: 6px 10px; font-weight: 700; border: 1px solid #94a3b8; border-bottom: none;">
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

          <div class="non-breaking" style="margin-top: 14px;">
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
                <td style="width: 42%; vertical-align: middle; text-align: center; padding: 10px;">
                  <div style="font-weight: 700; font-size: 11px; margin-bottom: 6px;">
                    Shipper's Signature and Stamp:
                  </div>
                  <div style="display: inline-flex; align-items: center; justify-content: center; gap: 14px; margin-top: 4px;">
                    <img src="/yinglima_signature.png" alt="Signature" style="height: 48px; object-fit: contain;" />
                    <img src="/yinglima_stamp.jpeg" alt="Stamp" style="height: 55px; object-fit: contain;" />
                  </div>
                </td>
              </tr>
            </table>

            <div style="text-align: center; font-size: 10.5px; font-weight: 700; color: #334155; margin-top: 10px;">
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
      company_name: order.buyer_name || "INHYMA SOLUTIONS LLP",
      address: order.buyer_branch_name ? `${order.buyer_branch_name}, India\nGSTIN/UIN: 27AAKFI9869H1ZL` : "Ground Floor, Godown No:2,3,4, Prerna Complex, Bhiwandi, Thane, Maharashtra, 421302, INDIA\nGSTIN/UIN: 27AAKFI9869H1ZL",
      contact_person: "Mr. Prathamesh Bangar",
      phone: "+91 95619 14519",
      email: "sales@inhyma.com",
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
      hs_code: it.hsn_code || "8422.30.00",
      uom: "NOS",
      quantity: Number(it.quantity),
      unit_price_usd: Number(it.unit_rate),
      total_amount_usd: Number(it.item_total),
      unit_price_rmb: Number(it.unit_rate) * 7.14,
      packages: Math.max(1, Math.ceil(Number(it.quantity) / 10)),
      net_weight: Number(it.quantity) * 1.5,
      gross_weight: Number(it.quantity) * 1.8,
      cbm: 0.05,
    })),
    totals: {
      quantity: Number(order.total_quantity),
      packages: Math.max(1, Math.ceil(Number(order.total_quantity) / 10)),
      total_amount_usd: Number(order.total_amount),
      total_amount_rmb: Number(order.total_amount) * 7.14,
      net_weight: Number(order.total_quantity) * 1.5,
      gross_weight: Number(order.total_quantity) * 1.8,
      cbm: 0.5,
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
          <div className="no-print" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={exportingExcel}
              style={{
                padding: "6px 13px",
                borderRadius: "6px",
                border: "1px solid #16a34a",
                background: "#f0fdf4",
                fontSize: "13px",
                fontWeight: 700,
                color: "#15803d",
                cursor: exportingExcel ? "wait" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
              title="Download official dual-sheet Excel (.xlsx) matching Yinglima CI and Packing List template"
            >
              <span>📥</span>
              <span>{exportingExcel ? "Generating..." : "Download Excel (.xlsx)"}</span>
            </button>

            <button
              type="button"
              onClick={() => handlePrintDoc()}
              style={{
                padding: "6px 13px",
                borderRadius: "6px",
                border: "1px solid #0284c7",
                background: "#f0f9ff",
                fontSize: "13px",
                fontWeight: 700,
                color: "#0369a1",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
              title="Print or save document as official PDF"
            >
              <span>🖨️</span>
              <span>Print / PDF</span>
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
            {activeDocTab === "ci" && effectiveDoc && (
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
                    COMMERCIAL INVOICE
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
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", width: "32%", fontWeight: 700 }}>{effectiveDoc.recipient.company_name}</td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Address</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontSize: "10.5px" }}>{effectiveDoc.shipper.address}</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Address</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontSize: "10.5px", whiteSpace: "pre-line" }}>{effectiveDoc.recipient.address}</td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Contact Person</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.shipper.contact_person}</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Contact Person</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.recipient.contact_person}</td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Phone Number</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.shipper.phone}</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Phone Number</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.recipient.phone}</td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Email</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.shipper.email}</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Email ID</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.recipient.email}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Trade Terms */}
                <div style={{ border: "1px solid #94a3b8", padding: "6px 12px", marginBottom: "12px", fontSize: "11px", lineHeight: "1.6" }}>
                  <div><strong>Terms of Payment:</strong> {effectiveDoc.payment_terms}</div>
                  <div><strong>Shipping Terms:</strong> {effectiveDoc.shipping_terms}</div>
                  <div><strong>Delivery Time:</strong> {effectiveDoc.delivery_time}</div>
                </div>

                {/* Items Table */}
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
                        <td style={{ border: "1px solid #94a3b8", padding: "5px 6px", textAlign: "center" }}>{item.hs_code}</td>
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
            )}

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
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", width: "32%", fontWeight: 700 }}>{effectiveDoc.recipient.company_name}</td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Address</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontSize: "10.5px" }}>{effectiveDoc.shipper.address}</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Address</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontSize: "10.5px", whiteSpace: "pre-line" }}>{effectiveDoc.recipient.address}</td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Contact Person</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.shipper.contact_person}</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Contact Person</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.recipient.contact_person}</td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Phone Number</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.shipper.phone}</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Phone Number</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.recipient.phone}</td>
                    </tr>
                    <tr>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Email</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.shipper.email}</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px", fontWeight: 700, background: "#f8fafc" }}>Email ID</td>
                      <td style={{ border: "1px solid #94a3b8", padding: "5px 8px" }}>{effectiveDoc.recipient.email}</td>
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
