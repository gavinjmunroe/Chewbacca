"use client";

import { useEffect, useRef } from "react";

export default function GranimBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<import("granim") | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    async function init() {
      const Granim = (await import("granim")).default;
      instanceRef.current = new Granim({
        element: canvasRef.current!,
        direction: "diagonal",
        isPausedWhenNotInView: true,
        stateTransitionSpeed: 4000,
        defaultStateName: "default-state",
        states: {
          "default-state": {
            colors: [
              ["#0f2027", "#203a43"],
              ["#2c5364", "#1e3c72"],
              ["#0f2027", "#203a43"],
            ],
            transitionSpeed: 7000,
          },
        },
      });
    }

    init();

    return () => {
      instanceRef.current?.destroy();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
        opacity: 0.9,
      }}
    />
  );
}
