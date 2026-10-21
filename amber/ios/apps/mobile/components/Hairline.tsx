import { View } from 'react-native';
import { HAIRLINE, cl } from '../lib/classical';

export function Hairline({
  soft = false,
  vertical = false,
}: {
  soft?: boolean;
  vertical?: boolean;
}) {
  const color = soft ? cl.ruleSoft : cl.ruleFaint;
  return (
    <View
      style={
        vertical
          ? { width: HAIRLINE, alignSelf: 'stretch', backgroundColor: color }
          : { height: HAIRLINE, alignSelf: 'stretch', backgroundColor: color }
      }
    />
  );
}
