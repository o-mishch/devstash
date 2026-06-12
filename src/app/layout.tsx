import { Suspense } from "react";
import type { Metadata } from "next";
import type { WithChildren } from "@/types/common";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "@/providers/theme-provider";
import { AppQueryClientProvider } from "@/providers/query-client-provider";
import { ServiceWorkerRegistration } from "@/components/shared/service-worker-registration";
import { ThemeInitializer } from "@/components/shared/theme-initializer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DevStash",
  description: "Developer knowledge hub",
};

export default function RootLayout({ children }: Readonly<WithChildren>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased scroll-smooth`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-background text-foreground">
        <AppQueryClientProvider>
          <Suspense>
            <ThemeProvider attribute="data-theme" defaultTheme="vscode" enableSystem={false}>
              <ThemeInitializer />
              {children}
              <Toaster />
            </ThemeProvider>
          </Suspense>
        </AppQueryClientProvider>
        <Analytics />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
