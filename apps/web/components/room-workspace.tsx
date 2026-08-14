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
import { PeerMesh, type RemoteMedia, type SignalPayload } from "../lib/peer-mesh";
import { callShortcutFor, shortcutKey } from "../lib/call-shortcuts";
import { playSound } from "../lib/sound";
import { Skeleton } from "./skeletons";

type Panel = "chat" | "notes" | "board" | "files" | "timeline";
type Participant = {
  connectionId: string;
  userId: string;
  username: string;
  role: string;
  joinedAt: string;
  screenSharing: boolean;
};
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

const maxAutomaticReconnectAttempts = 6;
const stableConnectionResetMs = 60_000;
const defaultPanelWidth = 360;
const minimumPanelWidth = 300;
const maximumPanelWidth = 720;
const minimumMainWidth = 380;

const clampPanelWidth = (width: number) => {
  if (typeof window === "undefined") return Math.min(maximumPanelWidth, Math.max(minimumPanelWidth, width));
  const availableWidth = Math.max(minimumPanelWidth, window.innerWidth - minimumMainWidth);
  return Math.min(maximumPanelWidth, availableWidth, Math.max(minimumPanelWidth, width));
};

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

function StreamVideo({ stream, muted, source }: { stream: MediaStream; muted?: boolean; source: "camera" | "screen" }) {
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
  return <video ref={ref} autoPlay muted={muted} playsInline data-source={source} />;
}

function StreamAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.srcObject = stream;
    const tryPlay = () =>
      void audio.play().catch(() => document.addEventListener("pointerdown", tryPlay, { once: true }));
    tryPlay();
    return () => document.removeEventListener("pointerdown", tryPlay);
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

function MediaView({ camera, screen, microphone, local = false }: RemoteMedia & { local?: boolean }) {
  return (
    <>
      {!local && microphone && <StreamAudio stream={microphone} />}
      {(screen || camera) && (
        <div className={`video-media-grid ${screen && camera ? "is-dual" : ""}`}>
          {screen && <StreamVideo stream={screen} muted source="screen" />}
          {camera && <StreamVideo stream={camera} muted source="camera" />}
        </div>
      )}
    </>
  );
}

const liveStream = (stream: MediaStream | undefined, kind: "audio" | "video") =>
  stream?.getTracks().some((track) => track.kind === kind && track.readyState === "live") ? stream : undefined;

function useSpeaking(stream?: MediaStream) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const audioStream = liveStream(stream, "audio");
    if (!audioStream) {
      setSpeaking(false);
      return;
    }

    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const analyser = context.createAnalyser();
    const source = context.createMediaStreamSource(audioStream);
    const samples = new Uint8Array(analyser.fftSize);
    let animationFrame = 0;
    let lastVoiceAt = 0;
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    void context.resume().catch(() => undefined);

    const measure = (now: number) => {
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const amplitude = (sample - 128) / 128;
        energy += amplitude * amplitude;
      }
      const voiceDetected = Math.sqrt(energy / samples.length) > 0.035;
      if (voiceDetected) lastVoiceAt = now;
      setSpeaking(voiceDetected || now - lastVoiceAt < 220);
      animationFrame = requestAnimationFrame(measure);
    };
    animationFrame = requestAnimationFrame(measure);

    return () => {
      cancelAnimationFrame(animationFrame);
      source.disconnect();
      analyser.disconnect();
      void context.close();
    };
  }, [stream]);

  return speaking;
}

