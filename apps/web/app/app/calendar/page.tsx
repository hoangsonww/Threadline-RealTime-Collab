import type { Metadata } from "next";
import { AppShell } from "../../../components/app-shell";
import { CalendarView } from "../../../components/calendar-view";
import { WorkspaceTopbar } from "../../../components/workspace-topbar";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <main id="main-content">
      <AppShell active="calendar">
        <WorkspaceTopbar />
        <CalendarView />
      </AppShell>
    </main>
  );
}
