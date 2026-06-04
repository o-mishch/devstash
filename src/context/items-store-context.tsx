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
    case ItemsStoreActionType.UpdateItem:
      return { ...state, items: state.items.map((i) => (i.id === action.item.id ? action.item : i)) }
    case ItemsStoreActionType.RemoveItem:
      return { ...state, items: state.items.filter((i) => i.id !== action.id) }
    case ItemsStoreActionType.SetLoading:
      return { ...state, loading: action.loading }
    case ItemsStoreActionType.UpdateItemFields:
      return {
        ...state,
        items: state.items
          .map((i) => (i.id === action.id ? { ...i, ...action.fields } : i))
          .filter((i) => {
            if (state.pageKey === 'favorites:items' && action.fields.isFavorite === false && i.id === action.id) {
              return false
            }
            return true
          })
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
