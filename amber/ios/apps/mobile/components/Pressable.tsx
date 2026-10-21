import { useState, type ReactNode } from 'react';
import {
  Pressable as RNPressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// A drop-in Pressable that actually honors the `style` FUNCTION form.
//
// React Native's Pressable accepts `style={({pressed}) => …}`. In this build it
// is silently dropped — NativeWind's css-interop wraps Pressable and only
// forwards a resolved style object, so anything expressed through the function
// never reaches the view. That was proved by measurement, not guessed: the day
// strip's boxes carried `style={({pressed}) => ({flex:1, height:56, …})}` and
// measured 20x34 — content-sized, with flex AND height dropped.
//
// The consequence for feel is that ~30 taps across the app had NO pressed state
// at all, because every one of them expressed it as `opacity: pressed ? … : 1`
// inside that function. Fixing them one by one would mean rewriting each call
// site; fixing it here fixes all of them.
//
// This resolves the function itself against locally-tracked press state and
// hands RNPressable a plain style object, which does apply. Same API surface, so
// call sites only change their import.
type Props = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  children?: ReactNode | ((state: { pressed: boolean }) => ReactNode);
};

export function Pressable({ style, children, onPressIn, onPressOut, ...rest }: Props) {
  const [pressed, setPressed] = useState(false);

  return (
    <RNPressable
      {...rest}
      style={typeof style === 'function' ? style({ pressed }) : style}
      onPressIn={(e: GestureResponderEvent) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        setPressed(false);
        onPressOut?.(e);
      }}
    >
      {typeof children === 'function' ? children({ pressed }) : children}
    </RNPressable>
  );
}
