/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#090d16",
        foreground: "#f8fafc",
        card: "#0f172a",
        "card-foreground": "#f8fafc",
        border: "#1e293b",
        muted: "#1e293b",
        "muted-foreground": "#94a3b8",
        primary: "#38bdf8",
        "primary-foreground": "#0f172a",
        accent: "#1e293b",
        "accent-foreground": "#f8fafc",
      },
    },
  },
  plugins: [],
}
