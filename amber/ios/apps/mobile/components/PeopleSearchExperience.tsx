import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sparkles, X } from 'lucide-react-native';
import { requestStyles as r } from './MemoStyles';
import { PlaceSearchResults } from './PlaceSearchResults';
import { GlobalSearchResults } from './GlobalSearchResults';
import { SearchConversation } from './SearchConversation';
import { GroundedConversation } from './GroundedConversation';
import { cl } from '../lib/classical';
export type SearchPerson = { id: string; name: string; detail: string; avatarUrl?: string | null };
export function PeopleSearchExperience({
  query,
  people,
  sample = false,
  web = false,
  scope = 'network',
  location,
  onPlanSaved,
  onChoose,
  onClose,
}: {
  query: string;
  people: SearchPerson[];
  sample?: boolean;
  web?: boolean;
  scope?: 'network' | 'day';
  location?: string;
  onPlanSaved?: () => void;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const choose = (id: string) => {
    onClose();
    onChoose(id);
  };
  return (
    <Modal visible transparent={!web} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={web?{flex:1,backgroundColor:cl.groundCream,paddingTop:insets.top,paddingBottom:insets.bottom}:r.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={web?{flex:1}:r.glow}>
          <View style={web?{flex:1}:r.sheet} accessibilityViewIsModal>
            <View style={[r.heading,web && {paddingHorizontal:24,paddingVertical:12}]}>
              {!web && <Sparkles color={cl.goldDeep} size={24} />}
              <Text style={r.title}>
                {web ? scope === 'network' ? 'Discover people' : 'Discover places' : 'Ask Amber'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close search"
                onPress={onClose}
                style={r.close}
              >
                <X color={cl.ink} />
              </Pressable>
            </View>
            {web && scope === 'day' ? (
              <PlaceSearchResults query={query} location={location} sample={sample} onPlanSaved={onPlanSaved}/>
            ) : web ? (
              <GlobalSearchResults
                query={query}
                sample={sample}
              />
            ) : (scope === 'day' && !web) || sample ? (
              <GroundedConversation
                query={query}
                records={people}
                sample={sample}
                scope={scope}
                onChoose={scope === 'network' ? choose : undefined}
              />
            ) : (
              <SearchConversation query={query} web={web} onChoose={choose} />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
