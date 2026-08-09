import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Threadline — persistent engineering collaboration",
    short_name: "Threadline",
    description: "A room-centered workspace for live engineering collaboration and durable session records.",
    start_url: "/app",
    display: "standalone",
    background_color: "#101216",
    theme_color: "#101216",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
