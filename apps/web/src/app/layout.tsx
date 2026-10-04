import type { ReactNode } from "react";
import { fontVariables } from "@aevia/ui/fonts";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
