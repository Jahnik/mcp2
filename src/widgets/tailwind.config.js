/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        'ibm-plex-mono': ['"IBM Plex Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
