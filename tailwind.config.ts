import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: "#081325",
          slate: "#0f1c33",
          accent: "#4ade80",
          azure: "#38bdf8",
        },
      },
      fontFamily: {
        sans: ["Space Grotesk", "Geist", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 30px 120px rgba(8, 19, 37, 0.35)",
        card: "0 20px 60px rgba(8, 19, 37, 0.25)",
      },
      backgroundImage: {
        "grid-overlay": "radial-gradient(circle at top, rgba(56, 189, 248, 0.2), transparent 55%)",
      },
      borderRadius: {
        fluid: "32px",
      },
    },
  },
  plugins: [],
};

export default config;
