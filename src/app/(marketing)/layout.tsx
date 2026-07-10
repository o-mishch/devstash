import type { WithChildren } from '@/types/common';
import { HomepageNav } from '@/components/marketing/homepage-nav';
import { auth } from '@/auth';
import { RootProviderShell } from '@/components/shared/root-provider-shell';
import { Suspense } from 'react';

// Fully static — no props/state dependency — so it's hoisted to a module-level
// const instead of created inline as a `fallback` prop on every render.
const unauthenticatedNavFallback = <HomepageNav isAuthenticated={false} />;

export default function MarketingLayout({ children }: WithChildren) {
  return (
    <RootProviderShell theme="modern-minimal" colorMode="dark">
      <Suspense fallback={unauthenticatedNavFallback}>
        <MarketingHeader />
      </Suspense>
      <Suspense fallback={null}>
        {children}
      </Suspense>
    </RootProviderShell>
  );
}

async function MarketingHeader() {
  const session = await auth();
  return <HomepageNav isAuthenticated={!!session} />;
}
