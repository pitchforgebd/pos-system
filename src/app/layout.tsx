import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";

import { ToastHost } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_NAME } from "@/constants/app";

import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm",
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: "Point of sale and business operations.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} h-full`}>
      <body className="min-h-full antialiased">
        <TooltipProvider>{children}</TooltipProvider>
        <ToastHost />
      </body>
    </html>
  );
}
