/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // iMessage palette
        imessage: {
          blue: "#0A84FF",
          "blue-dark": "#0070ED",
          green: "#34C759",
          "green-dark": "#2DB14E",
          gray: "#3A3A3C",
          "gray-light": "#48484A",
          "bubble-incoming": "#262629",
          "bubble-outgoing-blue": "#0A84FF",
          "bubble-outgoing-green": "#34C759",
        },
        // App chrome
        app: {
          bg: "#1C1C1E",
          sidebar: "#1C1C1E",
          "sidebar-hover": "#2C2C2E",
          "sidebar-active": "#3A3A3C",
          thread: "#000000",
          divider: "#2C2C2E",
          "text-primary": "#FFFFFF",
          "text-secondary": "#8E8E93",
          "text-tertiary": "#636366",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "SF Pro Display",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
      },
      fontSize: {
        // Tighter Apple-style scale
        "2xs": ["0.6875rem", { lineHeight: "0.875rem" }],
      },
      borderRadius: {
        bubble: "18px",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.25s ease-out",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
