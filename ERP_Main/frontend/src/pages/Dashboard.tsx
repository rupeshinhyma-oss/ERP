import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/hooks";
import { useGlobalSession } from "@/lib/session";

export function Dashboard() {
  const { profile } = useAuth();
  const { userType, memberships } = useGlobalSession();
  const activeMemberships = (memberships || []).filter((m) => m.status === "ACTIVE");

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

  const isZeroErpUser = userType === "global_user" && activeMemberships.length === 0;

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
        {isZeroErpUser ? (
          <div
            style={{
              maxWidth: "600px",
              margin: "40px auto",
              padding: "32px",
              background: "#ffffff",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "#f1f5f9",
                color: "#64748b",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
                fontSize: "24px",
              }}
            >
              🔒
            </div>
            <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#1e293b", marginBottom: "8px" }}>
              No ERP Access Assigned
            </h2>
            <p style={{ fontSize: "14px", color: "#64748b", lineHeight: 1.6, marginBottom: 0 }}>
              Your account has been created in the ERP Dashboard. You currently do not have access to any individual ERP applications.
              Please contact your platform administrator to grant access to Yinglima ERP or Inhyma ERP. Once access is granted, you will be able to access the assigned ERP directly.
            </p>
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}

export const DashboardPage = Dashboard;
export default Dashboard;
