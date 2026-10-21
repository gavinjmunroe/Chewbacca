import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The dev badge sat on top of the page's own corner text in every review shot.
  devIndicators: false,
  // Parallel agents each build into their own folder, so two dev servers or
  // builds never write the same .next at once. Unset in production.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    unoptimized: true,
  },
  // /scroll was where this was built and shared while it was a study. It is the
  // root now. Temporary, not permanent: a 308 is cached by the browser more or
  // less forever, and that path is worth keeping free.
  async redirects() {
    return [{ source: "/scroll", destination: "/", permanent: false }];
  },
};

export default nextConfig;
