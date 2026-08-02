"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";
import { useReducedMotion } from "motion/react";

gsap.registerPlugin(ScrollTrigger);

export function LandingAtmosphere() {
  const scope = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useGSAP(
    () => {
      if (reduceMotion || !scope.current) return;

      const bloom = scope.current.querySelector<HTMLElement>(".landing-atmosphere-bloom");
      const drift = scope.current.querySelector<HTMLElement>(".landing-atmosphere-drift");
      const orbitOne = scope.current.querySelector<HTMLElement>(".landing-atmosphere-orbit-one");
      const orbitTwo = scope.current.querySelector<HTMLElement>(".landing-atmosphere-orbit-two");
      const landing = scope.current.closest<HTMLElement>(".landing");
      if (!bloom || !drift || !orbitOne || !orbitTwo || !landing) return;

      const moveBloomX = gsap.quickTo(bloom, "x", { duration: 0.7, ease: "power3.out" });
      const moveBloomY = gsap.quickTo(bloom, "y", { duration: 0.7, ease: "power3.out" });
      const handlePointerMove = (event: PointerEvent) => {
        moveBloomX(event.clientX - window.innerWidth / 2);
        moveBloomY(event.clientY - window.innerHeight / 2);
      };

      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      gsap.to(orbitOne, { duration: 12, ease: "sine.inOut", repeat: -1, rotate: 20, x: 36, y: -24, yoyo: true });
      gsap.to(orbitTwo, { duration: 15, ease: "sine.inOut", repeat: -1, rotate: -16, x: -28, y: 36, yoyo: true });
      gsap.to(drift, {
        ease: "none",
        yPercent: 18,
        scrollTrigger: {
          trigger: landing,
          start: "top top",
          end: "bottom bottom",
          scrub: 1,
        },
      });

      return () => window.removeEventListener("pointermove", handlePointerMove);
    },
    { dependencies: [reduceMotion], scope },
  );

  return (
    <div ref={scope} className="landing-atmosphere" aria-hidden="true">
      <div className="landing-atmosphere-drift">
        <span className="landing-atmosphere-orbit landing-atmosphere-orbit-one" />
        <span className="landing-atmosphere-orbit landing-atmosphere-orbit-two" />
      </div>
      <span className="landing-atmosphere-bloom" />
      <span className="landing-atmosphere-grain" />
    </div>
  );
}
