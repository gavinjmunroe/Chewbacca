import { useMemo } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { CCard, CText } from './classical';
import { cl } from '../lib/classical';
import { HealthRadar } from './HealthRadar';
import {
  coverageLine,
  coverageNudge,
  dimensionsToRadar,
  getSelfDimensions,
  hasAnyCoverage,
} from '../lib/selfDimensions';
import { unwrapOrThrow } from '../lib/medhaId';

/**
 * YOUR OWN AMBER SCORE: how well Amber knows you, across the six dimensions.
 *
 * IT SAYS "KNOWN", AND IT NEVER SAYS "GOOD". The evidence underneath is things
 * you happened to mention to an app -- self-facts as you state them, plus, at a
 * fifth of the weight, the dimensions of the questions you ask. A thin spiritual
 * reading therefore means Amber has heard nothing about that part of your life.
 * It does not mean the part is thin, and a card that implied otherwise would be
 * handing somebody a verdict assembled out of their silence. Every string here
 * comes from lib/healthDimensions.ts, where a test forbids the vocabulary of
 * assessment: no balance, no healthy, no low, no score.
 *
 * WHY IT IS A COUNT AND NOT A PERCENTAGE. Somebody Amber knows deeply on two
 * dimensions and not at all on four averages to exactly the same number as
 * somebody it knows slightly on all six, and those two want different things
 * said to them. "Known across 4 of 6" is a sentence that can be checked.
 *
 * A FAILED LOAD DRAWS THE EMPTY FRAME. The radar without `values` is a real
 * state -- "building your read" -- so a network error, an instance that has not
 * run the migration, and a genuinely new user all land somewhere honest instead
 * of on a spinner or an error box in the middle of the profile.
 */
export function SelfDimensionsCard() {
  const { width } = useWindowDimensions();
  const size = Math.min(300, width - 96);

  const q = useQuery({
    queryKey: ['me', 'dimensions'],
    queryFn: async () => unwrapOrThrow(await getSelfDimensions()),
    staleTime: 5 * 60_000,
  });

  const rows = q.data?.dimensions ?? null;
  const values = useMemo(() => dimensionsToRadar(rows), [rows]);
  const any = hasAnyCoverage(rows);

  return (
    <CCard>
      <View style={{ alignItems: 'center' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'stretch',
            justifyContent: 'space-between',
          }}
        >
          <CText t="kicker" color={cl.goldKicker}>
            WHAT AMBER KNOWS
          </CText>
          <CText t="metaSm" color={cl.ink48}>
            {coverageLine(q.data?.summary)}
          </CText>
        </View>

        {/* No `values` until there is something to plot: the frame alone is the
            honest drawing of "nothing yet", and a hexagon of zeros would be a
            plotted shape claiming a measurement. */}
        <View style={{ marginTop: 6 }}>
          <HealthRadar size={size} values={any ? values : undefined} />
        </View>

        <CText
          t="metaSm"
          color={cl.ink48}
          style={{ textAlign: 'center', marginTop: 2, marginBottom: 2 }}
        >
          {q.isError
            ? 'Could not load this just now.'
            : q.isLoading
              ? 'Reading what you have told Amber.'
              : coverageNudge(rows)}
        </CText>
      </View>
    </CCard>
  );
}
