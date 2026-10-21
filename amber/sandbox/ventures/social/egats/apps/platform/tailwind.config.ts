import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        egats: {
          black: "#09090B",
          purple: "#8B5CF6",
          "purple-dark": "#6D28D9",
          "purple-light": "#A78BFA",
          gold: "#F59E0B",
          "gold-light": "#FCD34D",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
