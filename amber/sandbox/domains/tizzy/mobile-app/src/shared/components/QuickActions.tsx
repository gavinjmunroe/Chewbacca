import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface QuickAction {
  id: string;
  title: string;
  subtitle?: string;
  icon: string; // SF Symbol name
  color: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

interface QuickActionsProps {
  actions: QuickAction[];
  columns?: number;
}

function QuickActionItem({ action, columns }: { action: QuickAction; columns: number }) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    flex: columns === 1 ? undefined : 1,
    minWidth: columns === 1 ? ('100%' as any) : undefined,
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.94, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const handlePress = () => {
    if (!action.disabled && !action.loading) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      action.onPress();
    }
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={action.disabled || action.loading}
      style={[
        styles.actionButton,
        action.disabled && styles.disabled,
        animatedStyle,
      ]}
    >
      <View style={[styles.iconContainer, { backgroundColor: action.color + '20' }]}>
        {action.loading ? (
          <ActivityIndicator color={action.color} />
        ) : (
          <SymbolView
            name={action.icon}
            size={24}
            tintColor={action.color}
          />
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {action.title}
      </Text>
      {action.subtitle && (
        <Text style={styles.subtitle} numberOfLines={1}>
          {action.subtitle}
        </Text>
      )}
    </AnimatedPressable>
  );
}

export function QuickActions({ actions, columns = 2 }: QuickActionsProps) {
  return (
    <View style={styles.container}>
      <View style={[styles.grid, { gap: 12 }]}>
        {actions.map((action) => (
          <QuickActionItem key={action.id} action={action} columns={columns} />
        ))}
      </View>
    </View>
  );
}

interface QuickActionButtonProps {
  icon: string; // SF Symbol name
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  loading?: boolean;
}

export function QuickActionButton({
  icon,
  label,
  onPress,
  color = '#3B82F6',
  disabled = false,
  loading = false,
}: QuickActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.singleButton,
        { backgroundColor: color },
        pressed && !disabled && styles.singleButtonPressed,
        disabled && styles.singleButtonDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <SymbolView name={icon} size={24} tintColor="#FFFFFF" />
      )}
      <Text style={styles.singleButtonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  actionButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    minHeight: 120,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  disabled: {
    opacity: 0.5,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  icon: {
    fontSize: 28,
    fontWeight: '600',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
  },
  // Single button styles
  singleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  singleButtonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  singleButtonDisabled: {
    opacity: 0.5,
  },
  singleButtonIcon: {
    fontSize: 20,
    color: '#FFFFFF',
    marginRight: 8,
  },
  singleButtonLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
