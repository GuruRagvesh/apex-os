import type { Config } from "tailwindcss";
import tailwindColors from "tailwindcss/colors";

// DESIGN.md → Colors: the UI uses six colour families. Near-duplicate Tailwind
// families render as their official family, so older classes (bg-green-100,
// text-rose-600, border-gray-200) follow the rules without touching every page.
// slate-500 is a touch darker than stock (#64748b → #52617a) so grey labels pass
// 4.5:1 on tinted table headers as well as on white.
const slate = { ...tailwindColors.slate, 500: '#52617a' };
// red-600 likewise (#dc2626 → #c81e1e): red words such as "Overdue" and "Reject" sit
// on red-50 tints, where stock red-600 is 4.4:1.
const red = { ...tailwindColors.red, 600: '#c81e1e' };

const paletteFamilies = {
  slate,
  gray: slate,
  zinc: slate,
  neutral: slate,
  stone: slate,
  blue: tailwindColors.blue,
  sky: tailwindColors.blue,
  cyan: tailwindColors.blue,
  emerald: tailwindColors.emerald,
  green: tailwindColors.emerald,
  teal: tailwindColors.emerald,
  lime: tailwindColors.emerald,
  amber: tailwindColors.amber,
  yellow: tailwindColors.amber,
  orange: tailwindColors.amber,
  red: red,
  rose: red,
  pink: red,
  fuchsia: red,
  violet: tailwindColors.violet,
  purple: tailwindColors.violet,
  indigo: tailwindColors.violet,
};

// Meaning colours from DESIGN.md: -text for words, -fill for dots/bars, -bg for badges.
const meaning = (name: string) => ({
  text: `var(--${name}-text)`,
  fill: `var(--${name}-fill)`,
  bg: `var(--${name}-bg)`,
});

const config: Config = {
  darkMode: ["class", '[data-theme="john-wick-dark"]'],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    // Screens and components moved out of frontend/ into the platform packages
    "../platforms/**/*.{ts,tsx}",
    "../shared/**/*.{ts,tsx}",
    // The app shell (Global Search palette, cold-start banner) lives here; its
    // own classes were never generated (e.g. the search panel lost its top spacing).
    "../apps/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ['Hyperlegible Sans', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'monospace'],
      },
      fontSize: {
        // 11px is the smallest text allowed (DESIGN.md → Typography).
        caption: ['0.6875rem', { lineHeight: '1.35' }],
        '2xs': ['0.6875rem', { lineHeight: '1.35' }],
        xs: ['0.75rem', { lineHeight: '1.4' }],
        sm: ['0.8125rem', { lineHeight: '1.45' }],
        base: ['0.875rem', { lineHeight: '1.45' }],
        md: ['0.9375rem', { lineHeight: '1.4' }],
        lg: ['1rem', { lineHeight: '1.4' }],
        xl: ['1.25rem', { lineHeight: '1.3' }],
        '2xl': ['1.5rem', { lineHeight: '1.25' }],
        '3xl': ['1.875rem', { lineHeight: '1.15' }],
        '4xl': ['2.25rem', { lineHeight: '1.1' }],
        '5xl': ['3rem', { lineHeight: '1.05' }],
        '6xl': ['3.75rem', { lineHeight: '1' }],
      },
      // Weights are 400 / 500 / 600 / 700; heavier classes render as 700.
      fontWeight: {
        extrabold: '700',
        black: '700',
      },
      colors: {
        ...paletteFamilies,
        success: meaning('success'),
        warning: meaning('warning'),
        danger: meaning('danger'),
        info: meaning('info'),
        neutral: { ...paletteFamilies.neutral, ...meaning('neutral') },
        review: meaning('review'),
        ink: { strong: 'var(--ink-strong)', muted: 'var(--ink-muted)' },
        chart: {
          1: 'var(--chart-1)', 2: 'var(--chart-2)', 3: 'var(--chart-3)',
          4: 'var(--chart-4)', 5: 'var(--chart-5)', 6: 'var(--chart-6)',
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        'apex-bg':     'var(--bg-primary)',
        'apex-card':   'var(--surface-card)',
        'apex-accent': 'var(--accent)',
        'apex-text':   'var(--text-primary)',
        'apex-muted':  'var(--text-secondary)',
        'apex-border': 'var(--border-primary)',
      },
      borderRadius: {
        DEFAULT: '16px',
        sm: '8px',
        lg: '24px',
        xl: '16px',
        '2xl': '24px',
        md: "calc(var(--radius) - 2px)",
        // Role names (DESIGN.md → Shapes). New code uses these, not lg/xl.
        control: 'var(--radius-control)',
        card: 'var(--radius-card)',
        panel: 'var(--radius-panel)',
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: { "accordion-down": "accordion-down 0.2s ease-out", "accordion-up": "accordion-up 0.2s ease-out" },
    },
  },
  plugins: [],
};

export default config;
