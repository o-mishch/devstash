import type { WithChildren } from '@/types/common';
import { HomepageNav } from '@/components/marketing/HomepageNav';

export default function MarketingLayout({ children }: WithChildren) {
  return (
    <>
      <HomepageNav />
      {children}
    </>
  );
}
