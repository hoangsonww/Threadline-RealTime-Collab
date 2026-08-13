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

  constructor() {
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

  async addIceCandidate() {
    this.events.push("candidate");
  }

  restartIce() {
    this.events.push("restart");
  }

  close() {
    this.events.push("close");
  }

  addTrack() {
    throw new Error("No media is installed in this unit test.");
  }

  createDataChannel() {
    throw new Error("No data channel is installed in this unit test.");
  }
}

describe("PeerMesh signaling", () => {
  beforeEach(() => {
    FakePeerConnection.instances = [];
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  });

  afterEach(() => vi.unstubAllGlobals());

  const createMesh = () =>
    new PeerMesh({
      sendSignal: vi.fn(),
      onRemoteStream: vi.fn(),
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
    expect(connection.events).toEqual(["remote:start", "remote:end", "local", "candidate"]);
  });

  it("holds an early ICE candidate until a description is installed", async () => {
    const mesh = createMesh();
    await mesh.receiveSignal("a-peer", { candidate: { candidate: "candidate:early" } });
    const connection = FakePeerConnection.instances[0];

    expect(connection.events).toEqual([]);
    await mesh.receiveSignal("a-peer", { description: { type: "offer", sdp: "remote" } });
    expect(connection.events).toEqual(["remote:start", "remote:end", "candidate", "local"]);
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
