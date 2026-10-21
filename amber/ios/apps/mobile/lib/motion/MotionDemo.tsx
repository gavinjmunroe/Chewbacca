// Tab 9 motion primitives: dev-only demo screen.
//
// Item #135: a gallery so any tab can preview the motion primitives in
// isolation before wiring them into a screen. Returns null outside __DEV__ so
// it can never ship in a release bundle.
//
// To view it, mount <MotionDemo /> from a throwaway dev route, e.g.
//   // app/(gated)/_motion-demo.tsx
//   import { MotionDemo } from '@/lib/motion/MotionDemo';
//   export default MotionDemo;
//
// This file lives under lib/motion (Tab 9 ownership). It intentionally does not
// import Tab 8's component primitives so it stays decoupled from screens.

import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';
import { AmberPulse } from './AmberRefresh';
import { CitationChip } from './CitationChip';
import { CountUp } from './CountUp';
import { Crossfade, SwipeTabs } from './TabTransition';
import { FadeInUp } from './FadeInUp';
import { PressableScale } from './PressableScale';
import { Shimmer } from './Shimmer';
import { SuccessCheck } from './SuccessCheck';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.md, paddingVertical: spacing.base }}>
      <Text style={{ ...typography.titleMd, color: colors.ink }}>{title}</Text>
      {children}
    </View>
  );
}

export function MotionDemo() {
  const [replay, setReplay] = useState(0);
  const [score, setScore] = useState(0);
  const [crossKey, setCrossKey] = useState('a');
  const [pageIndex, setPageIndex] = useState(0);

  if (!__DEV__) return null;

  const bump = () => setReplay((n) => n + 1);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.base }}
    >
      <Text style={{ ...typography.displayMd, color: colors.ink }}>Motion primitives</Text>
      <Text style={{ ...typography.bodySm, color: colors.muted }}>
        Tab 9 gallery. Toggle iOS Reduce Motion to verify the calm fallbacks.
      </Text>

      <Section title="PressableScale (#125)">
        <PressableScale
          onPress={bump}
          style={{
            backgroundColor: colors.primary,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.lg,
            borderRadius: radius.sm,
            alignSelf: 'flex-start',
          }}
        >
          <Text style={{ ...typography.buttonMd, color: colors.onPrimary }}>Press me</Text>
        </PressableScale>
      </Section>

      <Section title="FadeInUp stagger (#122)">
        <PressableScale onPress={bump}>
          <Text style={{ ...typography.link, color: colors.primary }}>Replay</Text>
        </PressableScale>
        <View key={replay} style={{ gap: spacing.sm }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <FadeInUp key={i} index={i}>
              <View
                style={{
                  height: 44,
                  borderRadius: radius.sm,
                  backgroundColor: colors.surfaceStrong,
                  justifyContent: 'center',
                  paddingHorizontal: spacing.base,
                }}
              >
                <Text style={{ ...typography.bodySm, color: colors.body }}>Row {i + 1}</Text>
              </View>
            </FadeInUp>
          ))}
        </View>
      </Section>

      <Section title="Shimmer (#129)">
        <Shimmer height={20} width="80%" />
        <Shimmer height={20} width="55%" />
      </Section>

      <Section title="CountUp (#130)">
        <CountUp
          value={score}
          decimals={0}
          style={{ ...typography.ratingDisplay, color: colors.ink }}
        />
        <PressableScale onPress={() => setScore(Math.round((score + 37) % 100))}>
          <Text style={{ ...typography.link, color: colors.primary }}>Roll the score</Text>
        </PressableScale>
      </Section>

      <Section title="CitationChip (#126)">
        <View style={{ flexDirection: 'row', gap: spacing.sm }} key={replay}>
          {['Maya R.', 'Dev P.', 'Sara L.'].map((name) => (
            <CitationChip key={name} onPress={bump}>
              <Text style={{ ...typography.caption, color: colors.primary }}>{name}</Text>
            </CitationChip>
          ))}
        </View>
      </Section>

      <Section title="SuccessCheck (#127)">
        <View key={replay}>
          <SuccessCheck />
        </View>
      </Section>

      <Section title="AmberPulse (#124)">
        <AmberPulse />
      </Section>

      <Section title="Crossfade (#128)">
        <Crossfade activeKey={crossKey}>
          <Text style={{ ...typography.displaySm, color: colors.ink }}>
            {crossKey === 'a' ? 'First view' : 'Second view'}
          </Text>
        </Crossfade>
        <PressableScale onPress={() => setCrossKey((k) => (k === 'a' ? 'b' : 'a'))}>
          <Text style={{ ...typography.link, color: colors.primary }}>Swap</Text>
        </PressableScale>
      </Section>

      <Section title="SwipeTabs (#128)">
        <Text style={{ ...typography.captionSm, color: colors.muted }}>
          Active pane: {pageIndex + 1} of 3. Drag horizontally.
        </Text>
        <View style={{ height: 120 }}>
          <SwipeTabs
            index={pageIndex}
            onIndexChange={setPageIndex}
            panes={[0, 1, 2].map((i) => ({
              key: `p${i}`,
              render: () => (
                <View
                  style={{
                    flex: 1,
                    margin: spacing.xs,
                    borderRadius: radius.md,
                    backgroundColor: colors.surfaceStrong,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ ...typography.displaySm, color: colors.body }}>Pane {i + 1}</Text>
                </View>
              ),
            }))}
          />
        </View>
      </Section>

      <View style={{ height: spacing.section }} />
    </ScrollView>
  );
}
