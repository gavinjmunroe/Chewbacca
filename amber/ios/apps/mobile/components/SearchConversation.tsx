import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowUp, Square } from 'lucide-react-native';
import { ChatProvider, useChat } from '../lib/ChatContext';
import { AskChat } from './AskChat';
import { cl } from '../lib/classical';

/** A separate chat head keeps searches out of voice-note capture conversations. */
export function SearchConversation({
  query,
  web,
  onChoose,
}: {
  query: string;
  web: boolean;
  onChoose: (id: string) => void;
}) {
  return (
    <ChatProvider searchMode>
      <Conversation query={query} web={web} onChoose={onChoose} />
    </ChatProvider>
  );
}

function Conversation({
  query,
  web,
  onChoose,
}: {
  query: string;
  web: boolean;
  onChoose: (id: string) => void;
}) {
  const { runSearch, streaming, onStop } = useChat();
  const [draft, setDraft] = useState('');
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runSearch(query, undefined, undefined, undefined, false, web);
  }, [query, web, runSearch]);
  const send = () => {
    if (!draft.trim() || streaming) return;
    const message = draft.trim();
    setDraft('');
    // runSearch retains the conversation ID and uses the normal agent pipeline.
    void runSearch(message, undefined, undefined, undefined, false, web);
  };
  return (
    <View style={{ flex: 1 }}>
      <AskChat onOpenPerson={onChoose} hideNewChat hideEmpty tabBarClear={false} />
      <View style={s.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={send}
          returnKeyType="send"
          placeholder="Ask a follow-up…"
          accessibilityLabel="Message Amber"
          placeholderTextColor={cl.ink55}
          style={s.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={streaming ? 'Stop response' : 'Send message'}
          disabled={!streaming && !draft.trim()}
          onPress={streaming ? onStop : send}
          style={[s.send, !streaming && !draft.trim() && { opacity: 0.4 }]}
        >
          {streaming ? (
            <Square size={17} color={cl.card} fill={cl.card} />
          ) : (
            <ArrowUp size={23} color={cl.card} />
          )}
        </Pressable>
      </View>
      <Text style={s.hint}>{web ? 'Web search on' : 'Your Amber context'}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  composer: {
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: cl.cardHairline,
    borderRadius: 28,
    paddingLeft: 18,
    paddingRight: 5,
  },
  input: { flex: 1, minHeight: 54, fontFamily: 'Outfit_400Regular', fontSize: 16, color: cl.ink },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: cl.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontFamily: 'Outfit_400Regular',
    color: cl.ink62,
    fontSize: 11,
    textAlign: 'center',
    padding: 10,
  },
});
