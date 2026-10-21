"use client";

import React, { useEffect, useRef } from "react";

interface Props {
  children: React.ReactNode;
  className?: string;
  delay?: string;
  scale?: boolean;
  left?: boolean;
  right?: boolean;
}

export default function ScrollReveal({
  children,
  className = "",
  delay = "",
  scale = false,
  left = false,
  right = false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add("visible");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const base = scale ? "reveal-scale" : left ? "reveal-left" : right ? "reveal-right" : "reveal";
  return (
    <div ref={ref} className={`${base} ${delay} ${className}`}>
      {children}
    </div>
  );
}
