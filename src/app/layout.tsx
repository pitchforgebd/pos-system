import type { Metadata } from "next";
import { Hind_Siliguri, IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";

import { ToastHost } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_NAME } from "@/constants/app";
import { getPrefs, I18nBoundary } from "@/lib/i18n/server";

import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm",
});

// IBM Plex Sans has no Bangla letters: Hind Siliguri (Bangla and Latin, subset) draws them, so a Bangla word is never in a fallback system font.
const bangla = Hind_Siliguri({
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-bn",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: "Point of sale and business operations.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The language is the person's (a cookie, Bangla by default): the page's lang, its font and its texts all follow it (H12)
  const { lang } = await getPrefs();
  return (
    <html lang={lang} className={`${sans.variable} ${bangla.variable} h-full`}>
      <body className="min-h-full antialiased">
        <I18nBoundary>
          <TooltipProvider>{children}</TooltipProvider>
          <ToastHost />
        </I18nBoundary>
      </body>
    </html>
  );
}
