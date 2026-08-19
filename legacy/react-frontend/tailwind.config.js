/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#090d16",
        surface: "#131b2e",
        border: "#1e293b",
        primary: "#3b82f6",
      },
    },
  },
  plugins: [],
};
