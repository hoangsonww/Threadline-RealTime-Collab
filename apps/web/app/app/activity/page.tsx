import type { Metadata } from "next";
import { ActivityFeed } from "../../../components/activity-feed";
import { AppShell } from "../../../components/app-shell";
import { WorkspaceTopbar } from "../../../components/workspace-topbar";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return (
    <main id="main-content">
      <AppShell active="activity">
        <WorkspaceTopbar />
        <ActivityFeed />
      </AppShell>
    </main>
  );
}
