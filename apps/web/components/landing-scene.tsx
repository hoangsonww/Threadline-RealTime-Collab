"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";

export function LandingScene() {
  const reduceMotion = useReducedMotion();
  return (
    <motion.figure
      className="landing-scene"
      initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={reduceMotion ? undefined : { scale: 1.018, y: -5 }}
      transition={{ duration: 0.8, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="landing-scene-media">
        <Image
          src="/images/threadline-room-hero.webp"
          alt="Engineers collaborating in a focused working session"
          width={1536}
          height={1024}
          priority
          unoptimized
          sizes="(max-width: 900px) 100vw, 52vw"
        />
      </div>
      <figcaption className="scene-caption">
        <span>Live collaboration, with the context intact.</span>
      </figcaption>
    </motion.figure>
  );
}
