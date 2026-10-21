import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EGATS",
    short_name: "EGATS",
    description: "Elite Global Artists & Talent Studio",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0f",
    theme_color: "#7c3aed",
    icons: [
      { src: "/egatslogosimple.png", sizes: "192x192", type: "image/png" },
      { src: "/egatslogosimple.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
