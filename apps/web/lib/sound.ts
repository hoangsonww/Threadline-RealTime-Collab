/**
 * Interface sound feedback.
 *
 * The cues are synthesised through the Web Audio API rather than shipped as
 * audio files. That is a deliberate trade: a dozen short cues as files would be
 * a few hundred KB of binary assets carrying their own licences, and every one
 * of them would need a network round trip before the first mute click could be
 * heard. Synthesised, the whole palette is a table of frequencies, it is silent
 * until something actually happens, and the character of a cue can be tuned by
 * editing a number instead of re-cutting a WAV.
 *
 * The palette is built from one interval set (a major pentatonic) so cues sound
 * related rather than arbitrary, and every cue is paired: whatever rises to turn
 * something on falls to turn it back off.
 */

/** Every cue in the palette. Each one has a paired opposite — see the module note above. */
export type SoundName =
  | "join"
  | "leave"
  | "peerJoin"
  | "peerLeave"
  | "micOn"
  | "micOff"
  | "cameraOn"
  | "cameraOff"
  | "shareStart"
  | "shareStop"
  | "messageSent"
  | "messageReceived"
  | "success"
  | "error";

type Tone = {
  /** Seconds after the cue begins. */
  at: number;
  frequency: number;
  /** Seconds until this tone has decayed to silence. */
  duration: number;
  /** Peak level relative to the cue's own level. */
  level?: number;
  type?: OscillatorType;
};

type Sound = { level: number; tones: Tone[] };

// D major pentatonic, so every cue is consonant with every other one.
const D5 = 587.33;
const E5 = 659.25;
const A5 = 880;
const B5 = 987.77;
const D6 = 1174.66;
const Fs5 = 739.99;
const A4 = 440;
const Fs4 = 369.99;
const D4 = 293.66;

const soundLibrary: Record<SoundName, Sound> = {
  // You arriving and leaving are the two most consequential events in a room, so
  // they are the only three-note cues — long enough to read as a statement.
  join: {
    level: 0.5,
    tones: [
      { at: 0, frequency: D5, duration: 0.16 },
      { at: 0.08, frequency: Fs5, duration: 0.18 },
      { at: 0.16, frequency: A5, duration: 0.34 },
    ],
  },
  leave: {
    level: 0.44,
    tones: [
      { at: 0, frequency: A5, duration: 0.14 },
      { at: 0.08, frequency: Fs5, duration: 0.16 },
      { at: 0.16, frequency: D5, duration: 0.36 },
    ],
  },
  // Someone else arriving is information, not a decision you made — quieter, and
  // a narrower interval so it stays out of the way of conversation.
  peerJoin: {
    level: 0.26,
    tones: [
      { at: 0, frequency: Fs5, duration: 0.11 },
      { at: 0.07, frequency: B5, duration: 0.2 },
    ],
  },
  peerLeave: {
    level: 0.24,
    tones: [
      { at: 0, frequency: B5, duration: 0.11 },
      { at: 0.07, frequency: Fs5, duration: 0.22 },
    ],
  },
  micOn: { level: 0.34, tones: [{ at: 0, frequency: A5, duration: 0.11 }] },
  micOff: { level: 0.32, tones: [{ at: 0, frequency: E5, duration: 0.13 }] },
  cameraOn: {
    level: 0.32,
    tones: [
      { at: 0, frequency: E5, duration: 0.08 },
      { at: 0.05, frequency: B5, duration: 0.16 },
    ],
  },
  cameraOff: {
    level: 0.3,
    tones: [
      { at: 0, frequency: B5, duration: 0.08 },
      { at: 0.05, frequency: E5, duration: 0.18 },
    ],
  },
  shareStart: {
    level: 0.34,
    tones: [
      { at: 0, frequency: D5, duration: 0.09 },
      { at: 0.06, frequency: A5, duration: 0.11 },
      { at: 0.12, frequency: D6, duration: 0.24 },
    ],
  },
  shareStop: {
    level: 0.3,
    tones: [
      { at: 0, frequency: D6, duration: 0.09 },
      { at: 0.06, frequency: A5, duration: 0.11 },
      { at: 0.12, frequency: D5, duration: 0.26 },
    ],
  },
  // Sending is something you already know you did; the cue only has to confirm,
  // so it is the quietest and shortest thing in the palette.
  messageSent: { level: 0.18, tones: [{ at: 0, frequency: D6, duration: 0.07 }] },
  messageReceived: {
    level: 0.28,
    tones: [
      { at: 0, frequency: A5, duration: 0.08 },
      { at: 0.06, frequency: D6, duration: 0.18 },
    ],
  },
  success: {
    level: 0.36,
    tones: [
      { at: 0, frequency: Fs5, duration: 0.1 },
      { at: 0.07, frequency: A5, duration: 0.1 },
      { at: 0.14, frequency: D6, duration: 0.26 },
    ],
  },
  // The only cue that leaves the pentatonic: two low notes a tone apart, whose
  // beating is meant to sound unresolved rather than musical.
  error: {
    level: 0.34,
    tones: [
      { at: 0, frequency: Fs4, duration: 0.16, type: "triangle" },
      { at: 0.1, frequency: D4, duration: 0.3, type: "triangle" },
      { at: 0.1, frequency: A4 * 0.66, duration: 0.3, level: 0.5, type: "triangle" },
    ],
  },
};

