import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Semantic (shadcn) ─────────────────────────────────────────
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        sidebar: {
          DEFAULT: "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
        // ── Raw DS tokens — for ds-* utility classes ──────────────────
        "ds-bg":      "var(--ds-bg)",
        "ds-surface": "var(--ds-surface)",
        "ds-s2":      "var(--ds-s2)",
        "ds-s3":      "var(--ds-s3)",
        "ds-line":    "var(--ds-line)",
        "ds-cream":   "var(--ds-cream)",
        "ds-dim":     "var(--ds-dim)",
        "ds-muted":   "var(--ds-muted)",
        "ds-green":   "var(--ds-green)",
        "ds-gd":      "var(--ds-gd)",
        "ds-orange":  "var(--ds-orange)",
        "ds-red":     "var(--ds-red)",
        "ds-yellow":  "var(--ds-yellow)",
        "ds-blue":    "var(--ds-blue)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Syne", "sans-serif"],
        heading: ["var(--font-display)", "Syne", "sans-serif"],
        sans:    ["var(--font-body)", "Inter", "sans-serif"],
        mono:    ["var(--font-mono)", "JetBrains Mono", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};
export default config;
