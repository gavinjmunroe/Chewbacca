import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { HealthRadar } from './HealthRadar';
import { RADAR_DIMENSIONS } from '../lib/healthDimensions';
import type { ContactRank } from '../lib/contactRank';
import { cl } from '../lib/classical';
export function PeopleRankCard({
  rank,
  loading,
  error,
  onRetry,
}: {
  rank: ContactRank | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const scored = !!rank?.computedAt;
  const pct = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 100);
  const values = RADAR_DIMENSIONS.map(
    (d) => rank?.dimensions.find((r) => r.code === d.toLowerCase())?.score ?? 0,
  );
  return (
    <View style={s.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="People Rank and six health dimensions"
        accessibilityState={{ expanded: open }}
        onPress={() => (error ? onRetry() : setOpen(!open))}
        style={s.row}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.title}>People Rank</Text>
          <Text style={s.small}>
            {error
              ? 'Could not load · Tap to retry'
              : loading
                ? 'Loading from Amber…'
                : scored
                  ? 'Explore your relationship across six dimensions'
                  : 'Building with your relationship history'}
          </Text>
        </View>
        <Text style={s.score}>{scored ? pct(rank!.score) : '—'}</Text>
        {open ? (
          <ChevronUp size={18} color={cl.goldDeep} />
        ) : (
          <ChevronDown size={18} color={cl.goldDeep} />
        )}
      </Pressable>
      {open && (
        <View style={{ gap: 12 }}>
          <View style={{ alignItems: 'center' }}>
            <HealthRadar size={280} values={scored ? values : undefined} />
          </View>
          <Text style={s.small}>
            Relationship evidence across the six dimensions of health. These describe what Amber
            knows about this relationship.
          </Text>
          {RADAR_DIMENSIONS.map((d) => {
            const value = rank?.dimensions.find((r) => r.code === d.toLowerCase());
            return (
              <View key={d.toLowerCase()} style={s.row}>
                <Text style={[s.label, { flex: 1 }]}>{d}</Text>
                <Text style={s.small}>
                  {value?.observations
                    ? `${pct(value.score)} · ${value.observations} signals`
                    : 'No signals yet'}
                </Text>
              </View>
            );
          })}
          {scored && (
            <Text style={s.small}>
              Updated {new Date(rank!.computedAt!).toLocaleDateString()} · {rank!.observations}{' '}
              relationship signals
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  card: { padding: 16, borderRadius: 22, backgroundColor: cl.groundGold, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  title: { fontFamily: 'Outfit_500Medium', fontSize: 16, color: cl.ink },
  label: { fontFamily: 'Outfit_400Regular', fontSize: 14, color: cl.ink },
  small: { fontFamily: 'Outfit_400Regular', fontSize: 12, lineHeight: 18, color: cl.ink62 },
  score: { fontFamily: 'Newsreader_500Medium', fontSize: 32, color: cl.goldDeep },
});
