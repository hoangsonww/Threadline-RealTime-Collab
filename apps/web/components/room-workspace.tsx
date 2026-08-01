"use client";

import Link from "next/link";
import {
  ArrowLeftIcon,
  BroadcastIcon,
  CodeIcon,
  DesktopIcon,
  EraserIcon,
  FileArrowUpIcon,
  FileIcon,
  MicrophoneIcon,
  MicrophoneSlashIcon,
  MonitorArrowUpIcon,
  PaperPlaneTiltIcon,
  PhoneDisconnectIcon,
  SidebarSimpleIcon,
  VideoCameraIcon,
  VideoCameraSlashIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PeerMesh, type SignalPayload } from "../lib/peer-mesh";

type Panel = "chat" | "notes" | "board" | "files" | "timeline";
type Message = { id: number; person: string; initials: string; text: string; time: string };
type FileEntry = { name: string; size: string; status: string };

const participant = [
  { name: "Avery Chen", initials: "AC", label: "You", self: true },
  { name: "Lina Novak", initials: "LN", label: "Lina" },
  { name: "Mateo Costa", initials: "MC", label: "Mateo" },
  { name: "Sora Kim", initials: "SK", label: "Sora" },
];
const initialMessages: Message[] = [
  {
    id: 1,
    person: "Lina Novak",
    initials: "LN",
    text: "I added the rollback criteria to the shared notes. The error rate is falling now.",
    time: "10:24",
  },
  {
    id: 2,
    person: "Mateo Costa",
    initials: "MC",
    text: "The retry worker fix is ready to review. I am sharing the diff in a moment.",
    time: "10:27",
  },
  {
    id: 3,
    person: "Sora Kim",
    initials: "SK",
    text: "I captured the decision and assigned the follow-up owner.",
    time: "10:31",
  },
];
const starterNotes = `# Incident checkpoint\n\n## Decision\nKeep the rollback guard enabled until the payment retry error rate remains below the alert threshold.\n\n## Follow-up\n- Mateo: merge and monitor retry worker change\n- Lina: add a regression check to the runbook\n- Avery: post the room summary\n`;
const starterCode = `export async function shouldRetry(payment: Payment) {\n  if (payment.retryCount >= MAX_RETRIES) return false;\n  if (payment.state === "rollback_pending") return false;\n\n  return isRetryable(payment.lastError);\n}\n`;

function formatSize(bytes: number) {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function StreamVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline />;
}

