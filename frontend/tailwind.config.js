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
        surface: {
          DEFAULT: "var(--color-surface, #FFFFFF)",
          subtle: "var(--color-surface-subtle, #F0F2ED)",
          hover: "var(--color-surface-hover, #EAECE6)",
        },
        border: {
          DEFAULT: "var(--color-border, #E3E7E2)",
          main: "var(--color-border, #E3E7E2)",
          subtle: "var(--color-border-subtle, #EDF0EB)",
        },
        "border-main": "var(--color-border, #E3E7E2)",
        text: {
          DEFAULT: "var(--color-text, #14201D)",
          main: "var(--color-text, #14201D)",
          muted: "var(--color-text-muted, #5B6B66)",
          faint: "var(--color-text-faint, #8E9C97)",
        },
        "text-main": "var(--color-text, #14201D)",
        "text-muted": "var(--color-text-muted, #5B6B66)",
        accent: {
          DEFAULT: "var(--color-accent, #0B6B5E)",
          hover: "var(--color-accent-hover, #09584D)",
          soft: "var(--color-accent-soft, #E3F2EE)",
        },
        status: {
          success: "var(--color-accent, #0B6B5E)",
          "success-bg": "var(--color-accent-soft, #E3F2EE)",
          warning: "var(--color-warning-text, #8A5200)",
          "warning-bg": "var(--color-warning-bg, #FDF1DC)",
          "warning-border": "var(--color-warning-border, #F5C070)",
          danger: "var(--color-danger-text, #B42318)",
          "danger-bg": "var(--color-danger-bg, #FDECEA)",
          "danger-border": "var(--color-danger-border, #F8A59D)",
        },
      },
      boxShadow: {
        dropdown: "0 4px 20px -2px rgba(14, 31, 27, 0.12), 0 2px 6px -1px rgba(14, 31, 27, 0.08)",
        modal: "0 10px 30px -5px rgba(14, 31, 27, 0.2), 0 4px 10px -2px rgba(14, 31, 27, 0.1)",
        "2xs": "0 1px 2px 0 rgba(14, 31, 27, 0.05)",
      },
    },
  },
  plugins: [],
};