const preferenceKey = "threadline-sound";
const preferenceChangedEvent = "threadline:sound-preference";
/** Repeats of the same cue inside this window are dropped, so bursts don't machine-gun. */
const repeatSuppressionMs = 90;
/**
 * Chosen by rendering the palette offline and measuring it: the loudest cue
 * lands near -15 dBFS peak, which is audible over a call without competing with
 * speech, and leaves the quietest cue (a sent message) around -24 dBFS.
 */
const masterLevel = 0.3;

let audioContext: AudioContext | undefined;
let masterGain: GainNode | undefined;
let enabled: boolean | undefined;
const lastPlayedAt = new Map<SoundName, number>();

export function isSoundEnabled() {
  if (typeof window === "undefined") return false;
  // Sound is on unless it was explicitly turned off, so the feedback is there
  // the first time someone joins a call rather than waiting to be discovered.
  if (enabled === undefined) enabled = window.localStorage.getItem(preferenceKey) !== "off";
  return enabled;
}

export function setSoundEnabled(next: boolean) {
  if (typeof window === "undefined") return;
  enabled = next;
  window.localStorage.setItem(preferenceKey, next ? "on" : "off");
  window.dispatchEvent(new Event(preferenceChangedEvent));
}

export function onSoundPreferenceChange(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(preferenceChangedEvent, listener);
  return () => window.removeEventListener(preferenceChangedEvent, listener);
}

function ensureContext() {
  if (typeof window === "undefined") return undefined;
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return undefined;
  if (!audioContext) {
    audioContext = new AudioContextClass();
    // A gentle lowpass takes the glassy edge off the square-ish partials, which
    // is the difference between a cue that can run all day and one that grates.
    const softener = audioContext.createBiquadFilter();
    softener.type = "lowpass";
    softener.frequency.value = 2600;
    softener.Q.value = 0.6;
    masterGain = audioContext.createGain();
    masterGain.gain.value = masterLevel;
    masterGain.connect(softener);
    softener.connect(audioContext.destination);
  }
  // Browsers start an AudioContext suspended until a user gesture, and reject
  // resume() outside one. Retrying on every cue means the first cue after the
  // person actually interacts is the one that gets through, with no bookkeeping.
  if (audioContext.state === "suspended") void audioContext.resume().catch(() => undefined);
  return audioContext;
}

export function playSound(name: SoundName) {
  if (!isSoundEnabled()) return;
  const audio = ensureContext();
  const master = masterGain;
  if (!audio || !master) return;

  const now = Date.now();
  if (now - (lastPlayedAt.get(name) ?? 0) < repeatSuppressionMs) return;
  lastPlayedAt.set(name, now);

  const sound = soundLibrary[name];
  const start = audio.currentTime + 0.005;
  for (const tone of sound.tones) {
    const at = start + tone.at;
    const peak = Math.max(0.0002, sound.level * (tone.level ?? 1));
    // Ramped rather than switched: a gain that steps straight to its peak puts a
    // click at the front of every cue.
    const envelope = audio.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + tone.duration);
    envelope.connect(master);

    // The fundamental plus a quiet octave above it: the partial gives the cue
    // some body, which a bare sine at these durations does not have.
    const voices: Array<{ ratio: number; mix: number; type: OscillatorType }> = [
      { ratio: 1, mix: 1, type: tone.type ?? "sine" },
      { ratio: 2, mix: 0.2, type: "triangle" },
    ];
    let voicesRemaining = voices.length;
    for (const voice of voices) {
      const oscillator = audio.createOscillator();
      const partial = audio.createGain();
      oscillator.type = voice.type;
      oscillator.frequency.setValueAtTime(tone.frequency * voice.ratio, at);
      partial.gain.value = voice.mix;
      oscillator.connect(partial);
      partial.connect(envelope);
      oscillator.onended = () => {
        oscillator.disconnect();
        partial.disconnect();
        voicesRemaining -= 1;
        if (voicesRemaining === 0) envelope.disconnect();
      };
      oscillator.start(at);
      oscillator.stop(at + tone.duration + 0.04);
    }
  }
}
