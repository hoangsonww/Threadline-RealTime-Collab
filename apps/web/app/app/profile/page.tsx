import type { Metadata } from "next";
import { AppShell } from "../../../components/app-shell";
import { ProfilePage } from "../../../components/profile-page";
import { WorkspaceTopbar } from "../../../components/workspace-topbar";

export const metadata: Metadata = { title: "Profile" };

export default function Profile() {
  return (
    <main id="main-content">
      <AppShell active="profile">
        <WorkspaceTopbar />
        <ProfilePage />
      </AppShell>
    </main>
  );
}
