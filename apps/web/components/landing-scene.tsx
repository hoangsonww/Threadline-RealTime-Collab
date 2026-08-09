"use client";

import Image from "next/image";

export function LandingScene() {
  return (
    <figure className="landing-scene">
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
    </figure>
  );
}
