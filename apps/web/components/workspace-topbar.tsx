"use client";

import { BuildingsIcon, UserCircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, selectedOrganization, type IdentityResponse } from "../lib/api";

type Identity = { title: string; subtitle: string; initials: string };
const defaultIdentity: Identity = { title: "Loading workspace", subtitle: "Securing your session", initials: "··" };

const initialsFor = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TL";

export function WorkspaceTopbar() {
  const [identity, setIdentity] = useState(defaultIdentity);
  const selectedOrgId = useSearchParams().get("org");
  useEffect(() => {
    void apiFetch<IdentityResponse>("/v1/auth/me")
      .then((data) => {
        const name = data.user.displayName as string;
        const role = selectedOrganization(data, selectedOrgId)?.role;
        const roleLabel = role ? role[0].toUpperCase() + role.slice(1) : undefined;
        setIdentity({
          title: selectedOrganization(data, selectedOrgId)?.name ?? "Your workspace",
          subtitle: name ? `${name}${roleLabel ? ` · ${roleLabel}` : ""}` : "Your workspace",
          initials: initialsFor(name),
        });
      })
      .catch(() =>
        setIdentity({ title: "Session unavailable", subtitle: "Sign in to access your workspace", initials: "TL" }),
      );
  }, [selectedOrgId]);
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
        <Link className="button button-ghost button-icon" href="/app/rooms" aria-label="Open rooms">
          <BuildingsIcon size={18} />
        </Link>
        <Link className="button button-ghost button-icon" href="/app/settings" aria-label="Personal settings">
          <UserCircleIcon size={19} />
        </Link>
        <Link className="avatar topbar-profile" href="/app/settings" aria-label="Open personal settings">
          {identity.initials}
        </Link>
      </div>
    </header>
  );
}