export function RoomWorkspace({ roomId }: { roomId: string }) {
  const [panel, setPanel] = useState<Panel>("chat");
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState(starterNotes);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [mode, setMode] = useState<"call" | "editor">("call");
  const [connected, setConnected] = useState(false);
  const [code, setCode] = useState(starterCode);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const boardRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const meshRef = useRef<PeerMesh | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(`threadline-notes-${roomId}`);
    if (stored) setNotes(stored);
    const storedCode = localStorage.getItem(`threadline-code-${roomId}`);
    if (storedCode) setCode(storedCode);
  }, [roomId]);
  useEffect(() => {
    const timer = window.setTimeout(() => localStorage.setItem(`threadline-notes-${roomId}`, notes), 250);
    return () => window.clearTimeout(timer);
  }, [notes, roomId]);
  useEffect(() => {
    const timer = window.setTimeout(() => localStorage.setItem(`threadline-code-${roomId}`, code), 250);
    return () => window.clearTimeout(timer);
  }, [code, roomId]);
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      socketRef.current?.close();
      meshRef.current?.close();
    },
    [],
  );

  const publish = useCallback((type: string, payload: unknown) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type, payload }));
  }, []);
  const connectRoom = useCallback(async () => {
    const api = process.env.NEXT_PUBLIC_API_ORIGIN;
    const realtime = process.env.NEXT_PUBLIC_REALTIME_ORIGIN;
    if (!api || !realtime || socketRef.current) {
      setConnected(true);
      return;
    }
    try {
      const ticketResponse = await fetch(`${api}/v1/rooms/${roomId}/ticket`, {
        method: "POST",
        credentials: "include",
      });
      if (!ticketResponse.ok) throw new Error("ticket unavailable");
      const { ticket } = await ticketResponse.json();
      const socket = new WebSocket(
        `${realtime.replace(/^http/, "ws")}/rooms/${roomId}?ticket=${encodeURIComponent(ticket)}`,
      );
      meshRef.current ??= new PeerMesh({
        sendSignal: (peerId, payload) => socket.send(JSON.stringify({ type: "signal", to: peerId, payload })),
        onRemoteStream: (peerId, stream) => setRemoteStreams((streams) => ({ ...streams, [peerId]: stream })),
        onFile: (_peerId, file) =>
          setFiles((items) => [
            { name: file.name, size: formatSize(file.size), status: "Received via direct transfer" },
            ...items,
          ]),
      });
      socket.onopen = () => setConnected(true);
      socket.onclose = () => setConnected(false);
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as { type: string; payload?: unknown; from?: string };
        if (message.type === "chat" && message.from !== "local") {
          const payload = message.payload as { text?: string; username?: string };
          const text = payload.text;
          if (text)
            setMessages((items) => [
              ...items,
              {
                id: Date.now(),
                person: payload.username ?? "Room member",
                initials: "RM",
                text,
                time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              },
            ]);
        }
        if (message.type === "signal" && message.from)
          void meshRef.current?.receiveSignal(message.from, message.payload as SignalPayload);
        if (message.type === "room.ready") {
          const payload = message.payload as {
            participant?: { userId: string };
            participants?: Array<{ userId: string }>;
          };
          const localId = payload.participant?.userId;
          if (localId)
            payload.participants
              ?.filter((person) => person.userId !== localId)
              .forEach((person) => void meshRef.current?.connect(person.userId, localId < person.userId));
        }
      };
      socketRef.current = socket;
    } catch {
      setConnected(false);
    }
  }, [roomId]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      meshRef.current?.setLocalStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCamera(true);
      setMic(true);
      connectRoom();
    } catch {
      setCamera(false);
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
    if (!camera) {
      void startCamera();
      return;
    }
    const next = false;
    streamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setCamera(next);
  };
  const shareScreen = async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screen.getVideoTracks()[0];
      track.addEventListener("ended", () => {
        setSharing(false);
        publish("screen-share", { active: false });
      });
      if (videoRef.current) videoRef.current.srcObject = screen;
      meshRef.current?.setLocalStream(screen);
      setSharing(true);
      publish("screen-share", { active: true });
      connectRoom();
    } catch {
      setSharing(false);
    }
  };
  const leave = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    meshRef.current?.close();
    meshRef.current = null;
    setRemoteStreams({});
    setCamera(false);
    setSharing(false);
    setConnected(false);
  };
  const sendMessage = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const entry: Message = {
      id: Date.now(),
      person: "Avery Chen",
      initials: "AC",
      text,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((items) => [...items, entry]);
    publish("chat", { text, username: "Avery Chen" });
    setDraft("");
  };
  const pointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = boardRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };
  const startDraw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointer(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPoint.current = point;
  };
  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const point = pointer(event);
    const canvas = boardRef.current;
    const previous = lastPoint.current;
    if (!point || !canvas || !previous) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.strokeStyle = "#52e0a2";
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPoint.current = point;
    publish("whiteboard", { from: previous, to: point });
  };
  const clearBoard = () => {
    const canvas = boardRef.current;
    if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  };
  const uploadFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const next = selected.map((file) => ({
      name: file.name,
      size: formatSize(file.size),
      status: meshRef.current ? "Sending by direct transfer" : "Ready for peer transfer",
    }));
    setFiles((items) => [...next, ...items]);
    void Promise.all(selected.map((file) => meshRef.current?.sendFile(file)));
    publish("timeline", { type: "file.staged", files: next.map((file) => file.name) });
    event.target.value = "";
  };

  return (
    <main id="main-content" className="room-layout">
      <header className="room-topbar">
        <div className="room-breadcrumb">
          <Link href="/app" aria-label="Back to rooms">
            <ArrowLeftIcon size={17} />
          </Link>
          <span style={{ color: "var(--subtle)" }}>/</span>
          <strong># {roomId}</strong>
          <span className="room-state">
            <span className="status-dot" /> {connected ? "Connected" : "Room ready"}
          </span>
        </div>
        <div className="room-actions">
          <button className="button button-secondary" onClick={() => setMode(mode === "call" ? "editor" : "call")}>
            {mode === "call" ? (
              <>
                <CodeIcon size={16} /> Open editor
              </>
            ) : (
              <>
                <DesktopIcon size={16} /> Open call
              </>
            )}
          </button>
          <button className="button button-ghost button-icon" aria-label="Toggle room panel">
            <SidebarSimpleIcon size={18} />
          </button>
        </div>
      </header>
      <div className="room-body">
        <section className="room-main">
          {mode === "call" ? (
            <div className="stage">
              {participant.map((person, index) => {
                const remoteStream = person.self ? undefined : Object.values(remoteStreams)[index - 1];
                return (
                  <article className={`video-tile ${person.self ? "self" : ""}`} key={person.name}>
                    {person.self && (camera || sharing) && <video ref={videoRef} autoPlay muted playsInline />}
                    {!person.self && remoteStream && <StreamVideo stream={remoteStream} />}
                    {!person.self && !remoteStream && (
                      <div className="video-placeholder">
                        <span className="avatar">{person.initials}</span>
                      </div>
                    )}
                    {person.self && !camera && !sharing && (
                      <div className="video-placeholder">
                        <span className="avatar">{person.initials}</span>
                      </div>
                    )}
                    <div className="tile-label">
                      <span>{person.label}</span>
                      {person.self && (
                        <span className="mic">
                          {mic ? <MicrophoneIcon size={12} /> : <MicrophoneSlashIcon size={12} />}
                        </span>
                      )}
                    </div>
                    {person.name === "Lina Novak" && <span className="tile-status">Speaking</span>}
                    {person.self && sharing && <span className="tile-status">Sharing</span>}
                  </article>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: 15, minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(0,1fr)" }}>
              <div className="notes-head">
                <strong style={{ fontSize: 13 }}>src/retry-policy.ts</strong>
                <span>Saved locally · shared editor channel ready</span>
              </div>
              <textarea
                className="board"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  publish("editor", { content: event.target.value });
                }}
                spellCheck={false}
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
          <div className="room-controls">
            <button
              className={`control ${mic ? "active" : ""}`}
              onClick={toggleMic}
              aria-label={mic ? "Mute microphone" : "Unmute microphone"}
            >
              {mic ? <MicrophoneIcon size={18} /> : <MicrophoneSlashIcon size={18} />}
            </button>
            <button
              className={`control ${camera ? "active" : ""}`}
              onClick={toggleCamera}
              aria-label={camera ? "Turn off camera" : "Turn on camera"}
            >
              {camera ? <VideoCameraIcon size={18} /> : <VideoCameraSlashIcon size={18} />}
            </button>
            <button
              className={`control ${sharing ? "active" : ""}`}
              onClick={() => void shareScreen()}
              aria-label="Share screen"
            >
              <MonitorArrowUpIcon size={18} />
            </button>
            <button className="control" onClick={() => void connectRoom()} aria-label="Connect to room coordinator">
              <BroadcastIcon size={18} />
            </button>
            <button className="control danger" onClick={leave} aria-label="Leave media session">
              <PhoneDisconnectIcon size={18} />
            </button>
          </div>
        </section>
        <aside className="room-panel">
          <div className="room-panel-tabs" role="tablist" aria-label="Room tools">
            {(["chat", "notes", "board", "files", "timeline"] as Panel[]).map((item) => (
              <button
                key={item}
                className={panel === item ? "active" : ""}
                onClick={() => setPanel(item)}
                role="tab"
                aria-selected={panel === item}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="panel-content">
            {panel === "chat" && (
              <div className="chat">
                <div className="chat-list">
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
                </div>
                <form className="chat-compose" onSubmit={sendMessage}>
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Message the room"
                    aria-label="Message the room"
                  />
                  <button className="button button-primary" aria-label="Send message">
                    <PaperPlaneTiltIcon size={15} weight="fill" />
                  </button>
                </form>
              </div>
            )}
            {panel === "notes" && (
              <div className="notes">
                <div className="notes-head">
                  <strong>Shared notes</strong>
                  <span>Autosaved</span>
                </div>
                <textarea
                  value={notes}
                  onChange={(event) => {
                    setNotes(event.target.value);
                    publish("timeline", { type: "notes.changed" });
                  }}
                  aria-label="Shared notes"
                />
              </div>
            )}
            {panel === "board" && (
              <div className="whiteboard">
                <div className="whiteboard-head">
                  <strong>Whiteboard</strong>
                  <button className="button button-ghost" onClick={clearBoard}>
                    <EraserIcon size={14} /> Clear
                  </button>
                </div>
                <canvas
                  ref={boardRef}
                  className="board"
                  width={560}
                  height={630}
                  onPointerDown={startDraw}
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
            )}
            {panel === "files" && (
              <div className="files">
                <div className="files-head">
                  <strong>Files</strong>
                  <span>{files.length} staged</span>
                </div>
                <label className="file-drop" htmlFor="room-file">
                  <FileArrowUpIcon size={20} />
                  <strong>Stage a file for the room</strong>Files are prepared for direct peer transfer when a recipient
                  connects.
                  <input id="room-file" type="file" multiple onChange={uploadFiles} hidden />
                </label>
                <div className="file-list">
                  {files.length === 0 ? (
                    <p className="field-help">No files staged in this room yet.</p>
                  ) : (
                    files.map((file, index) => (
                      <div className="file-row" key={`${file.name}-${index}`}>
                        <FileIcon size={18} weight="duotone" />
                        <div>
                          <strong>{file.name}</strong>
                          <span>
                            {file.size} · {file.status}
                          </span>
                        </div>
                      </div>
                    ))
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
                <div className="timeline-event">
                  <i />
                  <div>
                    <p>Lina saved an action item: “Add retry regression coverage.”</p>
                    <time>10:31</time>
                  </div>
                </div>
                <div className="timeline-event">
                  <i />
                  <div>
                    <p>Mateo marked the retry worker change ready for review.</p>
                    <time>10:27</time>
                  </div>
                </div>
                <div className="timeline-event">
                  <i />
                  <div>
                    <p>Screen share started by Avery.</p>
                    <time>10:19</time>
                  </div>
                </div>
                <div className="timeline-event">
                  <i />
                  <div>
                    <p>Room opened for incident response.</p>
                    <time>10:14</time>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
