"use client";

import { ArrowRightIcon, ArrowUpRightIcon, FolderOpenIcon, VideoConferenceIcon } from "@phosphor-icons/react";
import Link from "next/link";
import type { PointerEvent, ReactNode } from "react";
import { useRef } from "react";
import { motion, useReducedMotion, useSpring } from "motion/react";

const ease = [0.16, 1, 0.3, 1] as const;

type MagneticLinkProps = {
  children: ReactNode;
  className: string;
  href: string;
};

export function MagneticLink({ children, className, href }: MagneticLinkProps) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLAnchorElement>(null);
  const x = useSpring(0, { damping: 18, mass: 0.35, stiffness: 280 });
  const y = useSpring(0, { damping: 18, mass: 0.35, stiffness: 280 });

  const handlePointerMove = (event: PointerEvent<HTMLAnchorElement>) => {
    if (reduceMotion || !ref.current) return;
    const bounds = ref.current.getBoundingClientRect();
    x.set((event.clientX - bounds.left - bounds.width / 2) * 0.12);
    y.set((event.clientY - bounds.top - bounds.height / 2) * 0.16);
  };

  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.span className="magnetic-link" style={reduceMotion ? undefined : { x, y }}>
      <Link ref={ref} className={className} href={href} onPointerLeave={reset} onPointerMove={handlePointerMove}>
        {children}
      </Link>
    </motion.span>
  );
}

export function LandingHeroCopy() {
  return (
    <div className="hero-copy">
      <p className="eyebrow">Work stays connected</p>
      <h1>
        Meet now. <em>Return smarter.</em>
      </h1>
      <p className="landing-lede">
        Threadline gives engineering teams one place to collaborate live, make decisions, and keep the full context.
      </p>
      <div className="landing-actions">
        <MagneticLink className="button button-primary" href="/register">
          Create workspace <ArrowRightIcon size={17} weight="bold" />
        </MagneticLink>
        <MagneticLink className="button button-secondary" href="/login">
          See your rooms
        </MagneticLink>
      </div>
    </div>
  );
}

export function LandingReveal({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["landing-reveal", className].filter(Boolean).join(" ")}>{children}</div>;
}

const storyCards = [
  {
    description: "Bring the call, screen, editor, and whiteboard into one focused space.",
    icon: VideoConferenceIcon,
    number: "01",
    title: "Gather live",
  },
  {
    description: "Save decisions and artifacts exactly where the conversation happened.",
    icon: FolderOpenIcon,
    number: "02",
    title: "Capture the turn",
  },
  {
    description: "Return with the context, ownership, and next move already clear.",
    icon: ArrowUpRightIcon,
    number: "03",
    title: "Pick it up later",
  },
];

export function RoomStory() {
  const reduceMotion = useReducedMotion();

  const setSpotlight = (event: PointerEvent<HTMLElement>) => {
    const target = event.currentTarget;
    const bounds = target.getBoundingClientRect();
    target.style.setProperty("--spotlight-x", `${event.clientX - bounds.left}px`);
    target.style.setProperty("--spotlight-y", `${event.clientY - bounds.top}px`);
  };

  return (
    <div className="record-flow" aria-label="A session becoming a durable record">
      {storyCards.map((card) => {
        const Icon = card.icon;
        return (
          <motion.article
            key={card.title}
            whileHover={reduceMotion ? undefined : { y: -5 }}
            transition={{ duration: 0.28, ease }}
            onPointerLeave={(event) => {
              event.currentTarget.style.removeProperty("--spotlight-x");
              event.currentTarget.style.removeProperty("--spotlight-y");
            }}
            onPointerMove={setSpotlight}
          >
            <span>{card.number}</span>
            <Icon size={24} weight="duotone" />
            <h3>{card.title}</h3>
            <p>{card.description}</p>
          </motion.article>
        );
      })}
    </div>
  );
}
