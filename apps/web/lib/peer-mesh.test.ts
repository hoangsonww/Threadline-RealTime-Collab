import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PeerMesh } from "./peer-mesh";

type Deferred = { promise: Promise<void>; resolve: () => void };

const deferred = (): Deferred => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription = {
    type: "answer",
    sdp: "local",
    toJSON: () => ({ type: "answer", sdp: "local" }),
  } as RTCSessionDescription;
  onicecandidate: RTCPeerConnection["onicecandidate"] = null;
  ontrack: RTCPeerConnection["ontrack"] = null;
  ondatachannel: RTCPeerConnection["ondatachannel"] = null;
  onconnectionstatechange: RTCPeerConnection["onconnectionstatechange"] = null;
  onnegotiationneeded: RTCPeerConnection["onnegotiationneeded"] = null;
  events: string[] = [];
  remoteDescriptionGate?: Deferred;
  failCandidates = new Set<string>();
  readonly configuration?: RTCConfiguration;
  senders: Array<{ track: MediaStreamTrack | null; replaceTrack: ReturnType<typeof vi.fn> }> = [];

  constructor(configuration?: RTCConfiguration) {
    this.configuration = configuration;
    FakePeerConnection.instances.push(this);
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.events.push("remote:start");
    await this.remoteDescriptionGate?.promise;
    this.remoteDescription = description;
    this.events.push("remote:end");
  }

  async setLocalDescription() {
    this.events.push("local");
  }

  async addIceCandidate(candidate?: RTCIceCandidateInit | null) {
    const value = candidate?.candidate ?? "end";
    this.events.push(`candidate:${value}`);
    if (this.failCandidates.has(value)) throw new Error(`Rejected ${value}`);
  }

  restartIce() {
    this.events.push("restart");
  }

  close() {
    this.events.push("close");
  }

  addTrack(track: MediaStreamTrack) {
    const sender: { track: MediaStreamTrack | null; replaceTrack: ReturnType<typeof vi.fn> } = {
      track,
      replaceTrack: vi.fn(async (replacement: MediaStreamTrack | null) => {
        sender.track = replacement;
      }),
    };
    this.senders.push(sender);
    this.events.push(`add:${track.id}`);
    return sender as unknown as RTCRtpSender;
  }

  removeTrack(sender: RTCRtpSender) {
    this.events.push(`remove:${sender.track?.id}`);
    this.senders = this.senders.filter((item) => item !== (sender as unknown));
  }

  createDataChannel() {
    throw new Error("No data channel is installed in this unit test.");
  }
}

