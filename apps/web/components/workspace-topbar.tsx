"use client";

import { BuildingsIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { ThemeToggle } from "./theme-toggle";

type Identity = { title: string; subtitle: string; initials: string };
const defaultIdentity: Identity = { title: "Your workspace", subtitle: "Personal workspace", initials: "TL" };

const initialsFor = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TL";

export function WorkspaceTopbar() {
  const [identity, setIdentity] = useState(defaultIdentity);
  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_ORIGIN;
    if (api) {
      void fetch(`${api}/v1/auth/me`, { credentials: "include" })
        .then(async (response) => (response.ok ? response.json() : Promise.reject(new Error("session unavailable"))))
        .then((data) => {
          const name = data.user.displayName as string;
          setIdentity({
            title: data.organizations[0]?.name ?? "Your workspace",
            subtitle: name ? `${name} · personal workspace` : "Personal workspace",
            initials: initialsFor(name),
          });
        })
        .catch(() => undefined);
      return;
    }
    try {
      const user = JSON.parse(localStorage.getItem("threadline-user") ?? "{}") as { displayName?: string };
      if (user.displayName)
        setIdentity({
          title: "Your workspace",
          subtitle: `${user.displayName} · personal workspace`,
          initials: initialsFor(user.displayName),
        });
    } catch {
      // The unauthenticated fallback is intentionally generic.
    }
  }, []);
  return (
    <header className="topbar">
      <div className="topbar-context">
        <span className="avatar">{identity.initials}</span>
        <div>
          <h1>{identity.title}</h1>
          <p>{identity.subtitle}</p>
        </div>
      </div>
      <div className="topbar-actions">
        <ThemeToggle compact />
        <button className="button button-ghost button-icon" aria-label="Organization settings">
          <BuildingsIcon size={18} />
        </button>
        <button className="button button-ghost button-icon" aria-label="Personal profile">
          <UserCircleIcon size={19} />
        </button>
        <span className="avatar">{identity.initials}</span>
      </div>
    </header>
  );
}
