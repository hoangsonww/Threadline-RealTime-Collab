"use client";

import Link from "next/link";
import {
  BellIcon,
  CalendarDotsIcon,
  GearSixIcon,
  HouseIcon,
  ListIcon,
  PlusIcon,
  SignOutIcon,
  UsersThreeIcon,
  VideoConferenceIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiFetch, selectedOrganization, type IdentityResponse, type Organization, type Room } from "../lib/api";
import { AppSelect } from "./app-select";
import { Brand } from "./brand";

type Active = "home" | "rooms" | "calendar" | "activity" | "settings" | "members";
type SidebarData = { identity?: IdentityResponse; organization?: Organization; rooms: Room[]; error?: string };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "TL";

export function WorkspaceSidebar({ active }: { active: Active }) {
  const [data, setData] = useState<SidebarData>({ rooms: [] });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedOrgId = searchParams.get("org");

  const logOut = async () => {
    setLoggingOut(true);
    try {
      await apiFetch("/v1/auth/logout", { method: "POST" });
    } catch {
      // Even if the request fails (e.g. the session was already gone), still send
      // the user to the login screen — there is nothing else useful to do here.
    } finally {
      router.push("/login");
    }
  };

  useEffect(() => setMobileOpen(false), [pathname]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const identity = await apiFetch<IdentityResponse>("/v1/auth/me");
        const organization = selectedOrganization(identity, selectedOrgId);
        if (!organization) throw new Error("Your account has no organization.");
        const result = await apiFetch<{ rooms: Room[] }>(`/v1/orgs/${organization.id}/rooms`);
        if (!cancelled) setData({ identity, organization, rooms: result.rooms });
      } catch (error) {
        if (!cancelled)
          setData({ rooms: [], error: error instanceof Error ? error.message : "Unable to load workspace." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedOrgId]);

  const org = data.organization;
  const query = org ? `?org=${encodeURIComponent(org.id)}` : "";
  const canManageMembers = org?.role === "owner" || org?.role === "admin" || org?.attributes?.canManageMembers === true;
  const nav = [
    ["home", `/app${query}`, HouseIcon, "Home"],
    ["rooms", `/app/rooms${query}`, VideoConferenceIcon, "Rooms"],
    ["calendar", `/app/calendar${query}`, CalendarDotsIcon, "Calendar"],
    ["activity", `/app/activity${query}`, BellIcon, "Activity"],
  ] as const;

  return (
    <>
      <button
        type="button"
        className="button button-ghost button-icon mobile-nav-toggle"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        aria-expanded={mobileOpen}
      >
        <ListIcon size={20} weight="bold" />
      </button>
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
      <aside className={mobileOpen ? "sidebar sidebar-open" : "sidebar"}>
        <button
          type="button"
          className="button button-ghost button-icon sidebar-close"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        >
          <XIcon size={18} />
        </button>
        <Brand href="/app" />
        <div className="workspace-switcher workspace-switcher-with-action" aria-busy={!org}>
          <span className="workspace-monogram">{org ? initials(org.name) : "··"}</span>
          <div className="workspace-switcher-copy">
            {data.identity && data.identity.organizations.length > 1 ? (
              <AppSelect
                ariaLabel="Current organization"
                id="current-organization"
                onValueChange={(organizationId) => router.push(`${pathname}?org=${encodeURIComponent(organizationId)}`)}
                options={data.identity.organizations.map((organization) => ({
                  value: organization.id,
                  label: organization.name,
                }))}
                value={org?.id ?? ""}
                variant="sidebar"
              />
            ) : (
              <strong>{org?.name ?? "Loading workspace"}</strong>
            )}
            <small>{data.error ? "Connection required" : "Engineering workspace"}</small>
          </div>
          <Link className="workspace-switcher-add" href="/onboarding" aria-label="Create or join another workspace">
            <PlusIcon size={13} weight="bold" />
          </Link>
        </div>
        <nav className="workspace-nav" aria-label="Workspace">
          {nav.map(([key, href, Icon, label]) => (
            <Link className={active === key ? "active" : ""} href={href} key={key}>
              <Icon size={17} weight="duotone" /> {label}
            </Link>
          ))}
        </nav>
        <p className="sidebar-label">Recent rooms</p>
        <div className="sidebar-room-list">
          {data.rooms.slice(0, 5).map((room) => (
            <Link className="sidebar-room" href={`/app/rooms/${room.id}`} key={room.id}>
              <span># {room.name}</span>
              {room.visibility === "restricted" && (
                <span className="room-lock" aria-label="Restricted room">
                  ••
                </span>
              )}
            </Link>
          ))}
          {!data.rooms.length && (
            <p className="sidebar-empty">{data.error ? "Sign in to load rooms" : "No rooms yet"}</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <nav className="workspace-nav" aria-label="Account">
            {org && (
              <Link className={active === "members" ? "active" : ""} href={`/app/org/${org.id}/members`}>
                <UsersThreeIcon size={17} weight="duotone" /> Members
              </Link>
            )}
            <Link className={active === "settings" ? "active" : ""} href="/app/settings">
              <GearSixIcon size={17} weight="duotone" /> Settings
            </Link>
            <button type="button" onClick={() => void logOut()} disabled={loggingOut} aria-label="Log out">
              <SignOutIcon size={17} weight="duotone" /> {loggingOut ? "Logging out…" : "Log out"}
            </button>
          </nav>
          {canManageMembers && (
            <Link
              className="button button-secondary"
              style={{ width: "100%", marginTop: 10 }}
              href={`/app/org/${org?.id}/members`}
            >
              <PlusIcon size={15} weight="bold" /> Invite team
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}
