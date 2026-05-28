import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: {
          DEFAULT: "var(--surface)",
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
          deep: "var(--surface-deep)",
        },
        ink: {
          1: "var(--ink-1)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
          4: "var(--ink-4)",
          muted: "var(--ink-muted)",
          faint: "var(--ink-faint)",
        },
        line: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
          faint: "var(--border-faint)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          fg: "var(--accent-fg)",
          soft: "var(--accent-soft)",
          text: "var(--accent-text)",
          text2: "var(--accent-text-2)",
          border: "var(--accent-border)",
        },
      },
    },
  },
  plugins: [],
};
export default config;
