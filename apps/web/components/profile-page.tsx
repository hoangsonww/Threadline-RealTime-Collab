"use client";

import Link from "next/link";
import { AtIcon, BuildingsIcon, CheckCircleIcon, EnvelopeSimpleIcon, KeyIcon, LaptopIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { announceIdentityUpdate, ApiError, apiFetch, type IdentityResponse } from "../lib/api";
import { playSound } from "../lib/sound";
import { Skeleton } from "./skeletons";

const initialsFor = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TL";

const joinedOn = (value?: string) =>
  value ? new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(value)) : undefined;

const roleLabel = (role?: string) => (role ? role[0].toUpperCase() + role.slice(1) : "Member");

export function ProfilePage() {
  const [identity, setIdentity] = useState<IdentityResponse>();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const adopt = (data: IdentityResponse) => {
    setIdentity(data);
    setDisplayName(data.user.displayName);
    setUsername(data.user.username);
  };

  useEffect(() => {
    let cancelled = false;
    void apiFetch<IdentityResponse>("/v1/auth/me")
      .then((data) => {
        if (!cancelled) adopt(data);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load your profile.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const user = identity?.user;
  const trimmedName = displayName.trim();
  const trimmedUsername = username.trim().toLowerCase();
  const nameChanged = !!user && trimmedName !== user.displayName;
  const usernameChanged = !!user && trimmedUsername !== user.username;
  const changed = nameChanged || usernameChanged;
  const nameValid = trimmedName.length >= 2 && trimmedName.length <= 80;
  const usernameValid = /^[a-z0-9-]{3,32}$/.test(trimmedUsername);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!changed || !nameValid || !usernameValid) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      // Only the fields that actually changed are sent, so a rename never has to
      // re-assert a username it did not touch and collide with itself.
      const data = await apiFetch<IdentityResponse>("/v1/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          ...(nameChanged ? { displayName: trimmedName } : {}),
          ...(usernameChanged ? { username: trimmedUsername } : {}),
        }),
      });
      adopt(data);
      setSaved(true);
      announceIdentityUpdate();
      playSound("success");
    } catch (cause) {
      playSound("error");
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "That username is already taken. Try another one."
          : cause instanceof Error
            ? cause.message
            : "Could not save your profile.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="content">
      <div className="page-header">
        <div>
          <p className="eyebrow">Your account</p>
          <h2>Profile</h2>
          <p>How you appear to everyone you share a room with, and the workspaces that appearance carries into.</p>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}

      <div className="settings-grid">
        <section>
          <div className="settings-section profile-identity">
            {loading ? (
              <>
                <span className="avatar large" aria-hidden="true" />
                <div className="profile-identity-copy">
                  <Skeleton width={180} height="1.4em" />
                  <Skeleton width={120} height="0.9em" style={{ marginTop: 8 }} />
                </div>
              </>
            ) : (
              <>
                <span className="avatar large profile-avatar">{initialsFor(user?.displayName ?? "")}</span>
                <div className="profile-identity-copy">
                  <h3>{user?.displayName}</h3>
                  <p className="profile-handle">
                    <AtIcon size={13} weight="bold" aria-hidden="true" />
                    {user?.username}
                  </p>
                  <div className="profile-badges">
                    <span className="profile-badge">
                      <EnvelopeSimpleIcon size={13} aria-hidden="true" /> {user?.email}
                    </span>
                    {joinedOn(user?.createdAt) && (
                      <span className="profile-badge">Joined {joinedOn(user?.createdAt)}</span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="settings-section">
            <h3>Edit profile</h3>
            <p>Your display name is what teammates see in rooms, chat, and the member directory.</p>
            <form className="profile-form" onSubmit={save}>
              <div className="field">
                <label htmlFor="profile-display-name">Display name</label>
                <input
                  id="profile-display-name"
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    setSaved(false);
                  }}
                  disabled={loading || saving}
                  maxLength={80}
                  required
                />
                <span className="field-help">Between 2 and 80 characters.</span>
              </div>
              <div className="field">
                <label htmlFor="profile-username">Username</label>
                <input
                  id="profile-username"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setSaved(false);
                  }}
                  disabled={loading || saving}
                  maxLength={32}
                  spellCheck={false}
                  autoCapitalize="none"
                  required
                />
                <span className="field-help">
                  Lowercase letters, numbers, and hyphens. This is the handle your account is known by.
                </span>
              </div>
              {changed && !nameValid && <p className="form-error">Display name must be 2–80 characters.</p>}
              {changed && !usernameValid && (
                <p className="form-error">Username must be 3–32 characters using letters, numbers, or hyphens.</p>
              )}
              {saved && !changed && (
                <p className="form-success">
                  <CheckCircleIcon size={15} weight="fill" aria-hidden="true" /> Profile updated.
                </p>
              )}
              <div className="profile-form-actions">
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={loading || saving || !changed || !nameValid || !usernameValid}
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={loading || saving || !changed}
                  onClick={() => {
                    if (!user) return;
                    setDisplayName(user.displayName);
                    setUsername(user.username);
                    setSaved(false);
                  }}
                >
                  Discard
                </button>
              </div>
            </form>
          </div>

          <div className="settings-section">
            <h3>Email address</h3>
            <p>Your email identifies the account at sign-in. Changing it is not self-serve.</p>
            <div className="key-row">
              <div>
                <strong>{user?.email ?? "Loading…"}</strong>
                <span>Contact a workspace owner if this address needs to change.</span>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3>Workspaces</h3>
            <p>Every organization this account belongs to, and the role it carries there.</p>
            {loading ? (
              <div className="key-row">
                <div>
                  <Skeleton width="40%" height="1em" />
                  <Skeleton width="65%" height="0.8em" style={{ marginTop: 4 }} />
                </div>
              </div>
            ) : identity?.organizations.length ? (
              identity.organizations.map((organization) => (
                <div className="key-row" key={organization.id}>
                  <div>
                    <strong>{organization.name}</strong>
                    <span>
                      {roleLabel(organization.role)} · {organization.slug}
                    </span>
                  </div>
                  <Link className="button button-secondary" href={`/app?org=${encodeURIComponent(organization.id)}`}>
                    <BuildingsIcon size={15} /> Open
                  </Link>
                </div>
              ))
            ) : (
              <p className="field-help">This account does not belong to a workspace yet.</p>
            )}
          </div>
        </section>

        <aside className="settings-side">
          <h3>Account</h3>
          <Link href="/app/profile" className="active">
            Profile
          </Link>
          <Link href="/app/settings">Settings</Link>
          <Link href="/app/settings/security">Security</Link>
          <Link href="/app/settings/sessions">Sessions</Link>
          <Link href="/app/settings/tokens">Personal access tokens</Link>
          <div className="profile-side-note">
            <p>
              <LaptopIcon size={14} aria-hidden="true" /> Revoke a device you no longer use from Sessions.
            </p>
            <p>
              <KeyIcon size={14} aria-hidden="true" /> Automation belongs on a scoped token, not your password.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
