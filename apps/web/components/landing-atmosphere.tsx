"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Image from "next/image";
import { useRef } from "react";
import { useReducedMotion } from "motion/react";

gsap.registerPlugin(ScrollTrigger);

/**
 * A deliberately quiet interactive layer. The visual is fully useful without
 * JavaScript; GSAP only adds a small sense of depth for pointer and scroll.
 */
export function LandingAtmosphere() {
  const scope = useRef<HTMLDivElement>(null);
  const ambientRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useGSAP(
    () => {
      if (reduceMotion || !scope.current) return;

      const visual = scope.current.querySelector<HTMLElement>(".landing-atmosphere-visual");
      const glow = scope.current.querySelector<HTMLElement>(".landing-atmosphere-glow");
      const landing = scope.current.closest<HTMLElement>(".landing");
      if (!visual || !glow || !landing) return;

      const moveVisualX = gsap.quickTo(visual, "x", { duration: 0.9, ease: "power3.out" });
      const moveVisualY = gsap.quickTo(visual, "y", { duration: 0.9, ease: "power3.out" });
      const moveGlowX = gsap.quickTo(glow, "x", { duration: 0.65, ease: "power3.out" });
      const moveGlowY = gsap.quickTo(glow, "y", { duration: 0.65, ease: "power3.out" });

      const handlePointerMove = (event: PointerEvent) => {
        if (event.clientY > window.innerHeight * 1.25) return;
        const x = event.clientX / window.innerWidth - 0.5;
        const y = event.clientY / window.innerHeight - 0.5;
        moveVisualX(x * -12);
        moveVisualY(y * -8);
        moveGlowX(x * 40);
        moveGlowY(y * 28);
      };

      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      const drift = gsap.to(visual, {
        yPercent: 7,
        scale: 1.025,
        ease: "none",
        scrollTrigger: {
          trigger: landing,
          start: "top top",
          end: "bottom bottom",
          scrub: 1.1,
        },
      });
      const pulse = gsap.to(glow, { duration: 4.8, ease: "sine.inOut", opacity: 0.9, repeat: -1, yoyo: true });

      // The hero visual only covers the first screenful. These orbs span the
      // full page and drift at different scroll-linked rates so the
      // background stays alive the whole way down instead of going flat
      // after the hero, and moves continuously with scroll rather than only
      // reacting to the pointer.
      const orbs = ambientRef.current
        ? Array.from(ambientRef.current.querySelectorAll<HTMLElement>(".landing-ambient-orb"))
        : [];
      const orbTweens = orbs.map((orb, index) =>
        gsap.to(orb, {
          yPercent: index % 2 === 0 ? -26 : 30,
          xPercent: index % 2 === 0 ? 10 : -12,
          ease: "none",
          scrollTrigger: { trigger: landing, start: "top top", end: "bottom bottom", scrub: 1.3 + index * 0.35 },
        }),
      );

      return () => {
        window.removeEventListener("pointermove", handlePointerMove);
        drift.kill();
        pulse.kill();
        orbTweens.forEach((tween) => tween.kill());
      };
    },
    { dependencies: [reduceMotion], scope },
  );

  return (
    <>
      <div ref={scope} className="landing-atmosphere" aria-hidden="true">
        <div className="landing-atmosphere-visual">
          <Image src="/images/threadline-signal-field.webp" alt="" fill priority sizes="100vw" unoptimized />
        </div>
        <span className="landing-atmosphere-vignette" />
        <span className="landing-atmosphere-glow" />
      </div>
      <div ref={ambientRef} className="landing-ambient" aria-hidden="true">
        <span className="landing-ambient-orb landing-ambient-orb-1" />
        <span className="landing-ambient-orb landing-ambient-orb-2" />
        <span className="landing-ambient-orb landing-ambient-orb-3" />
        <span className="landing-grain" />
      </div>
    </>
  );
}
