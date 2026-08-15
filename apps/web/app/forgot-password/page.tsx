import { Suspense } from "react";
import type { Metadata } from "next";
import { Brand } from "../../components/brand";
import { ForgotPasswordForm } from "../../components/password-recovery";
import { RedirectIfAuthenticated } from "../../components/redirect-if-authenticated";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Reset your Threadline password with one of the single-use recovery codes issued when you signed up.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <RedirectIfAuthenticated>
        <main id="main-content" className="auth-page">
          <aside className="auth-aside">
            <Brand />
            <div className="auth-aside-copy">
              <p className="eyebrow">Account recovery</p>
              <h1>Reset access without losing your room history.</h1>
              <p>Recovery codes are single-use and prove it&apos;s you without relying on email.</p>
            </div>
          </aside>
          <section className="auth-main">
            <div className="auth-card">
              <h2>Reset your password</h2>
              <p>Enter your email and one of the recovery codes you saved when you created your account.</p>
              <ForgotPasswordForm />
            </div>
          </section>
        </main>
      </RedirectIfAuthenticated>
    </Suspense>
  );
}
