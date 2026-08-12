"use client";

import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CopyIcon,
  KeyIcon,
  PlusIcon,
  ShieldCheckIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ApiError, apiFetch, type IdentityResponse } from "../lib/api";
import { AppSelect } from "./app-select";
import { MemberRowSkeleton } from "./skeletons";

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
  const [callerId, setCallerId] = useState("");
  const [callerRole, setCallerRole] = useState<"owner" | "admin" | "member" | undefined>(undefined);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [role, setRole] = useState("member");
  const [invite, setInvite] = useState<{ joinCode: string; allowMemberInvites: boolean } | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [roleUpdating, setRoleUpdating] = useState<string | null>(null);
  const load = useCallback(async () => {
    const identity = await apiFetch<IdentityResponse>("/v1/auth/me");
    const org = identity.organizations.find((candidate) => candidate.id === orgId);
    if (!org) throw new Error("You do not have access to this organization.");
    const data = await apiFetch<{ members: Member[] }>(`/v1/orgs/${orgId}/members`);
    setOrgName(org.name);
    setCallerId(identity.user.id);
    setCallerRole(org.role);
    setCanManageMembers(org.role === "owner" || org.role === "admin" || org.attributes?.canManageMembers === true);
    setMembers(data.members);
    try {
      setInvite(await apiFetch<{ joinCode: string; allowMemberInvites: boolean }>(`/v1/orgs/${orgId}/invite`));
    } catch (cause) {
      // A plain member without invite access simply doesn't see this panel —
      // that 403 is expected, not a page-level error.
      if (!(cause instanceof ApiError && cause.status === 403)) throw cause;
      setInvite(null);
    }
  }, [orgId]);
  useEffect(() => {
    setLoading(true);
    void load()
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load members."))
      .finally(() => setLoading(false));
  }, [load]);
  const copyJoinCode = async () => {
    if (!invite) return;
    await navigator.clipboard?.writeText(invite.joinCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const regenerateInvite = async () => {
    if (!window.confirm("Regenerate the invite code? The current code will stop working immediately.")) return;
    setRegenerating(true);
    setInviteError("");
    try {
      setInvite(
        await apiFetch<{ joinCode: string; allowMemberInvites: boolean }>(`/v1/orgs/${orgId}/invite/regenerate`, {
          method: "POST",
        }),
      );
    } catch (cause) {
      setInviteError(cause instanceof Error ? cause.message : "Could not regenerate the invite code.");
    } finally {
      setRegenerating(false);
    }
  };
  const toggleAllowMemberInvites = async () => {
    if (!invite) return;
    const next = !invite.allowMemberInvites;
    setSavingSettings(true);
    setInviteError("");
    try {
      const settings = await apiFetch<{ allowMemberInvites: boolean }>(`/v1/orgs/${orgId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ allowMemberInvites: next }),
      });
      setInvite({ ...invite, allowMemberInvites: settings.allowMemberInvites });
    } catch (cause) {
      setInviteError(cause instanceof Error ? cause.message : "Could not update workspace settings.");
    } finally {
      setSavingSettings(false);
    }
  };
  const changeMemberRole = async (member: Member, nextRole: "admin" | "member") => {
    if (nextRole === member.role) return;
    setRoleUpdating(member.id);
    setError("");
    try {
      await apiFetch(`/v1/orgs/${orgId}/members/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change that member's role.");
    } finally {
      setRoleUpdating(null);
    }
  };
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
      {invite && (
        <div className="invite-panel">
          <div className="invite-panel-head">
            <div>
              <h3>Invite people to {orgName}</h3>
              <p>Anyone with this code can join as a member.</p>
            </div>
            <KeyIcon size={20} color="var(--accent)" />
          </div>
          <div className="invite-code-row">
            <div className="field" style={{ flex: 1, margin: 0 }}>
              <input aria-label="Workspace invite code" readOnly value={invite.joinCode} />
            </div>
            <button type="button" className="button button-secondary" onClick={() => void copyJoinCode()}>
              {copied ? (
                <>
                  <CheckCircleIcon size={16} /> Copied
                </>
              ) : (
                <>
                  <CopyIcon size={16} /> Copy
                </>
              )}
            </button>
            {canManageMembers && (
              <button
                type="button"
                className="button button-ghost"
                disabled={regenerating}
                onClick={() => void regenerateInvite()}
              >
                <ArrowsClockwiseIcon size={16} /> {regenerating ? "Regenerating…" : "Regenerate"}
              </button>
            )}
          </div>
          {inviteError && <p className="form-error">{inviteError}</p>}
          {canManageMembers && (
            <div className="invite-panel-settings">
              <div className="invite-panel-settings-copy">
                <strong>Let members share this code</strong>
                <span>When off, only owners and admins can view or share the invite code.</span>
              </div>
              <label className="toggle-switch">
                <input
                  aria-label="Allow members to share the invite code"
                  checked={invite.allowMemberInvites}
                  disabled={savingSettings}
                  onChange={() => void toggleAllowMemberInvites()}
                  type="checkbox"
                />
                <span className="toggle-switch-track" />
              </label>
            </div>
          )}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="members-table">
        {loading && <MemberRowSkeleton count={4} withActions />}
        {!loading &&
          members.map((member) => {
            const roleOptions = [
              { value: "member", label: "Member" },
              ...(callerRole === "owner" || member.role === "admin" ? [{ value: "admin", label: "Admin" }] : []),
            ];
            return (
              <div className="member-row member-row-with-actions" key={member.id}>
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
                {canManageMembers && member.role !== "owner" ? (
                  <div className="member-role-cell">
                    <AppSelect
                      ariaLabel={`Change role for ${member.displayName}`}
                      disabled={roleUpdating === member.id}
                      id={`role-${member.id}`}
                      onValueChange={(value) => void changeMemberRole(member, value as "admin" | "member")}
                      options={roleOptions}
                      value={member.role}
                      variant="sidebar"
                    />
                  </div>
                ) : (
                  <span className="member-role-static">{member.id === callerId ? "You" : ""}</span>
                )}
              </div>
            );
          })}
      </div>
      {!loading && !error && !members.length && (
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
