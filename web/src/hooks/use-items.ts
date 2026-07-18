import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  InfiniteData,
  QueryClient,
  UseInfiniteQueryResult,
  UseMutationResult,
} from '@tanstack/react-query'
import { getItemContent } from '@/client'
import {
  createItemMutation,
  deleteItemMutation,
  getItemContentOptions,
  getItemDetailsOptions,
  getStatsOptions,
  listCollectionsOptions,
  listItemsInfiniteOptions,
  setItemFavoriteMutation,
  setItemPinnedMutation,
  updateItemMutation,
} from '@/client/@tanstack/react-query.gen'
import type {
  CreateItemData,
  CreateItemResponse,
  DeleteItemData,
  ErrorModel,
  ItemsPage,
  LightItem,
  ListItemsData,
  Options,
  SetItemFavoriteData,
  SetItemPinnedData,
  UpdateItemData,
  UpdateItemResponse,
} from '@/client'
import { toast } from 'sonner'
import { heyApiKeyIs, heyApiKeyIsInfinite } from '@/lib/query-keys'
import { toastMutationError } from '@/lib/api/errors'
import { favoriteToggleMessage } from '@/lib/utils'

type ItemsQuery = ListItemsData['query']

/** Infinite list of items for a given discriminated query (`recent` / `type` / …). */
export function useItemsInfinite(
  query: ItemsQuery,
): UseInfiniteQueryResult<InfiniteData<ItemsPage>, ErrorModel> {
  return useInfiniteQuery({
    ...listItemsInfiniteOptions({ query }),
    initialPageParam: '',
    getNextPageParam: (lastPage: ItemsPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  })
}

/** Flatten infinite pages into a single item array. */
export function flattenItems(data: InfiniteData<ItemsPage> | undefined): LightItem[] {
  return data?.pages.flatMap((page) => page.items ?? []) ?? []
}

/**
 * Count for a header badge — `undefined` (render no badge) unless the list is fully loaded.
 *
 * A badge is a factual claim about the user's data, so it reports the server's `total` — the
 * count of everything matching the filter — not the loaded pages. At a page size of 20 the
 * loaded count would tell a user with 57 favorites "20", then silently correct itself to
 * "40" and "57" as they page, which reads as data appearing from nowhere.
 *
 * `total` is identical on every page (the API counts without the cursor predicate), so page
 * 0 is as good as any. Undefined until a page arrives: showing nothing beats showing a wrong
 * number, and that includes showing "0" for a request that failed rather than came back empty.
 */
export function itemCount(
  query: UseInfiniteQueryResult<InfiniteData<ItemsPage>, ErrorModel>,
): number | undefined {
  return query.data?.pages[0]?.total
}

/**
 * Fetch an item's full stored content on demand (e.g. copy-to-clipboard). Kept in the
 * hooks/data layer so the generated client isn't called straight from a component.
 *
 * `throwOnError` is load-bearing: Hey API's fetch client defaults it to false and RETURNS
 * `{ data: undefined, error }` on a 401/404/5xx, so without it every HTTP failure would
 * read as "this item has no content" instead of as an error.
 */
export async function fetchItemContent(id: string): Promise<string> {
  const { data } = await getItemContent({ path: { id }, throwOnError: true })
  return data.content ?? ''
}

const isItemListQuery = (queryKey: readonly unknown[]): boolean =>
  heyApiKeyIs(queryKey, 'listItems')

/**
 * Whether a cached `listItems` key is the FAVORITES variant. Hey API puts the request's
 * `query` params on the key, so the list's identity is readable from the cache entry itself —
 * which is what lets a mutation refetch only the lists it actually changed.
 */
function isFavoritesListQuery(queryKey: readonly unknown[]): boolean {
  const first = queryKey[0]
  if (typeof first !== 'object' || first === null || !('query' in first)) return false
  const { query } = first
  return (
    typeof query === 'object' && query !== null && 'type' in query && query.type === 'favorites'
  )
}

/** Apply a transform to the item array of every cached item-list page. */
function updateItemLists(
  queryClient: QueryClient,
  transform: (items: LightItem[]) => LightItem[],
): void {
  queryClient.setQueriesData<InfiniteData<ItemsPage>>(
    // Infinite-only: this updater writes an `InfiniteData` shape, and the plain `listItems`
    // key caches a bare `ItemsPage` (no `.pages`).
    { predicate: (q) => isItemListQuery(q.queryKey) && heyApiKeyIsInfinite(q.queryKey) },
    (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items ? transform(page.items) : null,
        })),
      }
    },
  )
}

/**
 * Refetch the active item lists a mutation actually changed. The server, not the cache, decides
 * both list MEMBERSHIP and ORDER, and neither is derivable client-side: `favorites` filters
 * server-side (an un-favorited item must LEAVE the list, not just lose its star), the other lists
 * are keyset-ordered `{isPinned,createdAt,id}` DESC (a pinned item must move to the top), and
 * `total` is a server count. On mutation success `updateItemLists` patches the cache right away so
 * the changed row reflects it before this refetch settles — the refetch, not the patch, is the
 * source of truth for membership and order.
 *
 * COST, and why `match` exists: refetching an infinite query is NOT a cheap reset to page 1 —
 * query-core walks every loaded page SEQUENTIALLY, each awaiting the previous to derive the next
 * cursor. A user three pages into a list pays three serial round-trips, against a scale-to-zero
 * Cloud Run. So each caller narrows to the lists whose contents its mutation can actually have
 * moved; anything else is a refetch bought for nothing. Widen this only with a reason.
 */
