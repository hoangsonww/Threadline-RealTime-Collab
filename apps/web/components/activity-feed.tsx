"use client";

import Link from "next/link";
import {
  ArrowUpRightIcon,
  BellIcon,
  ChatCircleTextIcon,
  DoorOpenIcon,
  VideoConferenceIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, selectedOrganization, type IdentityResponse, type Room } from "../lib/api";
import { getPreferredOrgId, setPreferredOrgId } from "../lib/workspace-preference";
import { ActivityFeedRowSkeleton } from "./skeletons";

type ActivityEvent = { id: string; roomId: string; type: string; payload: unknown; createdAt: string };
const eventIcon = (type: string) =>
  type === "chat" ? ChatCircleTextIcon : type.startsWith("participant") ? DoorOpenIcon : VideoConferenceIcon;
const eventText = (type: string) => {
  if (type === "room.created") return "Room created";
  if (type === "participant.joined") return "Participant joined";
  if (type === "participant.left") return "Participant left";
  if (type === "chat") return "Message posted";
  if (type === "screen-share") return "Screen share updated";
  return "Room updated";
};

export function ActivityFeed() {
  const selectedOrgId = useSearchParams().get("org") ?? getPreferredOrgId();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [organization, setOrganization] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    void (async () => {
      try {
        const identity = await apiFetch<IdentityResponse>("/v1/auth/me");
        const org = selectedOrganization(identity, selectedOrgId);
        if (!org) throw new Error("Your account does not belong to an organization.");
        setPreferredOrgId(org.id);
        const data = await apiFetch<{ events: ActivityEvent[]; rooms: Array<{ id: string; name: string }> }>(
          `/v1/orgs/${org.id}/activity`,
        );
        setOrganization(org.name);
        setEvents(data.events);
        setRooms(data.rooms.map((room) => ({ ...room, orgId: org.id, createdAt: "", updatedAt: "" })));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load activity.");
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedOrgId]);
  const roomName = (id: string) => rooms.find((room) => room.id === id)?.name || "Room";
  return (
    <div className="content">
      <div className="page-header">
        <div>
          <p className="eyebrow">{organization || "Workspace"}</p>
          <h2>Activity</h2>
          <p>A durable, permission-filtered record of the rooms you can access.</p>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="activity-feed">
        {loading ? (
          <ActivityFeedRowSkeleton count={6} />
        ) : (
          events.map((event) => {
            const Icon = eventIcon(event.type);
            return (
              <Link className="activity-feed-row" href={`/app/rooms/${event.roomId}`} key={event.id}>
                <span className="activity-feed-icon">
                  <Icon size={18} weight="duotone" />
                </span>
                <span>
                  <strong>{eventText(event.type)}</strong>
                  <p># {roomName(event.roomId)}</p>
                </span>
                <time>
                  {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
                    new Date(event.createdAt),
                  )}
                </time>
                <ArrowUpRightIcon size={15} />
              </Link>
            );
          })
        )}
      </div>
      {!loading && !error && !events.length && (
        <div className="empty-state large">
          <BellIcon size={26} weight="duotone" />
          <div>
            <strong>No activity yet</strong>
            <p>When someone works in a room you can access, its durable events will appear here.</p>
          </div>
        </div>
      )}
    </div>
  );
}
