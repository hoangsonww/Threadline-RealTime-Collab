"use client";

import { ArrowLeftIcon, ArrowRightIcon, BuildingsIcon, TicketIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ApiError, apiFetch, type IdentityResponse } from "../lib/api";
import { Brand } from "./brand";

type View = "choice" | "create" | "join";

function destinationFromQuery() {
  const returnTo = new URLSearchParams(window.location.search).get("returnTo");
  return returnTo?.startsWith("/app") ? returnTo : "/app";
}

export function OnboardingFlow() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [gateError, setGateError] = useState("");
  const [view, setView] = useState<View>("choice");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void apiFetch<IdentityResponse>("/v1/auth/me")
      .then((identity) => {
        // Someone who already belongs to a workspace has nothing to do here.
        if (identity.organizations.length > 0) return router.replace(destinationFromQuery());
        setChecking(false);
      })
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) return router.replace("/login?returnTo=%2Fonboarding");
        setGateError(cause instanceof Error ? cause.message : "Unable to reach Threadline.");
        setChecking(false);
      });
  }, [router]);

  useEffect(() => {
    if (view === "create") nameInputRef.current?.focus();
    if (view === "join") codeInputRef.current?.focus();
  }, [view]);

  const goTo = (next: View) => {
    setError("");
    setView(next);
  };

  const createWorkspace = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (name.length < 2) {
      setError("Give your workspace a name — at least 2 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch("/v1/orgs", { method: "POST", body: JSON.stringify({ name }) });
      router.push(destinationFromQuery());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the workspace. Please try again.");
      setBusy(false);
    }
  };

  const joinWorkspace = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length < 4) {
      setError("Enter the invite code your teammate shared with you.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch("/v1/join", { method: "POST", body: JSON.stringify({ code: trimmed }) });
      router.push(destinationFromQuery());
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setError("That code doesn't match any workspace. Double-check it and try again.");
      } else if (cause instanceof ApiError && cause.status === 409) {
        setError("You're already a member of that workspace.");
      } else {
        setError(cause instanceof Error ? cause.message : "Could not join that workspace. Please try again.");
      }
      setBusy(false);
    }
  };

  if (checking) return <main id="main-content" className="workspace-loading" aria-busy="true" />;
  if (gateError)
    return (
      <main id="main-content" className="workspace-loading">
        <p className="form-error">{gateError}</p>
      </main>
    );

  return (
    <main id="main-content" className="onboarding-page">
      <div className="onboarding-shell">
        <Brand />
        <div className="onboarding-intro">
          <p className="eyebrow">One more step</p>
          <h1>Where do you want to work?</h1>
          <p>
            Every Threadline account starts empty — create a workspace of your own, or join one with an invite code.
          </p>
        </div>
        <AnimatePresence mode="wait">
          {view === "choice" && (
            <motion.div
              key="choice"
              className="onboarding-cards"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <button type="button" className="onboarding-card" onClick={() => goTo("create")}>
                <span className="onboarding-card-icon">
                  <BuildingsIcon size={24} weight="duotone" />
                </span>
                <span className="onboarding-card-copy">
                  <strong>Create a workspace</strong>
                  <span>Start fresh. You become the owner and can invite your team.</span>
                </span>
                <ArrowRightIcon size={16} weight="bold" className="onboarding-card-arrow" />
              </button>
              <button type="button" className="onboarding-card" onClick={() => goTo("join")}>
                <span className="onboarding-card-icon onboarding-card-icon-alt">
                  <TicketIcon size={24} weight="duotone" />
                </span>
                <span className="onboarding-card-copy">
                  <strong>Join a workspace</strong>
                  <span>Enter an invite code shared by an existing owner or member.</span>
                </span>
                <ArrowRightIcon size={16} weight="bold" className="onboarding-card-arrow" />
              </button>
            </motion.div>
          )}
          {view === "create" && (
            <motion.form
              key="create"
              className="onboarding-form"
              onSubmit={createWorkspace}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              noValidate
            >
              <button type="button" className="onboarding-back" onClick={() => goTo("choice")}>
                <ArrowLeftIcon size={14} weight="bold" /> Back
              </button>
              <div className="field">
                <label htmlFor="onboarding-workspace-name">Workspace name</label>
                <input
                  id="onboarding-workspace-name"
                  name="name"
                  placeholder="Northstar Engineering"
                  ref={nameInputRef}
                  maxLength={80}
                />
              </div>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button className="button button-primary" disabled={busy} type="submit">
                {busy ? "Creating workspace..." : "Create workspace"}
              </button>
            </motion.form>
          )}
          {view === "join" && (
            <motion.form
              key="join"
              className="onboarding-form"
              onSubmit={joinWorkspace}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              noValidate
            >
              <button type="button" className="onboarding-back" onClick={() => goTo("choice")}>
                <ArrowLeftIcon size={14} weight="bold" /> Back
              </button>
              <div className="field">
                <label htmlFor="onboarding-invite-code">Invite code</label>
                <input
                  id="onboarding-invite-code"
                  name="code"
                  className="onboarding-code-input"
                  placeholder="XXXXXXXX"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  ref={codeInputRef}
                  maxLength={8}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button className="button button-primary" disabled={busy} type="submit">
                {busy ? "Joining workspace..." : "Join workspace"}
              </button>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
