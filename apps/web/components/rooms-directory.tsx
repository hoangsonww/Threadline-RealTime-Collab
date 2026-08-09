"use client";

import Link from "next/link";
import { ArrowUpRightIcon, LockKeyIcon, PlusIcon, VideoConferenceIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, selectedOrganization, type IdentityResponse, type Room } from "../lib/api";

export function RoomsDirectory() {
  const selectedOrgId = useSearchParams().get("org");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [organization, setOrganization] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const identity = await apiFetch<IdentityResponse>("/v1/auth/me");
        const org = selectedOrganization(identity, selectedOrgId);
        if (!org) throw new Error("Your account does not belong to an organization.");
        const result = await apiFetch<{ rooms: Room[] }>(`/v1/orgs/${org.id}/rooms`);
        setOrganization(org.name);
        setRooms(result.rooms);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load rooms.");
      }
    })();
  }, [selectedOrgId]);
  return (
    <div className="content">
      <div className="page-header">
        <div>
          <p className="eyebrow">{organization || "Workspace"}</p>
          <h2>Rooms</h2>
          <p>Every room is a live collaboration space and a durable record for its members.</p>
        </div>
        <Link className="button button-primary" href={`/app?org=${selectedOrgId ?? ""}`}>
          <PlusIcon size={16} weight="bold" /> New room
        </Link>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="directory-grid">
        {rooms.map((room) => (
          <Link className="directory-card" href={`/app/rooms/${room.id}`} key={room.id}>
            <span className="directory-icon">
              <VideoConferenceIcon size={23} weight="duotone" />
            </span>
            <span className="directory-card-head">
              <strong># {room.name}</strong>
              {room.visibility === "restricted" && <LockKeyIcon size={14} aria-label="Restricted" />}
            </span>
            <p>{room.description || "No room description has been added."}</p>
            <span className="directory-card-footer">
              <span>{room.classification || "internal"}</span>
              <ArrowUpRightIcon size={15} />
            </span>
          </Link>
        ))}
      </div>
      {!error && !rooms.length && (
        <div className="empty-state large">
          <VideoConferenceIcon size={26} weight="duotone" />
          <div>
            <strong>No rooms are available to you</strong>
            <p>Once a room is created or you are explicitly added to a restricted room, it will appear here.</p>
          </div>
          <Link className="button button-primary" href={`/app?org=${selectedOrgId ?? ""}`}>
            Open a room
          </Link>
        </div>
      )}
    </div>
  );
}
