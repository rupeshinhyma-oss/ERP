import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/hooks";

export function DashboardPage() {
  const { profile } = useAuth();

  const titleName =
    (profile && typeof profile === "object"
      ? profile.display_name ||
        profile.full_name ||
        [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim()
      : "") || "Yinglima ERP";

  return (
    <AppShell activeKey="dashboard">
      <main className="page" style={{ background: "#f8fafc", minHeight: "calc(100vh - 60px)", padding: "24px 32px" }}>
        <div style={{ marginBottom: "24px" }}>
          <h1 className="page-title">
            {`Welcome To ${titleName}`}
          </h1>
        </div>
      </main>
    </AppShell>
  );
}
