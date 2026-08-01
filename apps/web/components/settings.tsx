"use client";

import { CheckCircleIcon, CopyIcon, KeyIcon, LaptopIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

type Token = { id: string | number; label: string; prefix: string; scopes: string; created: string; lastUsed: string };
const initialTokens: Token[] = [
  {
    id: 1,
    label: "incident-cli",
    prefix: "tl_pat_4f3…",
    scopes: "rooms:read, messages:write",
    created: "Jul 28, 2026",
    lastUsed: "Today",
  },
];

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN;
const apiToken = (token: {
  id: string;
  label: string;
  tokenPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
}): Token => ({
  id: token.id,
  label: token.label,
  prefix: `${token.tokenPrefix}…`,
  scopes: token.scopes.join(", "),
  created: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(token.createdAt),
  ),
  lastUsed: token.lastUsedAt
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(token.lastUsedAt))
    : "Never",
});

export function Settings() {
  const [tokens, setTokens] = useState(initialTokens);
  const [showNew, setShowNew] = useState(false);
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!apiOrigin) return;
    void fetch(`${apiOrigin}/v1/pats`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load personal access tokens.");
        return (await response.json()) as { tokens: Parameters<typeof apiToken>[0][] };
      })
      .then((data) => setTokens(data.tokens.map(apiToken)))
      .catch((error: unknown) =>
        setTokenError(error instanceof Error ? error.message : "Could not load access tokens."),
      );
  }, []);
  const createToken = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = String(form.get("label") || "Automation token").trim();
    setCreating(true);
    setTokenError("");
    try {
      if (apiOrigin) {
        const response = await fetch(`${apiOrigin}/v1/pats`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ label, scopes: ["rooms:read", "messages:write"] }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? "Could not create the access token.");
        setTokens((items) => [apiToken(data.token), ...items]);
        setSecret(data.secret);
      } else {
        const newSecret = `tl_pat_${crypto.randomUUID().replace(/-/g, "")}`;
        setTokens((items) => [
          {
            id: Date.now(),
            label,
            prefix: `${newSecret.slice(0, 14)}…`,
            scopes: "rooms:read, messages:write",
            created: "Just now",
            lastUsed: "Never",
          },
          ...items,
        ]);
        setSecret(newSecret);
      }
      setShowNew(false);
    } catch (error) {
      setTokenError(error instanceof Error ? error.message : "Could not create the access token.");
    } finally {
      setCreating(false);
    }
  };
  const revokeToken = async (token: Token) => {
    setTokenError("");
    try {
      if (apiOrigin) {
        const response = await fetch(`${apiOrigin}/v1/pats/${token.id}`, { method: "DELETE", credentials: "include" });
        if (!response.ok) throw new Error("Could not revoke the access token.");
      }
      setTokens((items) => items.filter((item) => item.id !== token.id));
    } catch (error) {
      setTokenError(error instanceof Error ? error.message : "Could not revoke the access token.");
    }
  };
  const copySecret = async () => {
    await navigator.clipboard?.writeText(secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="content">
      <div className="page-header">
        <div>
          <p className="eyebrow">Personal workspace</p>
          <h2>Settings</h2>
          <p>Manage the security controls and developer access that follow you across every Threadline room.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section>
          <div className="settings-section">
            <h3>Security</h3>
            <p>Browser sessions are individually revocable and refresh automatically with rotation.</p>
            <div className="key-row">
              <div>
                <strong>Current session</strong>
                <span>Chrome on macOS · active now</span>
              </div>
              <button className="button button-secondary">
                <LaptopIcon size={16} /> Current device
              </button>
            </div>
            <div className="key-row">
              <div>
                <strong>Other devices</strong>
                <span>Review and revoke past sessions</span>
              </div>
              <button className="button button-secondary">Manage sessions</button>
            </div>
          </div>
          <div className="settings-section">
            <h3>Personal access tokens</h3>
            <p>
              Use scoped tokens for trusted scripts, CLI workflows, and internal automation. They are shown exactly
              once.
            </p>
            <div className="key-row">
              <div>
                <strong>Automation access</strong>
                <span>Scopes are checked on every API request.</span>
              </div>
              <button
                className="button button-primary"
                onClick={() => {
                  setSecret("");
                  setShowNew(true);
                }}
              >
                <PlusIcon size={15} weight="bold" /> New token
              </button>
            </div>
            {tokenError && <p className="form-error">{tokenError}</p>}
            {tokens.map((token) => (
              <div className="key-row" key={token.id}>
                <div>
                  <strong>{token.label}</strong>
                  <span>
                    <code>{token.prefix}</code> · {token.scopes} · Last used {token.lastUsed}
                  </span>
                </div>
                <button className="button button-danger" onClick={() => void revokeToken(token)}>
                  <TrashIcon size={15} /> Revoke
                </button>
              </div>
            ))}
          </div>
          <div className="settings-section">
            <h3>First-party OIDC clients</h3>
            <p>
              Threadline only registers internal clients, using authorization code with PKCE and rotating refresh
              tokens.
            </p>
            <div className="key-row">
              <div>
                <strong>Threadline web</strong>
                <span>Authorization code + PKCE · Active</span>
              </div>
              <button className="button button-secondary">View client</button>
            </div>
            <div className="key-row">
              <div>
                <strong>Threadline CLI</strong>
                <span>Device registration pending</span>
              </div>
              <button className="button button-secondary">Configure</button>
            </div>
          </div>
        </section>
        <aside className="settings-side">
          <h3>Settings</h3>
          <a href="/app/settings" className="active">
            General
          </a>
          <a href="/app/settings/security">Security</a>
          <a href="/app/settings/sessions">Sessions</a>
          <a href="/app/settings/tokens">Personal access tokens</a>
          <a href="/app/settings/clients">OIDC clients</a>
        </aside>
      </div>
      {showNew && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={createToken} role="dialog" aria-modal="true">
            <div className="modal-head">
              <div>
                <h3>Create personal access token</h3>
                <p>Choose a descriptive label. You will be able to copy the secret once.</p>
              </div>
            </div>
            <div className="modal-form">
              <div className="field">
                <label htmlFor="token-label">Token label</label>
                <input id="token-label" name="label" autoFocus placeholder="deploy-bot" required />
              </div>
              <div className="field">
                <label htmlFor="token-scope">Scopes</label>
                <input id="token-scope" name="scopes" value="rooms:read, messages:write" readOnly />
                <span className="field-help">The production API enforces one or more explicit scopes.</span>
              </div>
              <div className="modal-actions">
                <button type="button" className="button button-ghost" onClick={() => setShowNew(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary">
                  {creating ? "Creating..." : "Create token"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
      {secret && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div>
                <h3>Copy your token now</h3>
                <p>This secret will not be visible again. Store it in your team’s secret manager.</p>
              </div>
              <KeyIcon size={23} color="var(--accent)" />
            </div>
            <div className="field">
              <label htmlFor="new-secret">Personal access token</label>
              <input id="new-secret" value={secret} readOnly />
            </div>
            <div className="modal-actions">
              <button className="button button-secondary" onClick={() => void copySecret()}>
                {copied ? (
                  <>
                    <CheckCircleIcon size={16} /> Copied
                  </>
                ) : (
                  <>
                    <CopyIcon size={16} /> Copy token
                  </>
                )}
              </button>
              <button className="button button-primary" onClick={() => setSecret("")}>
                I stored it safely
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
