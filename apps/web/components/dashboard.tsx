"use client";

import Link from "next/link";
import { ArrowUpRightIcon, CalendarDotsIcon, PlusIcon, VideoConferenceIcon, XIcon } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ApiError,
  apiFetch,
  selectedOrganization,
  type IdentityResponse,
  type Organization,
  type Room,
} from "../lib/api";
import { AppSelect } from "./app-select";

type ActivityEvent = {
  id: string;
  roomId: string;
  type: string;
  payload: unknown;
  actorId?: string;
  createdAt: string;
};
type State = {
  identity?: IdentityResponse;
  organization?: Organization;
  rooms: Room[];
  activity: ActivityEvent[];
  error?: string;
};

const relativeTime = (value: string) => {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
};

const describeEvent = (event: ActivityEvent, rooms: Room[]) => {
  const room = rooms.find((candidate) => candidate.id === event.roomId);
  const roomName = room ? `# ${room.name}` : "a room you can access";
  if (event.type === "room.created") return `opened ${roomName}`;
  if (event.type === "participant.joined") return `joined ${roomName}`;
  if (event.type === "participant.left") return `left ${roomName}`;
  if (event.type === "chat") return `posted a message in ${roomName}`;
  if (event.type === "screen-share") return `updated screen share in ${roomName}`;
  return `updated ${roomName}`;
};

