"use client";

import Link from "next/link";
import {
  CheckCircleIcon,
  CopyIcon,
  KeyIcon,
  LaptopIcon,
  PlusIcon,
  TrashIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { apiFetch, type IdentityResponse } from "../lib/api";
import { KeyRowSkeleton } from "./skeletons";
import { SoundPreference } from "./sound-preference";
import { ThemePreference } from "./theme-preference";

type Token = {
  id: string;
  label: string;
  tokenPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};
type Session = {
  id: string;
  userAgent?: string;
  createdAt: string;
  lastUsedAt: string;
  revokedAt?: string;
  isCurrent: boolean;
};
type OidcClient = {
  id: string;
  name: string;
  redirectUris: string[];
  allowedScopes: string[];
  isFirstParty: boolean;
  createdAt: string;
};
type Section = "general" | "security" | "sessions" | "tokens" | "clients";

const tokenDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));

export function Settings({ section = "general" }: { section?: Section }) {
  const [identity, setIdentity] = useState<IdentityResponse>();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [clients, setClients] = useState<OidcClient[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const load = async () => {
    const [identityData, tokenData, sessionData, clientData] = await Promise.all([
      apiFetch<IdentityResponse>("/v1/auth/me"),
      apiFetch<{ tokens: Token[] }>("/v1/pats"),
      apiFetch<{ sessions: Session[] }>("/v1/sessions"),
      apiFetch<{ clients: OidcClient[] }>("/v1/oidc/clients"),
    ]);
    setIdentity(identityData);
    setTokens(tokenData.tokens.filter((token) => !token.revokedAt));
    setSessions(sessionData.sessions.filter((session) => !session.revokedAt));
    setClients(clientData.clients);
  };
  useEffect(() => {
    void load()
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load settings."))
      .finally(() => setLoading(false));
  }, []);
  const createToken = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setCreating(true);
    setError("");
    const scopes = ["rooms:read", "messages:write", "artifacts:read"].filter((scope) => form.get(scope) === "on");
    try {
      const data = await apiFetch<{ token: Token; secret: string }>("/v1/pats", {
        method: "POST",
        body: JSON.stringify({ label: String(form.get("label") || "").trim(), scopes }),
      });
      setTokens((items) => [data.token, ...items]);
      setSecret(data.secret);
      setShowNew(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the token.");
    } finally {
      setCreating(false);
    }
  };
  const revokeToken = async (token: Token) => {
    try {
      await apiFetch(`/v1/pats/${token.id}`, { method: "DELETE" });
      setTokens((items) => items.filter((item) => item.id !== token.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke the token.");
    }
  };
  const revokeSession = async (session: Session) => {
    try {
      await apiFetch(`/v1/sessions/${session.id}`, { method: "DELETE" });
      setSessions((items) => items.filter((item) => item.id !== session.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke the session.");
    }
  };
  const copySecret = async () => {
    await navigator.clipboard?.writeText(secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const nav = [
    ["general", "/app/settings", "General"],
    ["security", "/app/settings/security", "Security"],
    ["sessions", "/app/settings/sessions", "Sessions"],
    ["tokens", "/app/settings/tokens", "Personal access tokens"],
    ["clients", "/app/settings/clients", "OIDC clients"],
  ] as const;
  return (
    <div className="content">
      <div className="page-header">
        <div>
          <p className="eyebrow">Personal workspace</p>
          <h2>Settings</h2>
          <p>Manage the security controls and developer access that follow you across every Threadline room.</p>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="settings-grid">
        <section>
          {(section === "general" || section === "security") && (
            <>
              <div className="settings-section">
                <h3>Appearance</h3>
                <p>Choose the interface contrast and feedback that are most comfortable for this device.</p>
                <div className="key-row appearance-row">
                  <div>
                    <strong>Color theme</strong>
                    <span>Your choice stays on this device.</span>
                  </div>
                  <ThemePreference />
                </div>
                <div className="key-row appearance-row">
                  <div>
                    <strong>Interface sounds</strong>
                    <span>Short cues when you join, leave, mute, share, or receive a message.</span>
                  </div>
                  <SoundPreference />
                </div>
              </div>
              <div className="settings-section">
                <h3>Security model</h3>
                <p>Browser sessions are HttpOnly, individually revocable, and isolated from automation tokens.</p>
                <div className="key-row">
                  <div>
                    <strong>Authentication boundary</strong>
                    <span>Refresh tokens rotate; room tickets expire after two minutes.</span>
                  </div>
                  <Link className="button button-secondary" href="/app/settings/sessions">
                    <LaptopIcon size={16} /> Review sessions
                  </Link>
                </div>
                {identity && (
                  <div className="key-row">
                    <div>
                      <strong>Signed in as</strong>
                      <span>{identity.user.email}</span>
                    </div>
                    <Link className="button button-secondary" href="/app/profile">
                      <UserCircleIcon size={16} /> View profile
                    </Link>
                  </div>
                )}
              </div>
            </>
          )}
          {(section === "general" || section === "sessions" || section === "security") && (
            <div className="settings-section" id="sessions">
              <h3>Browser sessions</h3>
              <p>Only sessions returned by the authenticated API are shown here.</p>
              {loading ? (
                <KeyRowSkeleton count={2} />
              ) : (
                <>
                  {sessions.map((session) => (
                    <div className="key-row" key={session.id}>
                      <div>
                        <strong>{session.isCurrent ? "Current device" : "Signed-in device"}</strong>
                        <span>
                          {session.userAgent || "Unknown browser"} · active {tokenDate(session.lastUsedAt)}
                        </span>
                      </div>
                      {session.isCurrent ? (
                        <span className="session-current">Current</span>
                      ) : (
                        <button className="button button-danger" onClick={() => void revokeSession(session)}>
                          <TrashIcon size={15} /> Revoke
                        </button>
                      )}
                    </div>
                  ))}
                  {!sessions.length && <p className="field-help">No active sessions were returned.</p>}
                </>
              )}
            </div>
          )}
          {(section === "general" || section === "tokens") && (
            <div className="settings-section" id="tokens">
              <h3>Personal access tokens</h3>
              <p>
                Use scoped tokens for trusted scripts, CLI workflows, and internal automation. Secrets are shown once.
              </p>
              <div className="key-row">
                <div>
                  <strong>Automation access</strong>
                  <span>Scopes are enforced for every API request.</span>
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
              {loading ? (
                <KeyRowSkeleton count={2} />
              ) : (
                <>
                  {tokens.map((token) => (
                    <div className="key-row" key={token.id}>
                      <div>
                        <strong>{token.label}</strong>
                        <span>
                          <code>{token.tokenPrefix}…</code> · {token.scopes.join(", ")} · Created{" "}
                          {tokenDate(token.createdAt)} · Last used{" "}
                          {token.lastUsedAt ? tokenDate(token.lastUsedAt) : "never"}
                        </span>
                      </div>
                      <button className="button button-danger" onClick={() => void revokeToken(token)}>
                        <TrashIcon size={15} /> Revoke
                      </button>
                    </div>
                  ))}
                  {!tokens.length && <p className="field-help">No active personal access tokens.</p>}
                </>
              )}
            </div>
          )}
          {(section === "general" || section === "clients") && (
            <div className="settings-section" id="clients">
              <h3>First-party OIDC clients</h3>
              <p>
                These client registrations are fetched from the identity service. Public third-party client creation is
                not enabled.
              </p>
              {loading ? (
                <KeyRowSkeleton count={2} />
              ) : (
                <>
                  {clients.map((client) => (
                    <div className="key-row" key={client.id}>
                      <div>
                        <strong>{client.name}</strong>
                        <span>
                          {client.id} · Authorization code + PKCE · {client.redirectUris.join(", ")}
                        </span>
                      </div>
                      <span className="session-current">Active</span>
                    </div>
                  ))}
                  {!clients.length && <p className="field-help">No first-party clients were returned.</p>}
                </>
              )}
            </div>
          )}
        </section>
        <aside className="settings-side">
          <h3>Account</h3>
          <Link href="/app/profile">Profile</Link>
          {nav.map(([key, href, label]) => (
            <Link href={href} className={section === key ? "active" : ""} key={key}>
              {label}
            </Link>
          ))}
        </aside>
      </div>
      {showNew && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={createToken} role="dialog" aria-modal="true">
            <div className="modal-head">
              <div>
                <h3>Create personal access token</h3>
                <p>Choose explicit scopes. You will copy the secret exactly once.</p>
              </div>
            </div>
            <div className="modal-form">
              <div className="field">
                <label htmlFor="token-label">Token label</label>
                <input id="token-label" name="label" autoFocus placeholder="deploy-bot" required />
              </div>
              <fieldset className="token-scopes">
                <legend>Scopes</legend>
                <label>
                  <input type="checkbox" name="rooms:read" defaultChecked /> Read rooms
                </label>
                <label>
                  <input type="checkbox" name="messages:write" defaultChecked /> Send messages
                </label>
                <label>
                  <input type="checkbox" name="artifacts:read" /> Read artifacts
                </label>
              </fieldset>
              <div className="modal-actions">
                <button type="button" className="button button-ghost" onClick={() => setShowNew(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={creating}>
                  {creating ? "Creating…" : "Create token"}
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
                <p>This secret will not be shown again. Store it in a secret manager.</p>
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
