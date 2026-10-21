import { NetworkCanvas } from '../components/NetworkCanvas';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  withSequence,
  withDelay,
} from 'react-native-reanimated';
import { MessageCircle, Mic, Plus, Search, Sparkles } from 'lucide-react-native';
import { cl } from '../lib/classical';

type Mode = 'Status' | 'Search' | 'Voice';
const MODES: Mode[] = ['Status', 'Search', 'Voice'];
const PEOPLE = ['Maya', 'Sam', 'Alex', 'Nina', 'Jo', 'Ari'];
const COPY: Record<Mode, { example: string; title: string; body: string }> = {
  Status: {
    example: 'Your circles · Amber Alert · Nearby',
    title: 'One rock. Three quick actions.',
    body: 'Tap your rock to customize your profile. Press and drag to switch networks, or choose Amber Alert to share your status.',
  },
  Search: {
    example: '“Who can help with product design?”',
    title: 'Find people. Make a connection.',
    body: 'Search your community in place. In Calendar, recordings and plans sit together. Follow your day, see friends’ shared updates and reopen any memo.',
  },
  Voice: {
    example: '“Sam starts a new role on Monday”',
    title: 'Say it once. Remember the details.',
    body: 'Voice notes add context to the people in your network, so the little things are easy to recall.',
  },
};

function MemoryPulse({ saved }: { saved: boolean }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = 0;
    if (!reduced)
      progress.value = withSequence(
        withDelay(250, withTiming(1, { duration: 650 })),
        withTiming(2, { duration: 200 }),
      );
  }, [saved, reduced, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: reduced ? 0 : progress.value <= 1 ? 1 : 2 - progress.value,
    transform: [{ translateY: -Math.min(progress.value, 1) * 78 }],
  }));
  return (
    <Animated.View accessible={false} style={[s.pulse, style]}>
      <Mic size={12} color={cl.card} />
    </Animated.View>
  );
}

