import type { WithChildren } from "@/types/common";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";
import { AppQueryClientProvider } from "@/providers/query-client-provider";
import { ServiceWorkerRegistration } from "@/components/shared/service-worker-registration";
import { MonacoConsoleSuppressor } from "@/components/shared/monaco-console-suppressor";
import { ThemeScript } from "@/components/shared/theme-script";
import "@/app/globals.css";
import "@/app/themes.generated.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

interface RootProviderShellProps extends WithChildren {
  theme: string;
  colorMode: string;
  themeScript?: boolean;
}

export function RootProviderShell({ children, theme, colorMode, themeScript }: RootProviderShellProps) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      data-theme={theme}
      className={`${geistSans.variable} ${geistMono.variable} ${colorMode} h-full antialiased scroll-smooth`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-background text-foreground">
        {themeScript && <ThemeScript />}
        <MonacoConsoleSuppressor />
        <AppQueryClientProvider>
          {children}
          <Toaster />
        </AppQueryClientProvider>
        {process.env.VERCEL === "1" && <Analytics />}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
