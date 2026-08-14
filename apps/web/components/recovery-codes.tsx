"use client";

import { CheckCircleIcon, CopyIcon, DownloadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";

/**
 * The one and only presentation of a set of recovery codes.
 *
 * Threadline has no transactional email provider, so these codes are the account's
 * only route back in after a forgotten password. Only their hashes are stored — the
 * plaintext exists in this component and nowhere else, ever again. That is why the
 * continue action is gated behind an explicit acknowledgement rather than a button
 * someone can click past on reflex.
 */
export function RecoveryCodes({
  codes,
  email,
  onContinue,
  continueLabel = "Continue",
}: {
  codes: string[];
  email?: string;
  onContinue?: () => void;
  continueLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const asText = [
    "Threadline recovery codes",
    email ? `Account: ${email}` : undefined,
    "",
    "Each code works once. Keep them somewhere you can reach without this account.",
    "",
    ...codes,
    "",
    `Generated ${new Date().toISOString()}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  const copy = async () => {
    await navigator.clipboard?.writeText(codes.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([asText], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "threadline-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="recovery-codes">
      <p className="recovery-codes-warning">
        <WarningCircleIcon size={16} weight="fill" aria-hidden="true" />
        <span>
          Save these now. They are shown once and cannot be retrieved later — without them, a forgotten password means a
          lost account.
        </span>
      </p>
      <ul className="recovery-code-grid" aria-label="Recovery codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <div className="recovery-codes-actions">
        <button type="button" className="button button-secondary" onClick={() => void copy()}>
          {copied ? (
            <>
              <CheckCircleIcon size={16} weight="fill" /> Copied
            </>
          ) : (
            <>
              <CopyIcon size={16} /> Copy codes
            </>
          )}
        </button>
        <button type="button" className="button button-secondary" onClick={download}>
          <DownloadSimpleIcon size={16} /> Download
        </button>
      </div>
      {onContinue && (
        <>
          <label className="recovery-codes-confirm">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            I have saved these codes somewhere safe
          </label>
          <button type="button" className="button button-primary" disabled={!acknowledged} onClick={onContinue}>
            {continueLabel}
          </button>
        </>
      )}
    </div>
  );
}
