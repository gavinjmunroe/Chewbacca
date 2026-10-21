declare module "granim" {
  interface GranimColorSet {
    colors: string[][];
    transitionSpeed?: number;
  }

  interface GranimOptions {
    element: string | HTMLCanvasElement;
    direction?: "left-right" | "top-bottom" | "diagonal" | "radial" | "custom";
    isPausedWhenNotInView?: boolean;
    stateTransitionSpeed?: number;
    defaultStateName?: string;
    states?: {
      [key: string]: GranimColorSet;
    };
    customDirection?: {
      x0: string;
      y0: string;
      x1: string;
      y1: string;
    };
    onStart?: () => void;
    onGradientChange?: (colorDetails: object) => void;
    onEnd?: () => void;
  }

  class Granim {
    constructor(options: GranimOptions);
    play(): void;
    pause(): void;
    clear(): void;
    destroy(): void;
    changeState(stateName: string): void;
    changeDirection(direction: string): void;
    changeSpeed(stateTransitionSpeed: number, gradientSpeed: number): void;
  }

  export = Granim;
}
