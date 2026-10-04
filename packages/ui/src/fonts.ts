import { DM_Serif_Display, Manrope } from "next/font/google";

export const dmSerif = DM_Serif_Display({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-dm-serif",
  display: "swap",
});
export const manrope = Manrope({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});
export const fontVariables = `${dmSerif.variable} ${manrope.variable}`;
