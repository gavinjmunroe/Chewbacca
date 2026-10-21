import { PeopleSearchExperience } from './PeopleSearchExperience';
import type { WebPerson } from '../lib/chat';
export type DiscoveryPerson = WebPerson & {
  workEmail?: string | null;
  personalEmail?: string | null;
  phone?: string | null;
};
/** Exa presets people on People and places on Plans; Clay is enrichment only. */
export function WebDiscoverySheet(props: {
  query: string;
  context?: string;
  location?: string;
  onPlanSaved?: () => void;
  scope: 'network' | 'day' | 'opportunities';
  sample?: boolean;
  onClose: () => void;
  onChoose?: (id: string) => void;
  onAddSample?: (person: DiscoveryPerson) => void;
}) {
  return (
    <PeopleSearchExperience
      query={props.query}
      location={props.location}
      onPlanSaved={props.onPlanSaved}
      sample={props.sample}
      web
      scope={props.scope === 'network' ? 'network' : 'day'}
      people={[]}
      onChoose={props.onChoose ?? (() => {})}
      onClose={props.onClose}
    />
  );
}