function ParticipantTile({
  person,
  media,
  self,
  otherDevice,
  localMicEnabled,
}: {
  person: Participant;
  media: RemoteMedia;
  self: boolean;
  otherDevice: boolean;
  localMicEnabled: boolean;
}) {
  const camera = liveStream(media.camera, "video");
  const screen = liveStream(media.screen, "video");
  const microphone = liveStream(media.microphone, "audio");
  const micEnabled = self ? localMicEnabled : !!microphone;
  const speaking = useSpeaking(microphone);
  const hasVideo = !!camera || !!screen;
  const mediaKey = `${camera?.id ?? "no-camera"}:${screen?.id ?? "no-screen"}`;
  const displayName = self
    ? `${person.username} (you)`
    : otherDevice
      ? `${person.username} (your other device)`
      : person.username;

  return (
    <article
      className={`video-tile ${self ? "self" : ""} ${speaking ? "is-speaking" : ""}`}
      aria-label={`${displayName}${speaking ? ", speaking" : micEnabled ? ", microphone on" : ", microphone off"}`}
    >
      <MediaView key={mediaKey} camera={camera} screen={screen} microphone={microphone} local={self} />
      {!hasVideo && (
        <div className="video-placeholder">
          <span className="avatar">{initialsFor(person.username)}</span>
        </div>
      )}
      <div className="tile-label">
        <span>{displayName}</span>
        <span
          className={`mic ${micEnabled ? "is-on" : "is-off"}`}
          title={micEnabled ? `${person.username}'s microphone is on` : `${person.username}'s microphone is off`}
          aria-hidden="true"
        >
          {micEnabled ? <MicrophoneIcon size={12} weight="fill" /> : <MicrophoneSlashIcon size={12} />}
        </span>
      </div>
      {screen && <span className="tile-status">Sharing</span>}
    </article>
  );
}

