"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiError, apiFetch, type IdentityResponse } from "../lib/api";

/** Keeps every /app surface behind one session check, including deep links. */
export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void apiFetch<IdentityResponse>("/v1/auth/me")
      .then((identity) => {
        if (identity.organizations.length === 0)
          return router.replace(`/onboarding?returnTo=${encodeURIComponent(pathname || "/app")}`);
        setAuthorized(true);
      })
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401)
          return router.replace(`/login?returnTo=${encodeURIComponent(pathname || "/app")}`);
        setError(cause instanceof Error ? cause.message : "Unable to reach Threadline.");
      });
  }, [pathname, router]);
  if (error)
    return (
      <main id="main-content" className="workspace-loading">
        <p className="form-error">{error}</p>
      </main>
    );
  return authorized ? children : <main id="main-content" className="workspace-loading" aria-busy="true" />;
}
