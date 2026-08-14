import { WorkspaceSidebar } from "./workspace-sidebar";

export function AppShell({
  children,
  active = "home",
}: {
  children: React.ReactNode;
  active?: "home" | "rooms" | "calendar" | "activity" | "settings" | "members" | "profile";
}) {
  return (
    <div className="app-layout">
      <WorkspaceSidebar active={active} />
      <section style={{ minWidth: 0 }}>{children}</section>
    </div>
  );
}
