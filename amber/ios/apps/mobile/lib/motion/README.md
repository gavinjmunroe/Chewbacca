# Motion primitives (`lib/motion`)

Tab 9's shared motion + micro-interaction layer. Every animation in the app
should route through these so motion reads consistently, stays on the UI thread,
and respects the OS Reduce Motion setting in one place.

Import from the barrel:

```ts
import { PressableScale, FadeInUp, springs, useAppReducedMotion } from '@/lib/motion';
```

## Setup requirements (read once)

- **Reanimated 4 / worklets.** The worklets babel plugin is added automatically
  by `babel-preset-expo` when `react-native-worklets` is installed (it is). No
  babel edit is needed.
- **Gesture handler root.** `PressableScale`, `Dismissible`, and `SwipeTabs` use
  `react-native-gesture-handler`. They must render under a `GestureHandlerRootView`.
  Expo Router wraps the app root in one by default; if a gesture primitive does
  nothing, confirm that wrapper is present at the app root.

## What's here

| Primitive                                    | Item | Use it for                                                                                       |
| -------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| `springs`, `timings`                         | #123 | Named physics: `gentle`, `snappy`, `bouncy`, `stiff`; timing curves `fast`/`base`/`slow`/`loop`. |
| `capStaggerDelay`                            | #122 | 40ms-per-row stagger delay, capped at 600ms total.                                               |
| `useAppReducedMotion`, `pickMotion`          | #133 | Live Reduce Motion flag + value picker.                                                          |
| `hapticPress` … `hapticError`                | #125 | The haptic vocabulary. Fire-and-forget, safe on simulator.                                       |
| `PressableScale`                             | #125 | Drop-in tappable: scale to 0.97 + haptic, press/disabled states.                                 |
| `FadeInUp`, `staggeredEntering`              | #122 | Staggered list entrance. Pass `staggeredEntering(index)` to a FlatList row's `entering`.         |
| `Shimmer`                                    | #129 | Animated gradient-sweep skeleton block.                                                          |
| `CountUp`                                    | #130 | Number that rolls up (scores, stats).                                                            |
| `CitationChip`                               | #126 | Pop + brand glow as a citation streams in; optional `onPress` rabbit-hole.                       |
| `SuccessCheck`                               | #127 | Checkmark that draws on + success haptic.                                                        |
| `AmberPulse`, `AmberRefresh`                 | #124 | Branded pulse indicator; custom pull-to-refresh ScrollView.                                      |
| `Dismissible`                                | #131 | Drag-down-to-dismiss for sheets and the person card.                                             |
| `useParallaxScroll`, `ParallaxHeader`        | #132 | Stretchy parallax header driven by scroll.                                                       |
| `Crossfade`, `SwipeTabs`                     | #128 | Keyed crossfade; gesture-interactive pager.                                                      |
| hero (`measureAndRegister`, `HeroTarget`, …) | #121 | Shared-element transition from rank card to person card.                                         |

All animation runs on the UI thread via Reanimated worklets (#134), and every
primitive checks `useAppReducedMotion()` and swaps springs for a calm fade or an
instant value when Reduce Motion is on (#133).

## Recipes

### Tappable (replace TouchableOpacity)

```tsx
<PressableScale onPress={open} accessibilityLabel="Open profile">
  <Card>…</Card>
</PressableScale>
```

### Staggered FlatList

```tsx
import Animated from 'react-native-reanimated';
import { staggeredEntering } from '@/lib/motion';

<FlatList
  data={people}
  renderItem={({ item, index }) => (
    <Animated.View entering={staggeredEntering(index)}>
      <RankCard person={item} />
    </Animated.View>
  )}
/>;
```

### Shared-element rank card → person card (#121)

Reanimated 4 dropped `sharedTransitionTag`, so this uses a measured-frame
registry instead. Source measures + registers on press, destination consumes the
frame on mount and springs in from it.

```tsx
// Rank card (Tab 1)
import { measureAndRegister } from '@/lib/motion';
const cardRef = useRef<View>(null);

<View ref={cardRef}>
  <PressableScale
    onPress={() =>
      measureAndRegister(cardRef, person.id, () => router.push(`/person/${person.id}`))
    }
  >
    …
  </PressableScale>
</View>;
```

```tsx
// Person card header (Tab 2)
import { HeroTarget } from '@/lib/motion';

<HeroTarget heroKey={person.id}>
  <PersonHeader person={person} />
</HeroTarget>;
```

If no frame was registered (deep link, cold open, Reduce Motion), `HeroTarget`
falls back to a plain fade, so it is always safe to wrap the header in it.

### Parallax person-card header (#132)

```tsx
const { scrollY, scrollHandler } = useParallaxScroll();

<Animated.ScrollView onScroll={scrollHandler} scrollEventThrottle={16}>
  <ParallaxHeader scrollY={scrollY} height={260}>
    <PersonHeader … />
  </ParallaxHeader>
  …
</Animated.ScrollView>;
```

### Dev gallery (#135)

Mount `MotionDemo` from a throwaway dev route to preview everything:

```tsx
// app/(gated)/_motion-demo.tsx
import { MotionDemo } from '@/lib/motion/MotionDemo';
export default MotionDemo;
```

It renders `null` outside `__DEV__`, so it can never ship in a release build.
