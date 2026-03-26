/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Playfair Display'", "Georgia", "serif"],
        mono:    ["'JetBrains Mono'", "'Fira Code'", "monospace"],
        sans:    ["'DM Sans'", "'Helvetica Neue'", "sans-serif"],
      },
    },
  },
  plugins: [],
};
