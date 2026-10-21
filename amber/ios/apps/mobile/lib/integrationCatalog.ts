import type { SourceName } from '../components/SourceLogo';
type IntegrationCopy = {
  title: string;
  description: string;
  permissions: string[];
  connection: string;
  footnote: string;
};
const exportOnly = {
  connection: 'Direct connection is not available in this app yet.',
  footnote:
    'Exports stay on this device for review. Upload, mapping and merging are not connected yet.',
};
export const integrationCopy: Record<SourceName, IntegrationCopy> = {
  Apple: {
    title: 'Your Apple context, by choice.',
    description: 'Choose location, contacts, photos, and Health & Fitness separately.',
    permissions: [
      'iOS asks before contacts are read.',
      'Allowed contacts are imported into your signed-in Amber account.',
    ],
    connection: 'Uses iPhone Contacts permission.',
    footnote: 'Each permission has its own iOS prompt. Permission alone does not upload data or share your location.',
  },
  Meta: {
    ...exportOnly,
    title: 'Your Meta context.',
    description: 'A shared place for the Meta context you choose to bring into Amber.',
    permissions: ['Direct account linking is not available yet.'],
  },
  Google: {
    title: 'Bring your Google context.',
    description:
      'Choose your account in Google’s secure sign-in window, then review the permissions Google presents.',
    permissions: [
      'Read saved and other Google contacts.',
      'Manage Gmail messages and send email.',
      'Manage calendars and Google Drive files.',
    ],
    connection:
      'The current connector requests these permissions together. Google confirms what you grant.',
    footnote:
      'A connected account is not proof that every source has finished importing. A narrower, feature-by-feature connection is planned.',
  },
  Slack: {
    ...exportOnly,
    title: 'Coming soon',
    description: 'The Slack integration has not been built out yet.',
    permissions: [],
  },
  Attio: {
    ...exportOnly,
    title: 'Coming soon',
    description: 'The Attio integration has not been built out yet.',
    permissions: [],
  },
  LinkedIn: {
    ...exportOnly,
    title: 'Your professional community.',
    description:
      'Bring professional relationships into the same cards as the rest of your community.',
    permissions: [
      'Review a LinkedIn data export from Files.',
      'Account sign-in alone does not grant your full connections list.',
    ],
  },
  WhatsApp: {
    ...exportOnly,
    title: 'Keep the conversation in context.',
    description: 'Review a conversation export before deciding what belongs in a contact card.',
    permissions: [
      'Choose the conversation you want to review.',
      'No access to your account or message history is granted here.',
    ],
  },
  iMessage: {
    ...exportOnly,
    title: 'A conversation with Amber.',
    description:
      'The planned Photon connection lets you message Amber. It is separate from importing your personal iMessage archive.',
    permissions: [
      'Link your messaging identity before using the agent.',
      'Review any outgoing action before it is sent.',
    ],
  },
  Instagram: {
    ...exportOnly,
    title: 'More than a username.',
    description: 'Review the context you choose to bring from Instagram into your community.',
    permissions: [
      'Choose an export from your own account.',
      'Photos and relationships are not imported automatically.',
    ],
  },
  Snapchat: {
    ...exportOnly,
    title: 'Keep your close connections.',
    description: 'Start with an export you choose from Snapchat.',
    permissions: [
      'Review the file on your device first.',
      'No private messages or photos are accessed automatically.',
    ],
  },
  Partiful: {
    ...exportOnly,
    title: 'People you meet. Plans you share.',
    description: 'Review event context before adding it to your calendar or community.',
    permissions: [
      'Choose a calendar or text export.',
      'Guest relationships need review before becoming contacts.',
    ],
  },
  TikTok: {
    ...exportOnly,
    title: 'Bring your interests into view.',
    description: 'Review your own exported context from TikTok.',
    permissions: [
      'You choose which file to review.',
      'Following someone does not automatically make them a close relationship.',
    ],
  },
  Web: {
    ...exportOnly,
    title: 'A fuller picture, with sources.',
    description:
      'Perplexity is the web discovery identity in Amber. Search for people, articles and opportunities, and review the sources.',
    permissions: [
      'Choose what you want to research.',
      'Keep the source and review proposed changes.',
    ],
    connection: 'Use Web search to open discovery. Contact enrichment is a separate Clay action.',
  },
};

export const integrationSources: SourceName[] = [
  'Apple',
  'Google',
  'Meta',
  'Slack',
  'LinkedIn',
  'Snapchat',
  'Partiful',
  'TikTok',
];
export const isComingSoon = (source: SourceName) => !['Apple', 'Google', 'Web'].includes(source);
