export type SignalPayload = {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
};

type PeerMeshOptions = {
  sendSignal: (peerId: string, payload: SignalPayload) => void;
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onFile: (peerId: string, file: File) => void;
  /** Read at signaling time (not just once), since it's only known after room.ready arrives. */
  getLocalId: () => string;
  iceServers?: RTCIceServer[];
};

type TrackKind = "audio" | "video";
const trackKinds: TrackKind[] = ["audio", "video"];

type Peer = {
  connection: RTCPeerConnection;
  channel?: RTCDataChannel;
  fileParts: ArrayBuffer[];
  incomingFile?: { name: string; type: string };
  senders: Partial<Record<TrackKind, RTCRtpSender>>;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingCandidates: Array<RTCIceCandidateInit | null>;
  signalQueue: Promise<void>;
};

/**
 * A room-scoped WebRTC mesh implementing "perfect negotiation" (the pattern MDN/W3C
 * recommend for exactly this class of bug): every track change — including one that
 * arrives well after the initial offer/answer, such as a camera stream that only
 * resolves once a real permission prompt is dismissed — triggers its own renegotiation
 * via `onnegotiationneeded` instead of only being signaled once at connection setup.
 * Without this, a track added after the first negotiation round is silently never
 * described to the remote peer: the sender has it, but the peer's video/audio never
 * shows anything, because nothing ever tells them a track was added.
 */
export class PeerMesh {
  private readonly peers = new Map<string, Peer>();
  private stream?: MediaStream;

  constructor(private readonly options: PeerMeshOptions) {}

  /** Pass null to stop publishing local media (e.g. after a screen share ends) without tearing down peers. */
  setLocalStream(stream: MediaStream | null) {
    this.stream = stream ?? undefined;
    for (const peer of this.peers.values()) this.applyStream(peer);
  }

  async connect(peerId: string, initiator: boolean) {
    const peer = this.ensurePeer(peerId);
    if (!initiator) return;
    // Creating the data channel (like adding a track) triggers onnegotiationneeded,
    // which is what actually sends the first offer — no explicit offer here.
    peer.channel ??= this.configureChannel(peerId, peer.connection.createDataChannel("threadline-files"));
  }

  async receiveSignal(peerId: string, signal: SignalPayload) {
    const peer = this.ensurePeer(peerId);
    // WebSocket messages arrive in order, but their async WebRTC operations do not
    // unless we explicitly serialize them. Without this queue, addIceCandidate can
    // run while an earlier setRemoteDescription is still pending and the candidate
    // is permanently lost.
    peer.signalQueue = peer.signalQueue
      .then(() => this.applySignal(peerId, peer, signal))
      .catch(() => {
        // One malformed/stale signal must not poison the queue for every signal that
        // follows it. A failed connection also gets an ICE restart below.
      });
    return peer.signalQueue;
  }

  /** A stable, symmetric tie-break — exactly one side is polite for any given pair. */
  private isPolite(peerId: string) {
    return this.options.getLocalId() > peerId;
  }

