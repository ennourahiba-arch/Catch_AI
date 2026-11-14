/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#151631", soft: "#2B2D52", mute: "#5C5F80" },
        violet: { DEFAULT: "#7765F6", ink: "#5643DE", wash: "#EEEBFE" },
        teal: { DEFAULT: "#28C8B7", ink: "#0B7E72", wash: "#E2F7F4" },
        coral: { DEFAULT: "#FF806D", ink: "#C2412D", wash: "#FFEDEA" },
        paper: "#F7F8FC",
        line: "#E3E5F0",
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', "ui-sans-serif", "system-ui", "sans-serif"],
        body: ['"Atkinson Hyperlegible"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: { sheet: "6px" },
    },
  },
  plugins: [],
};
