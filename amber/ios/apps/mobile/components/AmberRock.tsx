import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { FullWindowOverlay } from 'react-native-screens';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  FadeIn,
  useReducedMotion,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {
  BriefcaseBusiness,
  Bell,
  Heart,
  Users,
  House,
  GraduationCap,
  Dumbbell,
  MapPin,
} from 'lucide-react-native';
import { ROCK_TARGETS, rockTarget, type RockAction, type SavedNetwork } from '../lib/amberSpace';
import { cl } from '../lib/classical';
const ICONS = {
  'Amber Alert': Bell,
  Family: House,
  Friends: Users,
  Romance: Heart,
  Work: BriefcaseBusiness,
  School: GraduationCap,
  Exercise: Dumbbell,
  Nearby: MapPin,
};
function RockBubble({
  index,
  width,
  height,
  active,
  hover,
  choose,
}: {
  index: number;
  width: number;
  height: number;
  active: SavedNetwork;
  hover: SharedValue<number>;
  choose: (action: RockAction) => void;
}) {
  const target = ROCK_TARGETS[index],
    Icon = ICONS[target.action];
  const motion = useAnimatedStyle(() => ({
    transform: [{ scale: hover.value === index ? 1.08 : 1 }],
    backgroundColor: hover.value === index ? '#F2DAB4' : 'rgba(255,253,248,0.94)',
  }));
  return (
    <Animated.View
      style={[
        s.bubble,
        { left: width / 2 + target.x - 33, top: height / 2 - 3 + target.y - 33 },
        motion,
        active === target.action && s.selected,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          target.action === 'Amber Alert'
            ? target.action
            : `${target.action}, ${active === target.action ? 'on. Tap to show all relationships' : 'off'}`
        }
        accessibilityState={{ selected: active === target.action }}
        onPress={() => choose(target.action)}
        style={s.bubbleButton}
      >
        <Icon size={22} color={cl.goldDeep} />
        <Text style={s.option}>{target.action}</Text>
      </Pressable>
    </Animated.View>
  );
}
export const AmberRock = memo(function AmberRock({
  active,
  width,
  height,
  onSelect,
  onProfile,
  canvasPan,
}: {
  active: SavedNetwork;
  width: number;
  height: number;
  onSelect: (action: RockAction) => void;
  onProfile: () => void;
  canvasPan: ReturnType<typeof Gesture.Pan>;
}) {
  const [open, setOpen] = useState(false);
  const rockRef = useRef<View>(null);
  const opening = useRef(false);
  const generation = useRef(0);
  const screen = useWindowDimensions();
  const [anchor, setAnchor] = useState({ x: screen.width / 2, y: screen.height / 2 });
  const shiftX = useSharedValue(0),
    shiftY = useSharedValue(0);
  const reduced = useReducedMotion();
  const [opaque, setOpaque] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(setOpaque);
    const listener = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setOpaque);
    return () => listener.remove();
  }, []);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const close = useCallback(() => {
    generation.current += 1;
    opening.current = false;
    setOpen(false);
  }, []);
  const reveal = useCallback(() => {
    opening.current = true;
    const version = ++generation.current;
    rockRef.current?.measureInWindow((x, y) => {
      if (version !== generation.current) return;
      const origin = { x: x + 34, y: y + 33 };
      const next = {
        x: Math.max(164, Math.min(screen.width - 164, origin.x)),
        y: Math.max(205, Math.min(screen.height - 205, origin.y)),
      };
      shiftX.value = origin.x - next.x;
      shiftY.value = origin.y - next.y;
      setAnchor(next);
      setOpen(true);
    });
  }, [screen.width, screen.height, shiftX, shiftY]);
  const hover = useSharedValue(-1),
    pressed = useSharedValue(0);
  const toggle = useCallback(() => (opening.current ? close() : reveal()), [close, reveal]);
  const choose = useCallback(
    (action: RockAction) => {
      close();
      hover.value = -1;
      onSelect(action);
      void Haptics.selectionAsync().catch(() => {});
    },
    [onSelect, hover, close],
  );
  const finishDrag = useCallback(
    (x: number, y: number) => {
      const target = rockTarget(x, y);
      if (target) choose(target);
      else close();
    },
    [choose, close],
  );
  const gesture = useMemo(() => {
    const drag = Gesture.Pan()
      .minDistance(8)
      .blocksExternalGesture(canvasPan)
      .onStart(() => {
        runOnJS(reveal)();
      })
      .onUpdate((e) => {
        const x = e.x - 34 + shiftX.value,
          y = e.y - 33 + shiftY.value;
        let found = -1;
        for (let i = 0; i < ROCK_TARGETS.length; i++) {
          const t = ROCK_TARGETS[i];
          if ((x - t.x) * (x - t.x) + (y - t.y) * (y - t.y) <= 34 * 34) {
            found = i;
            break;
          }
        }
        hover.value = found;
      })
      .onEnd((e) => runOnJS(finishDrag)(e.x - 34 + shiftX.value, e.y - 33 + shiftY.value))
      .onFinalize(() => {
        pressed.value = 0;
        hover.value = -1;
      });
    return drag;
  }, [canvasPan, finishDrag, reveal, pressed, hover, shiftX, shiftY]);
  const feedback = useAnimatedStyle(() => ({ transform: [{ scale: pressed.value ? 0.93 : 1 }] }));
  return (
    <View style={[s.root, { width, height }]} pointerEvents="box-none">
      {open &&
        (() => {
          const content = (
            <Animated.View
              entering={reduced ? undefined : FadeIn.duration(160)}
              style={StyleSheet.absoluteFill}
              accessibilityViewIsModal
              onAccessibilityEscape={close}
            >
              {opaque ? (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: cl.ground }]} />
              ) : (
                <>
                  <BlurView
                    tint="systemMaterialLight"
                    intensity={55}
                    style={StyleSheet.absoluteFill}
                  />
                  <LinearGradient
                    pointerEvents="none"
                    colors={[
                      'rgba(255,253,248,0.24)',
                      'rgba(238,226,208,0.38)',
                      'rgba(255,253,248,0.2)',
                    ]}
                    style={StyleSheet.absoluteFill}
                  />
                </>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close circle menu"
                onPress={close}
                style={StyleSheet.absoluteFill}
              />
              <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                {ROCK_TARGETS.map((target, index) => (
                  <RockBubble
                    key={target.action}
                    index={index}
                    width={anchor.x * 2}
                    height={(anchor.y + 3) * 2}
                    active={active}
                    hover={hover}
                    choose={choose}
                  />
                ))}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close circle menu and return to your network"
                  onPress={close}
                  style={[s.rock, { left: anchor.x - 34, top: anchor.y - 33 }]}
                >
                  <Image
                    source={require('../assets/amber-logo.png')}
                    style={s.image}
                    resizeMode="contain"
                  />
                  <Text style={s.label}>Your circles</Text>
                </Pressable>
              </View>
            </Animated.View>
          );
          return Platform.OS === 'ios' ? (
            <FullWindowOverlay unstable_accessibilityContainerViewIsModal>
              {content}
            </FullWindowOverlay>
          ) : (
            <Modal visible transparent animationType="fade" onRequestClose={close}>
              {content}
            </Modal>
          );
        })()}
      <GestureDetector gesture={gesture}>
        <Animated.View
          ref={rockRef}
          collapsable={false}
          style={[s.rock, { left: width / 2 - 34, top: height / 2 - 36 }, feedback]}
        >
          <Pressable
            accessible={!open}
            onPress={toggle}
            onPressIn={() => {
              pressed.value = 1;
            }}
            onPressOut={() => {
              pressed.value = 0;
            }}
            style={{ width: 68, height: 90, alignItems: 'center' }}
            accessibilityRole="button"
            accessibilityLabel={`Your Amber rock. ${active} network. Tap to choose a circle or Amber Alert.`}
            accessibilityState={{ expanded: open }}
            accessibilityActions={[
              { name: 'activate', label: 'Choose network or Amber Alert' },
              { name: 'showMenu', label: 'Choose network or Amber Alert' },
              { name: 'editProfile', label: 'Edit profile' },
            ]}
            onAccessibilityAction={(e) =>
              e.nativeEvent.actionName === 'editProfile' ? onProfile() : toggle()
            }
          >
            <Image
              source={require('../assets/amber-logo.png')}
              style={s.image}
              resizeMode="contain"
            />
            <Text style={s.label}>{open ? 'Choose a circle' : 'You'}</Text>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
});
const s = StyleSheet.create({
  root: { position: 'absolute', left: 0, top: 0, zIndex: 100 },
  rock: { position: 'absolute', width: 68, height: 90, alignItems: 'center', zIndex: 102 },
  image: { width: 56, height: 65 },
  label: {
    fontFamily: 'Outfit_500Medium',
    fontSize: 10,
    color: cl.ink,
    marginTop: 5,
    width: 100,
    textAlign: 'center',
  },
  menu: { ...StyleSheet.absoluteFillObject, zIndex: 101 },
  bubble: {
    position: 'absolute',
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.92)',
    shadowColor: cl.ink,
    shadowOpacity: 0.09,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  selected: { borderColor: cl.goldDeep, borderWidth: 2 },
  bubbleButton: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5 },
  option: { fontFamily: 'Outfit_500Medium', fontSize: 10, color: cl.ink },
});
