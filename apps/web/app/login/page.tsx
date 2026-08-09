import type { Metadata } from "next";
import { AuthShell } from "../../components/auth-shell";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Threadline workspace to rejoin your rooms and pick up where you left off.",
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  return <AuthShell mode="login" />;
}
