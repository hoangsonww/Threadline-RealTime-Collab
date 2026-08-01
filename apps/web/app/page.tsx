import Link from "next/link";
import Image from "next/image";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  FingerprintIcon,
  FolderOpenIcon,
  ShieldCheckIcon,
  VideoConferenceIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Brand } from "../components/brand";
import { LandingScene } from "../components/landing-scene";
import { ThemeToggle } from "../components/theme-toggle";

export default function Home() {
  return (
    <main id="main-content" className="landing shell">
      <nav className="landing-nav" aria-label="Primary navigation">
        <Brand />
        <div className="landing-nav-links">
          <a href="#record">The record</a>
          <a href="#identity">Identity</a>
          <ThemeToggle compact />
          <Link className="button button-secondary" href="/login">
            Sign in
          </Link>
        </div>
      </nav>
      <section className="landing-hero">
        <div className="hero-copy">
          <p className="eyebrow">Work stays connected</p>
          <h1>
            Meet now. <em>Return smarter.</em>
          </h1>
          <p className="landing-lede">
            Threadline gives engineering teams one place to collaborate live, make decisions, and keep the full context.
          </p>
          <div className="landing-actions">
            <Link className="button button-primary" href="/register">
              Create workspace <ArrowRightIcon size={17} weight="bold" />
            </Link>
            <Link className="button button-secondary" href="/login">
              See your rooms
            </Link>
          </div>
        </div>
        <LandingScene />
      </section>

      <section className="landing-proof" aria-label="Threadline principles">
        <div>
          <VideoConferenceIcon size={22} weight="duotone" />
          <strong>Present together</strong>Talk, share, sketch, and edit in the same room.
        </div>
        <div>
          <FolderOpenIcon size={22} weight="duotone" />
          <strong>Keep the thread</strong>Notes, files, decisions, and activity remain connected.
        </div>
        <div>
          <FingerprintIcon size={22} weight="duotone" />
          <strong>Operate with confidence</strong>Identity, access, and automation share one foundation.
        </div>
      </section>

      <section className="landing-record" id="record">
        <div className="record-copy">
          <p className="eyebrow">A room has a memory</p>
          <h2>Live work is only half the work.</h2>
          <p>
            A room should not disappear when the call ends. Threadline keeps the important turns in one durable,
            searchable thread.
          </p>
          <Link className="inline-link" href="/register">
            Start a room that lasts <ArrowRightIcon size={16} weight="bold" />
          </Link>
        </div>
        <div className="record-flow" aria-label="A session becoming a durable record">
          <article>
            <span>01</span>
            <VideoConferenceIcon size={24} weight="duotone" />
            <h3>Gather live</h3>
            <p>Bring the call, screen, editor, and whiteboard into one focused space.</p>
          </article>
          <article>
            <span>02</span>
            <FolderOpenIcon size={24} weight="duotone" />
            <h3>Capture the turn</h3>
            <p>Save decisions and artifacts exactly where the conversation happened.</p>
          </article>
          <article>
            <span>03</span>
            <ArrowUpRightIcon size={24} weight="duotone" />
            <h3>Pick it up later</h3>
            <p>Return with the context, ownership, and next move already clear.</p>
          </article>
        </div>
      </section>

      <section className="landing-detail">
        <div className="detail-image-wrap">
          <Image
            src="/images/threadline-review-detail.webp"
            alt="A design review in progress around a shared table"
            width={1680}
            height={945}
            unoptimized
            sizes="(max-width: 820px) 100vw, 58vw"
          />
        </div>
        <div className="detail-copy">
          <h2>Built for the work between the meetings.</h2>
          <p>
            Threadline is designed for planning, incident response, pair sessions, and reviews where a decision needs a
            home after the moment passes.
          </p>
          <dl>
            <div>
              <dt>Rooms</dt>
              <dd>Live coordination with persistent artifacts.</dd>
            </div>
            <div>
              <dt>Records</dt>
              <dd>A clear timeline of what changed and why.</dd>
            </div>
            <div>
              <dt>Automation</dt>
              <dd>Scoped personal tokens for the tools around your team.</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="landing-identity" id="identity">
        <div>
          <ShieldCheckIcon size={28} weight="duotone" />
          <h2>Security belongs in the workflow.</h2>
          <p>
            Sessions, room permissions, personal access tokens, and first-party OIDC are built into the system from the
            start.
          </p>
        </div>
        <div className="identity-points">
          <span>Session control</span>
          <span>Scoped automation</span>
          <span>Room-level access</span>
          <span>First-party OIDC</span>
        </div>
      </section>

      <section className="landing-cta">
        <p className="eyebrow">Start with a room</p>
        <h2>Give the work somewhere to continue.</h2>
        <Link className="button button-primary" href="/register">
          Create workspace <ArrowRightIcon size={17} weight="bold" />
        </Link>
      </section>
    </main>
  );
}
