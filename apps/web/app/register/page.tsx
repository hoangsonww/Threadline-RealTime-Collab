import type { Metadata } from "next";
import { AuthShell } from "../../components/auth-shell";

export const metadata: Metadata = {
  title: "Create your workspace",
  description:
    "Start a Threadline workspace: a room your team can return to, with live collaboration and a durable record.",
  alternates: { canonical: "/register" },
};

export default function RegisterPage() {
  return <AuthShell mode="register" />;
}
