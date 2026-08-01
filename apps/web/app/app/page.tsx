import { AppShell } from "../../components/app-shell";
import { Dashboard } from "../../components/dashboard";
import { WorkspaceTopbar } from "../../components/workspace-topbar";

export default function AppHomePage() {
  return (
    <main id="main-content">
      <AppShell active="home">
        <WorkspaceTopbar />
        <Dashboard />
      </AppShell>
    </main>
  );
}
