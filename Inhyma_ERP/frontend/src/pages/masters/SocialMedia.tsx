/**
 * Social Media master module.
 * Replicates the legacy ERP screen with Name, Status, and action triggers.
 */

import { MasterPage, type FormState } from "@/components/MasterPage";
import { StatusBadge } from "@/components/ui";
import { StatusSelectField, TextField } from "@/components/fields";
import type { SocialMedia } from "@/types";

const EMPTY: FormState = {
  name: "",
  status: "active",
};

export function SocialMediaPage() {
  return (
    <MasterPage<SocialMedia>
      activeKey="masters-social-media"
      apiBase="/masters/social-media"
      permissionPrefix="socialmedia"
      exportPermission="socialmedia.export"
      bulkActionPermission="socialmedia.bulk_action"
      liveModule="social_media"
      entityName="social media"
      heading="Social Media"
      subtitle="Configure and manage social media platforms and communication channels."
      breadcrumbTrail={["Settings", "Masters", "Social Media"]}
      newButtonLabel="+ ADD NEW"
      searchPlaceholder="Search Name or Sr. No..."
      hideQuickAdd={true}
      columnHeaders={["Name", "Status"]}
      columns={[
        {
          header: "Name",
          sortValue: (s) => s.name,
          render: (s) => (
            <span className="cell-primary" style={{ fontWeight: 600 }}>
              {s.name}
            </span>
          ),
        },
        {
          header: "Status",
          sortValue: (s) => s.status,
          render: (s) => <StatusBadge status={s.status} />,
        },
      ]}
      importHeaders={[
        { key: "name", label: "Name", required: true },
        { key: "status", label: "Status" },
      ]}
      emptyForm={EMPTY}
      fillForm={(item) => ({
        name: item?.name ?? "",
        status: item?.status ?? "active",
      })}
      toPayload={(f) => ({
        name: f.name.trim(),
        status: f.status,
      })}
      validateForm={(f) => {
        const errs: Record<string, string> = {};
        if (!f.name.trim()) {
          errs.name = "Name is required.";
        }
        return errs;
      }}
      renderFields={(f, set, errors) => (
        <div className="form-grid">
          <TextField
            id="name"
            label="Name *"
            required
            maxLength={100}
            placeholder="e.g. Facebook"
            value={f.name}
            error={errors?.name}
            onChange={(v) => set("name", v)}
          />
          <StatusSelectField value={f.status} onChange={(v) => set("status", v)} />
        </div>
      )}
      detailFields={(s) => [
        { label: "Name", value: s.name, fullWidth: true },
        { label: "Current Status", value: <StatusBadge status={s.status} /> },
      ]}
      detailTitle={(s) => s.name}
      detailSubtitle={() => "Social Media Platform"}
    />
  );
}
