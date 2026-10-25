import base from '../web/tailwind.config.js';

/** @type {import('tailwindcss').Config} */
export default { ...base, content: ['./index.html', './src/**/*.{ts,tsx}', '../web/src/components/**/*.{ts,tsx}'] };
