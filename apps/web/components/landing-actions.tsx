"use client";

import Link from "next/link";
import { ArrowRightIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { MagneticLink } from "./landing-motion";
import { useViewer } from "../lib/use-viewer";

/**
 * The landing page's calls to action, resolved against the visitor's session.
 *
 * Offering "Sign in" and "Create workspace" to somebody who is already signed in
 * is a dead end — it sends them to a page that only bounces them back. Each slot
 * below therefore has a signed-out and a signed-in form.
 *
 * While the session is still `unknown` the signed-out copy is shown. That is the
 * common case, and it means the page is useful immediately instead of holding an
 * empty space until the API answers; a signed-in visitor sees it swap once.
 */

export function LandingNavAction() {
  const viewer = useViewer();
  return viewer.status === "signed-in" ? (
    <Link className="button button-secondary" href={viewer.destination}>
      Open workspace
    </Link>
  ) : (
    <Link className="button button-secondary" href="/login">
      Sign in
    </Link>
  );
}

export function LandingRecordAction() {
  const viewer = useViewer();
  return viewer.status === "signed-in" ? (
    <Link className="inline-link" href="/app/rooms">
      Go to your rooms <ArrowUpRightIcon size={16} weight="bold" />
    </Link>
  ) : (
    <Link className="inline-link" href="/register">
      Start a room that lasts <ArrowUpRightIcon size={16} weight="bold" />
    </Link>
  );
}

export function LandingPrimaryAction() {
  const viewer = useViewer();
  return viewer.status === "signed-in" ? (
    <MagneticLink className="button button-primary" href={viewer.destination}>
      {viewer.destination === "/onboarding" ? "Finish setting up" : "Open your workspace"}{" "}
      <ArrowRightIcon size={17} weight="bold" />
    </MagneticLink>
  ) : (
    <MagneticLink className="button button-primary" href="/register">
      Create workspace <ArrowRightIcon size={17} weight="bold" />
    </MagneticLink>
  );
}
