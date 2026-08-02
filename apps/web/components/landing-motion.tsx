"use client";

import { ArrowRightIcon, ArrowUpRightIcon, FolderOpenIcon, VideoConferenceIcon } from "@phosphor-icons/react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import type { PointerEvent, ReactNode } from "react";
import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";

const ease = [0.16, 1, 0.3, 1] as const;

gsap.registerPlugin(ScrollTrigger);

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

export function LandingScrollProgress() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();

  if (reduceMotion) return null;

  return <motion.div aria-hidden className="landing-scroll-progress" style={{ scaleX: scrollYProgress }} />;
}

export function LandingHeroCopy() {
  const reduceMotion = useReducedMotion();
  const item = {
    hidden: { opacity: 0, y: 18 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.68, ease } },
  };

  return (
    <motion.div
      className="hero-copy"
      initial={reduceMotion ? false : "hidden"}
      animate={reduceMotion ? undefined : "visible"}
      variants={{ visible: { transition: { delayChildren: 0.04, staggerChildren: 0.1 } } }}
    >
      <motion.p className="eyebrow" variants={item}>
        Work stays connected
      </motion.p>
      <motion.h1 variants={item}>
        Meet now. <em>Return smarter.</em>
      </motion.h1>
      <motion.p className="landing-lede" variants={item}>
        Threadline gives engineering teams one place to collaborate live, make decisions, and keep the full context.
      </motion.p>
      <motion.div className="landing-actions" variants={item}>
        <MagneticLink className="button button-primary" href="/register">
          Create workspace <ArrowRightIcon size={17} weight="bold" />
        </MagneticLink>
        <MagneticLink className="button button-secondary" href="/login">
          See your rooms
        </MagneticLink>
      </motion.div>
    </motion.div>
  );
}

export function LandingReveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 24 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ amount: 0.18, once: true }}
      transition={{ delay, duration: 0.72, ease }}
    >
      {children}
    </motion.div>
  );
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
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (reduceMotion || !scope.current) return;
      const record = scope.current.closest<HTMLElement>(".landing-record");
      const cards = gsap.utils.toArray<HTMLElement>("article", scope.current);
      if (!record || cards.length === 0) return;

      const media = gsap.matchMedia();
      media.add("(min-width: 960px)", () => {
        cards.forEach((card) => {
          gsap.fromTo(
            card,
            { opacity: 0.34, scale: 0.955 },
            {
              opacity: 1,
              scale: 1,
              ease: "none",
              scrollTrigger: {
                trigger: card,
                start: "top 78%",
                end: "top 44%",
                scrub: 0.55,
              },
            },
          );
        });
      });

      return () => media.revert();
    },
    { dependencies: [reduceMotion], scope },
  );

  const setSpotlight = (event: PointerEvent<HTMLElement>) => {
    const target = event.currentTarget;
    const bounds = target.getBoundingClientRect();
    target.style.setProperty("--spotlight-x", `${event.clientX - bounds.left}px`);
    target.style.setProperty("--spotlight-y", `${event.clientY - bounds.top}px`);
  };

  return (
    <div ref={scope} className="record-flow" aria-label="A session becoming a durable record">
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