export function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedOrgId = searchParams.get("org");
  const [state, setState] = useState<State>({ rooms: [], activity: [] });
  const [modal, setModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [visibility, setVisibility] = useState("organization");

  const load = useCallback(async () => {
    try {
      const identity = await apiFetch<IdentityResponse>("/v1/auth/me");
      const organization = selectedOrganization(identity, selectedOrgId);
      if (!organization) throw new Error("Your account does not belong to an organization.");
      const [roomData, activityData] = await Promise.all([
        apiFetch<{ rooms: Room[] }>(`/v1/orgs/${organization.id}/rooms`),
        apiFetch<{ events: ActivityEvent[] }>(`/v1/orgs/${organization.id}/activity`),
      ]);
      setState({ identity, organization, rooms: roomData.rooms, activity: activityData.events });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) router.replace("/login");
      setState({
        rooms: [],
        activity: [],
        error: error instanceof Error ? error.message : "Unable to load the workspace.",
      });
    }
  }, [router, selectedOrgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createRoom = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!state.organization) return;
    const form = new FormData(event.currentTarget);
    setCreating(true);
    setFormError("");
    try {
      const data = await apiFetch<{ room: Room }>(`/v1/orgs/${state.organization.id}/rooms`, {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") ?? "").trim(),
          description: String(form.get("description") ?? "").trim() || undefined,
          visibility: String(form.get("visibility") ?? "organization"),
        }),
      });
      router.push(`/app/rooms/${data.room.id}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create this room.");
      setCreating(false);
    }
  };

  const displayName = state.identity?.user.displayName?.split(" ")[0] ?? "there";
  const canCreateRoom =
    state.organization?.role === "owner" ||
    state.organization?.role === "admin" ||
    state.organization?.attributes?.canCreateRooms === true;
  const openRoomModal = () => {
    setVisibility("organization");
    setFormError("");
    setModal(true);
  };
  return (
    <>
      <div className="content">
        <div className="page-header">
          <div>
            <p className="eyebrow">{state.organization?.name ?? "Workspace"}</p>
            <h2>Welcome back, {displayName}.</h2>
            <p>Open a room, coordinate live, and keep the record connected to the work that follows.</p>
          </div>
          <button
            className="button button-primary"
            onClick={openRoomModal}
            disabled={!state.organization || !canCreateRoom}
          >
            <PlusIcon size={16} weight="bold" /> New room
          </button>
        </div>
        {state.error && <p className="form-error">{state.error}</p>}
        <div className="dashboard-grid">
          <section>
            <div className="section-heading">
              <h3>Rooms</h3>
              <Link className="text-action" href={`/app/rooms?org=${state.organization?.id ?? ""}`}>
                View all rooms
              </Link>
            </div>
            <div className="room-list">
              {state.rooms.length ? (
                state.rooms.slice(0, 8).map((room) => (
                  <Link className="room-card" href={`/app/rooms/${room.id}`} key={room.id}>
                    <span className="room-card-icon">
                      <VideoConferenceIcon size={21} weight="duotone" />
                    </span>
                    <span>
                      <h4># {room.name}</h4>
                      <p>{room.description || "No description yet."}</p>
                    </span>
                    <span className="room-meta">
                      <span>{room.visibility === "restricted" ? "Restricted" : "Organization"}</span>
                      <span>{relativeTime(room.updatedAt)}</span>
                      <ArrowUpRightIcon size={14} />
                    </span>
                  </Link>
                ))
              ) : (
                <div className="empty-state">
                  <VideoConferenceIcon size={22} weight="duotone" />
                  <div>
                    <strong>No rooms yet</strong>
                    <p>Create the first durable place for your team to meet.</p>
                  </div>
                  <button
                    className="button button-secondary"
                    onClick={openRoomModal}
                    disabled={!state.organization || !canCreateRoom}
                  >
                    Create room
                  </button>
                </div>
              )}
            </div>
          </section>
          <aside>
            <div className="section-heading">
              <h3>Recent activity</h3>
              <Link className="text-action" href={`/app/activity?org=${state.organization?.id ?? ""}`}>
                View all
              </Link>
            </div>
            <div className="activity-card">
              {state.activity.length ? (
                state.activity.slice(0, 5).map((event) => (
                  <div className="activity-item" key={event.id}>
                    <span className="avatar">TL</span>
                    <div>
                      <p>
                        <strong>Room activity</strong> {describeEvent(event, state.rooms)}
                      </p>
                      <time>{relativeTime(event.createdAt)}</time>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-activity">
                  Your room activity will appear here once people begin collaborating.
                </div>
              )}
            </div>
            <div className="section-heading" style={{ marginTop: 24 }}>
              <h3>Plan the next session</h3>
            </div>
            <Link className="schedule-card" href={`/app/calendar?org=${state.organization?.id ?? ""}`}>
              <CalendarDotsIcon size={20} weight="duotone" />
              <span>
                <strong>Coordinate in calendar</strong>
                <small>Schedule a room session with your organization.</small>
              </span>
              <ArrowUpRightIcon size={15} />
            </Link>
          </aside>
        </div>
      </div>
      <AnimatePresence>
        {modal && (
          <motion.div
            className="modal-backdrop"
            role="presentation"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.form
              className="modal"
              onSubmit={createRoom}
              aria-modal="true"
              role="dialog"
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
            >
              <div className="modal-head">
                <div>
                  <h3>Open a room</h3>
                  <p>Create the shared place for the session and its record.</p>
                </div>
                <button
                  className="button button-ghost button-icon"
                  type="button"
                  onClick={() => setModal(false)}
                  aria-label="Close"
                >
                  <XIcon size={17} />
                </button>
              </div>
              <div className="modal-form">
                <div className="field">
                  <label htmlFor="room-name">Room name</label>
                  <input id="room-name" name="name" autoFocus placeholder="incident-response" required />
                </div>
                <div className="field">
                  <label htmlFor="room-description">Purpose</label>
                  <textarea
                    id="room-description"
                    name="description"
                    placeholder="What should this room help the team accomplish?"
                  />
                </div>
                <div className="field">
                  <label htmlFor="room-visibility">Visibility</label>
                  <AppSelect
                    id="room-visibility"
                    name="visibility"
                    onValueChange={setVisibility}
                    options={[
                      {
                        value: "organization",
                        label: "Everyone in the organization",
                        description: "Any authorized organization member can join.",
                      },
                      {
                        value: "restricted",
                        label: "Only explicit room members",
                        description: "Members must be granted room access first.",
                      },
                    ]}
                    value={visibility}
                  />
                </div>
                {formError && <p className="form-error">{formError}</p>}
                <div className="modal-actions">
                  <button type="button" className="button button-ghost" onClick={() => setModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="button button-primary" disabled={creating}>
                    {creating ? "Opening…" : "Open room"}
                  </button>
                </div>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
