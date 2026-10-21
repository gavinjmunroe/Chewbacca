import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  /*
   * WHEN THIS IMAGE WAS BUILT, frozen into it.
   *
   * Paired with /api/version, which reports the commit. Together they answer
   * the question that cost an hour: is the thing serving this site actually
   * the thing I just pushed? A timestamp read at request time would say "now"
   * and tell nobody anything; this one moves only when the image is rebuilt,
   * so a stale deploy is visible at a glance instead of being indistinguishable
   * from a browser cache.
   */
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
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
