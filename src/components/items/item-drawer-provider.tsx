'use client'

import { useState, useCallback, useMemo } from 'react'
import { ItemDrawerContext } from '@/context/item-drawer-context'
import { ItemDetailDrawer } from './drawer/item-detail-drawer'
import type { WithChildren } from '@/types/common'

export function ItemDrawerProvider({ children }: WithChildren) {
  const [open, setOpen] = useState(false)
  const [itemId, setItemId] = useState<string | null>(null)

  const openDrawer = useCallback((id: string) => {
    setItemId(id)
    setOpen(true)
  }, [])

  const contextValue = useMemo(() => ({ openDrawer }), [openDrawer])

  return (
    <ItemDrawerContext.Provider value={contextValue}>
      {children}
      <ItemDetailDrawer
        itemId={itemId}
        open={open}
        onOpenChange={setOpen}
      />
    </ItemDrawerContext.Provider>
  )
}
