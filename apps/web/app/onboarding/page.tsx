import type { Metadata } from "next";
import { OnboardingFlow } from "../../components/onboarding-flow";

// Same reasoning as /app/**: private, in-flow account setup with nothing for a
// crawler to index.
export const metadata: Metadata = {
  title: "Set up your workspace",
  robots: { index: false, follow: false, nocache: true },
};

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
