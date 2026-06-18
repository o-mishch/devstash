'use client'

import Link from 'next/link'
import { Folder } from 'lucide-react'
import { CollectionsGrid } from '@/components/dashboard/collections-grid'
import { DashboardCollapsibleCard } from '@/components/dashboard/dashboard-collapsible-card'
import type { CollectionWithTypes } from '@/types/collection'

interface DashboardCollectionsCardProps {
  collections: CollectionWithTypes[]
}

export function DashboardCollectionsCard({ collections }: DashboardCollectionsCardProps) {
  return (
    <DashboardCollapsibleCard
      icon={Folder}
      title="Collections"
      section="collections"
      overflowVisible
      headerAction={
        <Link
          href="/collections"
          prefetch={false}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all
        </Link>
      }
    >
      <CollectionsGrid collections={collections} />
    </DashboardCollapsibleCard>
  )
}