describe("PeerMesh signaling", () => {
  beforeEach(() => {
    FakePeerConnection.instances = [];
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    vi.stubGlobal(
      "MediaStream",
      class {
        readonly id = crypto.randomUUID();
        private tracks: MediaStreamTrack[];
        constructor(tracks: MediaStreamTrack[] = []) {
          this.tracks = [...tracks];
        }
        getTracks() {
          return [...this.tracks];
        }
        addTrack(track: MediaStreamTrack) {
          this.tracks.push(track);
        }
        removeTrack(track: MediaStreamTrack) {
          this.tracks = this.tracks.filter((item) => item !== track);
        }
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  const createMesh = () =>
    new PeerMesh({
      sendSignal: vi.fn(),
      onRemoteMedia: vi.fn(),
      onFile: vi.fn(),
      getLocalId: () => "z-local-user",
    });

  it("serializes candidates behind an in-flight remote description", async () => {
    const mesh = createMesh();
    await mesh.connect("a-peer", false);
    const connection = FakePeerConnection.instances[0];
    connection.remoteDescriptionGate = deferred();

    const description = mesh.receiveSignal("a-peer", { description: { type: "offer", sdp: "remote" } });
    await Promise.resolve();
    const candidate = mesh.receiveSignal("a-peer", { candidate: { candidate: "candidate:1" } });
    await Promise.resolve();

    expect(connection.events).toEqual(["remote:start"]);
    connection.remoteDescriptionGate.resolve();
    await Promise.all([description, candidate]);
    expect(connection.events).toEqual(["remote:start", "remote:end", "local", "candidate:candidate:1"]);
  });

  it("holds an early ICE candidate until a description is installed", async () => {
    const mesh = createMesh();
    await mesh.receiveSignal("a-peer", { candidate: { candidate: "candidate:early" } });
    const connection = FakePeerConnection.instances[0];

    expect(connection.events).toEqual([]);
    await mesh.receiveSignal("a-peer", { description: { type: "offer", sdp: "remote" } });
    expect(connection.events).toEqual(["remote:start", "remote:end", "candidate:candidate:early", "local"]);
  });

  it("passes configured TURN servers into every peer connection", async () => {
    const iceServers: RTCIceServer[] = [
      { urls: ["stun:stun.example.test:3478"] },
      { urls: ["turns:turn.example.test:5349"], username: "temporary-user", credential: "temporary-secret" },
    ];
    const mesh = new PeerMesh({
      sendSignal: vi.fn(),
      onRemoteMedia: vi.fn(),
      onFile: vi.fn(),
      getLocalId: () => "z-local-user",
      iceServers,
    });

    await mesh.connect("a-peer", false);
    expect(FakePeerConnection.instances[0].configuration?.iceServers).toEqual(iceServers);
  });

  it("continues flushing queued candidates after one candidate is rejected", async () => {
    const mesh = createMesh();
    await mesh.receiveSignal("a-peer", { candidate: { candidate: "bad" } });
    await mesh.receiveSignal("a-peer", { candidate: { candidate: "good" } });
    const connection = FakePeerConnection.instances[0];
    connection.failCandidates.add("bad");

    await mesh.receiveSignal("a-peer", { description: { type: "offer", sdp: "remote" } });
    expect(connection.events).toEqual(["remote:start", "remote:end", "candidate:bad", "candidate:good", "local"]);
  });

  it("publishes camera and screen simultaneously and removes camera immediately", async () => {
    const sendSignal = vi.fn();
    const mesh = new PeerMesh({
      sendSignal,
      onRemoteMedia: vi.fn(),
      onFile: vi.fn(),
      getLocalId: () => "z-local-user",
    });
    const camera = { id: "camera-track", kind: "video" } as MediaStreamTrack;
    const screen = { id: "screen-track", kind: "video" } as MediaStreamTrack;

    mesh.setLocalTracks({ camera, screen });
    await mesh.connect("a-peer", false);
    const connection = FakePeerConnection.instances[0];

    expect(connection.events).toEqual(["add:camera-track", "add:screen-track"]);
    expect(sendSignal).toHaveBeenLastCalledWith("a-peer", {
      mediaSources: { camera: "camera-track", screen: "screen-track" },
    });

    mesh.setLocalTracks({ screen });
    expect(connection.events).toContain("remove:camera-track");
    expect(connection.senders.map((sender) => sender.track?.id)).toEqual(["screen-track"]);
    expect(sendSignal).toHaveBeenLastCalledWith("a-peer", { mediaSources: { screen: "screen-track" } });
  });

  it("requests a fresh ICE negotiation after the connection fails", async () => {
    const mesh = createMesh();
    await mesh.connect("a-peer", false);
    const connection = FakePeerConnection.instances[0];

    connection.connectionState = "failed";
    connection.onconnectionstatechange?.call(
      connection as unknown as RTCPeerConnection,
      new Event("connectionstatechange"),
    );
    expect(connection.events).toContain("restart");
  });

  it("forgets a departed peer so the same user can reconnect cleanly", async () => {
    const mesh = createMesh();
    await mesh.connect("a-peer", false);
    const firstConnection = FakePeerConnection.instances[0];

    mesh.disconnect("a-peer");
    await mesh.connect("a-peer", false);

    expect(firstConnection.events).toContain("close");
    expect(FakePeerConnection.instances).toHaveLength(2);
  });
});
