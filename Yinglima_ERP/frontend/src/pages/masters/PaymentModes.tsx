/** Payment Modes / Bank Accounts master page. */

import { useEffect, useState } from "react";
import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge } from "@/components/ui";
import { SelectField, TextField } from "@/components/fields";
import { apiGet } from "@/lib/api";
import type { Currency, PaymentMode } from "@/types";

const ACCOUNT_TYPE_OPTIONS = [
  { value: "", label: "— Select Type —" },
  { value: "Bank Account", label: "Bank Account" },
  { value: "Wire Transfer", label: "Wire Transfer" },
  { value: "Digital Wallet", label: "Digital Wallet" },
  { value: "Cash", label: "Cash" },
  { value: "Other", label: "Other" },
];

const EMPTY: FormState = {
  name: "",
  account_type: "",
  currency_code: "",
  description: "",
  status: "active",
};

export function PaymentModesPage() {
  const [currencies, setCurrencies] = useState<Array<{ value: string; label: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    apiGet<Currency[]>("/masters/currencies?status=active&page_size=50")
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res.data) ? res.data : [];
        setCurrencies(
          list.map((c) => ({
            value: c.code,
            label: c.symbol ? `${c.code} (${c.symbol}) — ${c.name}` : `${c.code} — ${c.name}`,
          }))
        );
      })
      .catch(() => {
        /* leave empty if unavailable */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <MasterPage<PaymentMode>
      activeKey="masters-payment-modes"
      apiBase="/masters/payment-modes"
      permissionPrefix="payment_mode"
      exportPermission="payment_mode.export"
      bulkActionPermission="payment_mode.bulk_action"
      entityName="payment mode"
      heading="Payment Modes / Bank Accounts"
      newButtonLabel="+ New Payment Mode"
      hideQuickAdd
      searchPlaceholder="Search name, type, currency..."
      columnHeaders={["Payment Mode / Bank Account", "Account Type", "Currency", "Status"]}
      columns={[
        { header: "Payment Mode / Bank Account", render: (b) => <span className="cell-primary">{b.name}</span> },
        { header: "Account Type", render: (b) => b.account_type || "—" },
        { header: "Currency", render: (b) => b.currency_code || "—" },
        { header: "Status", render: (b) => <StatusBadge status={b.status} /> },
      ]}
      importHeaders={[
        { key: "name", label: "Payment Mode / Bank Account", required: true },
        { key: "account_type", label: "Account Type" },
        { key: "currency_code", label: "Currency" },
        { key: "description", label: "Description" },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        name: item?.name ?? "",
        account_type: item?.account_type ?? "",
        currency_code: item?.currency_code ?? "",
        description: item?.description ?? "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => ({
        name: f.name.trim(),
        code: f.name.trim() ? `PM-${f.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 15)}` : "PM-GEN",
        account_type: f.account_type.trim() || null,
        currency_code: f.currency_code.trim() || null,
        description: f.description.trim() || null,
        status: f.status,
      })}
      renderFields={(f, set) => (
        <div className="form-grid">
          <TextField
            id="name"
            label="Payment Mode / Bank Account Name *"
            required
            maxLength={150}
            value={f.name}
            onChange={(v) => set("name", v)}
          />
          <SelectField
            id="account_type"
            label="Account Type"
            value={f.account_type}
            onChange={(v) => set("account_type", v)}
          >
            {ACCOUNT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="currency_code"
            label="Currency"
            value={f.currency_code}
            onChange={(v) => set("currency_code", v)}
          >
            <option value="">— Any / Multi-Currency —</option>
            {currencies.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
            {f.currency_code && !currencies.some((c) => c.value === f.currency_code) && (
              <option value={f.currency_code}>{f.currency_code}</option>
            )}
          </SelectField>
          <TextField
            id="description"
            label="Description / Bank Details"
            value={f.description}
            onChange={(v) => set("description", v)}
          />
        </div>
      )}
      detailFields={(b) => [
        { label: "Payment Mode / Bank Account", value: b.name, fullWidth: true },
        { label: "Code", value: b.code },
        { label: "Account Type", value: b.account_type || "—" },
        { label: "Currency", value: b.currency_code || "—" },
        { label: "Description", value: b.description || "—", fullWidth: true },
        { label: "Current Status", value: <StatusBadge status={b.status} /> },
      ]}
    />
  );
}
