import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkspaceGate } from "../../components/workspace-gate";

// Applies to every route under /app/* — this is private, authenticated workspace
// content (rooms, org membership, settings) with nothing for a crawler to usefully
// index, and no reason to let it show up in search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Suspense fallback={<main id="main-content" className="workspace-loading" aria-busy="true" />}>
      <WorkspaceGate>{children}</WorkspaceGate>
    </Suspense>
  );
}
