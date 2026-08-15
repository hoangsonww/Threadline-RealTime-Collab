"use client";

import { useEffect, useState } from "react";
import { apiFetch, type IdentityResponse } from "./api";

export type ViewerStatus = "unknown" | "signed-in" | "signed-out";

export type Viewer = {
  status: ViewerStatus;
  /**
   * Where a signed-in person should land. An account with no workspace yet has
   * nothing to show on /app, so it goes to onboarding instead — the same rule
   * `WorkspaceGate` applies once you are already inside.
   */
  destination: string;
};

/**
 * Resolve whether the visitor already has a session.
 *
 * Starts as `unknown` rather than guessing. The session cookie is HttpOnly, so
 * the only way to know is to ask the API, and callers need to be able to render
 * something sensible before the answer arrives rather than flashing the wrong
 * state and correcting it.
 */
export function useViewer(): Viewer {
  const [viewer, setViewer] = useState<Viewer>({ status: "unknown", destination: "/app" });

  useEffect(() => {
    let cancelled = false;
    void apiFetch<IdentityResponse>("/v1/auth/me")
      .then((identity) => {
        if (cancelled) return;
        setViewer({
          status: "signed-in",
          destination: identity.organizations.length === 0 ? "/onboarding" : "/app",
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Every failure resolves to signed-out. A 401 is the ordinary "no session"
        // answer; anything else (the API unreachable, a network blip) is not proof
        // of a session either, and the safe reading of "I could not confirm you are
        // signed in" is to show the signed-out surface rather than send someone to
        // a workspace that will bounce them straight back to /login.
        setViewer({ status: "signed-out", destination: "/app" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return viewer;
}
