"use client";

import { useEffect, useRef, ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  direction?: "up" | "down" | "left" | "right";
  delay?: number;
}

export function MaskReveal({ children, className, style, direction = "up", delay = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const clipMap = {
    up:    { hidden: "inset(0 0 100% 0)", visible: "inset(0 0 0% 0)" },
    down:  { hidden: "inset(100% 0 0 0)", visible: "inset(0% 0 0 0)" },
    left:  { hidden: "inset(0 100% 0 0)", visible: "inset(0 0% 0 0)" },
    right: { hidden: "inset(0 0 0 100%)", visible: "inset(0 0 0 0%)" },
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setTimeout(() => {
              el.style.clipPath = clipMap[direction].visible;
            }, delay);
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.05, rootMargin: "-40px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint_disable-next-line react-hooks/exhaustive-deps
  }, [direction, delay]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        clipPath: clipMap[direction].hidden,
        transition: `clip-path 1s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
        willChange: "clip-path",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
