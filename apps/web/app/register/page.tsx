import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthShell } from "../../components/auth-shell";
import { RedirectIfAuthenticated } from "../../components/redirect-if-authenticated";

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Create a Threadline account, then create or join a workspace: a room your team can return to, with live collaboration and a durable record.",
  alternates: { canonical: "/register" },
};

export default function RegisterPage() {
  return (
    <Suspense>
      <RedirectIfAuthenticated>
        <AuthShell mode="register" />
      </RedirectIfAuthenticated>
    </Suspense>
  );
}