function invalidateItemLists(
  queryClient: QueryClient,
  match: (queryKey: readonly unknown[]) => boolean = () => true,
): void {
  void queryClient.invalidateQueries({
    predicate: (q) => isItemListQuery(q.queryKey) && match(q.queryKey),
    refetchType: 'active',
  })
}

export function useToggleItemFavorite(): UseMutationResult<
  void,
  ErrorModel,
  Options<SetItemFavoriteData>
> {
  const queryClient = useQueryClient()
  return useMutation({
    ...setItemFavoriteMutation(),
    onSuccess: (_data, variables) => {
      const { id } = variables.path
      updateItemLists(queryClient, (items) =>
        items.map((it) => (it.id === id ? { ...it, isFavorite: variables.body.isFavorite } : it)),
      )
      // Favorites-only: this is the one list whose membership, order (`{updatedAt,id}` DESC)
      // and total this toggle moves. Everywhere else `isFavorite` is display state the patch
      // above already fixed — those lists are keyed on `{isPinned,createdAt,id}`, which a star
      // cannot change, so refetching them would buy nothing at a page-walk each.
      invalidateItemLists(queryClient, isFavoritesListQuery)
      toast.success(favoriteToggleMessage(variables.body.isFavorite))
    },
    onError: toastMutationError,
  })
}

export function useToggleItemPinned(): UseMutationResult<
  void,
  ErrorModel,
  Options<SetItemPinnedData>
> {
  const queryClient = useQueryClient()
  return useMutation({
    ...setItemPinnedMutation(),
    onSuccess: (_data, variables) => {
      const { id } = variables.path
      updateItemLists(queryClient, (items) =>
        items.map((it) => (it.id === id ? { ...it, isPinned: variables.body.isPinned } : it)),
      )
      // Unnarrowed: `isPinned` is the LEADING keyset column, so pinning re-orders every list
      // that carries the item — the patch above sets the icon, only the server can move the row.
      invalidateItemLists(queryClient)
      toast.success(variables.body.isPinned ? 'Pinned' : 'Unpinned')
    },
    onError: toastMutationError,
  })
}

/**
 * Create an item. A new item can land in `recent` and its type list (and shift a collection's
 * count), and it bumps the per-type / totals in `/stats` that drive the sidebar counts — so
 * this invalidates every item list plus the stats and collections queries. The server owns
 * membership and order, so there's no optimistic insert.
 */
export function useCreateItem(): UseMutationResult<
  CreateItemResponse,
  ErrorModel,
  Options<CreateItemData>
> {
  const queryClient = useQueryClient()
  return useMutation({
    ...createItemMutation(),
    onSuccess: () => {
      invalidateItemLists(queryClient)
      void queryClient.invalidateQueries({ queryKey: getStatsOptions().queryKey })
      void queryClient.invalidateQueries({ queryKey: listCollectionsOptions().queryKey })
      toast.success('Item created')
    },
    onError: toastMutationError,
  })
}

/**
 * Update an item (drawer edit). An edit can change the item's type (re-bucketing it across lists),
 * its title/content/tags, and its collection membership — so this invalidates every item list plus
 * the stats and collections queries, and refetches this item's detail + content. The server owns
 * membership and order, so there's no optimistic write.
 */
export function useUpdateItem(): UseMutationResult<
  UpdateItemResponse,
  ErrorModel,
  Options<UpdateItemData>
> {
  const queryClient = useQueryClient()
  return useMutation({
    ...updateItemMutation(),
    onSuccess: (_data, variables) => {
      const { id } = variables.path
      invalidateItemLists(queryClient)
      void queryClient.invalidateQueries({ queryKey: getStatsOptions().queryKey })
      void queryClient.invalidateQueries({ queryKey: listCollectionsOptions().queryKey })
      void queryClient.invalidateQueries({
        queryKey: getItemDetailsOptions({ path: { id } }).queryKey,
      })
      void queryClient.invalidateQueries({
        queryKey: getItemContentOptions({ path: { id } }).queryKey,
      })
      toast.success('Item saved')
    },
    onError: toastMutationError,
  })
}

export function useDeleteItem(): UseMutationResult<void, ErrorModel, Options<DeleteItemData>> {
  const queryClient = useQueryClient()
  return useMutation({
    ...deleteItemMutation(),
    onSuccess: (_data, variables) => {
      const { id } = variables.path
      updateItemLists(queryClient, (items) => items.filter((it) => it.id !== id))
      // Unnarrowed: the row leaves every list at once, and each list's `total` drops with it.
      // The filter above hides the row; without this the count badge would keep claiming it.
      invalidateItemLists(queryClient)
      toast.success('Item deleted')
    },
    onError: toastMutationError,
  })
}
