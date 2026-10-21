import { Pressable, View } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { IconButton } from './IconButton';
import { TextInput } from './TextInput';
import { colors, radius, spacing } from '../lib/tokens';

type Props = {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  onSubmit: () => void;
  // When set, shows a trailing rausch search button that also triggers onSubmit.
  withButton?: boolean;
};

export function SearchInput({ value, onChangeText, placeholder, onSubmit, withButton }: Props) {
  const hasValue = value.length > 0;
  const field = (
    <View style={{ flex: 1, position: 'relative' }}>
      <View
        style={{
          position: 'absolute',
          left: spacing.base,
          top: 0,
          bottom: 0,
          justifyContent: 'center',
          zIndex: 1,
        }}
      >
        <Search color={colors.muted} size={16} />
      </View>
      <View style={{ paddingLeft: spacing.sm }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={onSubmit}
          style={{ paddingLeft: 38, paddingRight: hasValue ? 40 : 12 }}
        />
      </View>
      {hasValue ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={8}
          style={{
            position: 'absolute',
            right: spacing.sm,
            top: 0,
            bottom: 0,
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: radius.full,
              backgroundColor: colors.surfaceStrong,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X color={colors.muted} size={14} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );

  if (!withButton) return field;

  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
      {field}
      <IconButton accessibilityLabel="Search" size={48} variant="rausch" onPress={onSubmit}>
        <Search color={colors.onPrimary} size={20} />
      </IconButton>
    </View>
  );
}
