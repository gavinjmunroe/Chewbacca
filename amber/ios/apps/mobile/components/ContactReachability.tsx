import { useState } from 'react';
import { Linking, Text, View, StyleSheet } from 'react-native';
import { Phone, Mail, ArrowUpRight } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { contactDetailRows, type ContactExport } from '../lib/contactExport';
import { cl } from '../lib/classical';
export function ContactReachability({ person }: { person: ContactExport }) {
  const [error, setError] = useState('');
  const rows = contactDetailRows(person);
  if (!rows.length) return null;
  return (
    <View style={s.card}>
      {rows.map((row) => (
        <Pressable
          key={row.kind + row.value}
          accessibilityRole="link"
          accessibilityLabel={`${row.kind === 'phone' ? 'Call' : row.kind === 'email' ? 'Email' : 'Open'} ${row.value}`}
          onPress={() => {
            const url =
              row.kind === 'phone'
                ? `tel:${row.value.replace(/[^+0-9]/g, '')}`
                : row.kind === 'email'
                  ? `mailto:${encodeURIComponent(row.value)}`
                  : row.value;
            void Linking.openURL(url).catch(() =>
              setError('This device could not open that action. You can copy the detail below.'),
            );
          }}
          style={({ pressed }) => [s.row, { opacity: pressed ? 0.6 : 1 }]}
        >
          <View style={s.icon}>
            {row.kind === 'phone' ? (
              <Phone size={19} color={cl.goldDeep} />
            ) : row.kind === 'email' ? (
              <Mail size={19} color={cl.goldDeep} />
            ) : (
              <ArrowUpRight size={19} color={cl.goldDeep} />
            )}
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.label}>{row.label}</Text>
            <Text selectable style={s.value}>
              {row.value}
            </Text>
          </View>
        </Pressable>
      ))}
      {!!error && (
        <Text accessibilityRole="alert" style={s.label}>
          {error}
        </Text>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  card: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 8 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: cl.groundGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontFamily: 'Outfit_400Regular', fontSize: 12, color: cl.ink62, lineHeight: 18 },
  value: { fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 23, color: cl.ink },
});
