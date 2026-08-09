import type { Metadata } from "next";
import { AppShell } from "../../../../components/app-shell";
import { Settings } from "../../../../components/settings";
import { WorkspaceTopbar } from "../../../../components/workspace-topbar";

export const metadata: Metadata = { title: "Sessions" };

export default function SessionSettingsPage() {
  return (
    <main id="main-content">
      <AppShell active="settings">
        <WorkspaceTopbar />
        <Settings section="sessions" />
      </AppShell>
    </main>
  );
}
