import type { Config } from "tailwindcss";

export default {
  content: ["./client/index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18231d",
        canvas: "#f4f7f2",
        moss: "#215c42",
        lime: "#c9f36b",
        cream: "#fffdf6",
      },
      boxShadow: {
        soft: "0 18px 50px rgba(31, 55, 43, 0.08)",
      },
    },
  },
  plugins: [],
} satisfies Config;
