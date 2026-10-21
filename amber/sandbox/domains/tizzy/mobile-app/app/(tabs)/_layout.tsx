import React, { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Platform, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors } from '../../src/shared/constants/colors';

interface AnimatedTabIconProps {
  name: string;
  focused: boolean;
  color: string;
  focusedName?: string;
}

function AnimatedTabIcon({ name, focused, color, focusedName }: AnimatedTabIconProps) {
  const scale = useSharedValue(1);
  const previousFocused = React.useRef(focused);

  useEffect(() => {
    if (focused && !previousFocused.current) {
      scale.value = withSpring(1.2, { damping: 10, stiffness: 300 }, () => {
        scale.value = withSpring(1, { damping: 12, stiffness: 300 });
      });
      Haptics.selectionAsync();
    }
    previousFocused.current = focused;
  }, [focused]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <SymbolView
        name={(focused && focusedName ? focusedName : name) as any}
        size={24}
        tintColor={color}
      />
    </Animated.View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary.main,
        tabBarInactiveTintColor: colors.neutral.gray400,
        tabBarStyle: {
          backgroundColor: colors.background.primary,
          borderTopWidth: 1,
          borderTopColor: colors.border.light,
          paddingBottom: Platform.OS === 'ios' ? 24 : 8,
          paddingTop: 8,
          height: Platform.OS === 'ios' ? 88 : 64,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
          elevation: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon
              name="house"
              focusedName="house.fill"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="devices"
        options={{
          title: 'Devices',
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon
              name="headphones"
              focusedName="headphones"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon
              name="chart.bar"
              focusedName="chart.bar.fill"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="coaching"
        options={{
          title: 'Coaching',
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon
              name="chart.line.uptrend.xyaxis"
              focusedName="chart.line.uptrend.xyaxis"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon
              name="person"
              focusedName="person.fill"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
