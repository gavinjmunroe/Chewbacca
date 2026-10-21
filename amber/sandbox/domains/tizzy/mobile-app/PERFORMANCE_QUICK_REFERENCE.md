# Performance Optimization Quick Reference

## One-Liner Imports

```typescript
// Performance utilities
import { debounce, throttle, memoize, performanceMonitor } from '../../src/shared/utils/performance';

// Optimized list hook
import { useOptimizedList, usePaginatedList } from '../../src/shared/hooks/useOptimizedList';
```

## Common Patterns

### Debounced Search Input
```typescript
const debouncedSearch = useMemo(
  () => debounce((query) => searchAPI(query), 300),
  []
);

<TextInput
  onChangeText={debouncedSearch}
  placeholder="Search..."
/>
```

### Throttled Scroll Listener
```typescript
const handleScroll = useMemo(
  () => throttle((scrollY) => updateHeaderOpacity(scrollY), 100),
  []
);

<FlatList
  onScroll={(e) => handleScroll(e.nativeEvent.contentOffset.y)}
  scrollEventThrottle={16}
/>
```

### Optimized FlatList
```typescript
const { items, renderItem, keyExtractor, ...props } = useOptimizedList({
  items: data,
  renderItem: ({ item }) => <ItemComponent item={item} />,
  windowSize: 10,
});

<FlatList
  data={items}
  renderItem={renderItem}
  keyExtractor={keyExtractor}
  {...props}
/>
```

### Memoized Computation
```typescript
const filtered = useMemo(
  () => items.filter(x => x.category === category),
  [items, category]
);

// OR with caching:
const computeExpensive = useMemo(
  () => memoize((data) => complexCalc(data), { maxSize: 50 }),
  []
);
```

### Performance Measurement
```typescript
performanceMonitor.mark('start');
// ... code to measure ...
performanceMonitor.mark('end');
performanceMonitor.measure('name', 'start', 'end');
performanceMonitor.logMetrics();
```

## Configuration Templates

### Small Lists (< 50 items)
```typescript
{ windowSize: 5, initialNumToRender: 5, maxToRenderPerBatch: 5 }
```

### Medium Lists (50-200 items)
```typescript
{ windowSize: 10, initialNumToRender: 10, maxToRenderPerBatch: 10 }
```

### Large Lists (> 200 items)
```typescript
{ windowSize: 15, initialNumToRender: 15, maxToRenderPerBatch: 15 }
```

### Search Debounce Delays
```typescript
300ms   // General search
500ms   // Validation
1000ms  // Heavy API calls
```

### Throttle Intervals
```typescript
50ms    // UI feedback (20 FPS)
100ms   // Smooth interaction (10 FPS)
200ms   // Background updates (5 FPS)
```

## Debugging Tips

### Check if list is virtualized
```typescript
// Look for FlatList with windowSize prop
<FlatList windowSize={10} ... />  // ✓ Good
<ScrollView><FlatList /></ScrollView>  // ✗ Bad
```

### Verify debounce is working
```typescript
const search = debounce(query => {
  console.log('Searching for:', query);
}, 300);

search('test'); // Won't log
setTimeout(() => console.log('Should be logged'), 400);
```

### Monitor performance
```typescript
import { PerformanceMonitor } from '../../src/shared/utils/performance';

const perf = new PerformanceMonitor();
perf.mark('operation-start');
// ... do work ...
perf.mark('operation-end');
console.log(perf.measure('operation', 'operation-start', 'operation-end'));
```

## Common Mistakes to Avoid

### ✗ Don't create new debounced function on every render
```typescript
const handleSearch = debounce((q) => search(q), 300); // Bad!
```

### ✓ Do memoize the debounced function
```typescript
const handleSearch = useMemo(
  () => debounce((q) => search(q), 300),
  []
);
```

### ✗ Don't render all items in ScrollView
```typescript
<ScrollView>
  {items.map(item => <Item key={item.id} item={item} />)}
</ScrollView>
```

### ✓ Do use FlatList for large lists
```typescript
<FlatList data={items} renderItem={renderItem} />
```

### ✗ Don't debounce inside handlers
```typescript
const handleSearch = (text) => {
  debounce(() => search(text), 300)();
};
```

### ✓ Do create debounced function outside
```typescript
const debouncedSearch = useMemo(
  () => debounce(search, 300),
  []
);
const handleSearch = (text) => debouncedSearch(text);
```

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| List scroll FPS | 60 | Varies with data |
| Search response | < 100ms | 300ms (debounced) |
| Initial render | < 500ms | Depends on list size |
| Memory (100 items) | < 5MB | ~2-3MB with windowing |

## Files to Review

- **Implementation:** `/src/shared/utils/performance.ts`
- **List Hook:** `/src/shared/hooks/useOptimizedList.ts`
- **Full Guide:** `/src/shared/PERFORMANCE_GUIDE.md`
- **Summary:** `/PERFORMANCE_OPTIMIZATIONS_SUMMARY.md`

## Quick Test

```typescript
// Paste in your screen to test performance monitoring
import { performanceMonitor } from '../../src/shared/utils/performance';

useEffect(() => {
  performanceMonitor.mark('screen-load');
  return () => {
    performanceMonitor.mark('screen-unload');
    const time = performanceMonitor.measure(
      'load-time',
      'screen-load',
      'screen-unload'
    );
    console.log(`Screen loaded in ${time.toFixed(2)}ms`);
  };
}, []);
```

## Utilities at a Glance

| Function | Input | Output | Use Case |
|----------|-------|--------|----------|
| `debounce(fn, 300)` | Function | Debounced function | Search, validation |
| `throttle(fn, 100)` | Function | Throttled function | Scroll, resize |
| `memoize(fn, {maxSize})` | Function | Memoized function | Expensive calcs |
| `useOptimizedList({...})` | Options | List props | FlatList optimization |
| `usePaginatedList({...})` | Options | Pagination helpers | Infinite scroll |
| `performanceMonitor` | - | Monitor instance | Performance tracking |

---

**Pro Tip:** Start with debounce on search inputs and optimize lists with windowing. These two changes will give you 80% of the performance improvement.
