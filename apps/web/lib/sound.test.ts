import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type GainEvent = { kind: "set" | "ramp"; value: number; time: number };

class FakeParam {
  events: GainEvent[] = [];
  value = 0;
  setValueAtTime(value: number, time: number) {
    this.events.push({ kind: "set", value, time });
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: "ramp", value, time });
  }
}

class FakeNode {
  connections: FakeNode[] = [];
  disconnected = false;
  connect(target: FakeNode) {
    this.connections.push(target);
    return target;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  static instances: FakeOscillator[] = [];
  type: OscillatorType = "sine";
  frequency = new FakeParam();
  startedAt?: number;
  stoppedAt?: number;
  onended: (() => void) | null = null;
  constructor() {
    super();
    FakeOscillator.instances.push(this);
  }
  start(time: number) {
    this.startedAt = time;
  }
  stop(time: number) {
    this.stoppedAt = time;
    this.onended?.();
  }
}

class FakeFilter extends FakeNode {
  type = "";
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  state: AudioContextState = "running";
  destination = new FakeNode();
  resumeCalls = 0;
  gains: FakeGain[] = [];
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume() {
    this.resumeCalls += 1;
    this.state = "running";
    return Promise.resolve();
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createOscillator() {
    return new FakeOscillator();
  }
  createBiquadFilter() {
    return new FakeFilter();
  }
}

const store = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

const installBrowser = () => {
  store.clear();
  listeners.clear();
  FakeOscillator.instances = [];
  FakeAudioContext.instances = [];
  const fakeWindow = {
    AudioContext: FakeAudioContext,
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    addEventListener: (type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => void listeners.get(type)?.delete(listener),
    dispatchEvent: (event: { type: string }) => {
      listeners.get(event.type)?.forEach((listener) => listener());
      return true;
    },
  };
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal(
    "Event",
    class {
      constructor(readonly type: string) {}
    },
  );
};

// The module keeps the audio context and the resolved preference in module
// scope, so every test needs its own instance of it.
const loadSound = async () => {
  vi.resetModules();
  return import("./sound");
};

describe("interface sound feedback", () => {
  beforeEach(installBrowser);
  afterEach(() => vi.unstubAllGlobals());

  it("plays nothing, and builds no audio graph at all, while sound is off", async () => {
    const { playSound, setSoundEnabled } = await loadSound();
    setSoundEnabled(false);

    playSound("join");
    playSound("error");

    // Not merely silent — a muted client should never construct an AudioContext,
    // which browsers count against the per-page limit and which keeps hardware
    // awake on some platforms.
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(FakeOscillator.instances).toHaveLength(0);
    expect(store.get("threadline-sound")).toBe("off");
  });

  it("is on by default so the first call a person joins already has feedback", async () => {
    const { isSoundEnabled, playSound } = await loadSound();

    expect(isSoundEnabled()).toBe(true);
    playSound("join");
    expect(FakeOscillator.instances.length).toBeGreaterThan(0);
  });

  it("ramps every envelope instead of switching it, so no cue starts with a click", async () => {
    const { playSound } = await loadSound();

    playSound("join");

    const context = FakeAudioContext.instances[0];
    // Envelopes are the only gains that schedule automation — the master and the
    // per-voice mix gains just take a static value.
    const envelopes = context.gains.filter((gain) => gain.gain.events.length > 0);
    expect(envelopes.length).toBeGreaterThan(0);
    for (const envelope of envelopes) {
      const [opening, attack, release] = envelope.gain.events;
      // Opens from effectively zero, ramps up, then ramps back down: a bare
      // setValueAtTime straight to the peak is what puts a click on the front.
      expect(opening).toMatchObject({ kind: "set" });
      expect(opening.value).toBeLessThan(0.001);
      expect(attack).toMatchObject({ kind: "ramp" });
      expect(attack.value).toBeGreaterThan(opening.value);
      expect(release).toMatchObject({ kind: "ramp" });
      expect(release.value).toBeLessThan(attack.value);
      expect(release.time).toBeGreaterThan(attack.time);
    }
  });

  it("collapses a burst of the same cue but lets different cues through", async () => {
    const { playSound } = await loadSound();

    playSound("peerJoin");
    const afterFirst = FakeOscillator.instances.length;
    for (let repeat = 0; repeat < 10; repeat += 1) playSound("peerJoin");
    expect(FakeOscillator.instances).toHaveLength(afterFirst);

    // Ten people leaving at once should still be distinguishable from one
    // arriving, so suppression is per cue rather than global.
    playSound("peerLeave");
    expect(FakeOscillator.instances.length).toBeGreaterThan(afterFirst);
  });

  it("retries resume() on a context the browser suspended before a user gesture", async () => {
    const { playSound } = await loadSound();

    playSound("join");
    const context = FakeAudioContext.instances[0];
    expect(FakeAudioContext.instances).toHaveLength(1);

    context.state = "suspended";
    playSound("leave");

    // Same context, resumed rather than replaced — autoplay policy rejects
    // resume() outside a gesture, so the retry is what recovers it.
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(context.resumeCalls).toBe(1);
  });

  it("persists the preference and notifies subscribers when it changes", async () => {
    const { onSoundPreferenceChange, isSoundEnabled, setSoundEnabled } = await loadSound();
    const seen: boolean[] = [];
    const stop = onSoundPreferenceChange(() => seen.push(isSoundEnabled()));

    setSoundEnabled(false);
    setSoundEnabled(true);
    stop();
    setSoundEnabled(false);

    expect(seen).toEqual([false, true]);
    expect(store.get("threadline-sound")).toBe("off");
  });

  it("reads a stored 'off' preference back on the next load", async () => {
    store.set("threadline-sound", "off");
    const { isSoundEnabled, playSound } = await loadSound();

    expect(isSoundEnabled()).toBe(false);
    playSound("join");
    expect(FakeAudioContext.instances).toHaveLength(0);
  });
});
