"use client";

import Link from "next/link";
import {
  ArrowLeftIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ShieldCheckIcon,
  UserMinusIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { apiFetch, type IdentityResponse, type Room } from "../lib/api";
import { AppSelect } from "./app-select";
import { MemberRowSkeleton } from "./skeletons";

type OrgMember = { id: string; email: string; displayName: string };
type RoomMember = {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "host" | "member" | "viewer";
  joinedAt: string;
};

const initialsFor = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TL";

export function RoomMembersPage({ roomId }: { roomId: string }) {
  const [room, setRoom] = useState<Room>();
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("member");
  const [removingId, setRemovingId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [addSearch, setAddSearch] = useState("");

  const load = useCallback(async () => {
    const [{ room: roomData, role: effectiveRole }, identity, roomMembers] = await Promise.all([
      apiFetch<{ room: Room; role?: string }>(`/v1/rooms/${roomId}`),
      apiFetch<IdentityResponse>("/v1/auth/me"),
      apiFetch<{ members: RoomMember[] }>(`/v1/rooms/${roomId}/members`),
    ]);
    setRoom(roomData);
    setMembers(roomMembers.members);
    const org = identity.organizations.find((candidate) => candidate.id === roomData.orgId);
    setCanManage(
      org?.role === "owner" ||
        org?.role === "admin" ||
        org?.attributes?.canManageMembers === true ||
        effectiveRole === "owner",
    );
    const orgMemberData = await apiFetch<{ members: OrgMember[] }>(`/v1/orgs/${roomData.orgId}/members`);
    setOrgMembers(orgMemberData.members);
  }, [roomId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load room members."))
      .finally(() => setLoading(false));
  }, [load]);

  const addable = orgMembers.filter((candidate) => !members.some((member) => member.id === candidate.id));
  const normalizedMemberSearch = memberSearch.trim().toLowerCase();
  const visibleMembers = members.filter((member) =>
    `${member.displayName} ${member.email} ${member.role}`.toLowerCase().includes(normalizedMemberSearch),
  );
  const normalizedAddSearch = addSearch.trim().toLowerCase();
  const visibleAddable = addable.filter((member) =>
    `${member.displayName} ${member.email}`.toLowerCase().includes(normalizedAddSearch),
  );

  const openAddModal = () => {
    setUserId(addable[0]?.id ?? "");
    setRole("member");
    setAddSearch("");
    setError("");
    setModal(true);
  };

  const addMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId) return setError("Choose an organization member to grant access.");
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/v1/rooms/${roomId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId, role }),
      });
      setModal(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not grant room access.");
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async (member: RoomMember) => {
    setRemovingId(member.id);
    setError("");
    try {
      await apiFetch(`/v1/rooms/${roomId}/members/${member.id}`, { method: "DELETE" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this person's access.");
    } finally {
      setRemovingId("");
    }
  };

  return (
    <main id="main-content" className="room-layout">
      <header className="room-topbar">
        <div className="room-breadcrumb">
          <Link href={`/app/rooms/${roomId}`} aria-label="Back to room">
            <ArrowLeftIcon size={17} />
          </Link>
          <span style={{ color: "var(--subtle)" }}>/</span>
          <strong># {room?.name || "Loading room"} members</strong>
        </div>
      </header>
      <div className="content">
        <div className="page-header">
          <div>
            <p className="eyebrow">Room access</p>
            <h2>Members</h2>
            <p>
              {room?.visibility === "restricted"
                ? "This room is restricted: only people listed here (or an organization admin) can open it."
                : "Everyone in the organization can already open this room. Add people here only if you also need to assign them a specific room role."}
            </p>
          </div>
          {canManage && (
            <button className="button button-primary" onClick={openAddModal} disabled={!addable.length}>
              <PlusIcon size={16} weight="bold" /> Grant access
            </button>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
        <label className="member-search">
          <MagnifyingGlassIcon size={17} aria-hidden="true" />
          <input
            aria-label="Search room members"
            value={memberSearch}
            onChange={(event) => setMemberSearch(event.target.value)}
            placeholder="Search room members by name, email, or role"
          />
          {memberSearch && (
            <button type="button" onClick={() => setMemberSearch("")} aria-label="Clear member search">
              <XIcon size={14} />
            </button>
          )}
        </label>
        <div className="members-table">
          {loading ? (
            <MemberRowSkeleton count={3} />
          ) : (
            visibleMembers.map((member) => (
              <div className="member-row" key={member.id}>
                <span className="avatar">{initialsFor(member.displayName)}</span>
                <div>
                  <strong>{member.displayName}</strong>
                  <span>{member.email}</span>
                </div>
                <span className={`role-badge role-${member.role}`}>{member.role}</span>
                {canManage && member.role !== "owner" ? (
                  <button
                    className="button button-danger"
                    onClick={() => void removeMember(member)}
                    disabled={removingId === member.id}
                    aria-label={`Remove ${member.displayName}'s access`}
                  >
                    <UserMinusIcon size={15} /> {removingId === member.id ? "Removing…" : "Remove access"}
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))
          )}
        </div>
        {!loading && members.length > 0 && !visibleMembers.length && (
          <p className="member-search-empty">No room members match “{memberSearch}”.</p>
        )}
        {!loading && !error && !members.length && (
          <div className="empty-state large">
            <UsersThreeIcon size={26} weight="duotone" />
            <div>
              <strong>No explicit room members yet</strong>
              <p>Room access falls back to organization visibility until someone is listed here.</p>
            </div>
          </div>
        )}
      </div>
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
                  <h3>Grant room access</h3>
                  <p>Only organization members can be granted access to a room.</p>
                </div>
                <button type="button" className="button button-ghost button-icon" onClick={() => setModal(false)}>
                  <XIcon size={17} />
                </button>
              </div>
              <div className="modal-form">
                <div className="field">
                  <label htmlFor="room-member">Organization member</label>
                  <label className="member-search compact" htmlFor="room-member">
                    <MagnifyingGlassIcon size={15} aria-hidden="true" />
                    <input
                      id="room-member"
                      value={addSearch}
                      onChange={(event) => setAddSearch(event.target.value)}
                      placeholder="Search by name or email"
                    />
                  </label>
                  <div className="member-picker-list" role="listbox" aria-label="Organization members">
                    {visibleAddable.map((candidate) => {
                      const selected = candidate.id === userId;
                      return (
                        <button
                          aria-selected={selected}
                          className={`member-picker-option ${selected ? "is-selected" : ""}`}
                          key={candidate.id}
                          onClick={() => setUserId(candidate.id)}
                          role="option"
                          type="button"
                        >
                          <span className="avatar">{initialsFor(candidate.displayName)}</span>
                          <span>
                            <strong>{candidate.displayName}</strong>
                            <small>{candidate.email}</small>
                          </span>
                          {selected && <CheckIcon size={15} weight="bold" aria-hidden="true" />}
                        </button>
                      );
                    })}
                    {!visibleAddable.length && (
                      <p className="field-help">
                        {addable.length ? "No organization members match that search." : "Everyone already has access."}
                      </p>
                    )}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="room-role">Room role</label>
                  <AppSelect
                    id="room-role"
                    onValueChange={setRole}
                    options={[
                      { value: "member", label: "Member", description: "Can read and write in the room." },
                      { value: "viewer", label: "Viewer", description: "Can join and read, but not write." },
                      { value: "host", label: "Host", description: "Can also manage the live session." },
                    ]}
                    value={role}
                  />
                </div>
                <div className="security-callout">
                  <ShieldCheckIcon size={17} />
                  <span>Access is enforced by the API on every request, not just hidden in this UI.</span>
                </div>
                <div className="modal-actions">
                  <button type="button" className="button button-ghost" onClick={() => setModal(false)}>
                    Cancel
                  </button>
                  <button className="button button-primary" disabled={saving || !addable.length}>
                    {saving ? "Granting…" : "Grant access"}
                  </button>
                </div>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
