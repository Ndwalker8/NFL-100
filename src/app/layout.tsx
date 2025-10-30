// src/app/layout.tsx (or app/layout.tsx)
import "./globals.css";

import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "NFL 100-Point Challenge",
  description: "Hit 100 points with your weekly fantasy lineup!",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster richColors />
      </body>
    </html>
  );
}
