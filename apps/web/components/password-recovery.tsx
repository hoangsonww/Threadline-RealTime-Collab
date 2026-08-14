"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PasswordField } from "./password-field";

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN;

export function ForgotPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const code = String(form.get("code") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (!email || !code) return setError("Enter your email and one of your recovery codes.");
    if (password.length < 10) return setError("Use at least 10 characters for your new password.");
    if (password !== confirmation) return setError("The two passwords do not match.");
    if (!apiOrigin) return setError("Connect the Threadline API to reset your password.");
    setBusy(true);
    try {
      const response = await fetch(`${apiOrigin}/v1/auth/password-reset/redeem`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code, password }),
      });
      const data = await response.json().catch(() => undefined);
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
        <label htmlFor="recovery-email">Work email</label>
        <input id="recovery-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" />
      </div>
      <div className="field">
        <label htmlFor="recovery-code">Recovery code</label>
        <input
          id="recovery-code"
          name="code"
          autoComplete="one-time-code"
          spellCheck={false}
          autoCapitalize="characters"
          placeholder="4KJ9-QW2M-7T5X"
        />
        <span className="field-help">
          One of the codes issued when you created your account. Each works once; dashes and capitalization don&apos;t
          matter.
        </span>
      </div>
      <PasswordField
        id="recovery-password"
        name="password"
        label="New password"
        autoComplete="new-password"
        placeholder="At least 10 characters"
      />
      <PasswordField
        id="recovery-confirmation"
        name="confirmation"
        label="Confirm new password"
        autoComplete="new-password"
        placeholder="Repeat your new password"
      />
      {error && <p className="form-error">{error}</p>}
      <button className="button button-primary" disabled={busy} type="submit">
        {busy ? "Resetting password..." : "Verify and reset password"}
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
      <PasswordField
        id="new-password"
        name="password"
        label="New password"
        autoComplete="new-password"
        placeholder="At least 10 characters"
      />
      <PasswordField
        id="confirm-password"
        name="confirmation"
        label="Confirm new password"
        autoComplete="new-password"
        placeholder="Repeat your new password"
      />
      {error && <p className="form-error">{error}</p>}
      <button className="button button-primary" disabled={busy} type="submit">
        {busy ? "Updating password..." : "Set new password"}
      </button>
    </form>
  );
}
