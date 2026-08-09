import type { Metadata } from "next";
import { AppShell } from "../../../components/app-shell";
import { RoomsDirectory } from "../../../components/rooms-directory";
import { WorkspaceTopbar } from "../../../components/workspace-topbar";

export const metadata: Metadata = { title: "Rooms" };

export default function RoomsPage() {
  return (
    <main id="main-content">
      <AppShell active="rooms">
        <WorkspaceTopbar />
        <RoomsDirectory />
      </AppShell>
    </main>
  );
}
