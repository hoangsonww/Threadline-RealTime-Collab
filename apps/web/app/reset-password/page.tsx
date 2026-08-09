import { Suspense } from "react";
import type { Metadata } from "next";
import { Brand } from "../../components/brand";
import { ResetPasswordForm } from "../../components/password-recovery";

export const metadata: Metadata = {
  title: "Set a new password",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <main id="main-content" className="auth-page">
      <aside className="auth-aside">
        <Brand />
        <div className="auth-aside-copy">
          <p className="eyebrow">Account recovery</p>
          <h1>Choose a new password and get back to the work.</h1>
          <p>For security, every other active browser session will be signed out when your password changes.</p>
        </div>
      </aside>
      <section className="auth-main">
        <div className="auth-card">
          <h2>Set a new password</h2>
          <p>Use a long, unique password you do not reuse on another service.</p>
          <Suspense>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
