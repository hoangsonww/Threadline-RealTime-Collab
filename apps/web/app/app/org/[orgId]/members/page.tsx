import type { Metadata } from "next";
import { AppShell } from "../../../../../components/app-shell";
import { MembersPage } from "../../../../../components/members-page";
import { WorkspaceTopbar } from "../../../../../components/workspace-topbar";

export const metadata: Metadata = { title: "Members" };

export default async function OrganizationMembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return (
    <main id="main-content">
      <AppShell active="members">
        <WorkspaceTopbar />
        <MembersPage orgId={orgId} />
      </AppShell>
    </main>
  );
}
