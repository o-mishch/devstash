'use client'

import { useState, useCallback, useMemo } from 'react'
import { ItemDrawerContext } from '@/context/item-drawer-context'
import { ItemDetailDrawer } from './item-detail-drawer'

interface ItemDrawerProviderProps {
  children: React.ReactNode
}

export function ItemDrawerProvider({ children }: ItemDrawerProviderProps) {
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
