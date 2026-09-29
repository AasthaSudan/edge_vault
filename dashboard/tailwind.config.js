/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Inter'", "-apple-system", "BlinkMacSystemFont", "'Segoe UI'", "Roboto", "sans-serif"],
        mono: ["'JetBrains Mono'", "'SF Mono'", "Menlo", "monospace"],
      },
      colors: {
        background: "#090d16",
        foreground: "#f1f5f9",
        card: {
          DEFAULT: "#0f172a",
          subtle: "#131d33",
          border: "#1e293b",
        },
        border: "#1e293b",
        muted: {
          DEFAULT: "#1e293b",
          foreground: "#94a3b8",
        },
        primary: {
          DEFAULT: "#0284c7",
          hover: "#0369a1",
          light: "#38bdf8",
          foreground: "#ffffff",
        },
        accent: {
          DEFAULT: "#1e293b",
          foreground: "#f8fafc",
        },
      },
    },
  },
  plugins: [],
};
