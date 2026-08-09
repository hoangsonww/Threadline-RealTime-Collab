"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "../lib/api";

type Mode = "login" | "register";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
    if (
      mode === "register" &&
      (String(form.get("displayName") ?? "").trim().length < 2 ||
        String(form.get("organizationName") ?? "").trim().length < 2)
    ) {
      setError("Add your name and workspace name to continue.");
      setBusy(false);
      return;
    }
    try {
      const payload =
        mode === "register"
          ? {
              email,
              password,
              displayName: String(form.get("displayName")).trim(),
              organizationName: String(form.get("organizationName")).trim(),
              // Threadline has no user-facing handle; this only fills an internal/OIDC
              // field, so it just needs to satisfy the API's 3-32 char shape.
              username: `${email
                .split("@")[0]
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, "-")}000`.slice(0, 32),
            }
          : { email, password };
      await apiFetch(`/v1/auth/${mode === "register" ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      router.push(returnTo?.startsWith("/app") ? returnTo : "/app");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in. Please try again.");
      setBusy(false);
    }
  };
  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      {mode === "register" && (
        <>
          <div className="field">
            <label htmlFor="displayName">Your name</label>
            <input id="displayName" name="displayName" autoComplete="name" placeholder="Avery Chen" />
          </div>
          <div className="field">
            <label htmlFor="organizationName">Workspace name</label>
            <input id="organizationName" name="organizationName" placeholder="Northstar Engineering" />
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          placeholder={mode === "login" ? "Your password" : "At least 10 characters"}
        />
        {mode === "login" && (
          <Link className="field-help" href="/forgot-password">
            Forgot password?
          </Link>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button button-primary" disabled={busy} type="submit">
        {busy ? "Opening workspace..." : mode === "login" ? "Sign in" : "Create workspace"}
      </button>
      <p className="field-help" style={{ textAlign: "center", margin: 0 }}>
        {mode === "login" ? (
          <>
            New to Threadline?{" "}
            <Link href="/register" style={{ color: "var(--accent)" }}>
              Create a workspace
            </Link>
          </>
        ) : (
          <>
            Already have a workspace?{" "}
            <Link href="/login" style={{ color: "var(--accent)" }}>
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
