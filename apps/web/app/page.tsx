import Image from "next/image";
import { FingerprintIcon, FolderOpenIcon, ShieldCheckIcon, VideoConferenceIcon } from "@phosphor-icons/react/dist/ssr";
import { Brand } from "../components/brand";
import { LandingAtmosphere } from "../components/landing-atmosphere";
import { LandingHeroCopy, LandingReveal, RoomStory } from "../components/landing-motion";
import { LandingNavAction, LandingPrimaryAction, LandingRecordAction } from "../components/landing-actions";
import { LandingScene } from "../components/landing-scene";

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Threadline",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "A room-centered workspace for live engineering collaboration and durable session records. Meet now, keep the thread, and return to a room that remembers.",
  url: "https://threadline-rtc.vercel.app",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default function Home() {
  return (
    <main id="main-content" className="landing shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <LandingAtmosphere />
      <nav className="landing-nav" aria-label="Primary navigation">
        <Brand />
        <div className="landing-nav-links">
          <a href="#record">The record</a>
          <a href="#identity">Identity</a>
          <LandingNavAction />
        </div>
      </nav>
      <section className="landing-hero">
        <LandingHeroCopy />
        <LandingScene />
      </section>

      <LandingReveal>
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
      </LandingReveal>

      <section className="landing-record" id="record">
        <LandingReveal className="record-copy">
          <p className="eyebrow">A room has a memory</p>
          <h2>Live work is only half the work.</h2>
          <p>
            A room should not disappear when the call ends. Threadline keeps the important turns in one durable,
            searchable thread.
          </p>
          <LandingRecordAction />
        </LandingReveal>
        <RoomStory />
      </section>

      <LandingReveal>
        <section className="landing-detail">
          <div className="detail-image-wrap">
            <Image
              src="/images/threadline-review-detail.webp"
              alt="A design review in progress around a shared table"
              width={1680}
              height={945}
              unoptimized
              loading="eager"
              sizes="(max-width: 820px) 100vw, 58vw"
            />
          </div>
          <div className="detail-copy">
            <h2>Built for the work between the meetings.</h2>
            <p>
              Threadline is designed for planning, incident response, pair sessions, and reviews where a decision needs
              a home after the moment passes.
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
      </LandingReveal>

      <LandingReveal>
        <section className="landing-identity" id="identity">
          <div>
            <ShieldCheckIcon size={28} weight="duotone" />
            <h2>Security belongs in the workflow.</h2>
            <p>
              Sessions, room permissions, personal access tokens, and first-party OIDC are built into the system from
              the start.
            </p>
          </div>
          <div className="identity-points">
            <span>Session control</span>
            <span>Scoped automation</span>
            <span>Room-level access</span>
            <span>First-party OIDC</span>
          </div>
        </section>
      </LandingReveal>

      <LandingReveal>
        <section className="landing-cta">
          <p className="eyebrow">Start with a room</p>
          <h2>Give the work somewhere to continue.</h2>
          <LandingPrimaryAction />
        </section>
      </LandingReveal>
    </main>
  );
}