export function RoomWorkspace({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("chat");
  const [mode, setMode] = useState<"call" | "editor">("call");
  const [showPanel, setShowPanel] = useState(true);
  const [panelWidth, setPanelWidth] = useState(defaultPanelWidth);
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
  const [connectionNotice, setConnectionNotice] = useState("");
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [remoteMedia, setRemoteMedia] = useState<Record<string, RemoteMedia>>({});
  const [localCameraStream, setLocalCameraStream] = useState<MediaStream | null>(null);
  const [localMicrophoneStream, setLocalMicrophoneStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
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
  const reconnectResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectPromiseRef = useRef<Promise<boolean> | null>(null);
  const hasOtherDeviceRef = useRef(false);
  const fileUrlsRef = useRef<string[]>([]);
  const identityIdRef = useRef("");
  const presenceIdsRef = useRef<Set<string>>(new Set());
  const wasConnectedRef = useRef(false);

  useEffect(() => {
    const fitPanelToViewport = () => setPanelWidth((width) => clampPanelWidth(width));
    window.addEventListener("resize", fitPanelToViewport);
    return () => window.removeEventListener("resize", fitPanelToViewport);
  }, []);

  // Driven off the rendered state rather than the socket handler so a recovered
  // connection is announced the same way the first one was — from the caller's
  // point of view, being back in the room is the same event either time.
  useEffect(() => {
    if (connected && !wasConnectedRef.current) playSound("join");
    wasConnectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    if (roomError) playSound("error");
  }, [roomError]);

  // Bound to the window rather than a container so the shortcuts work wherever
  // focus happens to be — including on the video stage, which holds no focusable
  // element of its own. Only while connected: there is nothing to toggle before
  // that, and a stray keypress on the pre-join screen should not ask for a device.

  /**
   * Announce only the people who arrived or left since the last presence frame.
   *
   * The room re-broadcasts its full participant list on every change, so
   * comparing against the previous frame is what separates "someone joined" from
   * "here is the roster again". The baseline is seeded from room.ready without a
   * cue, so joining a room that already has ten people in it stays silent.
   */
  const announcePresence = useCallback((people: Participant[], silent = false) => {
    const current = new Set(
      people.map((person) => person.connectionId).filter((connectionId) => connectionId !== localIdRef.current),
    );
    const previous = presenceIdsRef.current;
    presenceIdsRef.current = current;
    if (silent) return;
    if ([...current].some((connectionId) => !previous.has(connectionId))) playSound("peerJoin");
    if ([...previous].some((connectionId) => !current.has(connectionId))) playSound("peerLeave");
  }, []);

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
        identityIdRef.current = identityData.user.id;
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
      if (reconnectResetTimerRef.current) clearTimeout(reconnectResetTimerRef.current);
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
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

  const publishLocalTracks = useCallback(() => {
    meshRef.current?.setLocalTracks({
      camera: cameraStreamRef.current?.getVideoTracks()[0],
      microphone: microphoneStreamRef.current?.getAudioTracks()[0],
      screen: screenStreamRef.current?.getVideoTracks()[0],
    });
  }, []);

  const connectRoom = useCallback(async () => {
    const realtime = process.env.NEXT_PUBLIC_REALTIME_ORIGIN;
    if (socketRef.current?.readyState === WebSocket.OPEN && localIdRef.current) return true;
    if (connectPromiseRef.current) return connectPromiseRef.current;
    if (!apiOrigin || !realtime) {
      setRoomError("Realtime is not configured. Set both NEXT_PUBLIC_API_ORIGIN and NEXT_PUBLIC_REALTIME_ORIGIN.");
      return false;
    }
    const attempt = (async () => {
      try {
        const { ticket, iceServers } = await apiFetch<{ ticket: string; iceServers?: RTCIceServer[] }>(
          `/v1/rooms/${roomId}/ticket`,
          { method: "POST" },
        );
        return await new Promise<boolean>((resolve) => {
          let settled = false;
          const settle = (result: boolean) => {
            if (!settled) {
              settled = true;
              clearTimeout(readyTimer);
              resolve(result);
            }
          };
          const socket = new WebSocket(
            `${realtime.replace(/^http/, "ws")}/rooms/${roomId}?ticket=${encodeURIComponent(ticket)}`,
          );

          // A mesh is tied to the signaling socket that created it. Reusing it
          // after reconnect made every new SDP/ICE message use a closed socket.
          meshRef.current?.close();
          knownPeersRef.current.clear();
          localIdRef.current = "";
          setRemoteMedia({});
          const mesh = new PeerMesh({
            sendSignal: (peerId, payload) => {
              if (socket.readyState === WebSocket.OPEN)
                socket.send(JSON.stringify({ type: "signal", to: peerId, payload }));
            },
            onRemoteMedia: (peerId, media) => setRemoteMedia((items) => ({ ...items, [peerId]: media })),
            getLocalId: () => localIdRef.current,
            iceServers,
            onFile: (_peerId, file) => {
              const downloadUrl = URL.createObjectURL(file);
              playSound("success");
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
          mesh.setLocalTracks({
            camera: cameraStreamRef.current?.getVideoTracks()[0],
            microphone: microphoneStreamRef.current?.getAudioTracks()[0],
            screen: screenStreamRef.current?.getVideoTracks()[0],
          });
          meshRef.current = mesh;
          socketRef.current = socket;
          const readyTimer = setTimeout(() => {
            if (socketRef.current !== socket || settled) return;
            setRoomError("The live room did not finish connecting. Retrying…");
            socket.close();
          }, 15_000);

          const syncPeers = (people: Participant[]) => {
            const localId = localIdRef.current;
            if (!localId) return;
            const presentPeerIds = new Set(
              people.map((person) => person.connectionId).filter((connectionId) => connectionId !== localId),
            );
            for (const peerId of knownPeersRef.current) {
              if (presentPeerIds.has(peerId)) continue;
              mesh.disconnect(peerId);
              knownPeersRef.current.delete(peerId);
              setRemoteMedia((items) => {
                const next = { ...items };
                delete next[peerId];
                return next;
              });
            }
            for (const person of people) {
              if (person.connectionId === localId || knownPeersRef.current.has(person.connectionId)) continue;
              knownPeersRef.current.add(person.connectionId);
              void mesh.connect(person.connectionId, localId < person.connectionId);
            }
          };

          const syncOtherDevices = (people: Participant[]) => {
            const localId = localIdRef.current;
            const localUserId = people.find((person) => person.connectionId === localId)?.userId;
            if (!localId || !localUserId) return;
            const hasOtherDevice = people.some(
              (person) => person.userId === localUserId && person.connectionId !== localId,
            );
            hasOtherDeviceRef.current = hasOtherDevice;
            setConnectionNotice(
              hasOtherDevice
                ? "This account is connected on another device. Keep only one microphone active to prevent audio feedback."
                : "",
            );
          };

          socket.onopen = () => setRoomError("");
          socket.onclose = () => {
            settle(false);
            // leave() nulls this ref first; a newer attempt replaces it.
            if (socketRef.current !== socket) return;
            setConnected(false);
            mesh.close();
            if (meshRef.current === mesh) meshRef.current = null;
            knownPeersRef.current.clear();
            localIdRef.current = "";
            setRemoteMedia({});
            if (reconnectResetTimerRef.current) clearTimeout(reconnectResetTimerRef.current);
            const reconnectAttempt = reconnectAttemptRef.current + 1;
            reconnectAttemptRef.current = reconnectAttempt;
            if (reconnectAttempt > maxAutomaticReconnectAttempts) {
              setReconnecting(false);
              setRoomError("The live room could not reconnect automatically. Select Join room to try again.");
              return;
            }
            const delay = Math.min(1000 * 2 ** (reconnectAttempt - 1), 15_000);
            setReconnecting(true);
            reconnectTimerRef.current = setTimeout(() => {
              reconnectTimerRef.current = null;
              if (socketRef.current === socket) void connectRoom();
            }, delay);
          };
          socket.onerror = () => {
            if (socketRef.current === socket)
              setRoomError("The room coordinator could not be reached. Check the realtime deployment and try again.");
          };
          socket.onmessage = (wire) => {
            if (socketRef.current !== socket) return;
            const event = JSON.parse(wire.data) as { type: string; payload?: unknown; from?: string; at?: string };
            if (event.type === "presence") {
              const people = (event.payload as Participant[]) ?? [];
              announcePresence(people);
              setParticipants(people);
              syncPeers(people);
              syncOtherDevices(people);
              return;
            }
            if (event.type === "room.ready") {
              const payload = event.payload as {
                participants?: Participant[];
                recentEvents?: RoomEvent[];
                participant?: Participant;
              };
              // Both taken from room.ready rather than waiting on /v1/auth/me: that
              // fetch can still be in flight when the first chat message arrives, and
              // an unset identityIdRef would let your own echoed message through the
              // "is this from someone else" filter and play an arrival cue at you.
              if (payload.participant?.connectionId) {
                localIdRef.current = payload.participant.connectionId;
                identityIdRef.current = payload.participant.userId;
              }
              announcePresence(payload.participants ?? [], true);
              setParticipants(payload.participants ?? []);
              payload.recentEvents?.forEach(addEvent);
              hydrateEditorState(payload.recentEvents ?? []);
              syncPeers(payload.participants ?? []);
              syncOtherDevices(payload.participants ?? []);
              if (reconnectResetTimerRef.current) clearTimeout(reconnectResetTimerRef.current);
              reconnectResetTimerRef.current = setTimeout(() => {
                reconnectAttemptRef.current = 0;
                reconnectResetTimerRef.current = null;
              }, stableConnectionResetMs);
              setConnected(true);
              setReconnecting(false);
              setRoomError("");
              settle(true);
              return;
            }
            if (event.type === "signal" && event.from) {
              void mesh.receiveSignal(event.from, event.payload as SignalPayload);
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
            // Announced here rather than in addEvent: addEvent also replays the
            // room's stored history on load, and a page refresh must not sound
            // like every message in the backlog just arrived. The room echoes
            // chat back to its sender, so your own message is filtered out by
            // actor — `from` on a chat event is the sender's user id.
            if (event.type === "chat" && event.from && event.from !== identityIdRef.current)
              playSound("messageReceived");
            if (event.type !== "cursor") addEvent({ ...event, payload: event.payload ?? null, at: event.at });
          };
        });
      } catch (error) {
        setConnected(false);
        setRoomError(error instanceof Error ? error.message : "Unable to join the room.");
        return false;
      }
    })();
    connectPromiseRef.current = attempt;
    const result = await attempt;
    if (connectPromiseRef.current === attempt) connectPromiseRef.current = null;
    return result;
  }, [addEvent, announcePresence, drawLine, hydrateEditorState, roomId]);

  const retryRoomConnection = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    reconnectAttemptRef.current = 0;
    setReconnecting(false);
    setRoomError("");
    return connectRoom();
  }, [connectRoom]);

  const startCamera = async () => {
    try {
      if (!(await retryRoomConnection())) return;
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = stream;
      setLocalCameraStream(stream);
      setCamera(true);
      playSound("cameraOn");
      publishLocalTracks();
    } catch {
      setRoomError("Camera access was not granted.");
    }
  };
  const toggleMic = async () => {
    if (mic) {
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
      setLocalMicrophoneStream(null);
      setMic(false);
      playSound("micOff");
      publishLocalTracks();
      return;
    }
    try {
      if (!(await retryRoomConnection())) return;
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = stream;
      setLocalMicrophoneStream(stream);
      setMic(true);
      playSound("micOn");
      publishLocalTracks();
    } catch {
      setRoomError("Microphone access was not granted.");
    }
  };
  const toggleCamera = () => {
    if (!camera) void startCamera();
    else {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      setLocalCameraStream(null);
      setCamera(false);
      playSound("cameraOff");
      publishLocalTracks();
    }
  };
  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setLocalScreenStream(null);
    setSharing(false);
    // Also reached when the browser's own "stop sharing" bar is used, which is
    // the case that most needs an in-app confirmation that it took effect.
    playSound("shareStop");
    publish("screen-share", { active: false });
    publishLocalTracks();
  }, [publish, publishLocalTracks]);
  const toggleScreenShare = async () => {
    if (sharing) return stopScreenShare();
    try {
      if (!(await connectRoom())) return;
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const videoTrack = screen.getVideoTracks()[0];
      videoTrack.addEventListener("ended", stopScreenShare);
      screenStreamRef.current = screen;
      setLocalScreenStream(screen);
      setSharing(true);
      playSound("shareStart");
      publishLocalTracks();
      publish("screen-share", { active: true });
    } catch {
      setRoomError("Screen share was not started.");
    }
  };
  // Held in a ref so the listener below can be registered once per connection
  // instead of on every render. The toggles are recreated each render and the room
  // re-renders on every presence and speaking-state change, so binding the handler
  // directly would add and remove a window listener many times a second.
  const toggleRef = useRef({ toggleMic, toggleCamera, toggleScreenShare });
  toggleRef.current = { toggleMic, toggleCamera, toggleScreenShare };

  useEffect(() => {
    if (!connected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = callShortcutFor(event);
      if (!action) return;
      event.preventDefault();
      if (action === "toggleMic") void toggleRef.current.toggleMic();
      else if (action === "toggleCamera") toggleRef.current.toggleCamera();
      else void toggleRef.current.toggleScreenShare();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [connected]);

  const leave = () => {
    // Played before the teardown so it is not competing with the route change;
    // the audio graph lives outside React, so it finishes after this unmounts.
    playSound("leave");
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (reconnectResetTimerRef.current) clearTimeout(reconnectResetTimerRef.current);
    reconnectTimerRef.current = null;
    reconnectResetTimerRef.current = null;
    reconnectAttemptRef.current = 0;
    setReconnecting(false);
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
    setLocalMicrophoneStream(null);
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    meshRef.current?.close();
    meshRef.current = null;
    knownPeersRef.current.clear();
    presenceIdsRef.current.clear();
    localIdRef.current = "";
    setRemoteMedia({});
    setLocalCameraStream(null);
    setLocalScreenStream(null);
    setParticipants([]);
    setCamera(false);
    setMic(false);
    setSharing(false);
    setConnected(false);
    setConnectionNotice("");
    hasOtherDeviceRef.current = false;
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
    playSound("messageSent");
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
    const items = transfers.map(({ file, id }) => {
      const downloadUrl = URL.createObjectURL(file);
      fileUrlsRef.current.push(downloadUrl);
      return {
        id,
        name: file.name,
        size: formatSize(file.size),
        status: "Waiting for connected peers…",
        downloadUrl,
      };
    });
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
      ? [
          {
            connectionId: localIdRef.current || `local-${identity.id}`,
            userId: identity.id,
            username: identity.displayName,
            role: "member",
            joinedAt: "",
            screenSharing: false,
          },
        ]
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
      {!roomError && connectionNotice && <p className="room-notice">{connectionNotice}</p>}
      <div
        className={`room-body ${showPanel ? "" : "room-panel-hidden"}`}
        style={{ "--room-panel-width": `${panelWidth}px` } as React.CSSProperties}
      >
        <section className="room-main">
          {mode === "call" ? (
            <div className="room-mode">
              {connected ? (
                <div className="stage">
                  {visibleParticipants.map((person) => {
                    const self = person.connectionId === localIdRef.current;
                    const otherDevice = !self && person.userId === identity?.id;
                    const media: RemoteMedia = self
                      ? {
                          camera: localCameraStream ?? undefined,
                          microphone: localMicrophoneStream ?? undefined,
                          screen: localScreenStream ?? undefined,
                        }
                      : (remoteMedia[person.connectionId] ?? {});
                    return (
                      <ParticipantTile
                        key={person.connectionId}
                        person={person}
                        media={media}
                        self={self}
                        otherDevice={otherDevice}
                        localMicEnabled={mic}
                      />
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
                      <button className="button button-secondary" onClick={() => void retryRoomConnection()}>
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
                  <button className="button button-secondary" onClick={() => void retryRoomConnection()}>
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
                aria-keyshortcuts={shortcutKey.toggleMic}
                title={`${mic ? "Mute microphone" : "Unmute microphone"} (${shortcutKey.toggleMic})`}
              >
                {mic ? <MicrophoneIcon size={18} /> : <MicrophoneSlashIcon size={18} />}
              </button>
              <button
                className={`control ${camera ? "active" : ""}`}
                onClick={toggleCamera}
                aria-label={camera ? "Turn off camera" : "Turn on camera"}
                aria-keyshortcuts={shortcutKey.toggleCamera}
                title={`${camera ? "Turn off camera" : "Turn on camera"} (${shortcutKey.toggleCamera})`}
              >
                {camera ? <VideoCameraIcon size={18} /> : <VideoCameraSlashIcon size={18} />}
              </button>
              <button
                className={`control ${sharing ? "active" : ""}`}
                onClick={() => void toggleScreenShare()}
                aria-label={sharing ? "Stop sharing screen" : "Share screen"}
                aria-keyshortcuts={shortcutKey.toggleScreenShare}
                title={`${sharing ? "Stop sharing screen" : "Share screen"} (${shortcutKey.toggleScreenShare})`}
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
          <div
            className="room-panel-resizer"
            role="separator"
            aria-label="Resize room tools sidebar"
            aria-orientation="vertical"
            aria-valuemin={minimumPanelWidth}
            aria-valuemax={maximumPanelWidth}
            aria-valuenow={Math.round(panelWidth)}
            tabIndex={showPanel ? 0 : -1}
            onDoubleClick={() => setPanelWidth(clampPanelWidth(defaultPanelWidth))}
            onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              setPanelWidth(clampPanelWidth(window.innerWidth - event.clientX));
            }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 40 : 16;
              if (event.key === "ArrowLeft") setPanelWidth((width) => clampPanelWidth(width + step));
              else if (event.key === "ArrowRight") setPanelWidth((width) => clampPanelWidth(width - step));
              else if (event.key === "Home") setPanelWidth(clampPanelWidth(minimumPanelWidth));
              else if (event.key === "End") setPanelWidth(clampPanelWidth(maximumPanelWidth));
              else return;
              event.preventDefault();
            }}
          >
            <span aria-hidden="true" />
          </div>
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
          <div className={`panel-content ${connected ? "" : "is-connection-blocked"}`} data-panel={panel}>
            {!connected && (
              <div className="panel-connection-gate" role="status">
                <span className="panel-connection-gate-icon">
                  <LockSimpleIcon size={18} weight="duotone" />
                </span>
                <strong>Join to use {panel}</strong>
                <p>This tool becomes live once you connect to the room.</p>
                <button className="button button-primary" onClick={() => void retryRoomConnection()}>
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
