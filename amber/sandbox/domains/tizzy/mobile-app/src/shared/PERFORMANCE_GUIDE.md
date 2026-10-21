# Performance Optimization Guide

This guide covers the performance utilities available in the shared module to optimize rendering, data handling, and function execution.

## Overview

Three main tools are available:
1. **useOptimizedList** - Hook for efficient list rendering with windowing and memoization
2. **performance.ts utilities** - Debounce, throttle, memoization, and image optimization helpers
3. **Updated screens** - Sessions and Coaching screens now use performance optimizations

## 1. useOptimizedList Hook

### Purpose
Wrapper around React Native's FlatList with built-in optimizations for rendering large lists.

### Features
- **Windowing** - Only renders visible items + buffer
- **Batching** - Groups item renders into batches
- **Memoization** - Prevents unnecessary re-renders
- **Viewability tracking** - Knows which items are visible
- **Pagination support** - Built-in infinite scroll pattern

### Basic Usage

```typescript
import { useOptimizedList } from '../../src/shared/hooks/useOptimizedList';

function MyListScreen() {
  const { items, renderItem, keyExtractor, ...optimizedProps } = useOptimizedList({
    items: myData,
    renderItem: ({ item }) => <MyItemComponent item={item} />,
    keyExtractor: (item) => item.id,
    windowSize: 10, // Items to render outside visible area
    initialNumToRender: 10, // Initial items to render
  });

  return (
    <FlatList
      data={items}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      {...optimizedProps}
    />
  );
}
```

### Configuration Options

```typescript
interface WindowConfig {
  windowSize?: number; // Default: 10
  initialNumToRender?: number; // Default: 10
  updateCellsBatchingPeriod?: number; // Default: 50ms
  maxToRenderPerBatch?: number; // Default: 10
}
```

### Example: Sessions Screen

The sessions screen now uses `useOptimizedList`:

```typescript
const optimizedListProps = useOptimizedList({
  items: flatSessionsList,
  renderItem: ({ item }) => {
    if (item.type === 'header') {
      return <Text style={styles.groupTitle}>{item.label}</Text>;
    }
    return <SessionCard session={item.data!} onPress={handlePress} />;
  },
  keyExtractor: (item, index) => item.type === 'header' ? `header-${item.label}` : `session-${item.data?.id}`,
  windowSize: 10,
  initialNumToRender: 10,
});
```

## 2. Performance Utilities

### 2.1 Debounce

Delays function execution until after a delay period with no new invocations.

**Use cases:**
- Search input
- Resize handlers
- Text input validation
- API calls triggered by user input

**Example:**

```typescript
import { debounce } from '../../src/shared/utils/performance';

function SearchScreen() {
  const [searchQuery, setSearchQuery] = useState('');

  const debouncedSearch = useMemo(
    () => debounce((query: string) => {
      fetchSearchResults(query);
    }, 300), // 300ms delay
    []
  );

  const handleSearchChange = (text: string) => {
    debouncedSearch(text);
  };

  return (
    <TextInput
      onChangeText={handleSearchChange}
      placeholder="Search..."
    />
  );
}
```

**Methods:**
- `debouncedFunction.cancel()` - Cancel pending execution
- `debouncedFunction.flush()` - Execute immediately

### 2.2 Throttle

Ensures function executes at most once every specified interval.

**Use cases:**
- Scroll events
- Window resize
- Mouse move tracking
- Frequent update events

**Example:**

```typescript
import { throttle } from '../../src/shared/utils/performance';

const handleScroll = useMemo(
  () => throttle((scrollY: number) => {
    updateHeaderOpacity(scrollY);
  }, 200), // Execute at most once every 200ms
  []
);

<FlatList
  onScroll={(e) => handleScroll(e.nativeEvent.contentOffset.y)}
  scrollEventThrottle={16}
/>
```

### 2.3 Memoize

Caches function results based on arguments.

**Use cases:**
- Expensive computations
- Recursive calculations
- Data transformations
- Selector functions

**Example:**

```typescript
import { memoize } from '../../src/shared/utils/performance';

const expensiveComputation = memoize(
  (data: any) => {
    // Complex processing
    return result;
  },
  {
    maxSize: 50, // Keep 50 cached results
    ttl: 60000, // Cache for 60 seconds
  }
);

// Results are cached, repeated calls with same args return cached value
const result1 = expensiveComputation(data);
const result2 = expensiveComputation(data); // Returns cached result

// Clear cache when needed
expensiveComputation.clear();
```

### 2.4 Image Optimization

Utilities for generating optimized image URLs for different screen sizes.

**Example:**

```typescript
import {
  getOptimizedImageUrl,
  getResponsiveImageUrl
} from '../../src/shared/utils/performance';
import { useWindowDimensions } from 'react-native';

function OptimizedImage() {
  const { width } = useWindowDimensions();

  // For responsive images based on screen width and pixel ratio
  const optimizedUrl = getResponsiveImageUrl(
    imageUrl,
    width,
    PixelRatio.get()
  );

  return <Image source={{ uri: optimizedUrl }} />;
}
```

### 2.5 Batch Operations

Execute multiple operations in batches with progress tracking.

**Example:**

```typescript
import { batchOperations } from '../../src/shared/utils/performance';

const operations = items.map(item => async () => {
  return await apiService.processItem(item);
});

try {
  const results = await batchOperations(operations, 5, (completed, total) => {
    console.log(`Progress: ${completed}/${total}`);
  });
} catch (error) {
  console.error('Batch processing failed:', error);
}
```