/** An interactive illustration. These actions never import, record, or send data. */
export default function NetworkOnboardingDemo() {
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<Mode>('Status');
  const [playing, setPlaying] = useState(!reduced);
  const [added, setAdded] = useState(false);
  const [draft, setDraft] = useState(false);
  const [remembered, setRemembered] = useState(false);
  useEffect(() => {
    if (!playing || reduced) return;
    const search = setTimeout(() => setMode('Search'), 6000);
    const voice = setTimeout(() => {
      setMode('Voice');
      setPlaying(false);
    }, 12000);
    return () => {
      clearTimeout(search);
      clearTimeout(voice);
    };
  }, [playing, reduced]);
  const choose = (next: Mode) => {
    setPlaying(false);
    setMode(next);
    setDraft(false);
  };
  const copy = COPY[mode];
  return (
    <View style={s.root}>
      <View style={s.tabs} accessibilityRole="tablist">
        {MODES.map((item, i) => {
          const Icon = [Sparkles, Search, Mic][i];
          return (
            <Pressable
              key={item}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === item }}
              accessibilityLabel={`${item} demo`}
              onPress={() => choose(item)}
              style={[s.tab, mode === item && s.activeTab]}
            >
              <Icon size={15} color={mode === item ? cl.ink : cl.ink62} />
              <Text style={[s.tabText, mode === item && { color: cl.ink }]}>{item}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={s.explanation} accessibilityLiveRegion="polite">
        <Text style={s.title}>{copy.title}</Text>
        <Text style={s.body}>{copy.body}</Text>
      </View>
      <View style={s.graph}>
        <Text style={s.example}>{copy.example}</Text>
        <NetworkCanvas
          compact
          people={PEOPLE.slice(0, added ? 6 : 4).map((name, i) => ({
            id: name,
            name,
            context: [
              'hiking',
              'hiking new role Monday',
              'product design',
              'product design',
              'product design',
              'product design',
            ][i],
          }))}
          query={
            mode === 'Search' ? 'product design' : mode === 'Voice' ? 'Sam new role Monday' : ''
          }
          activity=""
          onOpen={() => {}}
        />
        {mode === 'Voice' && <MemoryPulse saved={remembered} />}
        {mode === 'Voice' && (
          <View style={s.memory}>
            <Mic size={12} color={cl.goldDeep} />
            <Text style={s.memoryText}>
              {remembered ? 'Saved to Sam · new role, Monday' : 'Voice note → Sam’s details'}
            </Text>
          </View>
        )}
      </View>
      {mode === 'Search' && (
        <View style={s.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setPlaying(false);
              setAdded(!added);
              setDraft(false);
            }}
            style={s.action}
          >
            <Plus size={15} color={cl.goldDeep} />
            <Text style={s.actionText}>
              {added ? 'Remove sample people' : 'Try adding Jo & Ari'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setPlaying(false);
              setDraft(!draft);
            }}
            style={s.action}
          >
            <MessageCircle size={15} color={cl.goldDeep} />
            <Text style={s.actionText}>Reach out to {added ? 'Jo' : 'Alex'}</Text>
          </Pressable>
        </View>
      )}
      {mode === 'Voice' && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setPlaying(false);
            setRemembered(!remembered);
          }}
          style={s.action}
        >
          <Mic size={15} color={cl.goldDeep} />
          <Text style={s.actionText}>
            {remembered ? 'Replay voice-note example' : 'Try saving this detail'}
          </Text>
        </Pressable>
      )}
      {draft && (
        <View style={s.draft}>
          <Text style={s.draftTitle}>Example message · not sent</Text>
          <Text style={s.body}>
            Hi {added ? 'Jo' : 'Alex'}, I’d love to hear about your product design work. Want to
            connect?
          </Text>
        </View>
      )}
      <View style={s.playback}>
        <Text style={s.caption}>Illustration with sample people</Text>
        {playing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pause walkthrough animation"
            onPress={() => setPlaying(false)}
            style={s.playButton}
          >
            <Text style={s.caption}>Pause</Text>
          </Pressable>
        ) : (
          !reduced && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Replay walkthrough animation"
              onPress={() => {
                setMode('Status');
                setAdded(false);
                setDraft(false);
                setRemembered(false);
                setPlaying(true);
              }}
              style={s.playButton}
            >
              <Text style={s.caption}>Replay</Text>
            </Pressable>
          )
        )}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  root: { marginTop: 20, gap: 14 },
  tabs: { flexDirection: 'row', backgroundColor: cl.groundGold, borderRadius: 24, padding: 4 },
  tab: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 20,
  },
  activeTab: { backgroundColor: cl.card },
  tabText: { fontFamily: 'Outfit_500Medium', fontSize: 14, color: cl.ink62 },
  graph: { height: 310, overflow: 'hidden', backgroundColor: cl.card, borderRadius: 28 },
  example: {
    paddingTop: 14,
    paddingHorizontal: 12,
    textAlign: 'center',
    color: cl.ink70,
    fontFamily: 'Outfit_400Regular',
    fontSize: 13,
  },
  pulse: {
    position: 'absolute',
    top: 145,
    left: '50%',
    marginLeft: -11,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: cl.goldDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memory: {
    position: 'absolute',
    bottom: 9,
    left: 12,
    right: 12,
    backgroundColor: cl.groundGold,
    borderRadius: 12,
    padding: 8,
    gap: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memoryText: { fontFamily: 'Outfit_400Regular', fontSize: 11, color: cl.ink70 },
  explanation: { gap: 6 },
  title: { fontFamily: 'Outfit_500Medium', fontSize: 18, color: cl.ink },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 15, lineHeight: 22, color: cl.ink70 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: cl.groundGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionText: { color: cl.goldDeep, fontFamily: 'Outfit_500Medium', fontSize: 12 },
  draft: { padding: 14, gap: 6, borderRadius: 18, backgroundColor: cl.groundGold },
  draftTitle: { fontFamily: 'Outfit_500Medium', fontSize: 12, color: cl.goldDeep },
  playback: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  caption: { fontFamily: 'Outfit_400Regular', fontSize: 11, color: cl.ink62 },
});
