import { Suspense } from "react";
import { Brand } from "../../components/brand";
import { VerifyEmailForm } from "../../components/password-recovery";

export default function VerifyEmailPage() {
  return (
    <main id="main-content" className="auth-page">
      <aside className="auth-aside">
        <Brand />
        <div className="auth-aside-copy">
          <p className="eyebrow">Secure your identity</p>
          <h1>Confirm the address that belongs to your Threadline account.</h1>
          <p>Verified addresses make recovery and first-party OIDC identity claims trustworthy.</p>
        </div>
      </aside>
      <section className="auth-main">
        <div className="auth-card">
          <h2>Verify your email</h2>
          <p>One final confirmation keeps your identity and room access secure.</p>
          <Suspense>
            <VerifyEmailForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
