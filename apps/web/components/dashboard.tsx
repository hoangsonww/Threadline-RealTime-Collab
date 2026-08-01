"use client";

import {
  ArrowUpRightIcon,
  ChatCircleTextIcon,
  ClockCounterClockwiseIcon,
  PlusIcon,
  UsersThreeIcon,
  VideoConferenceIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

type Room = { id: string; name: string; description: string; people: number; updated: string; live?: boolean };
const defaultRooms: Room[] = [
  {
    id: "incident-2026-07",
    name: "incident-2026-07",
    description: "Investigating the payment retries spike",
    people: 4,
    updated: "Live now",
    live: true,
  },
  {
    id: "platform-planning",
    name: "platform-planning",
    description: "Q4 architecture planning and RFC review",
    people: 7,
    updated: "18m ago",
  },
  {
    id: "design-crit",
    name: "design-crit",
    description: "Developer experience and editor review",
    people: 3,
    updated: "Yesterday",
  },
  {
    id: "api-contracts",
    name: "api-contracts",
    description: "Partner API handoff notes",
    people: 5,
    updated: "Yesterday",
  },
];

export function Dashboard() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [rooms, setRooms] = useState(defaultRooms);
  const [modal, setModal] = useState(false);
  const [displayName, setDisplayName] = useState("Avery");
  const [organizationId, setOrganizationId] = useState("");
  const [organizationName, setOrganizationName] = useState("Northstar Engineering");
  useEffect(() => {
    const stored = localStorage.getItem("threadline-rooms");
    if (stored) {
      try {
        setRooms(JSON.parse(stored));
      } catch {
        localStorage.removeItem("threadline-rooms");
      }
    }
    const user = localStorage.getItem("threadline-user");
    if (user) {
      try {
        setDisplayName(JSON.parse(user).displayName?.split(" ")[0] || "Avery");
      } catch {
        setDisplayName("Avery");
      }
    }
    const api = process.env.NEXT_PUBLIC_API_ORIGIN;
    if (api) {
      void fetch(`${api}/v1/auth/me`, { credentials: "include" })
        .then(async (response) => (response.ok ? response.json() : Promise.reject(new Error("session unavailable"))))
        .then(async (data) => {
          setDisplayName(data.user.displayName?.split(" ")[0] || "Avery");
          localStorage.setItem("threadline-user", JSON.stringify(data.user));
          const org = data.organizations[0];
          if (!org) return;
          setOrganizationId(org.id);
          setOrganizationName(org.name);
          const roomResponse = await fetch(`${api}/v1/orgs/${org.id}/rooms`, { credentials: "include" });
          if (!roomResponse.ok) return;
          const roomData = await roomResponse.json();
          setRooms(
            roomData.rooms.map((room: { id: string; name: string; description?: string; updatedAt: string }) => ({
              id: room.id,
              name: room.name,
              description: room.description || "Engineering room",
              people: 1,
              updated: new Date(room.updatedAt).toLocaleDateString(),
            })),
          );
        })
        .catch(() => undefined);
    }
  }, []);
  const createRoom = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const description = String(form.get("description") || "").trim();
    if (!name) return;
    const id =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || `room-${Date.now()}`;
    let room = { id, name, description: description || "New engineering room", people: 1, updated: "Just now" };
    const api = process.env.NEXT_PUBLIC_API_ORIGIN;
    if (api && organizationId) {
      const response = await fetch(`${api}/v1/orgs/${organizationId}/rooms`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (response.ok) {
        const data = await response.json();
        room = { ...room, id: data.room.id };
      }
    }
    const next = [room, ...rooms];
    setRooms(next);
    localStorage.setItem("threadline-rooms", JSON.stringify(next));
    router.push(`/app/rooms/${room.id}`);
  };
  return (
    <>
      <div className="content">
        <div className="page-header">
          <div>
            <p className="eyebrow">{organizationName}</p>
            <h2>Good afternoon, {displayName}.</h2>
            <p>Open a room, pick up an active thread, or return to a decision your team already made.</p>
          </div>
          <button className="button button-primary" onClick={() => setModal(true)}>
            <PlusIcon size={16} weight="bold" /> New room
          </button>
        </div>
        <div className="dashboard-grid">
          <section>
            <div className="section-heading">
              <h3>Rooms</h3>
              <button className="text-action" onClick={() => setModal(true)}>
                Create room
              </button>
            </div>
            <div className="room-list">
              {rooms.map((room, index) => (
                <motion.button
                  className="room-card"
                  key={room.id}
                  layout
                  onClick={() => router.push(`/app/rooms/${room.id}`)}
                  style={{ textAlign: "left" }}
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                  whileHover={reduceMotion ? undefined : { scale: 1.006, y: -2 }}
                  whileTap={reduceMotion ? undefined : { scale: 0.992 }}
                  transition={{ delay: index * 0.045, duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
                >
                  <span className="room-card-icon">
                    <VideoConferenceIcon size={21} weight="duotone" />
                  </span>
                  <span>
                    <h4># {room.name}</h4>
                    <p>{room.description}</p>
                  </span>
                  <span className="room-meta">
                    <span>
                      <UsersThreeIcon size={14} /> {room.people}
                    </span>
                    <span>
                      {room.live && <i className="status-dot" />} {room.updated}
                    </span>
                    <ArrowUpRightIcon size={14} />
                  </span>
                </motion.button>
              ))}
            </div>
          </section>
          <aside>
            <div className="section-heading">
              <h3>Activity</h3>
              <button className="text-action">View all</button>
            </div>
            <div className="activity-card">
              <div className="activity-item">
                <span className="avatar">LN</span>
                <div>
                  <p>
                    <strong>Lina</strong> added an action item in <strong># incident-2026-07</strong>
                  </p>
                  <time>7 minutes ago</time>
                </div>
              </div>
              <div className="activity-item">
                <span className="avatar">MC</span>
                <div>
                  <p>
                    <strong>Mateo</strong> saved the deployment rollback notes
                  </p>
                  <time>22 minutes ago</time>
                </div>
              </div>
              <div className="activity-item">
                <span className="avatar">SO</span>
                <div>
                  <p>
                    <strong>Sora</strong> shared a new editor snapshot
                  </p>
                  <time>Yesterday</time>
                </div>
              </div>
            </div>
            <div className="section-heading" style={{ marginTop: 24 }}>
              <h3>Continue</h3>
            </div>
            <div className="activity-card">
              <div className="activity-item">
                <span className="avatar">
                  <ClockCounterClockwiseIcon size={15} />
                </span>
                <div>
                  <p>
                    <strong>Platform planning</strong> has a saved notes checkpoint.
                  </p>
                  <time>Return to the last saved state</time>
                </div>
              </div>
              <div className="activity-item">
                <span className="avatar">
                  <ChatCircleTextIcon size={15} />
                </span>
                <div>
                  <p>
                    <strong>12 unread messages</strong> across your rooms.
                  </p>
                  <time>Review the record before your next call</time>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
      <AnimatePresence>
        {modal && (
          <motion.div
            className="modal-backdrop"
            role="presentation"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.form
              className="modal"
              onSubmit={createRoom}
              aria-modal="true"
              role="dialog"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.97, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
              transition={{ type: "spring", stiffness: 330, damping: 27, mass: 0.7 }}
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
                <div className="modal-actions">
                  <button type="button" className="button button-ghost" onClick={() => setModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="button button-primary">
                    Open room
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
