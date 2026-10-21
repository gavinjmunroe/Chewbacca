import { useMemo, useCallback, useRef, useEffect } from 'react';
import { FlatListProps, ListRenderItem, ViewToken } from 'react-native';

interface WindowConfig {
  /** Number of items to render outside the visible window */
  windowSize?: number;
  /** Initial number of items to render */
  initialNumToRender?: number;
  /** Number of items to render on every scroll */
  updateCellsBatchingPeriod?: number;
  /** Maximum number of items to render at once */
  maxToRenderPerBatch?: number;
}

interface OptimizedListConfig<T> extends WindowConfig {
  /** Items to render */
  items: T[];
  /** Render function for items */
  renderItem: ListRenderItem<T>;
  /** Key extractor function */
  keyExtractor?: (item: T, index: number) => string;
  /** Called when visible items change */
  onViewableItemsChanged?: (info: { viewableItems: ViewToken[] }) => void;
  /** Enable memoization of items */
  memoizeItems?: boolean;
  /** Enable memoization of render item function */
  memoizeRenderItem?: boolean;
}

export interface OptimizedListProps<T> extends Omit<FlatListProps<T>, 'data' | 'renderItem'> {
  items: T[];
  renderItem: ListRenderItem<T>;
  windowConfig?: WindowConfig;
  memoizeItems?: boolean;
  memoizeRenderItem?: boolean;
}

/**
 * Optimization hook for FlatList rendering
 * Provides windowing, batching, and memoization helpers
 */
export function useOptimizedList<T>({
  items,
  renderItem,
  keyExtractor,
  onViewableItemsChanged,
  windowSize = 10,
  initialNumToRender = 10,
  updateCellsBatchingPeriod = 50,
  maxToRenderPerBatch = 10,
  memoizeItems = true,
  memoizeRenderItem = true,
}: OptimizedListConfig<T>) {
  const viewableItemsRef = useRef<ViewToken[]>([]);
  const onViewableItemsChangedRef = useRef({ onViewableItemsChanged });

  // Update ref when callback changes (to avoid stale closures in FlatList)
  useEffect(() => {
    onViewableItemsChangedRef.current = { onViewableItemsChanged };
  }, [onViewableItemsChanged]);

  // Memoize items list to prevent unnecessary re-renders
  const memoizedItems = useMemo(() => items, [items]);

  // Memoize render item function
  const memoizedRenderItem = useCallback(
    (info: Parameters<ListRenderItem<T>>[0]) => renderItem(info),
    [renderItem]
  );

  // Handle viewable items change
  const handleViewableItemsChanged = useCallback(
    (info: { viewableItems: ViewToken[] }) => {
      viewableItemsRef.current = info.viewableItems;
      onViewableItemsChangedRef.current.onViewableItemsChanged?.(info);
    },
    []
  );

  // Default key extractor
  const defaultKeyExtractor = useCallback(
    (item: T, index: number) => {
      if (keyExtractor) {
        return keyExtractor(item, index);
      }
      if (item && typeof item === 'object' && 'id' in item) {
        return String((item as any).id);
      }
      return String(index);
    },
    [keyExtractor]
  );

  // Get currently visible items
  const getVisibleItems = useCallback((): T[] => {
    if (!memoizedItems) return [];
    return viewableItemsRef.current
      .map((viewToken) => {
        if (typeof viewToken.index === 'number') {
          return memoizedItems[viewToken.index];
        }
        return null;
      })
      .filter((item): item is T => item !== null);
  }, [memoizedItems]);

  return {
    items: memoizedItems,
    renderItem: memoizedRenderItem,
    keyExtractor: defaultKeyExtractor,
    onViewableItemsChanged: handleViewableItemsChanged,
    getVisibleItems,
    // FlatList optimization props
    windowSize,
    initialNumToRender,
    updateCellsBatchingPeriod,
    maxToRenderPerBatch,
    // Enable view tracking
    viewabilityConfig: {
      itemVisiblePercentThreshold: 50,
    },
  };
}

/**
 * Memoization helper for list items
 * Compares items shallowly to determine if list has changed
 */
export function useListMemoization<T>(items: T[]) {
  return useMemo(() => {
    return items;
  }, [items]);
}

/**
 * Hook to track which items are being rendered
 * Useful for analytics and performance monitoring
 */
export function useVisibleItemTracking<T>(
  getVisibleItems: () => T[],
  onItemsVisible?: (items: T[]) => void
) {
  useEffect(() => {
    const visibleItems = getVisibleItems();
    onItemsVisible?.(visibleItems);
  }, [getVisibleItems, onItemsVisible]);
}

/**
 * Hook for paginated list loading
 * Handles infinite scroll pattern
 */
export interface PaginationConfig {
  pageSize?: number;
  hasMorePages?: boolean;
  onLoadMore?: () => Promise<void>;
  loadMoreThreshold?: number;
}

export function usePaginatedList<T>(
  initialItems: T[],
  { pageSize = 20, hasMorePages = true, onLoadMore, loadMoreThreshold = 5 }: PaginationConfig = {}
) {
  const itemsRef = useRef<T[]>(initialItems);
  const isLoadingRef = useRef(false);

  const checkShouldLoadMore = useCallback(
    (visibleItems: T[]) => {
      if (
        !isLoadingRef.current &&
        hasMorePages &&
        onLoadMore &&
        visibleItems.length > 0
      ) {
        // Check if we're near the end
        const lastVisibleIndex = itemsRef.current.indexOf(
          visibleItems[visibleItems.length - 1]
        );
        if (lastVisibleIndex >= itemsRef.current.length - loadMoreThreshold) {
          isLoadingRef.current = true;
          onLoadMore().finally(() => {
            isLoadingRef.current = false;
          });
        }
      }
    },
    [hasMorePages, onLoadMore, loadMoreThreshold]
  );

  return {
    checkShouldLoadMore,
    pageSize,
  };
}
