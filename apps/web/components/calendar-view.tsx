"use client";

import { CalendarDotsIcon, ClockIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { apiFetch, selectedOrganization, type IdentityResponse, type Organization, type Room } from "../lib/api";
import { getPreferredOrgId, setPreferredOrgId } from "../lib/workspace-preference";
import { AppSelect } from "./app-select";
import { CalendarEventSkeleton } from "./skeletons";

type CalendarEvent = {
  id: string;
  title: string;
  description?: string;
  roomId?: string;
  startsAt: string;
  endsAt: string;
};

const localDateTime = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export function CalendarView() {
  const selectedOrgId = useSearchParams().get("org") ?? getPreferredOrgId();
  const [organization, setOrganization] = useState<Organization>();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [roomId, setRoomId] = useState("");
  const load = useCallback(async () => {
    const identity = await apiFetch<IdentityResponse>("/v1/auth/me");
    const org = selectedOrganization(identity, selectedOrgId);
    if (!org) throw new Error("Your account does not belong to an organization.");
    setPreferredOrgId(org.id);
    const [roomData, calendarData] = await Promise.all([
      apiFetch<{ rooms: Room[] }>(`/v1/orgs/${org.id}/rooms`),
      apiFetch<{ events: CalendarEvent[] }>(`/v1/orgs/${org.id}/calendar`),
    ]);
    setOrganization(org);
    setRooms(roomData.rooms);
    setEvents(calendarData.events);
  }, [selectedOrgId]);
  useEffect(() => {
    setLoading(true);
    void load()
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load calendar."))
      .finally(() => setLoading(false));
  }, [load]);
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organization) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await apiFetch<{ event: CalendarEvent }>(`/v1/orgs/${organization.id}/calendar`, {
        method: "POST",
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description") || undefined,
          startsAt: new Date(String(form.get("startsAt"))).toISOString(),
          endsAt: new Date(String(form.get("endsAt"))).toISOString(),
          roomId: form.get("roomId") || undefined,
        }),
      });
      setRoomId("");
      setModal(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not schedule this event.");
    } finally {
      setSaving(false);
    }
  };
  const roomName = (id?: string) => rooms.find((room) => room.id === id)?.name;
  const canSchedule =
    organization?.role === "owner" || organization?.role === "admin" || organization?.attributes?.canSchedule === true;
  const openScheduleModal = () => {
    setRoomId("");
    setError("");
    setModal(true);
  };
  return (
    <div className="content">
      <div className="page-header">
        <div>
          <p className="eyebrow">{organization?.name || "Workspace"}</p>
          <h2>Calendar</h2>
          <p>Coordinate the next live session with the people and rooms that need to be there.</p>
        </div>
        <button className="button button-primary" onClick={openScheduleModal} disabled={!organization || !canSchedule}>
          <PlusIcon size={16} weight="bold" /> Schedule session
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="calendar-list">
        {loading ? (
          <CalendarEventSkeleton count={4} />
        ) : (
          events.map((item) => (
            <article className="calendar-event" key={item.id}>
              <time>
                <strong>
                  {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
                    new Date(item.startsAt),
                  )}
                </strong>
                <span>
                  {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
                    new Date(item.startsAt),
                  )}
                </span>
              </time>
              <div>
                <h3>{item.title}</h3>
                <p>{item.description || "No description."}</p>
                <span>{item.roomId ? `# ${roomName(item.roomId) || "Room"}` : "Organization session"}</span>
              </div>
              <ClockIcon size={18} />
            </article>
          ))
        )}
      </div>
      {!loading && !error && !events.length && (
        <div className="empty-state large">
          <CalendarDotsIcon size={26} weight="duotone" />
          <div>
            <strong>Nothing scheduled yet</strong>
            <p>Schedule a real session and it will be visible to the right people in this organization.</p>
          </div>
          <button
            className="button button-primary"
            onClick={openScheduleModal}
            disabled={!organization || !canSchedule}
          >
            Schedule session
          </button>
        </div>
      )}
      <AnimatePresence>
        {modal && (
          <motion.div className="modal-backdrop" exit={{ opacity: 0 }}>
            <motion.form
              className="modal"
              onSubmit={create}
              role="dialog"
              aria-modal="true"
              exit={{ opacity: 0, scale: 0.98 }}
            >
              <div className="modal-head">
                <div>
                  <h3>Schedule a session</h3>
                  <p>This event is scoped to your organization.</p>
                </div>
                <button type="button" className="button button-ghost button-icon" onClick={() => setModal(false)}>
                  <XIcon size={17} />
                </button>
              </div>
              <div className="modal-form">
                <div className="field">
                  <label htmlFor="event-title">Title</label>
                  <input id="event-title" name="title" required placeholder="Architecture review" />
                </div>
                <div className="field">
                  <label htmlFor="event-room">Room</label>
                  <AppSelect
                    id="event-room"
                    name="roomId"
                    onValueChange={setRoomId}
                    options={[
                      { value: "", label: "No room yet", description: "An organization-wide session" },
                      ...rooms.map((room) => ({ value: room.id, label: `# ${room.name}` })),
                    ]}
                    value={roomId}
                  />
                </div>
                <div className="field">
                  <label htmlFor="event-start">Starts</label>
                  <input
                    id="event-start"
                    type="datetime-local"
                    name="startsAt"
                    required
                    defaultValue={localDateTime(new Date(Date.now() + 3_600_000))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="event-end">Ends</label>
                  <input
                    id="event-end"
                    type="datetime-local"
                    name="endsAt"
                    required
                    defaultValue={localDateTime(new Date(Date.now() + 7_200_000))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="event-description">Agenda</label>
                  <textarea
                    id="event-description"
                    name="description"
                    placeholder="What should this session accomplish?"
                  />
                </div>
                <div className="modal-actions">
                  <button type="button" className="button button-ghost" onClick={() => setModal(false)}>
                    Cancel
                  </button>
                  <button className="button button-primary" disabled={saving}>
                    {saving ? "Scheduling…" : "Schedule"}
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
