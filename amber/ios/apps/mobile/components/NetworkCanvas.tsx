import Svg, { Circle } from 'react-native-svg';
import { Minus, Plus, LocateFixed } from 'lucide-react-native';
import { AmberRock } from './AmberRock';
import type { RockAction, SavedNetwork } from '../lib/amberSpace';
import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import {
  arrangeCircle,
  visibleCircleNodes,
  warmCircleSearchIndex,
  type CirclePerson,
} from '../lib/networkLayout';
import { cl } from '../lib/classical';
export type NetworkPerson = CirclePerson;
const SPRING = { damping: 24, stiffness: 140, mass: 1 };
type Node = ReturnType<typeof arrangeCircle>[number];
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
function Orbit({
  radius,
  width,
  height,
  panX,
  panY,
  zoom,
}: {
  radius: number;
  width: number;
  height: number;
  panX: SharedValue<number>;
  panY: SharedValue<number>;
  zoom: SharedValue<number>;
}) {
  const props = useAnimatedProps(() => ({
    cx: width / 2 + panX.value,
    cy: height / 2 + panY.value,
    r: radius * zoom.value,
  }));
  return <AnimatedCircle animatedProps={props} fill="none" stroke="#E8DCCB" strokeWidth={1} />;
}
const Person = memo(function Person({
  node,
  width,
  height,
  panX,
  panY,
  zoom,
  onPress,
  dim,
}: {
  node: Node;
  width: number;
  height: number;
  panX: SharedValue<number>;
  panY: SharedValue<number>;
  zoom: SharedValue<number>;
  onPress: (id: string) => void;
  dim: boolean;
}) {
  const reduced = useReducedMotion();
  const x = useSharedValue(node.x),
    y = useSharedValue(node.y);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    x.value = reduced ? node.x : withSpring(node.x, SPRING);
    y.value = reduced ? node.y : withSpring(node.y, SPRING);
  }, [node.x, node.y, reduced, x, y]);
  const motion = useAnimatedStyle(() => ({
    transform: [
      { translateX: width / 2 - 36 + x.value * zoom.value + panX.value },
      { translateY: height / 2 - 30 + y.value * zoom.value + panY.value },
      { scale: Math.max(0.82, Math.min(1, zoom.value)) },
    ],
  }));
  const label = useAnimatedStyle(() => ({ opacity: zoom.value < 0.75 ? 0 : 1 }));
  return (
    <Animated.View style={[s.node, motion, { opacity: dim ? 0.38 : 1 }]}>
      <Pressable
        onPress={() => onPress(node.id)}
        accessibilityRole="button"
        accessibilityLabel={`${node.name}${node.relevant ? ', matches your focus' : ''}`}
        style={s.person}
      >
        <View style={[s.avatar, node.relevant && s.relevant]}>
          {node.avatarUrl && !failed ? (
            <Image
              source={{ uri: node.avatarUrl }}
              onError={() => setFailed(true)}
              style={s.photo}
            />
          ) : (
            <Text style={s.initial}>
              {node.name
                .split(' ')
                .map((p) => p[0])
                .slice(0, 2)
                .join('')}
            </Text>
          )}
        </View>
        <Animated.Text numberOfLines={1} style={[s.name, label]}>
          {node.name}
        </Animated.Text>
      </Pressable>
    </Animated.View>
  );
});
/** Shared by onboarding and Community. Positions respond to actual saved context; rings do not imply relationships between contacts. */
export const NetworkCanvas = memo(function NetworkCanvas({
  people,
  onOpen,
  focusId,
  query = '',
  activity = '',
  compact = false,
  activeNetwork = 'All',
  onRockAction,
  selfAvatar: _selfAvatar,
}: {
  people: NetworkPerson[];
  onOpen: (id: string) => void;
  focusId?: string;
  selfAvatar?: string | null;
  query?: string;
  activity?: string;
  compact?: boolean;
  activeNetwork?: SavedNetwork;
  onRockAction?: (action: RockAction) => void;
}) {
  const [size, setSize] = useState({ width: 340, height: compact ? 260 : 400 });
  const reduced = useReducedMotion();
  const panX = useSharedValue(0),
    panY = useSharedValue(0),
    startX = useSharedValue(0),
    startY = useSharedValue(0);
  const zoom = useSharedValue(1);
  const startZoom = useSharedValue(1);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  useAnimatedReaction(
    () => ({
      x: Math.round(panX.value / 80),
      y: Math.round(panY.value / 80),
      z: Math.round(zoom.value * 20),
    }),
    (current, previous) => {
      if (
        !previous ||
        current.x !== previous.x ||
        current.y !== previous.y ||
        current.z !== previous.z
      )
        runOnJS(setCamera)({ x: panX.value, y: panY.value, zoom: zoom.value });
    },
  );
  const intent = useDeferredValue(query.trim() || activity);
  useEffect(() => warmCircleSearchIndex(people), [people]);
  const nodes = useMemo(
    () => arrangeCircle(people, intent, size.width, size.height, compact),
    [people, intent, size, compact],
  );
  const visible = useMemo(
    () => (compact ? nodes : visibleCircleNodes(nodes, size, camera)),
    [nodes, size, camera, compact],
  );
  const extent = useMemo(
    () => nodes.reduce((max, n) => Math.max(max, Math.hypot(n.x, n.y)), 100),
    [nodes],
  );
  const matchCount = nodes.filter((p) => p.relevant).length;
  const recenter = () => {
    panX.value = reduced ? 0 : withSpring(0, SPRING);
    panY.value = reduced ? 0 : withSpring(0, SPRING);
  };
  useEffect(() => {
    const p = nodes.find((n) => n.id === focusId);
    panX.value = reduced
      ? -(p?.x ?? 0) * zoom.value
      : withSpring(-(p?.x ?? 0) * zoom.value, SPRING);
    panY.value = reduced
      ? -(p?.y ?? 0) * zoom.value
      : withSpring(-(p?.y ?? 0) * zoom.value, SPRING);
  }, [focusId, intent, nodes, reduced, panX, panY, zoom]);
  const pan = Gesture.Pan()
    .enabled(!compact)
    .minDistance(8)
    .onBegin(() => {
      startX.value = panX.value;
      startY.value = panY.value;
    })
    .onUpdate((e) => {
      const limit = extent * zoom.value;
      panX.value = Math.max(-limit, Math.min(limit, startX.value + e.translationX));
      panY.value = Math.max(-limit, Math.min(limit, startY.value + e.translationY));
    });
  const pinch = Gesture.Pinch()
    .enabled(!compact)
    .onBegin(() => {
      startZoom.value = zoom.value;
    })
    .onUpdate((event) => {
      zoom.value = Math.max(0.6, Math.min(1.4, startZoom.value * event.scale));
    });
  const changeZoom = (factor: number) => {
    const target = Math.max(0.6, Math.min(1.4, zoom.value * factor));
    zoom.value = reduced ? target : withSpring(target, SPRING);
  };
  const center = useAnimatedStyle(() => ({
    transform: [{ translateX: panX.value }, { translateY: panY.value }],
  }));
  return (
    <View style={[s.root, compact && { flex: 0, height: 260, minHeight: 260 }]}>
      {!compact && (
        <View style={s.heading}>
          <Text style={s.title}>
            {activeNetwork === 'All'
              ? 'Your people'
              : activeNetwork === 'Nearby'
                ? 'Nearby'
                : activeNetwork}
          </Text>
          <Text style={s.caption} accessibilityLiveRegion="polite">
            {intent ? `${matchCount} matches` : `${people.length.toLocaleString()} people`}
          </Text>
        </View>
      )}
      <View
        style={s.viewport}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setSize((old) =>
            width <= 0 || height <= 0 || (old.width === width && old.height === height)
              ? old
              : { width, height },
          );
        }}
      >
        <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
          <Animated.View style={StyleSheet.absoluteFill}>
            <Svg
              pointerEvents="none"
              width={size.width}
              height={size.height}
              style={StyleSheet.absoluteFill}
            >
              {Array.from(
                { length: compact ? 3 : Math.max(3, Math.ceil(extent / 84)) },
                (_, ring) => {
                  const radius = compact
                    ? (Math.min(size.width, size.height) * [0.6, 0.9, 1.22][ring]) / 2
                    : Math.max(82, Math.min(size.width * 0.25, size.height * 0.24)) + ring * 84;
                  return (
                    <Orbit
                      key={ring}
                      radius={radius}
                      width={size.width}
                      height={size.height}
                      panX={panX}
                      panY={panY}
                      zoom={zoom}
                    />
                  );
                },
              )}
            </Svg>
            {visible.map((node) => (
              <Person
                key={node.id}
                node={node}
                width={size.width}
                height={size.height}
                panX={panX}
                panY={panY}
                zoom={zoom}
                dim={!!intent && matchCount > 0 && !node.relevant}
                onPress={onOpen}
              />
            ))}
          </Animated.View>
        </GestureDetector>
        {!compact && onRockAction ? (
          <Animated.View
            pointerEvents="box-none"
            style={[StyleSheet.absoluteFill, { zIndex: 100 }, center]}
          >
            <AmberRock
              width={size.width}
              height={size.height}
              active={activeNetwork}
              onSelect={onRockAction}
              onProfile={() => onOpen('self')}
              canvasPan={pan}
            />
          </Animated.View>
        ) : (
          <Animated.View
            style={[s.rock, { left: size.width / 2 - 34, top: size.height / 2 - 36 }, center]}
          >
            <Pressable
              onPress={() => onOpen('self')}
              accessibilityRole="button"
              accessibilityLabel="Your personal profile"
              style={s.person}
            >
              <Image
                source={require('../assets/amber-logo.png')}
                style={{ width: 56, height: 65 }}
                resizeMode="contain"
              />
              <Text style={s.name}>You</Text>
            </Pressable>
          </Animated.View>
        )}
        {!people.length && (
          <Text style={s.empty}>
            {activeNetwork === 'All'
              ? 'Add someone to begin your community.'
              : activeNetwork === 'Nearby'
                ? 'No saved contacts match this city.'
                : `No one in ${activeNetwork} yet. Choose members to begin.`}
          </Text>
        )}
      </View>
      {!compact && (
        <View style={s.footer}>
          <Text style={[s.caption, { flex: 1 }]}>Drag to explore</Text>
          <Pressable
            onPress={() => changeZoom(0.8)}
            accessibilityRole="button"
            accessibilityLabel="Show more people"
            style={s.control}
          >
            <Minus size={20} color={cl.ink} />
          </Pressable>
          <Pressable
            onPress={() => changeZoom(1.25)}
            accessibilityRole="button"
            accessibilityLabel="Zoom in on network"
            style={s.control}
          >
            <Plus size={20} color={cl.ink} />
          </Pressable>
          <Pressable
            onPress={recenter}
            accessibilityRole="button"
            accessibilityLabel="Back to you"
            style={s.control}
          >
            <LocateFixed size={19} color={cl.goldDeep} />
          </Pressable>
        </View>
      )}
    </View>
  );
});
const s = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: 8,
    borderRadius: 24,
    backgroundColor: '#FCFAF7',
    overflow: 'hidden',
  },
  heading: {
    paddingHorizontal: 16,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: { fontFamily: 'Newsreader_400Regular', fontSize: 24, color: cl.ink },
  caption: { fontFamily: 'Outfit_400Regular', fontSize: 12, lineHeight: 18, color: cl.ink62 },
  viewport: { flex: 1, overflow: 'hidden', minHeight: 0 },
  node: { position: 'absolute', width: 72, height: 80 },
  person: { alignItems: 'center', minWidth: 44, minHeight: 44 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#EEE7DB',
    borderWidth: 1,
    borderColor: '#E4D7C4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  relevant: { backgroundColor: '#F2DAB4', borderColor: cl.goldDeep, borderWidth: 1.5 },
  photo: { width: 44, height: 44, borderRadius: 22 },
  initial: { fontFamily: 'Newsreader_500Medium', fontSize: 20, color: cl.ink },
  name: { fontFamily: 'Outfit_500Medium', fontSize: 11, color: cl.ink, marginTop: 5 },
  rock: { position: 'absolute', width: 68, height: 90, zIndex: 100 },
  footer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  control: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  reset: { minHeight: 44, justifyContent: 'center' },
  resetText: { fontFamily: 'Outfit_500Medium', fontSize: 12, color: cl.goldDeep },
  empty: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    fontFamily: 'Outfit_400Regular',
    color: cl.ink62,
  },
});