### 2.6 Performance Monitor

Track and measure performance metrics.

**Example:**

```typescript
import { performanceMonitor } from '../../src/shared/utils/performance';

// Mark start
performanceMonitor.mark('session-load-start');

// ... do work ...

// Mark end
performanceMonitor.mark('session-load-end');

// Measure duration
const duration = performanceMonitor.measure(
  'session-load',
  'session-load-start',
  'session-load-end'
);

// Get metrics
const metrics = performanceMonitor.getMetrics('session-load');
console.log(`Avg: ${metrics?.avg}ms, Min: ${metrics?.min}ms, Max: ${metrics?.max}ms`);

// View all metrics
performanceMonitor.logMetrics();

// Clear
performanceMonitor.clear('session-load');
```

## 3. Updated Screens

### Sessions Screen (`app/(tabs)/sessions.tsx`)

**Optimizations applied:**
- Debounced search input (300ms delay)
- Flat list rendering with proper windowing
- Memoized session grouping
- Optimized filter/sort operations

**Key changes:**
```typescript
// Debounced search
const debouncedSetSearchQuery = useMemo(
  () => debounce((query: string) => setSearchQuery(query), 300),
  []
);

// Optimized list rendering
const optimizedListProps = useOptimizedList({
  items: flatSessionsList,
  renderItem: optimizedRender,
  windowSize: 10,
  initialNumToRender: 10,
});
```

### Coaching Screen (`app/(tabs)/coaching.tsx`)

**Optimizations applied:**
- FlatList with optimized windowing
- Proper item batching
- Memoized data structure
- Efficient session card rendering

**Key changes:**
```typescript
const flatSessionsList = useMemo<SessionListItem[]>(() => {
  // Flatten structure for efficient rendering
  return items;
}, [sessions, latestSession]);

const optimizedListProps = useOptimizedList({
  items: flatSessionsList,
  renderItem: optimizedRender,
  windowSize: 8,
  initialNumToRender: 5,
});
```

## Performance Tips

### 1. Use FlatList Instead of ScrollView + map()
```typescript
// Bad - renders all items
<ScrollView>
  {items.map(item => <ItemComponent key={item.id} {...item} />)}
</ScrollView>

// Good - uses windowing
<FlatList
  data={items}
  renderItem={({ item }) => <ItemComponent {...item} />}
  keyExtractor={item => item.id}
  windowSize={10}
  initialNumToRender={10}
/>
```

### 2. Memoize Expensive Computations
```typescript
// Bad - recomputes on every render
const filtered = items.filter(item => item.category === category);

// Good - only recomputes when dependencies change
const filtered = useMemo(
  () => items.filter(item => item.category === category),
  [items, category]
);
```

### 3. Debounce User Input
```typescript
// Bad - calls API on every keystroke
const handleSearch = (text) => {
  searchApi(text);
};

// Good - waits for user to stop typing
const handleSearch = debounce((text) => {
  searchApi(text);
}, 300);
```

### 4. Optimize Images
```typescript
// Consider device pixel ratio and screen width
const url = getResponsiveImageUrl(
  originalUrl,
  screenWidth,
  PixelRatio.get()
);
```

### 5. Use React.memo for List Items
```typescript
interface ItemProps {
  item: Item;
  onPress: (id: string) => void;
}

export const ListItem = React.memo(({ item, onPress }: ItemProps) => (
  <TouchableOpacity onPress={() => onPress(item.id)}>
    <Text>{item.title}</Text>
  </TouchableOpacity>
), (prev, next) => {
  // Custom comparison for deep equal
  return prev.item.id === next.item.id;
});
```

## Measuring Impact

Monitor performance improvements:

```typescript
import { performanceMonitor } from '../../src/shared/utils/performance';

// In component mount
useEffect(() => {
  performanceMonitor.mark('list-render-start');
  return () => {
    performanceMonitor.mark('list-render-end');
    const duration = performanceMonitor.measure(
      'list-render',
      'list-render-start',
      'list-render-end'
    );
    console.log(`List render took ${duration}ms`);
  };
}, []);
```

## Files Created/Modified

1. **Created:**
   - `/src/shared/hooks/useOptimizedList.ts` - Optimized list hook
   - `/src/shared/utils/performance.ts` - Performance utilities
   - `/src/shared/hooks/index.ts` - Hooks exports
   - `/src/shared/utils/index.ts` - Utils exports

2. **Modified:**
   - `app/(tabs)/sessions.tsx` - Added optimizations
   - `app/(tabs)/coaching.tsx` - Added optimizations

## Quick Reference

| Utility | Use Case | Example Delay |
|---------|----------|---|
| Debounce | Search, validation | 300-500ms |
| Throttle | Scroll, resize | 100-200ms |
| Memoize | Complex calculations | Cache size: 50-100 |
| useOptimizedList | Large lists | windowSize: 8-15 |
| Image optimization | Network/device efficiency | adaptive based on screen |

## Next Steps

1. Monitor performance metrics using `performanceMonitor`
2. Adjust window sizes and batch periods based on device capabilities
3. Add React.memo to custom list item components
4. Consider virtualized lists for very large datasets (1000+ items)
5. Profile with React Native Performance Monitor in development
