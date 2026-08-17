/**
 * The WebRTC peer mesh.
 *
 * Threadline connects every participant to every other participant directly
 * rather than routing media through a selective forwarding unit. That decision,
 * and the participant count at which it stops being the right one, is recorded
 * in [ADR 0002](../../../docs/decisions/0002-webrtc-mesh-not-sfu.md).
 *
 * Media never touches Threadline's infrastructure on this path — the realtime
 * tier carries signalling only, and the only server involvement in media at all
 * is TURN relay for participants whose networks refuse a direct connection.
 *
 * @module
 */

/**
 * One signalling message between two peers.
 *
 * Relayed verbatim by the realtime tier, which does not interpret it. The
 * `mediaSources` map travels alongside the SDP because a track's identity says
 * nothing about which slot it belongs to — a camera track and a screen track
 * are indistinguishable to the receiver without it.
 */
export type SignalPayload = {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
  mediaSources?: Partial<Record<MediaSlot, string>>;
};

/** The three media roles a participant can publish. Each is independently toggleable. */
export type MediaSlot = "microphone" | "camera" | "screen";
/** The local tracks currently being published, by slot. */
export type LocalMediaTracks = Partial<Record<MediaSlot, MediaStreamTrack>>;
/** A remote participant's incoming streams, by slot. */
export type RemoteMedia = Partial<Record<MediaSlot, MediaStream>>;

/** Everything the mesh needs from its host component. */
export type PeerMeshOptions = {
  sendSignal: (peerId: string, payload: SignalPayload) => void;
  onRemoteMedia: (peerId: string, media: RemoteMedia) => void;
  onFile: (peerId: string, file: File) => void;
  /** Read at signaling time (not just once), since it's only known after room.ready arrives. */
  getLocalId: () => string;
  iceServers?: RTCIceServer[];
};

const mediaSlots: MediaSlot[] = ["microphone", "camera", "screen"];

type Peer = {
  connection: RTCPeerConnection;
  channel?: RTCDataChannel;
  fileParts: ArrayBuffer[];
  incomingFile?: { name: string; type: string };
  senders: Partial<Record<MediaSlot, RTCRtpSender>>;
  remoteTracks: Map<string, MediaStreamTrack>;
  remoteSources: Partial<Record<MediaSlot, string>>;
  hasRemoteSourceMetadata: boolean;
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
  private localTracks: LocalMediaTracks = {};
  private localStream?: MediaStream;

  constructor(private readonly options: PeerMeshOptions) {}

  /** Camera, microphone, and screen are independent senders and may coexist. */
  setLocalTracks(tracks: LocalMediaTracks) {
    this.localTracks = tracks;
    this.localStream ??= new MediaStream();
    const activeTracks = new Set(
      Object.values(tracks).filter((track): track is MediaStreamTrack => track !== undefined),
    );
    for (const track of this.localStream.getTracks()) {
      if (!activeTracks.has(track)) this.localStream.removeTrack(track);
    }
    for (const track of activeTracks) {
      if (!this.localStream.getTracks().includes(track)) this.localStream.addTrack(track);
    }
    for (const [peerId, peer] of this.peers) {
      this.applyLocalTracks(peer);
      this.sendMediaSources(peerId);
    }
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
      remoteTracks: new Map(),
      remoteSources: {},
      hasRemoteSourceMetadata: false,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      pendingCandidates: [],
      signalQueue: Promise.resolve(),
    };
    connection.onicecandidate = (event) => {
      if (event.candidate) this.options.sendSignal(peerId, { candidate: event.candidate.toJSON() });
    };
    connection.ontrack = (event) => {
      peer.remoteTracks.set(event.track.id, event.track);
      const notify = () => this.notifyRemoteMedia(peerId, peer);
      event.track.addEventListener("ended", notify);
      notify();
    };
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
    this.applyLocalTracks(peer);
    this.peers.set(peerId, peer);
    this.sendMediaSources(peerId);
    return peer;
  }

  private async applySignal(peerId: string, peer: Peer, signal: SignalPayload) {
    const { connection } = peer;
    if (Object.prototype.hasOwnProperty.call(signal, "mediaSources")) {
      peer.remoteSources = signal.mediaSources ?? {};
      peer.hasRemoteSourceMetadata = true;
      this.notifyRemoteMedia(peerId, peer);
    }
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

      let pendingCandidateError: unknown;
      for (const candidate of peer.pendingCandidates.splice(0)) {
        try {
          await connection.addIceCandidate(candidate);
        } catch (error) {
          // Keep processing: one obsolete candidate must not discard every later
          // candidate that was queued behind the remote description.
          if (!peer.ignoreOffer && pendingCandidateError === undefined) pendingCandidateError = error;
        }
      }
      if (signal.description.type === "offer") {
        await connection.setLocalDescription();
        this.options.sendSignal(peerId, { description: connection.localDescription?.toJSON() });
      }
      if (pendingCandidateError !== undefined) throw pendingCandidateError;
    }

    if (Object.prototype.hasOwnProperty.call(signal, "candidate")) {
      const candidate = signal.candidate ?? null;
      if (!connection.remoteDescription) {
        if (peer.ignoreOffer) {
          try {
            await connection.addIceCandidate(candidate);
          } catch {
            // This candidate belongs to the colliding offer the impolite side
            // intentionally ignored. That specific add failure is expected.
          }
          return;
        }
        peer.pendingCandidates.push(candidate);
        return;
      }
      try {
        await connection.addIceCandidate(candidate);
      } catch (error) {
        if (!peer.ignoreOffer) throw error;
      }
    }
  }

  private applyLocalTracks(peer: Peer) {
    for (const slot of mediaSlots) {
      const track = this.localTracks[slot];
      const sender = peer.senders[slot];
      if (sender) {
        if (!track) {
          peer.connection.removeTrack(sender);
          delete peer.senders[slot];
        } else if (sender.track !== track) {
          void sender.replaceTrack(track);
        }
      } else if (track && this.localStream) {
        peer.senders[slot] = peer.connection.addTrack(track, this.localStream);
      }
    }
  }

  private sendMediaSources(peerId: string) {
    this.options.sendSignal(peerId, {
      mediaSources: Object.fromEntries(
        mediaSlots.flatMap((slot) => (this.localTracks[slot] ? [[slot, this.localTracks[slot].id]] : [])),
      ),
    });
  }

  private notifyRemoteMedia(peerId: string, peer: Peer) {
    const media: RemoteMedia = {};
    for (const slot of mediaSlots) {
      const trackId = peer.remoteSources[slot];
      const track = trackId ? peer.remoteTracks.get(trackId) : undefined;
      if (track && track.readyState !== "ended") media[slot] = new MediaStream([track]);
    }
    // During a rolling web deployment, an already-open older client does not send
    // mediaSources metadata. It can only publish one video, so this fallback keeps
    // that camera/audio visible until the tab refreshes onto the new protocol.
    if (!peer.hasRemoteSourceMetadata) {
      const tracks = [...peer.remoteTracks.values()].filter((track) => track.readyState !== "ended");
      const audio = tracks.find((track) => track.kind === "audio");
      const videos = tracks.filter((track) => track.kind === "video");
      if (audio) media.microphone = new MediaStream([audio]);
      if (videos[0]) media.camera = new MediaStream([videos[0]]);
      if (videos[1]) media.screen = new MediaStream([videos[1]]);
    }
    this.options.onRemoteMedia(peerId, media);
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