  async sendFile(file: File) {
    const candidates = [...this.peers.values()];
    await Promise.all(candidates.map((peer) => this.waitForOpenChannel(peer)));
    const recipients = candidates.filter((peer) => peer.channel?.readyState === "open");
    if (!recipients.length) return 0;
    const chunkSize = 16 * 1024;
    const header = JSON.stringify({ kind: "file-header", name: file.name, type: file.type, size: file.size });
    for (const peer of recipients) peer.channel?.send(header);
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const chunk = await file.slice(offset, Math.min(offset + chunkSize, file.size)).arrayBuffer();
      for (const peer of recipients) peer.channel?.send(chunk);
    }
    for (const peer of recipients) peer.channel?.send(JSON.stringify({ kind: "file-end" }));
    return recipients.length;
  }

  close() {
    for (const peer of this.peers.values()) peer.connection.close();
    this.peers.clear();
  }

  disconnect(peerId: string) {
    this.peers.get(peerId)?.connection.close();
    this.peers.delete(peerId);
  }

  private ensurePeer(peerId: string) {
    const existing = this.peers.get(peerId);
    if (existing) return existing;
    const connection = new RTCPeerConnection({
      iceServers: this.options.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const peer: Peer = {
      connection,
      fileParts: [],
      senders: {},
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      pendingCandidates: [],
      signalQueue: Promise.resolve(),
    };
    connection.onicecandidate = (event) => {
      if (event.candidate) this.options.sendSignal(peerId, { candidate: event.candidate.toJSON() });
    };
    connection.ontrack = (event) => this.options.onRemoteStream(peerId, event.streams[0]);
    connection.ondatachannel = (event) => {
      peer.channel = this.configureChannel(peerId, event.channel);
    };
    connection.onconnectionstatechange = () => {
      // A transient "disconnected" state often heals by itself. "failed" does not,
      // so ask the browser for fresh ICE candidates and let perfect negotiation send
      // the restart offer rather than leaving media and files dead forever.
      if (connection.connectionState === "failed") connection.restartIce();
    };
    // Fires whenever a track or data channel is added/removed, at ANY point in this
    // connection's life — not just at initial setup. This is what actually lets a
    // camera stream that resolves seconds after the peer connection already exists
    // (a real getUserMedia() permission prompt, not a fake instantly-resolved stream)
    // still reach the other side.
    connection.onnegotiationneeded = () => {
      void (async () => {
        try {
          peer.makingOffer = true;
          // With no argument the browser creates the correct offer (or answer) for
          // the current signaling state, including offers requested by restartIce().
          await connection.setLocalDescription();
          this.options.sendSignal(peerId, { description: connection.localDescription?.toJSON() });
        } catch {
          // Ignore — a later negotiationneeded event or a signal from the remote peer
          // will retry rather than leaving the connection in a broken state.
        } finally {
          peer.makingOffer = false;
        }
      })();
    };
    this.applyStream(peer);
    this.peers.set(peerId, peer);
    return peer;
  }

  private async applySignal(peerId: string, peer: Peer, signal: SignalPayload) {
    const { connection } = peer;
    if (signal.description) {
      const readyForOffer =
        !peer.makingOffer && (connection.signalingState === "stable" || peer.isSettingRemoteAnswerPending);
      const offerCollision = signal.description.type === "offer" && !readyForOffer;

      // Exactly one side is polite. The impolite side keeps its own offer during
      // glare; the polite side accepts the incoming offer and the browser performs
      // the required rollback as part of setRemoteDescription.
      peer.ignoreOffer = !this.isPolite(peerId) && offerCollision;
      if (peer.ignoreOffer) return;

      peer.isSettingRemoteAnswerPending = signal.description.type === "answer";
      try {
        await connection.setRemoteDescription(signal.description);
      } finally {
        peer.isSettingRemoteAnswerPending = false;
      }

      for (const candidate of peer.pendingCandidates.splice(0)) await connection.addIceCandidate(candidate);

      if (signal.description.type === "offer") {
        await connection.setLocalDescription();
        this.options.sendSignal(peerId, { description: connection.localDescription?.toJSON() });
      }
    }

    if (Object.prototype.hasOwnProperty.call(signal, "candidate")) {
      const candidate = signal.candidate ?? null;
      if (peer.ignoreOffer) return;
      if (!connection.remoteDescription) {
        peer.pendingCandidates.push(candidate);
        return;
      }
      await connection.addIceCandidate(candidate);
    }
  }

  /**
   * Publishes the current local stream to one peer, kind by kind. Reuses each
   * sender's own slot rather than matching by `sender.track` so a track can be
   * swapped (camera <-> screen) or cleared (`replaceTrack(null)`) without
   * renegotiation, and so a later stream change can still find that sender
   * after its track has gone null.
   */
  private applyStream(peer: Peer) {
    for (const kind of trackKinds) {
      const track = this.stream?.getTracks().find((item) => item.kind === kind) ?? null;
      const sender = peer.senders[kind];
      if (sender) {
        if (sender.track !== track) void sender.replaceTrack(track);
      } else if (track && this.stream) {
        peer.senders[kind] = peer.connection.addTrack(track, this.stream);
      }
    }
  }

  private configureChannel(peerId: string, channel: RTCDataChannel) {
    channel.binaryType = "arraybuffer";
    channel.onmessage = (event) => {
      if (typeof event.data === "string") {
        const metadata = JSON.parse(event.data) as { kind: string; name?: string; type?: string };
        if (metadata.kind === "file-header") {
          const peer = this.peers.get(peerId);
          if (peer) {
            peer.fileParts.splice(0);
            peer.incomingFile = {
              name: metadata.name ?? "shared-file",
              type: metadata.type ?? "application/octet-stream",
            };
          }
        }
        if (metadata.kind === "file-end") {
          const peer = this.peers.get(peerId);
          const file = new File(peer?.fileParts ?? [], peer?.incomingFile?.name ?? "shared-file", {
            type: peer?.incomingFile?.type ?? "application/octet-stream",
          });
          this.options.onFile(peerId, file);
        }
      } else if (event.data instanceof ArrayBuffer) {
        this.peers.get(peerId)?.fileParts.push(event.data);
      }
    };
    return channel;
  }

  private waitForOpenChannel(peer: Peer, timeoutMs = 15_000) {
    if (peer.channel?.readyState === "open") return Promise.resolve();
    return new Promise<void>((resolve) => {
      const finish = () => {
        window.clearTimeout(timer);
        window.clearInterval(channelTimer);
        resolve();
      };
      const timer = window.setTimeout(finish, timeoutMs);
      const channelTimer = window.setInterval(() => {
        const channel = peer.channel;
        if (!channel || channel.readyState !== "open") return;
        finish();
      }, 50);
    });
  }
}
