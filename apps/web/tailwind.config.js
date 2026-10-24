/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        page: v('page'),
        canvas: v('canvas'),
        surface: v('surface'),
        sunken: v('sunken'),
        ink: v('ink'),
        'ink-2': v('ink-2'),
        muted: v('muted'),
        faint: v('faint'),
        line: v('line'),
        'line-strong': v('line-strong'),
        'line-soft': v('line-soft'),
        primary: v('primary'),
        'primary-hover': v('primary-hover'),
        'primary-fg': v('primary-fg'),
        accent: v('accent'),
        soft: v('soft'),
        'soft-fg': v('soft-fg'),
        danger: v('danger'),
        'danger-soft': v('danger-soft'),
        warn: v('warn'),
        'warn-soft': v('warn-soft'),
        info: v('info'),
        'info-soft': v('info-soft'),
        rail: v('rail'),
        'rail-2': v('rail-2'),
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Thai"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { xl: '12px', '2xl': '16px', '3xl': '20px' },
      boxShadow: {
        card: '0 1px 2px rgb(23 25 28 / 0.04)',
        pop: '0 12px 32px rgb(23 25 28 / 0.14)',
        lift: '0 4px 14px rgb(23 25 28 / 0.08)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': { from: { opacity: '0', transform: 'translateY(6px) scale(.98)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { 'fade-in': 'fade-in .15s ease-out', 'pop-in': 'pop-in .18s ease-out' },
    },
  },
  plugins: [],
};
