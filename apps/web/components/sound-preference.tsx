"use client";

import { CheckIcon, SpeakerHighIcon, SpeakerSlashIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { isSoundEnabled, onSoundPreferenceChange, playSound, setSoundEnabled } from "../lib/sound";

export function SoundPreference() {
  // Starts at the default rather than reading storage during render: the server
  // has no localStorage, and disagreeing with it would hydrate the wrong button
  // as selected.
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(isSoundEnabled());
    return onSoundPreferenceChange(() => setEnabled(isSoundEnabled()));
  }, []);

  const select = (next: boolean) => {
    setSoundEnabled(next);
    setEnabled(next);
    // Turning sound on is also the gesture that lets the browser start the audio
    // context, so previewing here both confirms the choice and warms it up.
    if (next) playSound("success");
  };

  return (
    <div className="sound-preference" role="group" aria-label="Interface sounds">
      <button type="button" className={enabled ? "active" : ""} onClick={() => select(true)} aria-pressed={enabled}>
        <SpeakerHighIcon size={16} weight="fill" />
        On
        {enabled && <CheckIcon size={14} weight="bold" aria-hidden="true" />}
      </button>
      <button type="button" className={enabled ? "" : "active"} onClick={() => select(false)} aria-pressed={!enabled}>
        <SpeakerSlashIcon size={16} weight="fill" />
        Off
        {!enabled && <CheckIcon size={14} weight="bold" aria-hidden="true" />}
      </button>
    </div>
  );
}
