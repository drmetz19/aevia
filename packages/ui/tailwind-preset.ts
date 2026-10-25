/** Preset untuk tooling Tailwind v3-style / konsumsi nilai token dari JS. */
export const aeviaPreset = {
  theme: {
    extend: {
      colors: {
        action: "var(--brand-primary-action)",
        navy: "var(--brand-primary)",
        copper: "var(--brand-accent)",
        "copper-ink": "var(--brand-accent-ink)",
        deep: "var(--brand-dark)",
        ivory: "var(--brand-bg)",
        sand: "var(--brand-soft)",
        slate: "var(--aevia-slate)",
        body: "var(--aevia-body)",
      },
      fontFamily: { serif: ["var(--font-serif)"], sans: ["var(--font-sans)"] },
      borderRadius: { md: "8px", lg: "16px", pill: "9999px" },
    },
  },
};
export default aeviaPreset;
