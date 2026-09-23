import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/hooks";

export function Dashboard() {
  const { profile } = useAuth();

  let titleName =
    profile && typeof profile === "object"
      ? (profile as any).display_name ||
        (profile as any).full_name ||
        (profile as any).username ||
        (profile as any).email ||
        "Super Admin"
      : "Super Admin";

  if (titleName === "Platform Super Admin" || titleName === "Platform SuperAdmin") {
    titleName = "Super Admin";
  }

  return (
    <AppShell activeKey="dashboard" pageTitle={`Welcome To ${titleName}`}>
      <main
        className="page"
        style={{
          background: "transparent",
          minHeight: "calc(100vh - 160px)",
          padding: 0,
        }}
      >
        {/* Clean Dashboard */}
      </main>
    </AppShell>
  );
}

export const DashboardPage = Dashboard;
export default Dashboard;
