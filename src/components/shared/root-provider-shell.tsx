import type { WithChildren } from "@/types/common";
import { Geist, Geist_Mono } from "next/font/google";
import dynamic from "next/dynamic";
import { Toaster } from "@/components/ui/sonner";
import { AppQueryClientProvider } from "@/providers/query-client-provider";
import { ServiceWorkerRegistration } from "@/components/shared/service-worker-registration";
import { MonacoConsoleSuppressor } from "@/components/shared/monaco-console-suppressor";
import { ThemeScript } from "@/components/shared/theme-script";
import "@/app/globals.css";
import "@/app/themes.generated.css";

// @vercel/analytics is a Vercel-only client package. NEXT_PUBLIC_VERCEL is a build-time constant
// injected by next.config ('1' on Vercel builds, '' otherwise). On self-hosted (GCP/kind) builds
// it folds to '', so this resolves to null and the bundler dead-code-eliminates the dynamic
// import — dropping @vercel/analytics from the client bundle entirely. (A client asset can't be
// pruned via outputFileTracingExcludes, so it's gated at the import instead.)
const Analytics =
  process.env.NEXT_PUBLIC_VERCEL === "1"
    ? dynamic(() => import("@vercel/analytics/next").then((m) => m.Analytics))
    : null;

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
        {Analytics && <Analytics />}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
