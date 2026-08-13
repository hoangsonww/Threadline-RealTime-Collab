"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  BroadcastIcon,
  CaretLeftIcon,
  CodeIcon,
  DesktopIcon,
  DownloadSimpleIcon,
  EraserIcon,
  FileArrowUpIcon,
  FileIcon,
  LockSimpleIcon,
  MicrophoneIcon,
  MicrophoneSlashIcon,
  MonitorArrowUpIcon,
  NotePencilIcon,
  PaperPlaneTiltIcon,
  PhoneDisconnectIcon,
  SidebarSimpleIcon,
  UsersThreeIcon,
  VideoCameraIcon,
  VideoCameraSlashIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, apiOrigin, type Room, type WorkspaceUser } from "../lib/api";
import { PeerMesh, type SignalPayload } from "../lib/peer-mesh";
import { Skeleton } from "./skeletons";

type Panel = "chat" | "notes" | "board" | "files" | "timeline";
type Participant = { userId: string; username: string; role: string; joinedAt: string; screenSharing: boolean };
type RoomEvent = {
  id?: string;
  type: string;
  payload: unknown;
  actorId?: string;
  from?: string;
  createdAt?: string;
  at?: string;
};
type Message = { id: string; person: string; initials: string; text: string; time: string };
type FileEntry = { id: string; name: string; size: string; status: string; downloadUrl?: string };

const initialsFor = (name: string) =>
  name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TL";
const formatSize = (bytes: number) =>
  bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
