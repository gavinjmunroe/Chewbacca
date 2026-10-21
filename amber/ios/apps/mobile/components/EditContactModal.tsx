import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Text } from './Text';
import { getContact, updateContact, type ContactPatch, type MedhaContactFull } from '../lib/contacts';
import { medhaIdErrorCopy } from '../lib/medhaId';
import { toast } from '../lib/toast';
import { fonts, radius, spacing, typography } from '../lib/tokens';
import { LIGHT } from '../lib/theme';
import { HAIRLINE, cl } from '../lib/classical';
import { GlassView } from 'expo-glass-effect';
import { liquidGlassEnabled } from './LiquidGlass';

// Matches the mic pill's burnt orange (app/(gated)/home.tsx) — no LIGHT token
// A BURNT_ORANGE constant used to be here for a Save button that now takes its
// color from the shared palette. Unused, and a hard-coded hex beside a token is
// exactly the pair that drifts.

type FormState = {
  name: string;
  phone: string;
  email: string;
  company: string;
  title: string;
  city: string;
};

const EMPTY_FORM: FormState = { name: '', phone: '', email: '', company: '', title: '', city: '' };

function formFromContact(c: MedhaContactFull): FormState {
  return {
    name: c.name ?? [c.firstName, c.lastName].filter(Boolean).join(' '),
    phone: c.phone ?? c.phoneNumbers?.[0] ?? '',
    email: c.email ?? c.emails?.[0] ?? '',
    company: c.company ?? '',
    title: c.title ?? '',
    city: c.city ?? '',
  };
}

export function EditContactModal({
  contactId,
  visible,
  onClose,
  onSaved,
}: {
  contactId: string;
  visible: boolean;
  onClose: () => void;
  onSaved: (contact: MedhaContactFull) => void;
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [original, setOriginal] = useState<FormState>(EMPTY_FORM);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  // Reload from the server each time the modal opens for a contact, so edits
  // always start from the current record rather than a stale prefill.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    getContact(contactId).then((res) => {
      if (!active) return;
      if (res.ok) {
        const next = formFromContact(res.data.contact);
        setOriginal(next);
        setForm(next);
      } else {
        toast.error('Could not load this contact.', medhaIdErrorCopy(res, 'Amber'));
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [visible, contactId]);

  const dirty =
    form.name !== original.name ||
    form.phone !== original.phone ||
    form.email !== original.email ||
    form.company !== original.company ||
    form.title !== original.title ||
    form.city !== original.city;
  const canSave = dirty && !saving && !loading;

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    const patch: ContactPatch = {};
    if (form.name !== original.name) patch.name = form.name;
    if (form.phone !== original.phone) patch.phone = form.phone;
    if (form.email !== original.email) patch.email = form.email;
    if (form.company !== original.company) patch.company = form.company;
    if (form.title !== original.title) patch.title = form.title;
    if (form.city !== original.city) patch.city = form.city;

    const res = await updateContact(contactId, patch);
    setSaving(false);
    if (res.ok) {
      toast.success('Contact updated.');
      onSaved(res.data.contact);
    } else {
      toast.error('Could not save changes.', medhaIdErrorCopy(res, 'Amber'));
    }
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: LIGHT.canvas }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.lg,
            paddingTop: insets.top + spacing.base,
            paddingBottom: spacing.md,
          }}
        >
          {/* iOS 26 Liquid Glass nav band behind the title/close row. On iOS < 26
              / Android nothing renders here, so the header stays transparent over
              the cream page exactly as today. Non-interactive, sits behind the
              title and close button. */}
          {liquidGlassEnabled ? (
            // 'clear' + faint tint: this band sits over the opaque cream canvas
            // (no dimming behind it), so the frosted 'regular' material would read
            // as a flat cream/white bar. 'clear' keeps it translucent so the form
            // shows through as it scrolls under the band; the tint holds the title
            // legible. No opaque fill backs this glass — the parent row View is
            // transparent.
            <GlassView
              glassEffectStyle="clear"
              tintColor="rgba(255,255,255,0.22)"
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          ) : null}
          <Text variant="titleMd" style={{ color: LIGHT.textPrimary }}>
            Edit contact
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <X color={LIGHT.textSecondary} size={22} />
          </Pressable>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="bodyMd" style={{ color: LIGHT.textMuted }}>
              Loading…
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.base,
              paddingBottom: spacing.xxl,
              gap: spacing.lg,
            }}
            keyboardShouldPersistTaps="handled"
          >
            <Field label="Name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
            <Field
              label="Phone"
              value={form.phone}
              onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
              keyboardType="phone-pad"
            />
            <Field
              label="Email"
              value={form.email}
              onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Field
              label="Company"
              value={form.company}
              onChangeText={(v) => setForm((f) => ({ ...f, company: v }))}
            />
            <Field label="Title" value={form.title} onChangeText={(v) => setForm((f) => ({ ...f, title: v }))} />
            <Field label="City" value={form.city} onChangeText={(v) => setForm((f) => ({ ...f, city: v }))} />
          </ScrollView>
        )}

        <View
          style={{
            paddingTop: spacing.sm,
            paddingBottom: insets.bottom + spacing.base,
          }}
        >
          <Pressable
            onPress={() => void save()}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel="Save"
            style={({ pressed }) => ({
              marginHorizontal: spacing.lg,
              opacity: !canSave ? 0.5 : pressed ? 0.85 : 1,
            })}
          >
            <View
              style={{
                height: 52,
                borderRadius: radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: cl.tint100,
                borderWidth: HAIRLINE,
                borderColor: cl.gold55,
                shadowColor: '#000',
                shadowOpacity: 0.15,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
                elevation: 4,
              }}
            >
              <Text
                variant="titleSm"
                style={{
                  color: cl.goldDeep,
                  fontFamily: fonts.bold,
                  textAlign: 'center',
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </View>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChangeText,
  ...rest
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
} & Partial<TextInputProps>) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="microLabel" uppercase>
        {label}
      </Text>
      <View
        style={{
          borderRadius: radius.sm,
          borderWidth: 1,
          borderColor: LIGHT.hairline,
          backgroundColor: LIGHT.surface,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholderTextColor={LIGHT.textMuted}
          style={{
            fontFamily: typography.bodyMd.fontFamily,
            fontSize: typography.bodyMd.fontSize,
            color: LIGHT.textPrimary,
            padding: 0,
          }}
          {...rest}
        />
      </View>
    </View>
  );
}
