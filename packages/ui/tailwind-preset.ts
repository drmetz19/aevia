/** Preset untuk tooling Tailwind v3-style / konsumsi nilai token dari JS. */
export const aeviaPreset = {
  theme: {
    extend: {
      colors: {
        navy: "var(--brand-primary)",
        copper: "var(--brand-accent)",
        deep: "var(--brand-dark)",
        ivory: "var(--brand-bg)",
        sand: "var(--brand-soft)",
        slate: "var(--aevia-slate)",
        body: "var(--aevia-body)",
      },
      fontFamily: { serif: ["var(--font-serif)"], sans: ["var(--font-sans)"] },
      borderRadius: { lg: "20px", pill: "36px" },
    },
  },
};
export default aeviaPreset;
