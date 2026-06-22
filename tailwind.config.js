/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50:  '#f0f4f9',
          100: '#dce6f0',
          200: '#b9cde1',
          300: '#8aaec9',
          400: '#5a8baf',
          500: '#3d6e95',
          600: '#2f5678',
          700: '#264462',
          800: '#1e3a50',
          900: '#152a3b',
          950: '#0d1a25',
        },
        gold: {
          50:  '#fdf9ec',
          100: '#faf0cc',
          200: '#f3dd8a',
          300: '#edc94a',
          400: '#e5b520',
          500: '#c99510',
          600: '#a8740d',
          700: '#85540f',
          800: '#6e4313',
          900: '#5c3714',
        },
        ink: '#1a1a2e',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
