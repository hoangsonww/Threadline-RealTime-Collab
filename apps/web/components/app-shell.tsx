import Link from "next/link";
import {
  BellIcon,
  CalendarDotsIcon,
  GearSixIcon,
  HouseIcon,
  PlusIcon,
  VideoConferenceIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";

const savedRooms = ["incident-2026-07", "platform-planning", "design-crit"];

export function AppShell({
  children,
  active = "home",
}: {
  children: React.ReactNode;
  active?: "home" | "rooms" | "settings";
}) {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Brand href="/app" />
        <div className="workspace-switcher">
          <span className="workspace-monogram">NE</span>
          <span>
            <strong>Northstar Engineering</strong>
            <small>Engineering workspace</small>
          </span>
        </div>
        <nav className="workspace-nav" aria-label="Workspace">
          <Link className={active === "home" ? "active" : ""} href="/app">
            <HouseIcon size={17} weight="duotone" /> Home
          </Link>
          <Link className={active === "rooms" ? "active" : ""} href="/app">
            <VideoConferenceIcon size={17} weight="duotone" /> Rooms
          </Link>
          <Link href="/app">
            <CalendarDotsIcon size={17} weight="duotone" /> Calendar
          </Link>
          <Link href="/app">
            <BellIcon size={17} weight="duotone" /> Activity
          </Link>
        </nav>
        <p className="sidebar-label">Recent rooms</p>
        <div>
          {savedRooms.map((room) => (
            <Link className="sidebar-room" href={`/app/rooms/${room}`} key={room}>
              <span># {room}</span>
              <span className="status-dot" />
            </Link>
          ))}
        </div>
        <div className="sidebar-bottom">
          <Link className={active === "settings" ? "workspace-nav active" : "workspace-nav"} href="/app/settings">
            <span style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 36, padding: "0 9px" }}>
              <GearSixIcon size={17} weight="duotone" /> Settings
            </span>
          </Link>
          <button className="button button-secondary" style={{ width: "100%", marginTop: 10 }}>
            <PlusIcon size={15} weight="bold" /> Invite team
          </button>
          <div className="sidebar-utility">
            <ThemeToggle compact />
            <span>Appearance</span>
          </div>
        </div>
      </aside>
      <section style={{ minWidth: 0 }}>{children}</section>
    </div>
  );
}
