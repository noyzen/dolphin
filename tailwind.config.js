/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Shabnam', 'sans-serif'],
      },
      colors: {
        'brand-dark': '#0a0f1a',
        'brand-med': '#101828',
        'brand-light': '#1d2939',
        'brand-accent': '#00f2a1',
        'brand-accent-glow': 'rgba(0, 242, 161, 0.5)',
        'brand-border': 'rgba(127, 255, 212, 0.2)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out forwards',
        'glow': 'glow 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: 0, transform: 'translateY(10px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        glow: {
          '0%, 100%': { 'box-shadow': '0 0 5px #00f2a1, 0 0 10px #00f2a1' },
          '50%': { 'box-shadow': '0 0 20px #00f2a1, 0 0 30px #00f2a1' },
        }
      },
    },
  },
  plugins: [],
}