const eventAt = (event: RoomEvent) => event.createdAt ?? event.at ?? new Date().toISOString();
const eventToMessage = (event: RoomEvent): Message | undefined => {
  if (event.type !== "chat") return undefined;
  const payload = event.payload as { text?: string; username?: string };
  if (!payload.text) return undefined;
  const person = payload.username || "Room member";
  return {
    id: event.id ?? `${event.from ?? event.actorId ?? "member"}-${eventAt(event)}-${payload.text}`,
    person,
    initials: initialsFor(person),
    text: payload.text,
    time: new Date(eventAt(event)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
};
const describeEvent = (event: RoomEvent) => {
  if (event.type === "room.created") return "Room created";
  if (event.type === "participant.joined") return "Participant joined";
  if (event.type === "participant.left") return "Participant left";
  if (event.type === "chat") return "Message posted";
  if (event.type === "editor") return "Shared document updated";
  if (event.type === "whiteboard") return "Whiteboard updated";
  if (event.type === "screen-share") return "Screen sharing updated";
  return event.type.replace(/[-.]/g, " ");
};

function StreamVideo({ stream, muted }: { stream: MediaStream; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    // Browsers can silently refuse to autoplay unmuted media (a remote peer's audio
    // track) without a recent user gesture on the page — the <video> then just sits
    // there paused, with nothing on screen, until something happens to retry it. The
    // `autoPlay` attribute alone doesn't surface or recover from that rejection, so
    // play() is called explicitly and retried on the next interaction if it's blocked.
    const tryPlay = () => {
      void video.play().catch(() => {
        document.addEventListener("pointerdown", tryPlay, { once: true });
      });
    };
    tryPlay();
    return () => document.removeEventListener("pointerdown", tryPlay);
  }, [stream]);
  return <video ref={ref} autoPlay muted={muted} playsInline />;
}

export function RoomWorkspace({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("chat");
  const [mode, setMode] = useState<"call" | "editor">("call");
  const [showPanel, setShowPanel] = useState(true);
  const [room, setRoom] = useState<Room>();
  const [identity, setIdentity] = useState<WorkspaceUser>();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [timeline, setTimeline] = useState<RoomEvent[]>([]);
  const [notes, setNotes] = useState("");
  const [code, setCode] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const boardRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const meshRef = useRef<PeerMesh | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localIdRef = useRef("");
  const knownPeersRef = useRef<Set<string>>(new Set());
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileUrlsRef = useRef<string[]>([]);

  const addEvent = useCallback((event: RoomEvent) => {
    setTimeline((items) =>
      items.some((item) => item.id && item.id === event.id) ? items : [...items, event].slice(-200),
    );
    const message = eventToMessage(event);
    if (message) setMessages((items) => (items.some((item) => item.id === message.id) ? items : [...items, message]));
  }, []);

  const hydrateEditorState = useCallback((events: RoomEvent[]) => {
    let latestNotes: string | undefined;
    let latestCode: string | undefined;
    for (const event of events) {
      if (event.type !== "editor") continue;
      const payload = event.payload as { document?: string; content?: string };
      if (payload.document === "notes" && typeof payload.content === "string") latestNotes = payload.content;
      if (payload.document === "code" && typeof payload.content === "string") latestCode = payload.content;
    }
    if (latestNotes !== undefined) setNotes(latestNotes);
    if (latestCode !== undefined) setCode(latestCode);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [identityData, roomData, eventData] = await Promise.all([
          apiFetch<{ user: WorkspaceUser }>("/v1/auth/me"),
          apiFetch<{ room: Room }>(`/v1/rooms/${roomId}`),
          apiFetch<{ events: RoomEvent[] }>(`/v1/rooms/${roomId}/events`),
        ]);
        if (cancelled) return;
        setIdentity(identityData.user);
        setRoom(roomData.room);
        eventData.events.forEach(addEvent);
        hydrateEditorState(eventData.events);
      } catch (error) {
        if (!cancelled) setRoomError(error instanceof Error ? error.message : "Unable to load this room.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addEvent, hydrateEditorState, roomId]);

  useEffect(() => {
    if (room?.name) document.title = `# ${room.name} | Threadline`;
  }, [room?.name]);

  useEffect(
    () => () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      socketRef.current?.close();
      socketRef.current = null;
      meshRef.current?.close();
      fileUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      fileUrlsRef.current = [];
    },
    [],
  );

  const publish = useCallback((type: string, payload: unknown) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return false;
    socketRef.current.send(JSON.stringify({ type, payload }));
    return true;
  }, []);

  const drawLine = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = boardRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.strokeStyle = "#52e0a2";
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }, []);

  const connectRoom = useCallback(async () => {
    const realtime = process.env.NEXT_PUBLIC_REALTIME_ORIGIN;
    if (socketRef.current?.readyState === WebSocket.OPEN) return true;
    if (!apiOrigin || !realtime) {
      setRoomError("Realtime is not configured. Set both NEXT_PUBLIC_API_ORIGIN and NEXT_PUBLIC_REALTIME_ORIGIN.");
      return false;
    }
    try {
      const { ticket } = await apiFetch<{ ticket: string }>(`/v1/rooms/${roomId}/ticket`, { method: "POST" });
      const socket = new WebSocket(
        `${realtime.replace(/^http/, "ws")}/rooms/${roomId}?ticket=${encodeURIComponent(ticket)}`,
      );
      meshRef.current ??= new PeerMesh({
        sendSignal: (peerId, payload) => socket.send(JSON.stringify({ type: "signal", to: peerId, payload })),
        onRemoteStream: (peerId, stream) => setRemoteStreams((streams) => ({ ...streams, [peerId]: stream })),
        getLocalId: () => localIdRef.current,
        onFile: (_peerId, file) => {
          const downloadUrl = URL.createObjectURL(file);
          fileUrlsRef.current.push(downloadUrl);
          setFiles((items) => [
            {
              id: crypto.randomUUID(),
              name: file.name,
              size: formatSize(file.size),
              status: "Ready to download",
              downloadUrl,
            },
            ...items,
          ]);
        },
      });
      socket.onopen = () => {
        reconnectAttemptRef.current = 0;
        setConnected(true);
        setReconnecting(false);
        setRoomError("");
      };
      socket.onclose = () => {
        setConnected(false);
        // Only auto-reconnect if this socket is still the active one — a call to
        // leave() nulls socketRef.current first, and a newer connectRoom() call
        // has already replaced it with a different socket, so either way this
        // close is not the "still trying to be in this room" case.
        if (socketRef.current !== socket) return;
        const attempt = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = attempt;
        const delay = Math.min(1000 * 2 ** (attempt - 1), 15_000);
        setReconnecting(true);
        reconnectTimerRef.current = setTimeout(() => {
          if (socketRef.current === socket) void connectRoom();
        }, delay);
      };
      socket.onerror = () =>
        setRoomError("The room coordinator could not be reached. Check the realtime deployment and try again.");
      const connectToNewPeers = (people: Participant[]) => {
        const localId = localIdRef.current;
        if (!localId) return;
        for (const person of people) {
          if (person.userId === localId || knownPeersRef.current.has(person.userId)) continue;
          knownPeersRef.current.add(person.userId);
          void meshRef.current?.connect(person.userId, localId < person.userId);
        }
      };
      socket.onmessage = (wire) => {
        const event = JSON.parse(wire.data) as { type: string; payload?: unknown; from?: string; at?: string };
        if (event.type === "presence") {
          const people = (event.payload as Participant[]) ?? [];
          setParticipants(people);
          // Presence broadcasts (someone else joining) only reach sockets that
          // were already connected, so this side must also offer to connect —
          // room.ready alone only tells the newcomer about existing peers, not
          // the other way around.
          connectToNewPeers(people);
          return;
        }
        if (event.type === "room.ready") {
          const payload = event.payload as {
            participants?: Participant[];
            recentEvents?: RoomEvent[];
            participant?: Participant;
          };
          setParticipants(payload.participants ?? []);
          payload.recentEvents?.forEach(addEvent);
          hydrateEditorState(payload.recentEvents ?? []);
          if (payload.participant?.userId) localIdRef.current = payload.participant.userId;
          connectToNewPeers(payload.participants ?? []);
          return;
        }
        if (event.type === "signal" && event.from) {
          void meshRef.current?.receiveSignal(event.from, event.payload as SignalPayload);
          return;
        }
        if (event.type === "editor") {
          const payload = event.payload as { document?: string; content?: string };
          if (payload.document === "notes" && typeof payload.content === "string") setNotes(payload.content);
          if (payload.document === "code" && typeof payload.content === "string") setCode(payload.content);
        }
        if (event.type === "whiteboard") {
          const payload = event.payload as {
            from?: { x: number; y: number };
            to?: { x: number; y: number };
            clear?: boolean;
          };
          if (payload.clear)
            boardRef.current?.getContext("2d")?.clearRect(0, 0, boardRef.current.width, boardRef.current.height);
          else if (payload.from && payload.to) drawLine(payload.from, payload.to);
        }
        if (event.type !== "cursor") addEvent({ ...event, payload: event.payload ?? null, at: event.at });
      };
      socketRef.current = socket;
      return true;
    } catch (error) {
      setConnected(false);
      setRoomError(error instanceof Error ? error.message : "Unable to join the room.");
      return false;
    }
  }, [addEvent, drawLine, hydrateEditorState, roomId]);

  const startCamera = async () => {
    try {
      if (!(await connectRoom())) return;
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      meshRef.current?.setLocalStream(stream);
      setLocalStream(stream);
      setCamera(true);
      setMic(true);
    } catch {
      setRoomError("Camera and microphone access was not granted.");
    }
  };
  const toggleMic = () => {
    const next = !mic;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setMic(next);
  };
  const toggleCamera = () => {
    if (!camera) void startCamera();
    else {
      streamRef.current?.getVideoTracks().forEach((track) => {
        track.enabled = false;
      });
      setCamera(false);
    }
  };
  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setSharing(false);
    publish("screen-share", { active: false });
    // Restore whatever the camera stream was already sending (on, off-but-muted, or
    // never started) rather than assuming it should come back on.
    meshRef.current?.setLocalStream(streamRef.current);
    setLocalStream(camera ? streamRef.current : null);
  }, [camera, publish]);
  const toggleScreenShare = async () => {
    if (sharing) return stopScreenShare();
    try {
      if (!(await connectRoom())) return;
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const videoTrack = screen.getVideoTracks()[0];
      videoTrack.addEventListener("ended", stopScreenShare);
      screenStreamRef.current = screen;
      // Keep the mic flowing to peers while sharing: publish the screen's video
      // alongside the existing microphone track rather than replacing it.
      const audioTrack = streamRef.current?.getAudioTracks()[0];
      meshRef.current?.setLocalStream(audioTrack ? new MediaStream([videoTrack, audioTrack]) : screen);
      setLocalStream(screen);
      setSharing(true);
      publish("screen-share", { active: true });
    } catch {
      setRoomError("Screen share was not started.");
    }
  };
  const leave = () => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    reconnectAttemptRef.current = 0;
    setReconnecting(false);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    meshRef.current?.close();
    meshRef.current = null;
    knownPeersRef.current.clear();
    localIdRef.current = "";
    setRemoteStreams({});
    setLocalStream(null);
    setParticipants([]);
    setCamera(false);
    setSharing(false);
    setConnected(false);
    router.push("/app/rooms");
  };
  const sendMessage = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (!publish("chat", { text, username: identity?.displayName || identity?.username || "Room member" })) {
      setRoomError("Join the live room before sending a message.");
      return;
    }
    setDraft("");
  };
  const pointFor = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = boardRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };
  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const point = pointFor(event);
    const previous = lastPoint.current;
    if (!point || !previous) return;
    drawLine(previous, point);
    publish("whiteboard", { from: previous, to: point });
    lastPoint.current = point;
  };
  const clearBoard = () => {
    const canvas = boardRef.current;
    if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    publish("whiteboard", { clear: true });
  };
  const uploadFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!connected || !meshRef.current) {
      event.target.value = "";
      setRoomError("Join the live room before sharing a file.");
      return;
    }
    const selected = Array.from(event.target.files ?? []);
    const transfers = selected.map((file) => ({
      file,
      id: crypto.randomUUID(),
    }));
    const items = transfers.map(({ file, id }) => ({
      id,
      name: file.name,
      size: formatSize(file.size),
      status: "Waiting for connected peers…",
    }));
    setFiles((existing) => [...items, ...existing]);
    void Promise.all(
      transfers.map(async ({ file, id }) => {
        const recipients = await meshRef.current?.sendFile(file);
        setFiles((existing) =>
          existing.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: recipients
                    ? `Sent to ${recipients} connected ${recipients === 1 ? "peer" : "peers"}`
                    : "No peer was ready — try again",
                }
              : item,
          ),
        );
      }),
    );
    event.target.value = "";
  };
  const visibleParticipants = participants.length
    ? participants
    : identity
      ? [{ userId: identity.id, username: identity.displayName, role: "member", joinedAt: "", screenSharing: false }]
      : [];

  return (
    <main id="main-content" className="room-layout">
      <header className="room-topbar">
        <div className="room-breadcrumb">
          <Link href="/app/rooms" aria-label="Back to rooms" title="Back to rooms">
            <ArrowLeftIcon size={17} />
          </Link>
          <span style={{ color: "var(--subtle)" }}>/</span>
          <strong># {room?.name || "Loading room"}</strong>
          <span className="room-state">
            <span className={connected ? "status-dot" : "room-state-dot"} />
            {connected ? "Connected" : reconnecting ? "Reconnecting…" : "Not connected"}
          </span>
        </div>
        <div className="room-actions">
          <button
            className="button button-secondary"
            onClick={() => setMode(mode === "call" ? "editor" : "call")}
            aria-label={mode === "call" ? "Open editor" : "Open call"}
          >
            {mode === "call" ? (
              <>
                <CodeIcon size={16} /> <span className="button-label">Open editor</span>
              </>
            ) : (
              <>
                <DesktopIcon size={16} /> <span className="button-label">Open call</span>
              </>
            )}
          </button>
          <Link
            className="button button-ghost button-icon"
            href={`/app/rooms/${roomId}/members`}
            aria-label="Room members"
            title="Room members"
          >
            <UsersThreeIcon size={18} />
          </Link>
          <button
            className={`button button-ghost button-icon room-panel-toggle ${showPanel ? "active" : ""}`}
            onClick={() => setShowPanel((value) => !value)}
            aria-label={showPanel ? "Hide chat, notes, and other room tools" : "Show chat, notes, and other room tools"}
            title={showPanel ? "Hide chat, notes, and other room tools" : "Show chat, notes, and other room tools"}
          >
            <SidebarSimpleIcon size={18} />
          </button>
        </div>
      </header>
      {roomError && <p className="room-error">{roomError}</p>}
      <div className={`room-body ${showPanel ? "" : "room-panel-hidden"}`}>
        <section className="room-main">
          {mode === "call" ? (
            <div className="room-mode">
              {connected ? (
                <div className="stage">
                  {visibleParticipants.map((person) => {
                    const self = person.userId === identity?.id;
                    const stream = self ? undefined : remoteStreams[person.userId];
                    const hasLocalVideo = self && (camera || sharing) && !!localStream;
                    return (
                      <article className={`video-tile ${self ? "self" : ""}`} key={person.userId}>
                        {hasLocalVideo && <StreamVideo stream={localStream!} muted />}
                        {!self && stream && <StreamVideo stream={stream} />}{" "}
                        {((!stream && !self) || (self && !hasLocalVideo)) && (
                          <div className="video-placeholder">
                            <span className="avatar">{initialsFor(person.username)}</span>
                          </div>
                        )}
                        <div className="tile-label">
                          <span>{self ? `${person.username} (you)` : person.username}</span>
                          {self && (
                            <span className="mic">
                              {mic ? <MicrophoneIcon size={12} /> : <MicrophoneSlashIcon size={12} />}
                            </span>
                          )}
                        </div>
                        {person.screenSharing && <span className="tile-status">Sharing</span>}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="room-prejoin">
                  <div className="room-prejoin-card">
                    <span className="room-prejoin-eyebrow">{reconnecting ? "Reconnecting…" : "Not connected yet"}</span>
                    <h2># {room?.name || "this room"}</h2>
                    <p>
                      Join to see who&apos;s here, chat, and collaborate live. Camera and mic are optional — turn them
                      on now or later from the controls below.
                    </p>
                    <div className="room-prejoin-actions">
                      <button className="button button-primary" onClick={() => void startCamera()}>
                        <VideoCameraIcon size={16} weight="fill" /> Join with camera
                      </button>
                      <button className="button button-secondary" onClick={() => void connectRoom()}>
                        <BroadcastIcon size={16} /> Join without camera
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="room-mode room-editor-mode">
              <div className="notes-head">
                <strong>Shared editor</strong>
                {connected ? (
                  <span>Synced through the room</span>
                ) : (
                  <button className="button button-secondary" onClick={() => void connectRoom()}>
                    <BroadcastIcon size={14} /> Join to sync
                  </button>
                )}
              </div>
              <textarea
                className="board"
                disabled={!connected}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  publish("editor", { document: "code", content: event.target.value });
                }}
                spellCheck={false}
                placeholder="Start writing shared code…"
                style={{
                  padding: 16,
                  resize: "none",
                  border: "1px solid var(--line)",
                  color: "#d8e2f0",
                  fontFamily: '"SFMono-Regular", Consolas, monospace',
                  fontSize: 13,
                  lineHeight: 1.6,
                  outline: "none",
                }}
              />
            </div>
          )}
          {connected && (
            <div className="room-controls">
              <span className="room-controls-status">
                <span className="status-dot" /> In call
              </span>
              <button
                className={`control ${mic ? "active" : ""}`}
                onClick={toggleMic}
                aria-label={mic ? "Mute microphone" : "Unmute microphone"}
                title={mic ? "Mute microphone" : "Unmute microphone"}
              >
                {mic ? <MicrophoneIcon size={18} /> : <MicrophoneSlashIcon size={18} />}
              </button>
              <button
                className={`control ${camera ? "active" : ""}`}
                onClick={toggleCamera}
                aria-label={camera ? "Turn off camera" : "Turn on camera"}
                title={camera ? "Turn off camera" : "Turn on camera"}
              >
                {camera ? <VideoCameraIcon size={18} /> : <VideoCameraSlashIcon size={18} />}
              </button>
              <button
                className={`control ${sharing ? "active" : ""}`}
                onClick={() => void toggleScreenShare()}
                aria-label={sharing ? "Stop sharing screen" : "Share screen"}
                title={sharing ? "Stop sharing screen" : "Share screen"}
              >
                <MonitorArrowUpIcon size={18} />
              </button>
              <button className="control danger" onClick={leave} aria-label="Leave the room" title="Leave the room">
                <PhoneDisconnectIcon size={18} /> <span className="control-label">Leave call</span>
              </button>
            </div>
          )}
        </section>
        {!showPanel && (
          <button
            className="room-panel-reveal"
            onClick={() => setShowPanel(true)}
            aria-label="Show chat, notes, and other room tools"
            title="Show chat, notes, and other room tools"
          >
            <CaretLeftIcon size={14} />
          </button>
        )}
        <aside
          className={`room-panel ${showPanel ? "" : "room-panel-collapsed"}`}
          inert={!showPanel || undefined}
          aria-hidden={!showPanel}
        >
          <div className="room-panel-tabs" role="tablist" aria-label="Room tools">
            {(["chat", "notes", "board", "files", "timeline"] as Panel[]).map((item) => (
              <button
                key={item}
                className={panel === item ? "active" : ""}
                onClick={() => setPanel(item)}
                role="tab"
                aria-selected={panel === item}
                data-locked={!connected || undefined}
              >
                {item}
              </button>
            ))}
          </div>
          <div className={`panel-content ${connected ? "" : "is-connection-blocked"}`}>
            {!connected && (
              <div className="panel-connection-gate" role="status">
                <span className="panel-connection-gate-icon">
                  <LockSimpleIcon size={18} weight="duotone" />
                </span>
                <strong>Join to use {panel}</strong>
                <p>This tool becomes live once you connect to the room.</p>
                <button className="button button-primary" onClick={() => void connectRoom()}>
                  <BroadcastIcon size={15} /> Join room
                </button>
              </div>
            )}
            {panel === "chat" && (
              <div className="chat">
                <div className="chat-list">
                  {!room && !roomError ? (
                    Array.from({ length: 3 }, (_, index) => (
                      <article className="message" key={index}>
                        <span className="avatar" aria-hidden="true" />
                        <div className="message-body">
                          <div className="message-meta">
                            <Skeleton width={80} height="0.85em" />
                            <Skeleton width={50} height="0.75em" />
                          </div>
                          <Skeleton width="70%" />
                        </div>
                      </article>
                    ))
                  ) : (
                    <>
                      {messages.map((message) => (
                        <article className="message" key={message.id}>
                          <span className="avatar">{message.initials}</span>
                          <div className="message-body">
                            <div className="message-meta">
                              <strong>{message.person}</strong>
                              <time>{message.time}</time>
                            </div>
                            <p>{message.text}</p>
                          </div>
                        </article>
                      ))}
                      {!messages.length && <p className="panel-empty">No messages have been recorded in this room.</p>}
                    </>
                  )}
                </div>
                <form className="chat-compose" onSubmit={sendMessage}>
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={connected ? "Message the room" : "Connect to message"}
                    aria-label="Message the room"
                    disabled={!connected}
                  />
                  <button className="button button-primary" disabled={!connected} aria-label="Send message">
                    <PaperPlaneTiltIcon size={15} weight="fill" />
                  </button>
                </form>
              </div>
            )}
            {panel === "notes" && (
              <div className="notes notes-workspace">
                <div className="notes-intro">
                  <span className="notes-intro-icon">
                    <NotePencilIcon size={18} weight="duotone" />
                  </span>
                  <div>
                    <strong>Shared notes</strong>
                    <p>Capture decisions and follow-ups for everyone in the call.</p>
                  </div>
                  <span className={`notes-sync-state ${connected ? "is-live" : ""}`}>
                    <span /> {connected ? "Live sync" : "Offline"}
                  </span>
                </div>
                <div className="notes-editor-shell">
                  <textarea
                    value={notes}
                    disabled={!connected}
                    onChange={(event) => {
                      setNotes(event.target.value);
                      publish("editor", { document: "notes", content: event.target.value });
                    }}
                    aria-label="Shared notes"
                    placeholder={
                      connected
                        ? "Start with a decision, question, or follow-up…"
                        : "Join the room to write shared notes."
                    }
                  />
                  <div className="notes-editor-footer">
                    <span>Visible to everyone in this room</span>
                    <span>{notes.trim() ? `${notes.trim().split(/\s+/).length} words` : "No notes yet"}</span>
                  </div>
                </div>
              </div>
            )}
            {
              // Kept mounted (not conditionally rendered like the other panels) even
              // when a different tab is active: incoming whiteboard strokes are drawn
              // straight onto the canvas imperatively, with no separate stroke-history
              // state to replay later, so unmounting it while off-tab would silently
              // and permanently drop anything a teammate drew in the meantime.
            }
            <div className="whiteboard" style={panel === "board" ? undefined : { display: "none" }}>
              <div className="whiteboard-head">
                <strong>Whiteboard</strong>
                <button className="button button-ghost" onClick={clearBoard} disabled={!connected}>
                  <EraserIcon size={14} /> Clear
                </button>
              </div>
              <canvas
                ref={boardRef}
                className="board"
                width={560}
                height={630}
                onPointerDown={(event) => {
                  const point = pointFor(event);
                  if (!point || !connected) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drawingRef.current = true;
                  lastPoint.current = point;
                }}
                onPointerMove={draw}
                onPointerUp={() => {
                  drawingRef.current = false;
                  lastPoint.current = null;
                }}
                onPointerLeave={() => {
                  drawingRef.current = false;
                  lastPoint.current = null;
                }}
              />
            </div>
            {panel === "files" && (
              <div className="files">
                <div className="files-head">
                  <strong>Files</strong>
                  <span>{files.length} transfers</span>
                </div>
                <label
                  aria-disabled={!connected}
                  className={`file-drop ${connected ? "" : "is-disabled"}`}
                  htmlFor={connected ? "room-file" : undefined}
                >
                  <FileArrowUpIcon size={20} />
                  <strong>{connected ? "Send directly to connected peers" : "Join before sharing files"}</strong>
                  Files move over encrypted WebRTC data channels and are not silently stored by the UI.
                  <input id="room-file" type="file" multiple onChange={uploadFiles} disabled={!connected} hidden />
                </label>
                <div className="file-list">
                  {files.length ? (
                    files.map((file) => (
                      <div className="file-row" key={file.id}>
                        <FileIcon size={18} weight="duotone" />
                        <div>
                          <strong>{file.name}</strong>
                          <span>
                            {file.size} · {file.status}
                          </span>
                        </div>
                        {file.downloadUrl && (
                          <a
                            className="button button-secondary button-icon file-download"
                            download={file.name}
                            href={file.downloadUrl}
                            aria-label={`Download ${file.name}`}
                            title={`Download ${file.name}`}
                          >
                            <DownloadSimpleIcon size={15} weight="bold" />
                          </a>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="field-help">No files have been transferred in this session.</p>
                  )}
                </div>
              </div>
            )}
            {panel === "timeline" && (
              <div className="timeline">
                <div className="timeline-head">
                  <strong>Room timeline</strong>
                  <span>Durable record</span>
                </div>
                {!room && !roomError ? (
                  Array.from({ length: 4 }, (_, index) => (
                    <div className="timeline-event" key={index}>
                      <i />
                      <div>
                        <Skeleton width="60%" />
                        <Skeleton width={90} height="0.75em" style={{ marginTop: 4 }} />
                      </div>
                    </div>
                  ))
                ) : (
                  <>
                    {timeline
                      .slice()
                      .reverse()
                      .map((event, index) => (
                        <div className="timeline-event" key={event.id ?? `${event.type}-${index}-${eventAt(event)}`}>
                          <i />
                          <div>
                            <p>{describeEvent(event)}</p>
                            <time>
                              {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
                                new Date(eventAt(event)),
                              )}
                            </time>
                          </div>
                        </div>
                      ))}
                    {!timeline.length && <p className="panel-empty">This room has no durable events yet.</p>}
                  </>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
