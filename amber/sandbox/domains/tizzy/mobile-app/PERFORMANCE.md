# Performance Optimization Guide

This document outlines performance best practices and optimizations implemented in the Tizzy mobile app.

## Table of Contents

- [Performance Goals](#performance-goals)
- [Key Optimizations](#key-optimizations)
- [Performance Monitoring](#performance-monitoring)
- [Best Practices](#best-practices)
- [Common Issues](#common-issues)
- [Tools](#tools)

## Performance Goals

### Target Metrics

- **App Launch Time**: < 2 seconds
- **Screen Load Time**: < 1 second
- **API Response Time**: < 500ms (local network)
- **List Scroll**: 60 FPS (no jank)
- **Memory Usage**: < 150MB (average)
- **Bundle Size**: < 5MB (optimized)

### Current Implementation

The app implements several performance optimizations:

1. **Hermes Engine**: Enabled for faster JavaScript execution
2. **Inline Requires**: Lazy loading for faster startup
3. **Optimized Lists**: FlatList with windowing and memoization
4. **Component Memoization**: React.memo for expensive components
5. **State Optimization**: Zustand for minimal re-renders
6. **Asset Optimization**: Image compression and caching
7. **Metro Bundler**: Optimized for faster builds
8. **Performance Monitoring**: Real-time tracking of key metrics

## Key Optimizations

### 1. Component-Level Optimizations

#### Use React.memo for Pure Components

```typescript
import React, { memo } from 'react';

export const MyComponent = memo(({ data }) => {
  return <View>{/* ... */}</View>;
});
```

#### Use useMemo for Expensive Calculations

```typescript
const expensiveValue = useMemo(() => {
  return computeExpensiveValue(data);
}, [data]);
```

#### Use useCallback for Function Props

```typescript
const handlePress = useCallback(() => {
  doSomething(id);
}, [id]);
```

### 2. List Optimizations

#### FlatList Best Practices

```typescript
<FlatList
  data={items}
  renderItem={renderItem}
  keyExtractor={(item) => item.id}
  // Performance props
  windowSize={8} // Number of screens to render
  initialNumToRender={10} // Items to render initially
  maxToRenderPerBatch={10} // Max items per batch
  updateCellsBatchingPeriod={50} // Batch update delay
  removeClippedSubviews={true} // Remove off-screen views
  // Use getItemLayout if possible
  getItemLayout={(data, index) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index,
  })}
/>
```

#### Optimized List Hook

```typescript
import { useOptimizedList } from '../hooks/useOptimizedList';

const listProps = useOptimizedList({
  items: data,
  renderItem: ({ item }) => <ItemComponent item={item} />,
  keyExtractor: (item) => item.id,
});

<FlatList {...listProps} />;
```

### 3. Image Optimization

#### Use Optimized Image Component

```typescript
import { Image } from 'expo-image';

<Image
  source={{ uri: imageUrl }}
  style={styles.image}
  contentFit="cover"
  transition={200}
  cachePolicy="memory-disk" // Cache for faster loads
/>;
```

#### Preload Critical Images

```typescript
import { Asset } from 'expo-asset';

await Asset.loadAsync([
  require('./assets/logo.png'),
  require('./assets/background.png'),
]);
```

### 4. State Management Optimization

#### Use Zustand for Minimal Re-renders

```typescript
import create from 'zustand';

const useStore = create((set) => ({
  data: null,
  setData: (data) => set({ data }),
}));

// Only re-renders when specific state changes
const data = useStore((state) => state.data);
```

#### Avoid Unnecessary State

```typescript
// ❌ Bad: Storing derived state
const [total, setTotal] = useState(0);

// ✅ Good: Calculate on render
const total = useMemo(() => items.reduce((sum, item) => sum + item.price, 0), [items]);
```

### 5. API Optimization

#### Use React Query for Caching

```typescript
import { useQuery } from '@tanstack/react-query';

const { data, isLoading } = useQuery({
  queryKey: ['sessions', userId],
  queryFn: () => apiService.getSessions(userId),
  staleTime: 5 * 60 * 1000, // 5 minutes
  cacheTime: 10 * 60 * 1000, // 10 minutes
});
```

#### Batch API Requests

```typescript
// ❌ Bad: Multiple sequential requests
const user = await api.getUser(userId);
const sessions = await api.getSessions(userId);
const progress = await api.getProgress(userId);

// ✅ Good: Parallel requests
const [user, sessions, progress] = await Promise.all([
  api.getUser(userId),
  api.getSessions(userId),
  api.getProgress(userId),
]);
```

### 6. Bundle Size Optimization

#### Lazy Load Screens

```typescript
import { lazy, Suspense } from 'react';

const SessionDetailScreen = lazy(() => import('./screens/SessionDetail'));

function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <SessionDetailScreen />
    </Suspense>
  );
}
```

#### Analyze Bundle Size

```bash
npx expo export --platform ios
npx react-native-bundle-visualizer
```

## Performance Monitoring

### Using Performance Profiler

```typescript
import { PerformanceProfiler } from '../components/PerformanceProfiler';

export function MyScreen() {
  return (
    <PerformanceProfiler id="MyScreen">
      {/* Your component tree */}
    </PerformanceProfiler>
  );
}
```

### Track Screen Load Time

```typescript
import { usePerformanceTracking } from '../hooks/usePerformanceTracking';

export function MyScreen() {
  usePerformanceTracking('MyScreen');

  return <View>{/* ... */}</View>;
}
```

### Track API Calls

```typescript
import { useAPICallTracking } from '../hooks/usePerformanceTracking';

export function useData() {
  const trackAPI = useAPICallTracking();

  const fetchData = async () => {
    const callId = trackAPI.start('/api/sessions');
    try {
      const data = await api.getSessions();
      trackAPI.end(callId, true);
      return data;
    } catch (error) {
      trackAPI.end(callId, false);
      throw error;
    }
  };
}
```

### View Performance Metrics

```typescript
import { PerformanceMonitoring } from '../services/PerformanceMonitoring';

const metrics = PerformanceMonitoring.getMetrics();
console.log('Performance Metrics:', metrics);
```

## Best Practices

### DO:

- ✅ Use FlatList for long lists (not ScrollView)
- ✅ Memoize expensive computations
- ✅ Use key prop correctly in lists
- ✅ Optimize images (compress, resize, cache)
- ✅ Avoid inline function definitions in render
- ✅ Use React.memo for pure components
- ✅ Lazy load screens and heavy components
- ✅ Batch API requests when possible
- ✅ Use Hermes engine
- ✅ Profile before optimizing

### DON'T:

- ❌ Don't use ScrollView for long lists
- ❌ Don't create new objects/arrays in render
- ❌ Don't use index as key in dynamic lists
- ❌ Don't optimize prematurely
- ❌ Don't ignore performance warnings
- ❌ Don't nest FlatLists
- ❌ Don't use console.log in production
- ❌ Don't load all data at once

## Common Issues

### Issue: List scroll is janky

**Solutions:**

1. Use `getItemLayout` if items are fixed height
2. Increase `windowSize` for smoother scrolling
3. Memoize list items with `React.memo`
4. Avoid heavy computations in `renderItem`
5. Use `removeClippedSubviews={true}`

### Issue: App launch is slow

**Solutions:**

1. Enable inline requires in metro.config.js
2. Lazy load screens
3. Defer non-critical initialization
4. Optimize splash screen
5. Use Hermes engine

### Issue: High memory usage

**Solutions:**

1. Clear unused image cache
2. Limit FlatList windowSize
3. Remove event listeners on unmount
4. Use `removeClippedSubviews`
5. Profile with React DevTools

### Issue: Bundle size is large

**Solutions:**

1. Remove unused dependencies
2. Use tree-shaking friendly imports
3. Lazy load screens
4. Analyze bundle with visualizer
5. Optimize images

## Tools

### Development Tools

1. **React DevTools Profiler**: Identify slow components
2. **Flipper**: Debug performance, network, and state
3. **React Native Performance Monitor**: FPS and memory tracking
4. **Metro Bundler**: Analyze bundle size
5. **Xcode Instruments**: iOS-specific profiling
6. **Android Profiler**: Android-specific profiling

### Profiling Commands

```bash
# iOS profiling with Instruments
npx react-native run-ios --configuration Release

# Android profiling
npx react-native run-android --variant=release

# Bundle analysis
npx expo export --platform ios
npx react-native-bundle-visualizer

# Memory profiling
# Use Flipper or Xcode Instruments
```

### Performance Testing

```bash
# Test app performance
npm run test:performance

# Profile specific screen
ENABLE_PERFORMANCE_PROFILING=true npm start
```

## Monitoring in Production

### Sentry Performance Monitoring

```typescript
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: SENTRY_DSN,
  tracesSampleRate: 0.1, // 10% of transactions
  enableAutoPerformanceTracking: true,
});
```

### Custom Performance Metrics

```typescript
// Track custom metrics
PerformanceMonitoring.trackComponentRender('MyComponent', 'update', 45, 20);
PerformanceMonitoring.trackListScroll('SessionList', 100, 58, false);
PerformanceMonitoring.trackMemoryUsage('HomeScreen', 125);
```

## Resources

- [React Native Performance](https://reactnative.dev/docs/performance)
- [Expo Performance](https://docs.expo.dev/guides/analyzing-bundles/)
- [React Optimization](https://react.dev/learn/render-and-commit#optimizing-performance)
- [Metro Bundler](https://metrobundler.dev/)
- [Hermes Engine](https://hermesengine.dev/)

---

Last updated: February 13, 2026
