/**
 * Bank Master Module.
 * Replicates legacy screen erp.inhymasolutions.com/bank/list
 * with Sr. No., Holder Name, Bank (Bank Name + Account Number), Branch, Status, and Action.
 */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge } from "@/components/ui";
import { StatusSelectField, TextField } from "@/components/fields";
import type { Bank } from "@/types";

const EMPTY: FormState = {
  bank_name: "",
  account_number: "",
  account_holder_name: "",
  ifsc_code: "",
  branch: "",
  status: "active",
};

export function BanksPage() {
  return (
    <MasterPage<Bank>
      activeKey="masters-banks"
      apiBase="/masters/banks"
      permissionPrefix="bank"
      exportPermission="bank.export"
      bulkActionPermission="bank.bulk_action"
      liveModule="banks"
      entityName="Bank"
      heading="Bank"
      subtitle="Manage corporate bank accounts, account numbers, IFSC codes, branches, and holder details."
      breadcrumbTrail={["Settings", "Masters", "Bank"]}
      newButtonLabel="+ ADD NEW"
      searchPlaceholder="Search..."
      hideQuickAdd={true}
      modalCardStyle={{ maxWidth: "540px", width: "100%" }}
      columnHeaders={["Holder Name", "Bank", "Branch", "Status"]}
      columns={[
        {
          header: "Holder Name",
          sortValue: (b) => b.account_holder_name,
          render: (b) => (
            <span className="cell-primary" style={{ fontWeight: 600 }}>
              {b.account_holder_name}
            </span>
          ),
        },
        {
          header: "Bank",
          sortValue: (b) => b.bank_name,
          render: (b) => (
            <div>
              <div style={{ fontWeight: 600, color: "#1e293b" }}>{b.bank_name}</div>
              <div
                style={{
                  fontSize: "13px",
                  color: "#475569",
                  fontFamily: "ui-monospace, monospace",
                  marginTop: "2px",
                }}
              >
                {b.account_number}
              </div>
            </div>
          ),
        },
        {
          header: "Branch",
          sortValue: (b) => b.branch,
          render: (b) => <span style={{ color: "#334155" }}>{b.branch}</span>,
        },
        {
          header: "Status",
          sortValue: (b) => b.status,
          render: (b) => <StatusBadge status={b.status} />,
        },
      ]}
      importHeaders={[
        { key: "bank_name", label: "Bank Name", required: true },
        { key: "account_number", label: "Account Number", required: true },
        { key: "account_holder_name", label: "Account Holder Name", required: true },
        { key: "ifsc_code", label: "IFSC Code", required: true },
        { key: "branch", label: "Branch", required: true },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        bank_name: item?.bank_name ?? "",
        account_number: item?.account_number ?? "",
        account_holder_name: item?.account_holder_name ?? "",
        ifsc_code: item?.ifsc_code ?? "",
        branch: item?.branch ?? "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => ({
        bank_name: f.bank_name.trim(),
        account_number: f.account_number.trim(),
        account_holder_name: f.account_holder_name.trim(),
        ifsc_code: f.ifsc_code.trim().toUpperCase(),
        branch: f.branch.trim(),
        status: f.status,
      })}
      validateForm={(f) => {
        const errs: Record<string, string> = {};
        if (!f.bank_name.trim()) errs.bank_name = "Bank Name is required.";
        if (!f.account_number.trim()) errs.account_number = "Account Number is required.";
        if (!f.account_holder_name.trim()) errs.account_holder_name = "Account Holder Name is required.";
        if (!f.ifsc_code.trim()) errs.ifsc_code = "IFSC Code is required.";
        if (!f.branch.trim()) errs.branch = "Branch is required.";
        return errs;
      }}
      renderFields={(f, set, errors) => (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <TextField
            id="bank_name"
            label="Bank Name *"
            value={f.bank_name}
            onChange={(v) => set("bank_name", v)}
            error={errors?.bank_name}
            placeholder="e.g. HDFC BANK"
            required
          />
          <TextField
            id="account_number"
            label="Account Number *"
            value={f.account_number}
            onChange={(v) => set("account_number", v)}
            error={errors?.account_number}
            placeholder="e.g. 50200117491557"
            required
          />
          <TextField
            id="account_holder_name"
            label="Account Holder Name *"
            value={f.account_holder_name}
            onChange={(v) => set("account_holder_name", v)}
            error={errors?.account_holder_name}
            placeholder="e.g. INHYMA SOLUTIONS LLP (GUJARAT)"
            required
          />
          <TextField
            id="ifsc_code"
            label="IFSC Code *"
            value={f.ifsc_code}
            onChange={(v) => set("ifsc_code", v.toUpperCase())}
            error={errors?.ifsc_code}
            placeholder="e.g. HDFC0000118"
            required
          />
          <TextField
            id="branch"
            label="Branch *"
            value={f.branch}
            onChange={(v) => set("branch", v)}
            error={errors?.branch}
            placeholder="e.g. PARMESHWARI PLAZA MULUND (W)"
            required
          />
          <StatusSelectField
            value={f.status}
            onChange={(v) => set("status", v)}
          />
        </div>
      )}
      detailFields={(b) => [
        { label: "Account Holder Name", value: b.account_holder_name, fullWidth: true },
        { label: "Bank Name", value: b.bank_name },
        { label: "Account Number", value: b.account_number },
        { label: "IFSC Code", value: b.ifsc_code },
        { label: "Branch", value: b.branch },
        { label: "Status", value: <StatusBadge status={b.status} /> },
      ]}
      detailTitle={(b) => b.account_holder_name}
      detailSubtitle={(b) => `${b.bank_name} - ${b.account_number}`}
    />
  );
}
