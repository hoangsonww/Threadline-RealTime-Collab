"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "../lib/api";
import { PasswordField } from "./password-field";
import { RecoveryCodes } from "./recovery-codes";

type Mode = "login" | "register";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Held here rather than routed to a page of their own: the plaintext exists only
  // in this response, so navigating away before it is saved would destroy it.
  const [issued, setIssued] = useState<{ codes: string[]; email: string; destination: string }>();
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      setError("Enter your email and password to continue.");
      setBusy(false);
      return;
    }
    if (mode === "register" && String(form.get("displayName") ?? "").trim().length < 2) {
      setError("Add your name to continue.");
      setBusy(false);
      return;
    }
    if (mode === "register" && password.length < 10) {
      setError("Use at least 10 characters for your password.");
      setBusy(false);
      return;
    }
    if (mode === "register" && password !== String(form.get("confirmation") ?? "")) {
      setError("The two passwords do not match.");
      setBusy(false);
      return;
    }
    try {
      const payload =
        mode === "register"
          ? { email, password, displayName: String(form.get("displayName")).trim() }
          : { email, password };
      // No username is sent. Deriving one from the email address client-side collides
      // as soon as two people share a local part across domains, and the sign-up form
      // has no handle field for them to resolve it with — so the API generates a free
      // one instead.
      const created = await apiFetch<{ recoveryCodes?: string[] }>(
        `/v1/auth/${mode === "register" ? "register" : "login"}`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      const destination = returnTo?.startsWith("/app") ? returnTo : "/app";
      if (mode === "register") {
        // A brand-new account belongs to no workspace yet — onboarding comes next,
        // but only after the recovery codes have been shown and acknowledged.
        setIssued({ codes: created.recoveryCodes ?? [], email, destination });
        setBusy(false);
        return;
      }
      const identity = await apiFetch<{ organizations: unknown[] }>("/v1/auth/me");
      router.push(
        identity.organizations.length === 0
          ? `/onboarding${destination !== "/app" ? `?returnTo=${encodeURIComponent(destination)}` : ""}`
          : destination,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in. Please try again.");
      setBusy(false);
    }
  };
  if (issued)
    return (
      <div className="auth-form">
        <RecoveryCodes
          codes={issued.codes}
          email={issued.email}
          continueLabel="Continue to your workspace"
          onContinue={() =>
            router.push(
              `/onboarding${issued.destination !== "/app" ? `?returnTo=${encodeURIComponent(issued.destination)}` : ""}`,
            )
          }
        />
      </div>
    );

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      {mode === "register" && (
        <div className="field">
          <label htmlFor="displayName">Your name</label>
          <input id="displayName" name="displayName" autoComplete="name" placeholder="Avery Chen" />
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" />
      </div>
      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        placeholder={mode === "login" ? "Your password" : "At least 10 characters"}
        helper={
          mode === "login" && (
            <Link className="field-help" href="/forgot-password">
              Forgot password?
            </Link>
          )
        }
      />
      {mode === "register" && (
        <PasswordField
          id="confirmation"
          name="confirmation"
          label="Confirm password"
          autoComplete="new-password"
          placeholder="Repeat your password"
        />
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button button-primary" disabled={busy} type="submit">
        {busy
          ? mode === "login"
            ? "Signing in..."
            : "Creating account..."
          : mode === "login"
            ? "Sign in"
            : "Create account"}
      </button>
      <p className="field-help" style={{ textAlign: "center", margin: 0 }}>
        {mode === "login" ? (
          <>
            New to Threadline?{" "}
            <Link href="/register" style={{ color: "var(--accent)" }}>
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" style={{ color: "var(--accent)" }}>
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
