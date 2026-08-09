"use client";

import { PlusIcon, ShieldCheckIcon, UsersThreeIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { apiFetch, type IdentityResponse } from "../lib/api";
import { AppSelect } from "./app-select";

type Member = {
  id: string;
  email: string;
  displayName: string;
  username: string;
  role: "owner" | "admin" | "member";
  attributes?: { canCreateRooms?: boolean; canManageMembers?: boolean; canSchedule?: boolean };
  joinedAt: string;
};

export function MembersPage({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [orgName, setOrgName] = useState("Workspace");
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [role, setRole] = useState("member");
  const load = useCallback(async () => {
    const identity = await apiFetch<IdentityResponse>("/v1/auth/me");
    const org = identity.organizations.find((candidate) => candidate.id === orgId);
    if (!org) throw new Error("You do not have access to this organization.");
    const data = await apiFetch<{ members: Member[] }>(`/v1/orgs/${orgId}/members`);
    setOrgName(org.name);
    setCanManageMembers(org.role === "owner" || org.role === "admin" || org.attributes?.canManageMembers === true);
    setMembers(data.members);
  }, [orgId]);
  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load members."));
  }, [load]);
  const addMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/v1/orgs/${orgId}/members`, {
        method: "POST",
        body: JSON.stringify({
          email: String(form.get("email")).trim(),
          role: form.get("role"),
          attributes: {
            canCreateRooms: form.get("canCreateRooms") === "on",
            canSchedule: form.get("canSchedule") === "on",
          },
        }),
      });
      setRole("member");
      setModal(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add member.");
    } finally {
      setSaving(false);
    }
  };
  const openMemberModal = () => {
    setRole("member");
    setError("");
    setModal(true);
  };
  return (
    <div className="content">
      <div className="page-header">
        <div>
          <p className="eyebrow">{orgName}</p>
          <h2>Members</h2>
          <p>
            Organization membership is the first access boundary; room-level rules further restrict protected rooms.
          </p>
        </div>
        {canManageMembers && (
          <button className="button button-primary" onClick={openMemberModal}>
            <PlusIcon size={16} weight="bold" /> Add member
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="members-table">
        {members.map((member) => (
          <div className="member-row" key={member.id}>
            <span className="avatar">
              {member.displayName
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              <strong>{member.displayName}</strong>
              <span>{member.email}</span>
            </div>
            <span className={`role-badge role-${member.role}`}>{member.role}</span>
            <span className="member-grants">
              {[
                member.attributes?.canCreateRooms && "rooms",
                member.attributes?.canSchedule && "calendar",
                member.attributes?.canManageMembers && "members",
              ]
                .filter(Boolean)
                .join(" · ") || "standard access"}
            </span>
          </div>
        ))}
      </div>
      {!error && !members.length && (
        <div className="empty-state large">
          <UsersThreeIcon size={26} weight="duotone" />
          <div>
            <strong>No members loaded</strong>
            <p>Organization members are fetched securely from the API.</p>
          </div>
        </div>
      )}
      <AnimatePresence>
        {modal && (
          <motion.div className="modal-backdrop" exit={{ opacity: 0 }}>
            <motion.form
              className="modal"
              onSubmit={addMember}
              role="dialog"
              aria-modal="true"
              exit={{ opacity: 0, scale: 0.98 }}
            >
              <div className="modal-head">
                <div>
                  <h3>Add organization member</h3>
                  <p>They need an existing Threadline account first.</p>
                </div>
                <button type="button" className="button button-ghost button-icon" onClick={() => setModal(false)}>
                  <XIcon size={17} />
                </button>
              </div>
              <div className="modal-form">
                <div className="field">
                  <label htmlFor="member-email">Account email</label>
                  <input id="member-email" type="email" name="email" required placeholder="teammate@company.com" />
                </div>
                <div className="field">
                  <label htmlFor="member-role">Organization role</label>
                  <AppSelect
                    id="member-role"
                    name="role"
                    onValueChange={setRole}
                    options={[
                      { value: "member", label: "Member", description: "Standard organization access." },
                      { value: "admin", label: "Admin", description: "Can manage the organization." },
                    ]}
                    value={role}
                  />
                </div>
                <label className="permission-check">
                  <input type="checkbox" name="canCreateRooms" /> Can create rooms
                </label>
                <label className="permission-check">
                  <input type="checkbox" name="canSchedule" /> Can schedule calendar sessions
                </label>
                <div className="security-callout">
                  <ShieldCheckIcon size={17} />
                  <span>
                    Delegated capabilities are explicit attributes and are checked by the API on every request.
                  </span>
                </div>
                <div className="modal-actions">
                  <button type="button" className="button button-ghost" onClick={() => setModal(false)}>
                    Cancel
                  </button>
                  <button className="button button-primary" disabled={saving}>
                    {saving ? "Adding…" : "Add member"}
                  </button>
                </div>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
