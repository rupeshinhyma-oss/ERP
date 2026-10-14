import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/hooks";

export function DashboardPage() {
  const { profile } = useAuth();

  const titleName = profile && typeof profile === "object"
    ? profile.full_name || profile.username || "Inhyma ERP"
    : "Inhyma ERP";

  return (
    <AppShell activeKey="dashboard">
      <main className="page">
        <div className="page-header">
          <h1 style={{ color: "#1e293b", fontWeight: 700, fontSize: "20px", margin: 0 }}>
            {`Welcome To ${titleName}`}
          </h1>
        </div>
      </main>
    </AppShell>
  );
}
