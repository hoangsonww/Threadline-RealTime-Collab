import { LockKeyIcon, ShieldCheckIcon, StackIcon } from "@phosphor-icons/react/dist/ssr";
import { Brand } from "./brand";
import { AuthForm } from "./auth-form";
import { ThemeToggle } from "./theme-toggle";

export function AuthShell({ mode }: { mode: "login" | "register" }) {
  const register = mode === "register";
  return (
    <main id="main-content" className="auth-page">
      <aside className="auth-aside">
        <div>
          <Brand />
          <ThemeToggle compact />
          <div className="auth-aside-copy">
            <p className="eyebrow" style={{ marginTop: 76 }}>
              Engineering, in context
            </p>
            <h1>{register ? "Give your team a room that remembers." : "Return to the room where the work lives."}</h1>
            <p>Threadline keeps the live session and the durable record together.</p>
          </div>
        </div>
        <div className="auth-points">
          <div className="auth-point">
            <ShieldCheckIcon size={18} weight="duotone" /> Session-aware access controls
          </div>
          <div className="auth-point">
            <StackIcon size={18} weight="duotone" /> Rooms, artifacts, and decisions together
          </div>
          <div className="auth-point">
            <LockKeyIcon size={18} weight="duotone" /> Built-in token and OIDC security
          </div>
        </div>
      </aside>
      <section className="auth-main">
        <div className="auth-card">
          <h2>{register ? "Create your workspace" : "Welcome back"}</h2>
          <p>{register ? "Start a room your team can return to." : "Sign in to continue to Threadline."}</p>
          <AuthForm mode={mode} />
        </div>
      </section>
    </main>
  );
}
