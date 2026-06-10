'use client'

import { createContext, useContext, type Dispatch } from 'react'
import type { LightItem } from '@/types/item'

export const ItemsStoreActionType = {
  Reset: 'RESET',
  AppendPage: 'APPEND_PAGE',
  UpdateItem: 'UPDATE_ITEM',
  RemoveItem: 'REMOVE_ITEM',
  SetLoading: 'SET_LOADING',
  UpdateItemFields: 'UPDATE_ITEM_FIELDS',
  PrependItem: 'PREPEND_ITEM',
} as const

export interface ItemsStoreState {
  pageKey: string
  items: LightItem[]
  cursor: string | null
  hasMore: boolean
  loading: boolean
}

export type ItemsStoreAction =
  | { type: 'RESET'; pageKey: string; items: LightItem[]; cursor: string | null; hasMore: boolean }
  | { type: 'APPEND_PAGE'; items: LightItem[]; cursor: string | null; hasMore: boolean }
  | { type: 'UPDATE_ITEM'; item: LightItem }
  | { type: 'REMOVE_ITEM'; id: string }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'UPDATE_ITEM_FIELDS'; id: string; fields: Partial<LightItem> }
  | { type: 'PREPEND_ITEM'; item: LightItem }

export const itemsStoreInitialState: ItemsStoreState = {
  pageKey: '',
  items: [],
  cursor: null,
  hasMore: true,
  loading: false,
}

export function itemsStoreReducer(state: ItemsStoreState, action: ItemsStoreAction): ItemsStoreState {
  switch (action.type) {
    case ItemsStoreActionType.Reset:
      return { pageKey: action.pageKey, items: action.items, cursor: action.cursor, hasMore: action.hasMore, loading: false }
    case ItemsStoreActionType.AppendPage:
      return { ...state, items: [...state.items, ...action.items], cursor: action.cursor, hasMore: action.hasMore, loading: false }
    case ItemsStoreActionType.UpdateItem: {
      const oldItem = state.items.find(i => i.id === action.item.id)
      let changedSort = false
      if (oldItem && oldItem.isPinned !== action.item.isPinned) changedSort = true

      let items = state.items.map((i) => (i.id === action.item.id ? action.item : i))

      if (changedSort && state.pageKey !== 'favorites:items') {
        items = sortGridItems(items)
      }

      return { ...state, items }
    }
    case ItemsStoreActionType.RemoveItem:
      return { ...state, items: state.items.filter((i) => i.id !== action.id) }
    case ItemsStoreActionType.SetLoading:
      return { ...state, loading: action.loading }
    case ItemsStoreActionType.UpdateItemFields: {
      let changedSort = false
      let items = state.items
        .map((i) => {
          if (i.id === action.id) {
            if (action.fields.isPinned !== undefined && i.isPinned !== action.fields.isPinned) changedSort = true
            return { ...i, ...action.fields }
          }
          return i
        })
        .filter((i) => {
          if (state.pageKey === 'favorites:items' && action.fields.isFavorite === false && i.id === action.id) {
            return false
          }
          return true
        })

      if (changedSort && state.pageKey !== 'favorites:items') {
        items = sortGridItems(items)
      }
      return { ...state, items }
    }
    case ItemsStoreActionType.PrependItem: {
      // Only add to pages where this item type belongs: recent or matching type page
      const typeName = action.item.itemType.name
      const matchesPage = state.pageKey === 'recent' || state.pageKey === `type:${typeName}`
      if (!matchesPage) return state
      return { ...state, items: sortGridItems([action.item, ...state.items]) }
    }
  }
}

export interface ItemsStoreContextValue {
  state: ItemsStoreState
  dispatch: Dispatch<ItemsStoreAction>
}

export const ItemsStoreContext = createContext<ItemsStoreContextValue>({
  state: itemsStoreInitialState,
  dispatch: () => { },
})

export function useItemsStore() {
  return useContext(ItemsStoreContext)
}

export function useVirtualGridState(pageKey: string) {
  const { state } = useItemsStore()
  return {
    items: state.pageKey === pageKey ? state.items : [],
    hasMore: state.pageKey === pageKey ? state.hasMore : false,
    loading: state.pageKey === pageKey ? state.loading : false,
  }
}

function sortGridItems(items: LightItem[]): LightItem[] {
  return [...items].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    const timeA = new Date(a.createdAt).getTime()
    const timeB = new Date(b.createdAt).getTime()
    if (timeA !== timeB) return timeB - timeA
    if (a.id > b.id) return -1
    if (a.id < b.id) return 1
    return 0
  })
}
