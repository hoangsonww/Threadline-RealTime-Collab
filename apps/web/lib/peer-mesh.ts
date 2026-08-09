export type SignalPayload = {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
};

type PeerMeshOptions = {
  sendSignal: (peerId: string, payload: SignalPayload) => void;
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onFile: (peerId: string, file: File) => void;
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
};

/** A room-scoped, perfect-negotiation-friendly WebRTC mesh. Durable Objects only relay its signals. */
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
    peer.channel ??= this.configureChannel(peerId, peer.connection.createDataChannel("threadline-files"));
    const offer = await peer.connection.createOffer();
    await peer.connection.setLocalDescription(offer);
    this.options.sendSignal(peerId, { description: peer.connection.localDescription?.toJSON() });
  }

  async receiveSignal(peerId: string, signal: SignalPayload) {
    const peer = this.ensurePeer(peerId);
    if (signal.candidate) await peer.connection.addIceCandidate(signal.candidate);
    if (!signal.description) return;
    await peer.connection.setRemoteDescription(signal.description);
    if (signal.description.type === "offer") {
      const answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);
      this.options.sendSignal(peerId, { description: peer.connection.localDescription?.toJSON() });
    }
  }

  async sendFile(file: File) {
    const chunkSize = 16 * 1024;
    const header = JSON.stringify({ kind: "file-header", name: file.name, type: file.type, size: file.size });
    for (const peer of this.peers.values()) {
      if (peer.channel?.readyState === "open") peer.channel.send(header);
    }
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const chunk = await file.slice(offset, Math.min(offset + chunkSize, file.size)).arrayBuffer();
      for (const peer of this.peers.values()) {
        if (peer.channel?.readyState === "open") peer.channel.send(chunk);
      }
    }
    for (const peer of this.peers.values()) {
      if (peer.channel?.readyState === "open") peer.channel.send(JSON.stringify({ kind: "file-end" }));
    }
  }

  close() {
    for (const peer of this.peers.values()) peer.connection.close();
    this.peers.clear();
  }

  private ensurePeer(peerId: string) {
    const existing = this.peers.get(peerId);
    if (existing) return existing;
    const connection = new RTCPeerConnection({
      iceServers: this.options.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const peer: Peer = { connection, fileParts: [], senders: {} };
    connection.onicecandidate = (event) => {
      if (event.candidate) this.options.sendSignal(peerId, { candidate: event.candidate.toJSON() });
    };
    connection.ontrack = (event) => this.options.onRemoteStream(peerId, event.streams[0]);
    connection.ondatachannel = (event) => {
      peer.channel = this.configureChannel(peerId, event.channel);
    };
    this.applyStream(peer);
    this.peers.set(peerId, peer);
    return peer;
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
}
