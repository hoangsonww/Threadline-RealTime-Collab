import type { Metadata } from "next";
import { Brand } from "../../components/brand";
import { ForgotPasswordForm } from "../../components/password-recovery";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a single-use, short-lived link to reset your Threadline account password.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <main id="main-content" className="auth-page">
      <aside className="auth-aside">
        <Brand />
        <div className="auth-aside-copy">
          <p className="eyebrow">Account recovery</p>
          <h1>Reset access without losing your room history.</h1>
          <p>Password reset links are intentionally short-lived and single-use.</p>
        </div>
      </aside>
      <section className="auth-main">
        <div className="auth-card">
          <h2>Reset your password</h2>
          <p>Enter the email associated with your Threadline account.</p>
          <ForgotPasswordForm />
        </div>
      </section>
    </main>
  );
}
