import type { WithChildren } from '@/types/common';
import { HomepageNav } from '@/components/marketing/homepage-nav';
import { auth } from '@/auth';

export default async function MarketingLayout({ children }: WithChildren) {
  const session = await auth();

  return (
    <>
      <HomepageNav isAuthenticated={!!session} />
      {children}
    </>
  );
}
