/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Manrope", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      borderRadius: {
        card: "14px",
        btn: "10px",
        input: "10px",
      },
      colors: {
        // LamSuite clean clinical tokens
        canvas: "var(--color-canvas, #F5F6F2)",
        surface: "var(--color-surface, #FFFFFF)",
        "border-main": "var(--color-border, #E3E7E2)",
        "text-main": "var(--color-text, #14201D)",
        "text-muted": "var(--color-text-muted, #5B6B66)",
        accent: {
          DEFAULT: "var(--color-accent, #0B6B5E)",
          soft: "var(--color-accent-soft, #E3F2EE)",
        },
        status: {
          warning: "#8A5200",
          "warning-bg": "#FDF1DC",
          danger: "#B42318",
          "danger-bg": "#FDECEA",
        },
        // Backward compatibility for existing brand references
        brand: {
          50: "#E3F2EE",
          100: "#C9D8D3",
          200: "#99BCB2",
          300: "#6EA093",
          400: "#3D8275",
          500: "#0B6B5E",
          600: "#0B6B5E",
          700: "#09584D",
          800: "#0E1F1B",
          900: "#0E1F1B",
        },
      },
      boxShadow: {
        dropdown: "0 4px 20px -2px rgba(14, 31, 27, 0.12), 0 2px 6px -1px rgba(14, 31, 27, 0.08)",
        modal: "0 10px 30px -5px rgba(14, 31, 27, 0.2), 0 4px 10px -2px rgba(14, 31, 27, 0.1)",
      },
    },
  },
  plugins: [],
};

