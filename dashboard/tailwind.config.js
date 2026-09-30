/** @type {import('tailwindcss').Config} */

// Every color is a CSS variable (see app/globals.css) so light and dark themes
// share one set of class names.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "-apple-system", "BlinkMacSystemFont", "'Segoe UI'", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "'SF Mono'", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        subtle: token("subtle"),
        line: token("line"),
        "line-strong": token("line-strong"),
        fg: token("fg"),
        muted: token("muted"),
        faint: token("faint"),
        accent: token("accent"),
        "accent-2": token("accent-2"),
        "on-accent": token("on-accent"),
        ok: token("ok"),
        warn: token("warn"),
        danger: token("danger"),
        // Note categories: one fixed hue each, validated as a set for color-blind readers
        shared: token("shared"),
        private: token("private"),
        temp: token("temp"),
        // Text and tints on the Home banner (dark ink on the light banner, white on the dark one)
        hero: token("hero-ink"),
      },
      boxShadow: {
        card: "0 1px 2px rgb(var(--shadow) / 0.05), 0 1px 3px rgb(var(--shadow) / 0.04)",
        lift: "0 4px 12px -2px rgb(var(--shadow) / 0.08), 0 2px 4px -2px rgb(var(--shadow) / 0.05)",
        pop: "0 12px 32px -8px rgb(var(--shadow) / 0.22), 0 4px 8px -4px rgb(var(--shadow) / 0.1)",
        glow: "0 6px 20px -6px rgb(var(--shadow) / 0.35)",
      },
      keyframes: {
        "fade-in": { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1, transform: "none" } },
        blink: { "0%, 80%, 100%": { opacity: 0.25 }, "40%": { opacity: 1 } },
        ping: { "75%, 100%": { transform: "scale(2)", opacity: 0 } },
      },
      animation: {
        "fade-in": "fade-in 180ms ease-out",
        blink: "blink 1.2s infinite ease-in-out",
        ping: "ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite",
      },
    },
  },
  plugins: [],
};
