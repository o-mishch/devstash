import type { WithChildren } from '@/types/common';
import { HomepageNav } from '@/components/marketing/homepage-nav';
import { auth } from '@/auth';
import { RootProviderShell } from '@/components/shared/root-provider-shell';
import { Suspense } from 'react';

export default function MarketingLayout({ children }: WithChildren) {
  return (
    <RootProviderShell theme="modern-minimal" colorMode="dark">
      <Suspense fallback={<HomepageNav isAuthenticated={false} />}>
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
