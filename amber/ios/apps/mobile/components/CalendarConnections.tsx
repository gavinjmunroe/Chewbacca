import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Activity, Heart, X } from 'lucide-react-native';
import { SourceLogo } from './SourceLogo';
import { CalendarSyncSheet } from './CalendarSyncSheet';
import { calendarSources } from '../lib/surfaceSearch';
import { cl } from '../lib/classical';
import { requestStyles as s } from './MemoStyles';
export function CalendarConnections({
  sample,
  onConnected,
}: {
  sample: boolean;
  onConnected: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [calendar, setCalendar] = useState(false);
  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0, height: 104 }}
        contentContainerStyle={{ gap: 14, paddingHorizontal: 24, paddingVertical: 8 }}
      >
        {calendarSources.map((name, index) => (
          <Pressable
            key={name}
            accessibilityRole="button"
            accessibilityLabel={`${name}${index > 1 ? ', coming soon' : ' connection'}`}
            onPress={() => (index === 1 && !sample ? setCalendar(true) : setSelected(name))}
            style={{ width: 68, alignItems: 'center', gap: 8, opacity: index > 1 ? 0.35 : 1 }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                borderWidth: 1,
                borderColor: cl.warmHairline,
                backgroundColor: cl.card,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {index === 0 ? (
                <SourceLogo name="Apple" size={30} />
              ) : index === 1 ? (
                <SourceLogo name="Google" size={29} />
              ) : index === 6 ? (
                <Heart size={25} color={cl.ink} />
              ) : (
                <Text style={{ fontSize: 20, color: cl.ink, fontFamily: 'Outfit_500Medium' }}>
                  {name === 'Whoop'
                    ? 'W'
                    : name === 'Oura'
                      ? 'O'
                      : name === 'Garmin'
                        ? 'G'
                        : name === 'Strava'
                          ? 'S'
                          : 'F'}
                </Text>
              )}
            </View>
            <Text
              style={{
                fontSize: 10,
                fontFamily: 'Outfit_400Regular',
                color: cl.ink,
                textAlign: 'center',
              }}
            >
              {name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <CalendarSyncSheet
        visible={calendar}
        onClose={() => setCalendar(false)}
        onConnected={onConnected}
      />
      <Modal
        visible={!!selected}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <View style={s.backdrop}>
          <View style={[s.glow, { height: 'auto' }]}>
            <View style={s.heading}>
              <Text style={s.title}>{selected}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close connection"
                onPress={() => setSelected(null)}
                style={s.close}
              >
                <X color={cl.ink} />
              </Pressable>
            </View>
            <View style={s.content}>
              <Activity size={28} color={cl.goldDeep} />
              <Text style={s.body}>
                {selected === 'Apple Health'
                  ? 'Your health activity will sit beside your notes and plans. Apple Health access is not connected in this build yet.'
                  : selected === 'Google Calendar'
                    ? 'Sign in to Amber to connect Google Calendar and choose which calendars appear in your day.'
                    : 'This connection is coming soon.'}
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
