import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { Pressable } from './Pressable';
import { CCard, CText } from './classical';
import { HAIRLINE, cl, clLayout } from '../lib/classical';
import { spacing } from '../lib/tokens';

// ADDING SOMEONE FROM A NOTE USED TO PRODUCE A NAME AND NOTHING ELSE.
//
// "Add Sam" created a contact whose entire content was the transcript's spelling
// of a first name — no surname, no number, no way to reach them — and left the
// user to fill the rest in later, which nobody does. The moment you are told a
// name is new is the moment you still remember who they are, so that is when to
// ask.
//
// Everything except the name is optional on purpose. A form that refuses to save
// until it is complete is a form people abandon, and a contact with a name and a
// phone number is already useful.
export type NewContactDraft = {
  fullName: string;
  phone?: string;
  email?: string;
  company?: string;
  title?: string;
  city?: string;
};

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize = 'words',
  first = false,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'email-address';
  autoCapitalize?: 'none' | 'words';
  first?: boolean;
}) {
  return (
    <View
      style={{
        paddingHorizontal: clLayout.cardPadX,
        paddingVertical: 11,
        borderTopWidth: first ? 0 : HAIRLINE,
        borderTopColor: cl.ruleSoft,
      }}
    >
      <CText t="metaSm" color={cl.ink48} style={{ letterSpacing: 1, marginBottom: 3 }}>
        {label.toUpperCase()}
      </CText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={cl.ink38}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={{ fontSize: 17, color: cl.ink, paddingVertical: 2 }}
      />
    </View>
  );
}

export function NewContactModal({
  visible,
  spokenName,
  saving,
  manual = false,
  error,
  onCancel,
  onSave,
}: {
  visible: boolean;
  /** What the transcript heard. Pre-filled, and editable, because it is a guess. */
  spokenName: string;
  saving?: boolean;
  manual?: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (draft: NewContactDraft) => void;
}) {
  const [fullName, setFullName] = useState(spokenName);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [city, setCity] = useState('');

  // Reset every time it opens, so the last person's details never leak into the
  // next one.
  useEffect(() => {
    if (!visible) return;
    setFullName(spokenName);
    setPhone('');
    setEmail('');
    setCompany('');
    setTitle('');
    setCity('');
  }, [visible, spokenName]);

  const canSave =
    fullName.trim().length > 0 && !saving && (!manual || !!(phone.trim() || email.trim()));

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={() => !saving && onCancel()}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(28,25,23,0.34)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={{
              backgroundColor: cl.ground,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingTop: spacing.lg,
              paddingBottom: spacing.xl,
              maxHeight: '88%',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: spacing.lg,
                marginBottom: spacing.md,
              }}
            >
              <Pressable
                disabled={saving}
                onPress={onCancel}
                accessibilityRole="button"
                hitSlop={10}
              >
                <CText t="listTitle" color={cl.ink48}>
                  Cancel
                </CText>
              </Pressable>
              <CText t="listTitle" color={cl.ink}>
                New contact
              </CText>
              <Pressable
                onPress={() => canSave && onSave({ fullName, phone, email, company, title, city })}
                accessibilityRole="button"
                disabled={!canSave}
                hitSlop={10}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={cl.goldDeep} />
                ) : (
                  <CText t="listTitle" color={canSave ? cl.goldDeep : cl.ink38}>
                    Save
                  </CText>
                )}
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}
            >
              <CText t="body" color={cl.ink48} style={{ marginBottom: spacing.md }}>
                {manual
                  ? 'Add their real name and a phone number or email so you can recognize and reach them.'
                  : `Amber heard "${spokenName}" and has nobody by that name. Fix the spelling if it is wrong, and add whatever you know — everything but the name is optional.`}
              </CText>
              {!!error && (
                <CText t="body" color={cl.goldDeep} style={{ marginBottom: 12 }}>
                  {error}
                </CText>
              )}
              <CCard flush>
                <Field
                  first
                  label="Name"
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Full name"
                />
                <Field
                  label="Phone"
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="Optional"
                  keyboardType="phone-pad"
                />
                <Field
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Optional"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <Field
                  label="Company"
                  value={company}
                  onChangeText={setCompany}
                  placeholder="Optional"
                />
                <Field label="Title" value={title} onChangeText={setTitle} placeholder="Optional" />
                <Field label="City" value={city} onChangeText={setCity} placeholder="Optional" />
              </CCard>
              <CText t="metaSm" color={cl.ink38} style={{ marginTop: spacing.md }}>
                {manual
                  ? 'Saves to your private Amber contacts.'
                  : `Saving links this note to them, and teaches Amber that "${spokenName}" means this person next time.`}
              </CText>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
