"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useViewer } from "../lib/use-viewer";

/**
 * Send an already-signed-in visitor away from the authentication pages.
 *
 * Signing in, signing up, or recovering a password are all meaningless with a
 * live session, and leaving them reachable invites the confusing outcomes:
 * signing in as somebody else over an existing session, or resetting a password
 * from a page that could simply have been Settings.
 *
 * Children render immediately rather than waiting on the session check. The
 * overwhelming majority of visitors to these pages are signed out, and blocking
 * the form behind a network round trip would slow all of them down to spare the
 * few who are signed in a brief glimpse of a form they are about to leave.
 */
export function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const viewer = useViewer();

  useEffect(() => {
    if (viewer.status !== "signed-in") return;
    // Honour ?returnTo when it points somewhere inside the app — that parameter is
    // how WorkspaceGate sends people here in the first place, so the deep link
    // they originally wanted should survive the round trip.
    const returnTo = params.get("returnTo");
    router.replace(returnTo?.startsWith("/app") ? returnTo : viewer.destination);
  }, [params, router, viewer]);

  return children;
}
