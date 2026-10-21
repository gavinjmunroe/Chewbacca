import { useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ArrowRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { GlassSurface } from '../components/LiquidGlass';
import { SourceLogo, type SourceName } from '../components/SourceLogo';
import NetworkOnboardingDemo from './NetworkOnboardingDemo';
import { cl } from '../lib/classical';

/** Design-only entry. Does not create accounts, request permissions, or persist identity. */
export default function NetworkOnboarding({ onComplete }: { onComplete: (name: string) => void }) {
  const scroll = useRef<ScrollView>(null);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<SourceName[]>([]);
  const [name, setName] = useState('');
  const move = (next: number) => {
    void Haptics.selectionAsync().catch(() => {});
    setStep(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const titles = [
    'Your mutual friend.',
    'It starts with you.',
    'Your account comes first.',
    'Bring your people together.',
    'Your network moves with you.',
  ];
  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView
        style={s.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous onboarding screen"
            disabled={step === 0}
            onPress={() => move(step - 1)}
            style={[s.back, { opacity: step === 0 ? 0 : 1 }]}
          >
            <ArrowLeft size={22} color={cl.ink} />
          </Pressable>
          <Text style={s.brand}>amber</Text>
          <View style={s.back} />
        </View>
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.content}
        >
          {step < 3 && (
            <View style={s.hero}>
              <Image
                source={require('../assets/amber-logo.png')}
                style={s.logo}
                resizeMode="contain"
                accessibilityLabel="Amber"
              />
            </View>
          )}
          <Text
            accessibilityRole="header"
            style={[s.title, step === 4 && { fontSize: 34, lineHeight: 38 }]}
          >
            {titles[step]}
          </Text>
          <Text style={s.body}>
            {step === 0
              ? 'A home for your most important people. Remember the little things. Make time for each other.'
              : step === 1
                ? 'What should Amber call you? You can change this later.'
                : step === 2
                  ? 'Sign in before saving your network or connecting private data.'
                  : step === 4
                    ? 'Tell Amber what matters. Watch your network respond.'
                    : 'Choose a source to explore how your contacts, conversations, and plans come together.'}
          </Text>
          {step === 1 && (
            <TextInput
              accessibilityLabel="Your name"
              placeholder="Your name"
              placeholderTextColor={cl.ink55}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoComplete="name"
              maxLength={80}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (name.trim()) move(2);
              }}
              style={s.input}
            />
          )}
          {step === 3 && (
            <View style={s.sources}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {(['Apple', 'Google', 'Web'] satisfies SourceName[]).map((source) => (
                  <Pressable
                    key={source}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected.includes(source) }}
                    accessibilityLabel={source}
                    onPress={() =>
                      setSelected((values) =>
                        values.includes(source)
                          ? values.filter((value) => value !== source)
                          : [...values, source],
                      )
                    }
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      padding: 12,
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: selected.includes(source) ? cl.goldDeep : cl.cardHairline,
                      gap: 8,
                    }}
                  >
                    <SourceLogo name={source} />
                    <Text style={s.note}>
                      {source}
                      {selected.includes(source) ? ' ✓' : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={s.note}>
                Selected for this design: {selected.length}. No accounts connected.
              </Text>
              <Text style={s.note}>
                Start with Apple, Google, or the web. Choose what to bring in; you can add more
                later.
              </Text>
            </View>
          )}
          {step === 2 && (
            <View style={s.sources}>
              <Text style={s.cardTitle}>Phone → verification code → account</Text>
              <Text style={s.note}>
                The live sign-in flow sends and checks a code. This design walkthrough does not send
                SMS or verify an account. A phone code confirms access to a number, not a verified
                human identity.
              </Text>
            </View>
          )}
          {step === 3 && (
            <View style={s.sources}>
              <Text style={s.cardTitle}>Choose what Amber can use</Text>
              <Text style={s.note}>
                Contacts: choose people to import. Calendar: choose calendars. Photos: select
                specific images for your card. Location: optional, when you use nearby discovery.
                Importing is separate from sharing with other people.
              </Text>
            </View>
          )}
          {step === 4 && <NetworkOnboardingDemo />}
          {step === 0 && (
            <GlassSurface style={s.card} fallbackStyle={{ backgroundColor: cl.card }}>
              <Text style={s.cardTitle}>One network. Search or speak.</Text>
              <Text style={s.note}>People, memories, and your calendar, connected around you.</Text>
            </GlassSurface>
          )}
        </ScrollView>
        <View style={s.footer}>
          <View accessibilityLabel={`Step ${step + 1} of 5`} style={s.progress}>
            {[0, 1, 2, 3, 4].map((index) => (
              <View key={index} style={[s.dot, index === step && s.activeDot]} />
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={step === 1 && !name.trim()}
            onPress={() => (step < 4 ? move(step + 1) : onComplete(name.trim()))}
            style={[s.button, { opacity: step === 1 && !name.trim() ? 0.4 : 1 }]}
          >
            <Text style={s.buttonText}>
              {step === 0
                ? 'Meet Amber'
                : step === 2
                  ? 'Preview next step · no SMS'
                  : step === 3
                    ? 'See how the graph builds'
                    : step === 4
                      ? 'Explore the sample network'
                      : 'Continue'}
            </Text>
            <ArrowRight size={20} color={cl.card} />
          </Pressable>
          <Text style={s.disclosure}>DESIGN WALKTHROUGH · NO ACCOUNT CREATED</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cl.ground },
  header: {
    height: 60,
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  brand: { fontFamily: 'Newsreader_500Medium', fontSize: 32, color: cl.ink },
  content: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 24 },
  hero: { alignItems: 'center', paddingVertical: 30 },
  logo: { width: 136, height: 150 },
  title: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: -1,
    color: cl.ink,
  },
  body: {
    fontFamily: 'Outfit_400Regular',
    fontSize: 17,
    lineHeight: 26,
    color: cl.ink70,
    marginTop: 16,
  },
  card: { borderRadius: 24, padding: 22, marginTop: 30, gap: 10 },
  cardTitle: { fontFamily: 'Outfit_500Medium', fontSize: 17, color: cl.ink },
  note: { fontFamily: 'Outfit_400Regular', fontSize: 14, lineHeight: 22, color: cl.ink62 },
  input: {
    marginTop: 28,
    backgroundColor: cl.card,
    borderWidth: 1,
    borderColor: cl.warmHairline,
    borderRadius: 20,
    padding: 20,
    fontFamily: 'Outfit_400Regular',
    fontSize: 22,
    color: cl.ink,
  },
  sources: { marginTop: 24, gap: 16 },
  footer: { paddingHorizontal: 28, paddingBottom: 12, gap: 20 },
  progress: { flexDirection: 'row', gap: 7, justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: cl.warmHairline },
  activeDot: { width: 22, backgroundColor: cl.goldDeep },
  button: {
    minHeight: 58,
    borderRadius: 29,
    backgroundColor: cl.ink,
    paddingHorizontal: 22,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  buttonText: { fontFamily: 'Outfit_500Medium', fontSize: 16, color: cl.card },
  disclosure: {
    fontFamily: 'Outfit_400Regular',
    fontSize: 9,
    letterSpacing: 1,
    color: cl.ink62,
    textAlign: 'center',
  },
});
