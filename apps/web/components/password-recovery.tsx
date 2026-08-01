"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN;

export function ForgotPasswordForm() {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    try {
      if (!email) throw new Error("Enter the email associated with your workspace.");
      if (apiOrigin) {
        const response = await fetch(`${apiOrigin}/v1/auth/password-reset/request`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? "We could not start account recovery.");
      }
      setStatus("If an account exists for that email, a recovery link is on its way.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not start account recovery.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="recovery-email">Work email</label>
        <input id="recovery-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" />
      </div>
      {status && <p className="form-success">{status}</p>}
      {error && <p className="form-error">{error}</p>}
      <button className="button button-primary" disabled={busy} type="submit">
        {busy ? "Sending link..." : "Send reset link"}
      </button>
      <p className="field-help" style={{ textAlign: "center", margin: 0 }}>
        <Link href="/login" style={{ color: "var(--accent)" }}>
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const query = useSearchParams();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const token = query.get("token") ?? "";
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (!token) return setError("This recovery link is missing its token. Request a new link and try again.");
    if (password.length < 10) return setError("Use at least 10 characters for your new password.");
    if (password !== confirmation) return setError("The two passwords do not match.");
    if (!apiOrigin) return setError("Connect the Threadline API to complete password recovery.");
    setBusy(true);
    try {
      const response = await fetch(`${apiOrigin}/v1/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = response.status === 204 ? undefined : await response.json();
      if (!response.ok) throw new Error(data?.message ?? "We could not reset your password.");
      router.replace("/login?reset=complete");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not reset your password.");
      setBusy(false);
    }
  };
  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 10 characters"
        />
      </div>
      <div className="field">
        <label htmlFor="confirm-password">Confirm new password</label>
        <input
          id="confirm-password"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat your new password"
        />
      </div>
      {error && <p className="form-error">{error}</p>}
      <button className="button button-primary" disabled={busy} type="submit">
        {busy ? "Updating password..." : "Set new password"}
      </button>
    </form>
  );
}

export function VerifyEmailForm() {
  const query = useSearchParams();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const token = query.get("token") ?? "";
  const verify = async () => {
    if (!token)
      return setError("This verification link is missing its token. Request a new link from security settings.");
    if (!apiOrigin) return setError("Connect the Threadline API to verify this address.");
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiOrigin}/v1/auth/email-verification/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = response.status === 204 ? undefined : await response.json();
      if (!response.ok) throw new Error(data?.message ?? "We could not verify this email address.");
      setStatus("Email verified. You can return to your workspace.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not verify this email address.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-form">
      <p className="field-help" style={{ margin: 0 }}>
        Verification links expire after one hour and can only be used once.
      </p>
      {status && <p className="form-success">{status}</p>}
      {error && <p className="form-error">{error}</p>}
      <button className="button button-primary" disabled={busy} type="button" onClick={() => void verify()}>
        {busy ? "Verifying email..." : "Verify email"}
      </button>
      <Link className="button button-secondary" href="/app">
        Return to workspace
      </Link>
    </div>
  );
}
