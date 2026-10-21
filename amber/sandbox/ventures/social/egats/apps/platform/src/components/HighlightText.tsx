"use client";

import { useEffect, useRef } from "react";

interface Props {
  text: string;
  highlightColor?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function HighlightText({ text, highlightColor = "#BF5AF2", className, style }: Props) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const words = el.querySelectorAll<HTMLElement>(".egats-hl-word");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = Array.from(words).indexOf(entry.target as HTMLElement);
            setTimeout(() => {
              (entry.target as HTMLElement).style.background = `linear-gradient(to right, ${highlightColor}35, ${highlightColor}18)`;
              (entry.target as HTMLElement).style.borderRadius = "4px";
              (entry.target as HTMLElement).style.paddingLeft = "3px";
              (entry.target as HTMLElement).style.paddingRight = "3px";
            }, idx * 50);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.7, rootMargin: "-10px 0px" }
    );

    words.forEach((w) => observer.observe(w));
    return () => observer.disconnect();
  }, [highlightColor]);

  return (
    <p ref={ref} className={className} style={style}>
      {text.split(" ").map((word, i) => (
        <span
          key={i}
          className="egats-hl-word inline-block mr-[0.25em]"
          style={{ transition: "background 0.5s ease, padding 0.3s ease" }}
        >
          {word}
        </span>
      ))}
    </p>
  );
}
