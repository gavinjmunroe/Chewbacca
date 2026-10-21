"use client";

import { useEffect } from "react";

export default function AOSInit() {
  useEffect(() => {
    async function init() {
      const AOS = (await import("aos")).default;
      AOS.init({
        duration: 600,
        easing: "ease-out-cubic",
        once: true,
        offset: 60,
      });
    }
    init();
  }, []);

  return null;
}
