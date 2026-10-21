import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  FlatList,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  FadeInDown,
  FadeInRight,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { colors } from '../src/shared/constants/colors';
import { spacing } from '../src/shared/constants/spacing';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const ONBOARDING_KEY = 'has_seen_onboarding';

interface OnboardingSlide {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  symbolName: string;
  symbolColor: string;
  bgColor: string;
}

const slides: OnboardingSlide[] = [
  {
    id: '1',
    title: 'Track Your Conversations',
    subtitle: 'Real-time awareness',
    description: 'Tizzy records and analyzes your conversations in real-time, giving you insights into your communication patterns.',
    symbolName: 'waveform.path.ecg',
    symbolColor: colors.primary.main,
    bgColor: colors.primary.main + '10',
  },
  {
    id: '2',
    title: 'AI-Powered Coaching',
    subtitle: 'Personalized feedback',
    description: 'Get actionable coaching insights after each session. Track clarity, pace, and engagement over time.',
    symbolName: 'chart.line.uptrend.xyaxis',
    symbolColor: colors.secondary.main,
    bgColor: colors.secondary.main + '10',
  },
  {
    id: '3',
    title: 'Wearable Integration',
    subtitle: 'Always with you',
    description: 'Connect your Tizzy wearable device via Bluetooth for seamless, hands-free recording during any conversation.',
    symbolName: 'headphones',
    symbolColor: colors.accent.main,
    bgColor: colors.accent.main + '10',
  },
  {
    id: '4',
    title: 'Privacy First',
    subtitle: 'Your data, your control',
    description: 'All recordings are encrypted and processed with your consent. You control what is shared and for how long it is retained.',
    symbolName: 'lock.shield.fill',
    symbolColor: colors.warning.dark,
    bgColor: colors.warning.main + '15',
  },
];

interface DotIndicatorProps {
  slides: OnboardingSlide[];
  currentIndex: number;
}

function DotIndicator({ slides, currentIndex }: DotIndicatorProps) {
  return (
    <View style={dotStyles.container}>
      {slides.map((_, index) => {
        const isActive = index === currentIndex;
        return (
          <Animated.View
            key={index}
            style={[
              dotStyles.dot,
              isActive ? dotStyles.dotActive : dotStyles.dotInactive,
              isActive && { width: 20 },
            ]}
          />
        );
      })}
    </View>
  );
}

const dotStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 20,
    backgroundColor: colors.primary.main,
  },
  dotInactive: {
    width: 8,
    backgroundColor: colors.neutral.gray300,
  },
});

interface SlideItemProps {
  slide: OnboardingSlide;
}

function SlideItem({ slide }: SlideItemProps) {
  return (
    <View style={slideStyles.container}>
      <Animated.View
        entering={FadeInDown.duration(600)}
        style={[slideStyles.iconContainer, { backgroundColor: slide.bgColor }]}
      >
        <SymbolView
          name={slide.symbolName as any}
          size={64}
          tintColor={slide.symbolColor}
          type="hierarchical"
        />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(150).duration(500)}>
        <Text style={slideStyles.subtitle}>{slide.subtitle}</Text>
        <Text style={slideStyles.title}>{slide.title}</Text>
        <Text style={slideStyles.description}>{slide.description}</Text>
      </Animated.View>
    </View>
  );
}

const slideStyles = StyleSheet.create({
  container: {
    width: SCREEN_WIDTH,
    flex: 1,
    paddingHorizontal: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainer: {
    width: 140,
    height: 140,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 48,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary.main,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  description: {
    fontSize: 16,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
    alignSelf: 'center',
  },
});

export default function OnboardingScreen() {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const buttonScale = useSharedValue(1);

  const buttonAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const isLastSlide = currentIndex === slides.length - 1;

  const handleNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    buttonScale.value = withSpring(0.95, { damping: 10 }, () => {
      buttonScale.value = withSpring(1, { damping: 12 });
    });

    if (isLastSlide) {
      completeOnboarding();
    } else {
      const nextIndex = currentIndex + 1;
      flatListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
      setCurrentIndex(nextIndex);
    }
  };

  const handleSkip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    completeOnboarding();
  };

  const completeOnboarding = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    } catch (err) {
      // Ignore storage errors
    }
    router.replace('/(auth)/login');
  };

  const handleScroll = (event: any) => {
    const offset = event.nativeEvent.contentOffset.x;
    const index = Math.round(offset / SCREEN_WIDTH);
    if (index !== currentIndex) {
      setCurrentIndex(index);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Skip button */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleSkip} style={styles.skipButton}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* Slides */}
      <FlatList
        ref={flatListRef}
        data={slides}
        renderItem={({ item }) => <SlideItem slide={item} />}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        style={styles.flatList}
      />

      {/* Bottom controls */}
      <View style={styles.footer}>
        <DotIndicator slides={slides} currentIndex={currentIndex} />

        <Animated.View style={[styles.nextButtonWrapper, buttonAnimStyle]}>
          <TouchableOpacity
            onPress={handleNext}
            style={styles.nextButton}
            activeOpacity={0.85}
          >
            {isLastSlide ? (
              <>
                <Text style={styles.nextButtonText}>Get Started</Text>
                <SymbolView name="arrow.right" size={18} tintColor={colors.primary.contrast} />
              </>
            ) : (
              <>
                <Text style={styles.nextButtonText}>Next</Text>
                <SymbolView name="arrow.right" size={18} tintColor={colors.primary.contrast} />
              </>
            )}
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  skipButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  skipText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text.secondary,
  },
  flatList: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: Platform.OS === 'ios' ? 24 : spacing.xl,
    paddingTop: spacing.xl,
    gap: 28,
    alignItems: 'center',
  },
  nextButtonWrapper: {
    width: '100%',
  },
  nextButton: {
    backgroundColor: colors.primary.main,
    height: 56,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: colors.primary.main,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  nextButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.primary.contrast,
    letterSpacing: 0.2,
  },
});
