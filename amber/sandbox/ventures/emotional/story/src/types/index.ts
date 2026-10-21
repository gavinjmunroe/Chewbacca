// Extended stories imported separately to avoid large inline data
import { STORIES_EXTENDED } from "./stories-extended";

export type Screen =
  | "splash"
  | "verify"
  | "home"
  | "prompt"
  | "compose"
  | "feed"
  | "story"
  | "discovery"
  | "profile"
  | "notifications"
  | "settings"
  | "circle-manage"
  | "user-profile";

export interface NavProps {
  navigate: (screen: Screen, direction?: "forward" | "back", storyId?: string) => void;
  goBack?: () => void;
  storyId?: string;
  posted?: boolean;
  onPost?: () => void;
  navActive?: "home" | "compose" | "discovery" | "profile";
}

export interface StoryUser {
  id: string;
  name: string;
  initials: string;
  color: string;
  verified: boolean;
  campus?: string;
}

export type StoryMediaType = "text" | "photo" | "audio";

export interface StoryPost {
  id: string;
  user: StoryUser;
  preview: string;
  body: string;
  timeAgo: string;
  dayLabel?: string;
  promptText?: string;
  mediaType: StoryMediaType;
  audioDuration?: string;
  photoGradient?: [string, string];
  photoUrl?: string;
  reactions: { think: number; changed: number; felt: number; door: number };
  isDiscovery?: boolean;
}

// ── Users ──────────────────────────────────────────────────────────────────────

export const USERS: Record<string, StoryUser> = {
  caleb:     { id: "caleb",     name: "Caleb N.",          initials: "CN", color: "#c2410c", verified: true, campus: "USC IYA" },
  marcus:    { id: "marcus",    name: "Marcus Rivera",     initials: "MR", color: "#2563eb", verified: true, campus: "USC IYA" },
  priya:     { id: "priya",     name: "Priya Sharma",      initials: "PS", color: "#0d9488", verified: true, campus: "USC IYA" },
  daniel:    { id: "daniel",    name: "Daniel Kim",        initials: "DK", color: "#ea580c", verified: true, campus: "USC IYA" },
  aisha:     { id: "aisha",     name: "Aisha Johnson",     initials: "AJ", color: "#be185d", verified: true, campus: "USC IYA" },
  sam:       { id: "sam",       name: "Sam Okafor",        initials: "SO", color: "#059669", verified: true, campus: "USC IYA" },
  gabriel:   { id: "gabriel",   name: "Gabriel Moreau",    initials: "GM", color: "#10b981", verified: true, campus: "Tufts · Biology" },
  destiny:   { id: "destiny",   name: "Destiny Washington",initials: "DW", color: "#b45309", verified: true, campus: "NC A&T · Engineering" },
  patrick:   { id: "patrick",   name: "Patrick Flynn",     initials: "PF", color: "#6366f1", verified: true, campus: "Fordham · Philosophy" },
  ananya:    { id: "ananya",    name: "Ananya Krishnan",   initials: "AK", color: "#a855f7", verified: true, campus: "Michigan · Biochem" },
  caden:     { id: "caden",     name: "Caden Brooks",      initials: "CB", color: "#ef4444", verified: true, campus: "Arizona State · CS" },
  layla:     { id: "layla",     name: "Layla Ahmed",       initials: "LA", color: "#059669", verified: true, campus: "UChicago · Sociology" },
  derek:     { id: "derek",     name: "Derek Johnson",     initials: "DJ", color: "#3b82f6", verified: true, campus: "Georgetown · Business" },
  xiomara:   { id: "xiomara",   name: "Xiomara Cruz",      initials: "XC", color: "#ec4899", verified: true, campus: "NYU · Dance" },
  cole:      { id: "cole",      name: "Cole Anderson",     initials: "CA", color: "#f59e0b", verified: true, campus: "Duke · Engineering" },
  precious:  { id: "precious",  name: "Precious Obi",      initials: "PO", color: "#0d9488", verified: true, campus: "Howard · Nursing" },
  felix:     { id: "felix",     name: "Felix Wagner",      initials: "FW", color: "#2563eb", verified: true, campus: "Cornell · Architecture" },
  amara_k:   { id: "amara_k",   name: "Amara Keita",       initials: "AK", color: "#9333ea", verified: true, campus: "Rutgers · Political Sci" },
  hunter:    { id: "hunter",    name: "Hunter Reeves",     initials: "HR", color: "#16a34a", verified: true, campus: "Emory · Pre-Med" },
  zara:      { id: "zara",      name: "Zara Ali",          initials: "ZA", color: "#f43f5e", verified: true, campus: "Princeton · Neuroscience" },
  brendon:   { id: "brendon",   name: "Brendon Lee",       initials: "BL", color: "#78716c", verified: true, campus: "UC San Diego · CS" },
  kyla:      { id: "kyla",      name: "Kyla Morrison",     initials: "KM", color: "#a16207", verified: true, campus: "Clark Atlanta · Marketing" },
  javier:    { id: "javier",    name: "Javier Morales",    initials: "JM", color: "#0891b2", verified: true, campus: "Miami · Engineering" },
  grace:     { id: "grace",     name: "Grace Kim",         initials: "GK", color: "#d946ef", verified: true, campus: "Northwestern · Music" },
  omar_b:    { id: "omar_b",    name: "Omar Bakr",         initials: "OB", color: "#22c55e", verified: true, campus: "Harvard · Government" },
  stella:    { id: "stella",    name: "Stella Kowalczyk",  initials: "SK", color: "#f97316", verified: true, campus: "UChicago · Economics" },
  michael:   { id: "michael",   name: "Michael Chen",      initials: "MC", color: "#60a5fa", verified: true, campus: "Boston College · Finance" },
  nina:      { id: "nina",      name: "Nina Petrov",       initials: "NP", color: "#f472b6", verified: true, campus: "NYU · Psychology" },
  sam_j:     { id: "sam_j",     name: "Sam Jackson",       initials: "SJ", color: "#34d399", verified: true, campus: "Howard · Film" },
  phoenix:   { id: "phoenix",   name: "Phoenix Reed",      initials: "PR", color: "#a78bfa", verified: true, campus: "Arizona State · Art" },
  tamara:    { id: "tamara",    name: "Tamara Okonkwo",    initials: "TO", color: "#dc2626", verified: true, campus: "Columbia · Sociology" },
  evan:      { id: "evan",      name: "Evan Goldstein",    initials: "EG", color: "#818cf8", verified: true, campus: "Penn · History" },
  riya:      { id: "riya",      name: "Riya Patel",        initials: "RP", color: "#10b981", verified: true, campus: "Georgia Tech · CS" },
  alejandro: { id: "alejandro", name: "Alejandro Vega",    initials: "AV", color: "#0ea5e9", verified: true, campus: "UT Austin · Physics" },
  serena:    { id: "serena",    name: "Serena Williams",   initials: "SW", color: "#8b5cf6", verified: true, campus: "Duke · Education" },
  jalen:     { id: "jalen",     name: "Jalen Brooks",      initials: "JB", color: "#e11d48", verified: true, campus: "Xavier · Political Sci" },
  hazel:     { id: "hazel",     name: "Hazel Kim",         initials: "HK", color: "#fbbf24", verified: true, campus: "BU · Nursing" },
  diego:     { id: "diego",     name: "Diego Martinez",    initials: "DM", color: "#92400e", verified: true, campus: "Berkeley · Math" },
  quinn:     { id: "quinn",     name: "Quinn Taylor",      initials: "QT", color: "#9333ea", verified: true, campus: "Oberlin · Music" },
  monique:   { id: "monique",   name: "Monique Davis",     initials: "MD", color: "#16a34a", verified: true, campus: "Spelman · Business" },
  ibrahim:   { id: "ibrahim",   name: "Ibrahim Al-Farsi",  initials: "IA", color: "#3b82f6", verified: true, campus: "Georgetown · CS" },
  callie:    { id: "callie",    name: "Callie Nguyen",     initials: "CN", color: "#f9a8d4", verified: true, campus: "UCLA · Psychology" },
  rafael:    { id: "rafael",    name: "Rafael Costa",      initials: "RC", color: "#f97316", verified: true, campus: "Columbia · Architecture" },
  neha:      { id: "neha",      name: "Neha Sharma",       initials: "NS", color: "#c084fc", verified: true, campus: "Michigan · Pre-Med" },
  brooks:    { id: "brooks",    name: "Brooks Hamilton",   initials: "BH", color: "#059669", verified: true, campus: "Emory · Business" },
  tiana:     { id: "tiana",     name: "Tiana Johnson",     initials: "TJ", color: "#a855f7", verified: true, campus: "Howard · Law" },
  pierre:    { id: "pierre",    name: "Pierre Dumont",     initials: "PD", color: "#0891b2", verified: true, campus: "Georgetown · Philosophy" },
  luna:      { id: "luna",      name: "Luna Garcia",       initials: "LG", color: "#f43f5e", verified: true, campus: "Stanford · Education" },
  deon:      { id: "deon",      name: "Deon Washington",   initials: "DW", color: "#dc2626", verified: true, campus: "Morehouse · CS" },
  emma_f:    { id: "emma_f",    name: "Emma Fischer",      initials: "EF", color: "#93c5fd", verified: true, campus: "Cornell · Literature" },
  fiona:     { id: "fiona",     name: "Fiona Walsh",       initials: "FW", color: "#fb7185", verified: true, campus: "NYU · Journalism" },
  nadia:     { id: "nadia",     name: "Nadia Petersen",    initials: "NP", color: "#34d399", verified: true, campus: "Yale · Cognitive Sci" },
  trevor:    { id: "trevor",    name: "Trevor Osei",       initials: "TO", color: "#60a5fa", verified: true, campus: "Vanderbilt · Economics" },
  simone:    { id: "simone",    name: "Simone Beaumont",   initials: "SB", color: "#e879f9", verified: true, campus: "UCLA · Film" },
  kai:       { id: "kai",       name: "Kai Nakamura",      initials: "KN", color: "#f59e0b", verified: true, campus: "CalTech · Physics" },
  josephine: { id: "josephine", name: "Josephine Adeyemi", initials: "JA", color: "#4ade80", verified: true, campus: "Brown · Anthropology" },
  leon:      { id: "leon",      name: "Leon Bachmann",     initials: "LB", color: "#818cf8", verified: true, campus: "Chicago · Statistics" },
  yasmin:    { id: "yasmin",    name: "Yasmin El-Amin",    initials: "YE", color: "#f472b6", verified: true, campus: "Princeton · Near East" },
  tyrese:    { id: "tyrese",    name: "Tyrese Grant",      initials: "TG", color: "#2dd4bf", verified: true, campus: "Morehouse · Business" },
  ingrid:    { id: "ingrid",    name: "Ingrid Sorensen",   initials: "IS", color: "#a78bfa", verified: true, campus: "Northwestern · Design" },
  carlos:    { id: "carlos",    name: "Carlos Mendez",     initials: "CM", color: "#fb923c", verified: true, campus: "UT Austin · CS" },
  jade:      { id: "jade",      name: "Jade Williams",     initials: "JW", color: "#c084fc", verified: true, campus: "Hampton · Pre-Law" },
  andre:     { id: "andre",     name: "Andre Fontaine",    initials: "AF", color: "#38bdf8", verified: true, campus: "Columbia · Finance" },
  preethi:   { id: "preethi",   name: "Preethi Nair",      initials: "PN", color: "#a3e635", verified: true, campus: "Michigan · Bioengineering" },
  nate:      { id: "nate",      name: "Nate Coleman",      initials: "NC", color: "#fb7185", verified: true, campus: "Ohio State · CS" },
  alicia:    { id: "alicia",    name: "Alicia Torres",     initials: "AT", color: "#fde047", verified: true, campus: "USC · Public Policy" },
  felix_m:   { id: "felix_m",   name: "Felix Muller",      initials: "FM", color: "#6ee7b7", verified: true, campus: "MIT · Math" },
  brianna:   { id: "brianna",   name: "Brianna Scott",     initials: "BS", color: "#fca5a5", verified: true, campus: "Spelman · Pre-Med" },
  omar_s:    { id: "omar_s",    name: "Omar Shaikh",       initials: "OS", color: "#93c5fd", verified: true, campus: "Stanford · CS" },
  mia:       { id: "mia",       name: "Mia Johansson",     initials: "MJ", color: "#f0abfc", verified: true, campus: "UCLA · Neuroscience" },
  elijah:    { id: "elijah",    name: "Elijah Okafor",     initials: "EO", color: "#4ade80", verified: true, campus: "Howard · Business" },
  sophie:    { id: "sophie",    name: "Sophie Laurent",    initials: "SL", color: "#e2e8f0", verified: true, campus: "Georgetown · Int'l Rel" },
  kofi:      { id: "kofi",      name: "Kofi Asante",       initials: "KA", color: "#fbbf24", verified: true, campus: "Yale · Economics" },
  aria:      { id: "aria",      name: "Aria Singh",        initials: "AS", color: "#c4b5fd", verified: true, campus: "Caltech · Biochem" },
  jordan:    { id: "jordan",    name: "Jordan Mills",      initials: "JM", color: "#67e8f9", verified: true, campus: "Duke · Environmental Sci" },
  kezia:     { id: "kezia",     name: "Kezia Amankwah",    initials: "KA", color: "#fda4af", verified: true, campus: "Clark Atlanta · English" },
  tobias:    { id: "tobias",    name: "Tobias Reinholt",   initials: "TR", color: "#86efac", verified: true, campus: "Yale · Linguistics" },
  farah:     { id: "farah",     name: "Farah Mansouri",    initials: "FM", color: "#fdba74", verified: true, campus: "BU · Political Sci" },
  marcus_j:  { id: "marcus_j",  name: "Marcus Johnson",    initials: "MJ", color: "#a5b4fc", verified: true, campus: "Xavier · Pre-Law" },
  esther:    { id: "esther",    name: "Esther Osei",       initials: "EO", color: "#6ee7b7", verified: true, campus: "Fisk · Biology" },
  drew:      { id: "drew",      name: "Drew Chen",         initials: "DC", color: "#f9a8d4", verified: true, campus: "Berkeley · EECS" },
  amani:     { id: "amani",     name: "Amani Wambua",      initials: "AW", color: "#bef264", verified: true, campus: "Howard · Psychology" },
  julian:    { id: "julian",    name: "Julian Reyes",      initials: "JR", color: "#7dd3fc", verified: true, campus: "Columbia · History" },
  skye:      { id: "skye",      name: "Skye Hoffmann",     initials: "SH", color: "#f0abfc", verified: true, campus: "Northwestern · Journalism" },
  cyrus:     { id: "cyrus",     name: "Cyrus Tehrani",     initials: "CT", color: "#a3e635", verified: true, campus: "UT Austin · Philosophy" },
  naomi:     { id: "naomi",     name: "Naomi Okafor",      initials: "NO", color: "#fb923c", verified: true, campus: "Spelman · Sociology" },
  luca:      { id: "luca",      name: "Luca Bernardi",     initials: "LB", color: "#818cf8", verified: true, campus: "Cornell · Architecture" },
  zoe:       { id: "zoe",       name: "Zoe Ashworth",      initials: "ZA", color: "#f472b6", verified: true, campus: "Penn · Communications" },
  kwame:     { id: "kwame",     name: "Kwame Asare",       initials: "KA", color: "#4ade80", verified: true, campus: "Yale · Philosophy" },
  priya_r:   { id: "priya_r",   name: "Priya Rao",         initials: "PR", color: "#a855f7", verified: true, campus: "Brown · CS" },
  isaiah:    { id: "isaiah",    name: "Isaiah Thompson",   initials: "IT", color: "#60a5fa", verified: true, campus: "Duke · Pre-Law" },
  elena:     { id: "elena",     name: "Elena Vasquez",     initials: "EV", color: "#e879f9", verified: true, campus: "Stanford · Product" },
  jerome:    { id: "jerome",    name: "Jerome Williams",   initials: "JW", color: "#2dd4bf", verified: true, campus: "Howard · Econ" },
  freya:     { id: "freya",     name: "Freya Andersen",    initials: "FA", color: "#fde047", verified: true, campus: "MIT · CS" },
  moses:     { id: "moses",     name: "Moses Kimani",      initials: "MK", color: "#34d399", verified: true, campus: "Georgetown · Global Dev" },
  vivian:    { id: "vivian",    name: "Vivian Huang",      initials: "VH", color: "#fb7185", verified: true, campus: "NYU · Finance" },

  // Family
  mom:       { id: "mom",       name: "Linda Newton",      initials: "LN", color: "#d97706", verified: true, campus: "Los Angeles, CA" },
  dad:       { id: "dad",       name: "David Newton",      initials: "DN", color: "#5c7a8e", verified: true, campus: "Los Angeles, CA" },
  maya_n:    { id: "maya_n",    name: "Maya Newton",       initials: "MN", color: "#22c55e", verified: true, campus: "Stanford · English '25" },
  nana_j:    { id: "nana_j",    name: "Joyce Newton",      initials: "JN", color: "#e07b4f", verified: true, campus: "Inglewood, CA" },
  uncle_ray: { id: "uncle_ray", name: "Ray Newton",        initials: "RN", color: "#0ea5e9", verified: true, campus: "Oakland, CA" },

  // Hometown Friends
  chris_m:   { id: "chris_m",   name: "Chris Martinez",    initials: "CM", color: "#8b5cf6", verified: true, campus: "UCLA · Economics" },
  tara:      { id: "tara",      name: "Tara Wilson",       initials: "TW", color: "#ec4899", verified: true, campus: "UCSB · Biology" },
  deja:      { id: "deja",      name: "Deja Simmons",      initials: "DS", color: "#f59e0b", verified: true, campus: "Cal State LA · Education" },
  kev:       { id: "kev",       name: "Kevin Huang",       initials: "KH", color: "#06b6d4", verified: true, campus: "UC Berkeley · CS" },
  aaliyah_b: { id: "aaliyah_b", name: "Aaliyah Brown",     initials: "AB", color: "#10b981", verified: true, campus: "LMU · Communications" },
  brielle:   { id: "brielle",   name: "Brielle Thomas",    initials: "BT", color: "#f97316", verified: true, campus: "SDSU · Business" },
  nick_p:    { id: "nick_p",    name: "Nick Petrov",       initials: "NP", color: "#64748b", verified: true, campus: "Gap year" },
};

const KENJI:  StoryUser = { id: "kenji",  name: "Kenji T.",   initials: "KT", color: "#b45309", verified: true, campus: "Stanford · Design" };
const LEILA:  StoryUser = { id: "leila",  name: "Leila A.",   initials: "LA", color: "#065f46", verified: true, campus: "MIT · Computation" };
const DANI:   StoryUser = { id: "dani",   name: "Dani R.",    initials: "DR", color: "#1d4ed8", verified: true, campus: "NYU · Philosophy" };
const YARA:   StoryUser = { id: "yara",   name: "Yara M.",    initials: "YM", color: "#7e22ce", verified: true, campus: "Harvard · Psychology" };
const RIKU:   StoryUser = { id: "riku",   name: "Riku N.",    initials: "RN", color: "#0e7490", verified: true, campus: "Columbia · Architecture" };
const AMARA:  StoryUser = { id: "amara",  name: "Amara K.",   initials: "AK", color: "#9d174d", verified: true, campus: "Yale · Sociology" };
const THEO:   StoryUser = { id: "theo",   name: "Theo P.",    initials: "TP", color: "#92400e", verified: true, campus: "Princeton · Economics" };
const PREET:  StoryUser = { id: "preet",  name: "Preet S.",   initials: "PS2", color: "#1e3a8a", verified: true, campus: "Berkeley · CS + Ethics" };

// ── Constants ──────────────────────────────────────────────────────────────────

export const DAILY_PROMPT =
  "What are you afraid of that you rarely talk about?";

// ── Circle Architecture ─────────────────────────────────────────────────────
// Per product spec: "A Circle is a group of 5-15 verified humans."
// "Circles can be organized around any axis: a friend group, a class, a dorm
//  floor, a shared interest." — Caleb is in 3 Circles simultaneously.

interface Circle {
  id: string;
  name: string;
  description: string;
  memberIds: string[]; // excludes Caleb
}

export const CIRCLES: Circle[] = [
  {
    id: "close-friends",
    name: "Close Friends",
    description: "The people who know me",
    memberIds: ["marcus", "callie", "nadia", "elena", "kofi", "drew", "simone"],
  },
  {
    id: "iya-27",
    name: "IYA '27",
    description: "USC Iovine & Young Academy cohort",
    memberIds: ["priya", "daniel", "aisha", "sam", "alicia", "brendon", "grace", "riya", "ingrid"],
  },
  {
    id: "builders",
    name: "Builders",
    description: "CS & product people building things",
    memberIds: ["freya", "omar_s", "drew", "felix_m", "carlos", "nate", "aria"],
  },
  {
    id: "family",
    name: "Family",
    description: "The people who knew me first",
    memberIds: ["mom", "dad", "maya_n", "nana_j", "uncle_ray"],
  },
  {
    id: "hometown",
    name: "Hometown",
    description: "Inglewood and high school people",
    memberIds: ["chris_m", "tara", "deja", "kev", "aaliyah_b", "brielle", "nick_p"],
  },
];

// All unique people across all of Caleb's circles (some overlap between circles)
export const ALL_CIRCLE_MEMBER_IDS = [...new Set(CIRCLES.flatMap(c => c.memberIds))];
export const ALL_CIRCLE_MEMBERS = ALL_CIRCLE_MEMBER_IDS.map(id => USERS[id]).filter(Boolean);
export const TOTAL_CONNECTIONS = ALL_CIRCLE_MEMBER_IDS.length + 1; // +1 for Caleb

// ── Stories ────────────────────────────────────────────────────────────────────

const _BASE_STORIES: StoryPost[] = [

  // TODAY: Circle responses

  {
    id: "marcus-1",
    user: USERS.marcus,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "12m",
    preview:
      "I thought more efficiency meant more optimization. Then I had a conversation with my grandma about how she and my grandpa used to spend whole Saturdays just wandering, no plan, no destination.",
    body: `I have been pretty set in my views on technology and productivity. I thought more efficiency meant more optimization. Track everything, measure everything, be ruthless about your time. Then I had this conversation with my grandma on Sunday. She was telling me about how she and my grandpa used to spend whole Saturdays just wandering. No plan. No destination. They would drive somewhere new and figure it out as they went.

I realized I have never done that. Not once in my adult life. I always have a plan, a goal, a metric. Even my "relaxation" is optimized: scheduled recovery, tracked sleep scores, planned leisure.

What changed for me is not that I now think efficiency is bad. It is that I realized efficiency is a tool, not a value. My grandpa did not optimize his Saturdays and he built a 50-year marriage and a life he was proud of. There is something worth sitting with in that.

This week I left a Saturday afternoon completely open. No tasks, no Notion, no phone apps. I ended up reading an entire book I had been "meaning to get to" for two years. It felt like cheating. It felt like the most human thing I had done in months.`,
    reactions: { think: 24, changed: 11, felt: 8, door: 6 },
  },

  {
    id: "priya-1",
    user: USERS.priya,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#0d2a3a", "#071520"],
    photoUrl: "/images/story/priya-1.jpg",
    timeAgo: "43m",
    preview:
      "Changed my mind on asking for help. I spent 3 hours stuck on a proof that Marcus solved in 10 minutes. Not because I am bad at math, but because knowledge is collective and hoarding your struggle is inefficient.",
    body: `Changed my mind on something small but it matters: I used to think asking for help was a sign you had not tried hard enough. You could figure it out faster yourself, right? Then I spent 3 hours stuck on a proof that Marcus helped me solve in 10 minutes. Not because I am bad at math, but because he had seen a similar pattern and knew the trick.

Asking for help is not a weakness. Hoarding your struggle is.

I think I had internalized some version of "figure it out yourself" as a virtue. Like needing help was evidence of not working hard enough. But that is not how knowledge actually works. Knowledge is collective. It lives between people, not just inside them.

The 10 minutes with Marcus did not just solve the proof. It gave me a new tool I will use for the next 10 problems. Three hours alone would have given me one solution and a headache.

I am trying to ask for help sooner now. It is harder than it sounds.`,
    reactions: { think: 9, changed: 17, felt: 6, door: 5 },
  },

  {
    id: "daniel-1",
    user: USERS.daniel,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "audio",
    audioDuration: "4:12",
    timeAgo: "1h",
    preview:
      "I thought I understood imposter syndrome until a professor I admired said she still feels it, 20 years in, 40 published papers. It completely reframed what I thought I was trying to overcome.",
    body: `Thought I understood what imposter syndrome meant until I talked to a professor I admired. She said she still feels it, 20 years in, 40 papers published.

That changed everything for me. I had been treating imposter syndrome as something to overcome. A phase. Like once I get good enough, confident enough, it will go away. But if it does not go away for someone who is objectively accomplished, then that model is wrong.

Maybe it is not about confidence at all. Maybe it is just the feeling you get when you care enough about something to be honest about what you do not know yet. The people who do not feel it are not better than us. They just stopped caring whether they are actually good.

That is a terrifying thought. But also kind of freeing.

I stopped trying to eliminate the feeling. I am trying to make it feel like evidence I am still in the arena, not evidence that I do not belong there.`,
    reactions: { think: 31, changed: 14, felt: 11, door: 7 },
  },

  {
    id: "aisha-1",
    user: USERS.aisha,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#2a1040", "#120820"],
    timeAgo: "2h",
    preview:
      "My AirPods died on a 45-minute walk and I did not have my charger. I think that was the first time in months I let a thought fully complete itself without something interrupting it.",
    body: `I changed my mind about silence this week. I used to fill every quiet moment: podcast in the shower, music while cooking, something in my ears always. I told myself I was learning, being productive, not wasting time.

Then my AirPods died on a 45-minute walk and I did not have my charger. Just me and the street.

I noticed things I never notice. The way a certain block smells like jasmine around 7pm. A mural I have walked past a hundred times but never actually looked at. A conversation two strangers were having about a dog named Gerald.

I do not think I have let a thought fully complete itself in months. There is always something interrupting, a notification, a new episode, a new concept to absorb. My brain never gets to digest.

I have been leaving the AirPods home on purpose since then. Not every day. But enough. Something is shifting.`,
    reactions: { think: 14, changed: 8, felt: 27, door: 5 },
  },

  {
    id: "sam-1",
    user: USERS.sam,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "3h",
    preview:
      "I realized my idea of independence was actually just fear with better branding. I had mistaken refusing to need people for being strong. These are very different things.",
    body: `I have been thinking about a story I told myself for a long time: that not needing people was a form of strength. That being self-sufficient was the goal. That asking for things was a burden on others.

But I noticed something this semester. The students who are most grounded, most creative, most alive to what they are doing, they are not the lone wolves. They are the people with dense networks of people they trust. They ask questions constantly. They share half-formed ideas. They let themselves be helped.

My self-sufficiency was not independence. It was fear with better branding.

I was afraid that if I needed people too much, they would eventually find it exhausting. Better to be low-maintenance. Better not to give anyone a reason to leave.

I do not know when I learned that. But I am trying to unlearn it. It is slow and uncomfortable. Last week I texted a friend asking for help on something I could have figured out alone, just to practice. She helped me in five minutes and seemed happy to do it.

Nothing bad happened. That was the whole lesson.`,
    reactions: { think: 18, changed: 9, felt: 21, door: 12 },
  },

  // YESTERDAY

  {
    id: "marcus-2",
    user: USERS.marcus,
    dayLabel: "Yesterday",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "3:47",
    timeAgo: "1d",
    preview:
      "I used to think hard work was the differentiator. Put in the hours, outwork everyone. But the most interesting people I know are not the hardest workers. They are the most curious.",
    body: `Growing up, the message I absorbed was clear: hard work is the answer. Put in the hours. Outwork everyone. Success is earned through volume and sacrifice.

I believed this completely. I still believe part of it. But I am no longer sure it is the differentiator I thought it was.

What I have started to notice is that the most interesting people I know are not necessarily the hardest workers. They are the most curious. They follow questions into strange places. They stay with ideas past the point where it is comfortable. They connect things across domains.

Hard work without curiosity is just a treadmill. You go fast and get nowhere new.

I am not saying stop working hard. I am saying that maybe the thing I should have been training this whole time is my capacity to be genuinely interested in the world, not just disciplined within it.

This is hard to admit because "work hard" is an identity for me. Letting go of it, even a little, feels like losing ground. But I think staying curious is actually harder than staying disciplined. It requires more of you, not less.`,
    reactions: { think: 22, changed: 16, felt: 7, door: 9 },
  },

  {
    id: "priya-2",
    user: USERS.priya,
    dayLabel: "Yesterday",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "1d",
    preview:
      "I used to think that being decisive meant never second-guessing yourself. Now I think the most honest people are the ones who can hold two things as true at once without needing to resolve them immediately.",
    body: `For a long time I believed decisiveness meant certainty. Pick a direction, commit, do not look back. Second-guessing was weakness. Changing your mind was inconsistency.

I think I got this from watching people I respected present themselves as unshakeable. They always had an answer. They never said "I do not know." I mistook that for intelligence.

But I have started to notice something: the smartest people I know are also the most comfortable saying they are not sure. They hold two contradictory things at once without needing to resolve them immediately. They change their minds out loud without embarrassment.

What I was calling decisiveness was often just impatience with complexity. I wanted to be done thinking, not done being right.

Real decisiveness is being able to act even while acknowledging you might be wrong. It is not the same as certainty. Certainty often means you have stopped paying attention.

I still struggle with this. Every time I catch myself saying "I am sure about this," I try to ask: am I sure, or am I just tired of being uncertain? Usually it is the second thing.`,
    reactions: { think: 19, changed: 14, felt: 8, door: 7 },
  },

  {
    id: "aisha-2",
    user: USERS.aisha,
    dayLabel: "Yesterday",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "1d",
    preview:
      "I spent years trying to fix my tendency to overthink. Now I wonder if the overthinking was never the problem. Maybe what I was trying to silence was actually useful signal.",
    body: `I have spent years treating my tendency to overthink as a flaw to be corrected. Meditate it away. Journal through it. Reframe it. Turn the volume down.

But lately I am not sure the overthinking itself was ever the problem.

Here is what I mean: when I look back at the things I have been most right about, I usually got there through overthinking. I noticed things other people walked past. I traced a feeling all the way back to where it started. I followed a thread until it explained something that had never made sense before.

The overthinking felt like noise. It turned out to be signal.

What I was actually trying to fix was not the thinking itself. It was the anxiety it produced. I made those two things the same and they are not.

I am trying now to let the thinking do its job and address the anxiety separately. That requires trusting that the part of me that will not stop turning something over is doing it for a reason.

That is a much harder belief to hold than "I am just broken." But I think it is closer to true.`,
    reactions: { think: 28, changed: 11, felt: 19, door: 8 },
  },

  {
    id: "sam-2",
    user: USERS.sam,
    dayLabel: "Yesterday",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "photo",
    photoGradient: ["#0f1e35", "#061020"],
    photoUrl: "/images/story/sam-2.jpg",
    timeAgo: "1d",
    preview:
      "Took this right before sunset on the East side. Something about shooting film forces a different kind of attention. I cannot spam the shutter. I have to actually decide.",
    body: `I picked up a film camera last month, mostly on a whim. I had always been a digital person: take 200 shots, choose the 3 that work, delete the rest. Infinite tries.

Film forces something different. You get 24 exposures, and each one costs you whether you use it well or not. You have to actually decide what is worth taking.

I noticed something on this walk: I was looking differently. I was evaluating before I shot instead of after. I was thinking about light and framing in real time instead of hoping something good would shake out of volume.

The photo I was most proud of from this roll was one I almost did not take because I was not sure it would work. But I only had a few frames left, and something about the light felt right, and I took it.

It came out exactly how I saw it in my head. That almost never happens digitally because digitally I do not have to commit. Film made me commit.

I think about this as a metaphor for a lot of things now. Constraints are not the enemy of quality. Sometimes they are the only thing that creates it.`,
    reactions: { think: 16, changed: 9, felt: 22, door: 13 },
  },

  // 2 DAYS AGO

  {
    id: "daniel-2",
    user: USERS.daniel,
    dayLabel: "2d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "2d",
    preview:
      "I have been avoiding starting the project I actually want to work on. Not the impressive one. The one I think about before I fall asleep. I think I am afraid that trying will prove I am not as good as I hoped.",
    body: `I keep starting the wrong projects. Technically impressive, clearly relevant to future opportunities, exactly the kind of thing that shows up well in a portfolio review. I have been building things I do not care about and telling myself it is strategic.

The project I actually want to work on, the one I have been sketching out and abandoning for about six months, I keep finding reasons to wait. The timing is not right. I need to learn more first. I will have more capacity next semester.

I think the real reason is simpler and harder to say: I am afraid that if I try the project I actually believe in and it fails, or is mediocre, or does not work the way I imagined, I will have to live with that. Right now it is still perfect inside my head. Working on the decoy projects protects that.

So I am going to start next week. Not because I am ready, because I have established fairly clearly that "ready" is not a state I ever reach. Just because the alternative is continuing to work on things I do not care about while the real thing waits.

I do not know if it will be good. I know it will be mine.`,
    reactions: { think: 26, changed: 8, felt: 17, door: 19 },
  },

  {
    id: "marcus-3",
    user: USERS.marcus,
    dayLabel: "2d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "audio",
    audioDuration: "2:58",
    timeAgo: "2d",
    preview:
      "There is a phone call I have been putting off for two months. The person is easy to talk to. I think I have been avoiding it because the conversation will force me to make a decision I have been letting myself defer.",
    body: `There is a phone call I have been putting off for two months. It is not to someone difficult. The person on the other end is warm and understanding. The conversation itself will probably take 20 minutes.

I have been avoiding it because I know what the call will require. I will have to say something definitive about a direction I have been treating as open. Right now I can keep both options alive in my head. Once I make the call, one of them closes.

I have been telling myself I am gathering more information. But I already have the information. I have had it for weeks. I am not waiting for data. I am waiting to feel ready for the loss that comes with choosing.

Every decision is also a goodbye to the other possibilities. I think I had not sat with that enough. I had been treating indecision like a neutral holding state, but it is not. It is its own choice. And it has its own costs.

I am going to make the call tomorrow. Not because I am no longer afraid of closing the door. But because I would rather close it intentionally than have it close on its own while I was busy deferring.`,
    reactions: { think: 21, changed: 13, felt: 10, door: 16 },
  },

  // 3 DAYS AGO

  {
    id: "priya-3",
    user: USERS.priya,
    dayLabel: "3d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "photo",
    photoGradient: ["#0c2e2e", "#061818"],
    photoUrl: "/images/story/priya-3.jpg",
    timeAgo: "3d",
    preview:
      "I have been keeping a list of every time I changed my mind this year and what caused it. Most of them were not arguments. Most of them were single observations that did not fit the model I was using.",
    body: `I started keeping a log in January: every time I changed my mind on something, I would write down what caused it. I am up to 23 entries now.

What surprised me is the distribution. I expected most of them to be debates or strong arguments that convinced me I was wrong. But only 4 are from arguments. The other 19 are from observations.

Not arguments. Observations. A thing I noticed that did not fit the model I was running. A contradiction I could not explain away. A person behaving differently than my theory predicted.

I think I had overestimated the role of logic in how I update my beliefs. I thought I was a rational actor who changed my mind when confronted with good evidence. But mostly I change my mind when something in the world does not match my map of it.

The arguments come later, to explain what already shifted. The shift itself happened somewhere quieter.

I am trying to pay more attention to those quiet shifts now. To not immediately reach for an explanation when something surprises me. To let the surprise stay strange a little longer, because that strangeness is usually pointing at something.`,
    reactions: { think: 33, changed: 20, felt: 9, door: 14 },
  },

  {
    id: "sam-3",
    user: USERS.sam,
    dayLabel: "3d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "3d",
    preview:
      "I used to think leadership meant having answers. The leaders I watched growing up were decisive, certain, clear. That turned out to be a performance I had mistaken for the real thing.",
    body: `The leadership I grew up watching looked like certainty. The person in charge always knew what to do. They did not waver. They had answers.

I spent a long time trying to cultivate that version of leadership. Projecting confidence even when I was not confident. Giving answers I was not sure of because hesitation felt like failure.

Then I worked on a project last fall with a team lead who did something I had never seen before: she said "I do not know" in a room full of people waiting for her to have the answer. Just directly. Then she turned to the group and asked what they thought.

The conversation that followed was the best I had been in all year. People actually said what they thought instead of waiting to agree with whoever was in charge. We got somewhere real.

I changed my mind about what leadership is. It is not the performance of certainty. It is the practice of creating conditions where good thinking can happen. You do not have to have the answer. You have to make it possible for the answer to emerge.

The leaders I admired growing up were probably scared the whole time. They just hid it. I think hiding it was the worst thing they did.`,
    reactions: { think: 29, changed: 18, felt: 11, door: 15 },
  },

  // Caleb historical profile stories

  {
    id: "caleb-1",
    user: USERS.caleb,
    dayLabel: "7d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "7d",
    preview:
      "I spent two years optimizing for legibility. Everything I built was designed to make sense to someone else first. I did not realize this had made me very good at looking productive and considerably worse at actually building.",
    body: `I spent two years optimizing for legibility. Every project, every skill, every choice was evaluated partly by how well it would land on a resume or in a conversation. I was building my story for an audience before I even knew what story I wanted to tell.

The problem is that "legible to others" and "what I actually want to make" are different targets. Not always, but often. And I had been unconsciously prioritizing the first one.

I noticed this when I caught myself killing a project I was genuinely excited about because I could not figure out how to explain it quickly. Not because it was not good. Because the explanation was going to take more than 30 seconds and I was afraid people would not get it.

That is a bad reason to stop building something.

I am trying to reverse the process now. Start with what I actually want to understand or create. Figure out the legibility problem second. It is uncomfortable because the feedback loop is longer and less clear. But the things I am building feel more mine than they have in a long time.

I do not know if this is the right approach at every stage of a career. But I think at this stage, before I have figured out what I actually care about, optimizing for how it looks to others is the wrong optimization.`,
    reactions: { think: 41, changed: 22, felt: 14, door: 18 },
  },

  {
    id: "caleb-2",
    user: USERS.caleb,
    dayLabel: "14d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "5:03",
    timeAgo: "14d",
    preview:
      "I have been trying to trace where my self-critic learned its voice. Not to silence it, but to understand what it is actually afraid of and whether that fear still applies.",
    body: `I spent a long time in a silent fight with my inner critic. Every time I failed at something, the voice was there immediately: you should have been better, you knew this was coming, why did you think you could do this.

I tried ignoring it. I tried arguing with it. Neither worked. The voice does not respond to logic because it is not making a logical argument. It is expressing fear.

I started trying to trace where it learned its voice. Not to fix it, but to understand what it was actually afraid of. When I listened differently, less like it was my enemy and more like it was a scared younger version of me, I started hearing what was underneath.

The fear was not about the failure itself. It was about what the failure might mean about my worth to people I needed. The critic was not mean because it hated me. It was mean because it was terrified of abandonment.

Once I understood that, I could not unhear it. Every time the voice shows up now, I can ask: what are you afraid of losing? That question gets somewhere useful. "You are wrong" does not.

I still fail. The voice still shows up. But the conversation is different now. I am not fighting it anymore.`,
    reactions: { think: 38, changed: 19, felt: 31, door: 11 },
  },

  {
    id: "caleb-3",
    user: USERS.caleb,
    dayLabel: "21d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#1a0a3a", "#0d0520"],
    photoUrl: "/images/story/caleb-3.jpg",
    timeAgo: "21d",
    preview:
      "The version of me that shows up in introductions is assembled, polished, ready. He has the right answers. The real version spends most of his time uncertain and is suspicious of anyone who seems too sure.",
    body: `The version of me that shows up in introductions is assembled. He knows what projects he is working on and why they matter. He has a thesis about the future. He is curious and confident and useful to talk to.

That person is real, but he is also a construction. He is the version I put together when I know I am being read.

The actual daily version is quieter and less certain. He does not always know what he is building or why. He spends a lot of time not knowing whether the thing he is doing is important or if he is just filling time productively. He is suspicious of people who seem too sure, because in his experience certainty is usually a performance covering anxiety.

The gap between these two versions has gotten smaller over the past year, and I think that is mostly good. But I notice I still reach for the assembled version when I am nervous. When I want someone to think well of me. When I am trying to make a first impression that will carry me long enough to show them the real version.

I do not know if the gap ever fully closes. I am not sure it should. But I am trying to lead with the uncertain version more often. Not as a strategy. Just because it is truer.`,
    reactions: { think: 36, changed: 17, felt: 28, door: 13 },
  },

  // Caleb's today story (shown when posted)

  {
    id: "caleb-today",
    user: USERS.caleb,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "just now",
    preview:
      "I am afraid of building something that works technically but does not matter. I can optimize systems. I do not know yet whether I can build things that actually change how people feel about being alive.",
    body: `Here is the fear I almost never say out loud: I am afraid I will spend my life building things that are technically impressive but do not matter.

I can optimize systems. I can find the inefficiency in almost anything and close it. I have been good at that for a long time. But technical competence is not the same as significance. I know how to make things work. I do not know yet whether I can make things that actually change something real in the lives of people who encounter them.

The honest version of what I am working on is not "a product with strong metrics." It is an attempt to prove to myself that it is possible to build technology that makes people more human rather than less. That is the bet. I am not sure I can win it.

What I am most afraid of is getting to 35, having shipped a lot of things that worked, and realizing that I optimized for the wrong output the whole time.

That fear is useful. It makes me take the mission seriously even when it would be easier to just ship a feature. But it is also a lot to carry.

I am still learning how to hold that weight without it freezing me. Today felt like progress.`,
    reactions: { think: 0, changed: 0, felt: 0, door: 0 },
  },

  // FAMILY CIRCLE STORIES

  {
    id: "mom-1",
    user: USERS.mom,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "3h",
    preview:
      "I walked past your old bedroom last week and the door was open and it was so quiet. I do not know when I stopped being afraid of empty and started being afraid that the quiet meant we had all grown past each other.",
    body: `I walked past your old bedroom last week. Door was open. Light was on because I had been in there doing laundry. And it was so quiet.

Your room was never quiet. Even when you were studying, there was always some ambient thing happening. Music, a show, your phone. Noise was how I knew you were home.

I stood in the doorway for a minute longer than I needed to. Thinking about when you were seven and we could not get you to sleep because you wanted to keep talking. Every night a negotiation about one more story, one more question, five more minutes.

I do not know exactly when I stopped being afraid of empty and started being afraid that the quiet meant something bigger. That we had all grown past each other in the ways that matter.

You are doing exactly what you are supposed to be doing. I know that. I am proud of it.

But I wanted to write this somewhere true, which is that I miss you in the ordinary way. Not the proud, milestone way. The Tuesday afternoon, door open, laundry still in the basket way.`,
    reactions: { think: 12, changed: 4, felt: 34, door: 8 },
  },

  {
    id: "dad-1",
    user: USERS.dad,
    dayLabel: "Yesterday",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "audio",
    audioDuration: "4:12",
    timeAgo: "1d",
    preview:
      "I spent thirty years optimizing for stability because my parents did not have it. Now I watch you choose uncertainty on purpose and I am not sure if I gave you freedom or if I just never showed you what I was protecting you from.",
    body: `I grew up in a house where the money stress was ambient. Always there, rarely spoken about, present in the way my parents held their shoulders and changed the subject.

I made a decision at some point that stability would be my north star. I would build a life where nobody had to hold their shoulders like that.

I built it. And I think it was right for what I was solving for.

But I watch you now choosing a path that I would have called risky and you call purposeful, and I keep trying to figure out if I gave you something valuable or if I just protected you from an experience that would have taught you something.

There is a version of this where I did my job. You do not carry the money anxiety I grew up with, so you can afford to take swings I could not take. That is the story where stability was the gift.

There is another version where I shielded you from the kind of friction that builds something in you. That version worries me more.

I do not have a resolution here. I have watched you for two years at USC making choices I would not have made at your age and being better at them than I would have been. So maybe I am asking the wrong question.

But I think about it more than I say.`,
    reactions: { think: 18, changed: 9, felt: 22, door: 11 },
  },

  {
    id: "maya-1",
    user: USERS.maya_n,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "1h",
    preview:
      "Six months out of college and I still catch myself defining myself by what I am building toward instead of who I am right now. School always gave you a next thing. Nobody warned me about the gap.",
    body: `I graduated in June. Six months ago now.

School gave me a clear answer to the question of who I was. I was a Stanford student. I was working on this, studying that, applying for the other thing. The identity came with the institution.

I did not realize how much I was leaning on that until it was gone.

The first two months after graduation I filled every hour. Applications, freelance work, coffee chats, a trip, a course, another application. I told myself I was being productive. I was running from the gap.

The gap is: who am I when I am not building toward something?

I think I have spent most of my life answering that question with a resume. Here is what I am doing. Here is what it is in service of. Here is the next thing.

For the first time I do not have a clean answer. I have fragments. Things I like. Things I care about. A sense of what I want my life to feel like without a clear picture of the form.

I am trying to sit with that instead of immediately filling it. It is uncomfortable in a way that feels important.

Nobody really prepares you for the version of identity crisis that is not dramatic. The quiet one, six months after everything went according to plan.`,
    reactions: { think: 21, changed: 7, felt: 18, door: 9 },
  },

  {
    id: "nana-1",
    user: USERS.nana_j,
    dayLabel: "2d ago",
    promptText: "When did you last feel completely present? What made that possible?",
    mediaType: "photo",
    photoGradient: ["#451a03", "#1c0a00"],
    timeAgo: "2d",
    preview:
      "I planted tomatoes in the backyard again this year. Same spot where I planted them with your grandfather in 1974. Some things you do not do for the harvest. You do them because the ritual is the point.",
    body: `I planted tomatoes in the backyard again this year. Third row from the fence, same spot as always, same spot where your grandfather and I planted our first garden in 1974.

He is gone twelve years now and I still talk to him when I am back there. Not out loud, mostly. Just the kind of talking that happens in your chest when you are doing something you used to do together.

People ask me sometimes why I bother. The market tomatoes are fine. My back does not love the bending anymore. It would be easier not to.

I never quite know how to explain that some things are not about the outcome. The tomatoes matter, but that is not why I do it. I do it because it is a way of being in the same place twice. Fifty years apart and it is the same dirt, the same season, the same slow work of putting something in the ground and waiting.

You asked me once what I miss most about being young. I think the honest answer is the sense that there was more time for things to grow. Now I know there is not always more time, so I try to be more careful about what I put in the ground.

Plant things that are worth tending. That is the whole lesson.`,
    reactions: { think: 16, changed: 6, felt: 47, door: 14 },
  },

  {
    id: "uncle-ray-1",
    user: USERS.uncle_ray,
    dayLabel: "3d ago",
    promptText: "What is a cost you have been paying that you never consciously agreed to?",
    mediaType: "text",
    timeAgo: "3d",
    preview:
      "I left a job I had for eleven years last spring because I realized I had confused the job with the identity. It took me until I was 48 to figure out that was a choice I had been making every day and could unmake.",
    body: `I worked in logistics for eleven years. Good company, good pay, genuinely liked the people. I was good at it.

I left last spring and it took me about six months to stop introducing myself as someone who used to work in logistics.

What I did not understand until I was deep into the transition is how much I had been using the job as an answer to questions that were not really about work. Who are you? Logistics. What do you do? I manage supply chain operations. The job was doing identity work I had not realized I was outsourcing to it.

When it was gone, the questions came back without the easy answer. And they are harder questions when you are 48 than when you are 22, because at 22 you assume the answer is still forming. At 48 you have to reckon with the possibility that you have been not answering for a long time.

I am doing something I care about now. A consulting thing that is slower and more uncertain and more mine.

The cost of the confusion was eleven years of a decent life that was not quite the right life. I do not regret it. But I want to be honest about what it cost.

You are building from the beginning. That is the advantage you have that I did not have. Use it.`,
    reactions: { think: 29, changed: 16, felt: 11, door: 19 },
  },

  // HOMETOWN CIRCLE STORIES

  {
    id: "chris-1",
    user: USERS.chris_m,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "2h",
    preview:
      "We text every week. We see each other maybe three times a year. I used to feel guilty that the friendship was smaller than it used to be. Now I think we are both just changing and the relationship is doing what real ones do.",
    body: `There is something I have been figuring out about distance friendships.

You and I talked every day in high school. We were in each other's houses, in each other's business, in each other's moods. The friendship was ambient. It required no maintenance because it was just the condition of our lives.

College split that. Different schools, different rhythms, different people we are becoming. We text on Sundays mostly. Talk on the phone maybe once a month. See each other over breaks.

I used to feel guilty about that. Like I was letting something important get smaller.

I do not feel that way anymore.

What I have started to notice is that every conversation we have is denser than it used to be. Not because we catch up efficiently, but because we are both actually saying things. Not filler. Not just existing near each other. Actual chosen connection.

The friendship did not shrink. It changed shape. It became a thing we are doing on purpose instead of a thing we fell into.

I think that is what adult friendship is. You stop being ambient to each other and you have to decide to show up. Most relationships cannot survive that transition. The ones that do become something different and I think stronger.

I am not afraid of us growing. I was for a while. Now I think growing is just what we are doing.`,
    reactions: { think: 19, changed: 8, felt: 14, door: 7 },
  },

  {
    id: "tara-1",
    user: USERS.tara,
    dayLabel: "Yesterday",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "3:44",
    timeAgo: "1d",
    preview:
      "I switched my major twice and took a semester off and I am graduating a year late. I think I made the right call every time. The version of me that stayed on track would have finished faster and known less about what she actually wanted.",
    body: `I had a plan coming into college. Pre-med, four years, medical school, done. My parents had the same plan. I had the same plan for long enough that it started to feel like a fact instead of a choice.

Sophomore year I took organic chemistry and genuinely could not make myself care. Not just the hard parts. The whole project. I went to office hours and asked questions and did all the right things and none of it stuck because I was not interested. I was performing interest.

I took a semester off to figure out what I actually wanted. My parents thought it was a crisis. In retrospect it was the opposite of a crisis. It was the first time I had asked myself a real question instead of executing a plan.

I switched to biology with a health education focus. I want to be a school nurse or a public health educator in under-resourced communities. It is not as prestigious as the plan. It pays less than the plan.

I have never once sat in a class since I switched and felt like I was performing interest.

The belief I let go of is that the plan I made before I knew myself was the one I was obligated to keep. Plans are guesses about the future made by a person who does not yet know what they will want. You are allowed to update when you have better information.

I am graduating a year late. I do not care.`,
    reactions: { think: 22, changed: 18, felt: 16, door: 12 },
  },

  {
    id: "deja-1",
    user: USERS.deja,
    dayLabel: "2d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "2d",
    preview:
      "Everybody assumed I would do tech. Good at math, liked computers, got into engineering programs. I am getting a teaching credential instead. Most people still think it is a backup plan. It is not.",
    body: `People have a script for me and I have been deviating from it for two years now.

The script goes: strong in STEM, family is working class, smart kid from a neighborhood that does not produce a lot of tech workers, therefore the narrative is that I become one. Break cycles, change trajectories, prove the doubters wrong.

It is a good story. I understand why people like it. I used to believe I was supposed to be inside it.

I am getting a teaching credential and I want to teach high school math in South LA.

When I tell people this, I can see them doing the recalculation. Did she not get into the programs? Is something wrong? Is this a backup plan?

It is not a backup plan. It is what I want.

I grew up with teachers who saw something in me and changed the trajectory. Real ones, specific ones, who knew my name and pushed me and made me feel like the math was something I was capable of because they said so out loud.

That is not a small thing. That is the whole thing.

I could go make software. I do not want to make software. I want to be in a classroom in five years being the person who changes the calculation for someone the way someone changed it for me.

The story is not less than the other story. It is a different story. I am done apologizing for it.`,
    reactions: { think: 24, changed: 11, felt: 19, door: 16 },
  },

  {
    id: "kev-1",
    user: USERS.kev,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "4h",
    preview:
      "I am surrounded by people who are genuinely brilliant at Berkeley and it has been the best thing for my ego. I used to think being the smartest person in the room was the goal. Now I understand it was actually the problem.",
    body: `I was the best CS student at my high school. Best in my grade, maybe best in recent memory. Teachers mentioned my name when talking to younger students. I had an identity around it.

Berkeley broke that in a specific and useful way.

The first semester I was just keeping up. Not struggling, but not leading. The people around me were fast and creative in ways I had not encountered before. The gap between the top of the class and me was real.

My first instinct was to close it. Compete. Prove I belonged.

What happened instead is that I started paying attention differently. Not to how I compared, but to how these people thought. What made them fast was not effort, most of the time. It was a different relationship to uncertainty. They were willing to be wrong and move on faster. They did not protect their ideas the way I protected mine.

The ego stuff cost me something. Specifically it cost me years of protecting my ideas from critique because critique felt like it was about me. Every time someone poked a hole in my thinking I felt it as an attack on the identity.

Watching people who did not have that attachment showed me what I was doing.

I am a better programmer now than I was two years ago. Most of that improvement came from getting over myself.

Being in rooms where you are not the smartest person is not humbling. It is corrective.`,
    reactions: { think: 31, changed: 14, felt: 9, door: 11 },
  },

  {
    id: "aaliyah-1",
    user: USERS.aaliyah_b,
    dayLabel: "Yesterday",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "photo",
    photoGradient: ["#042f2e", "#021a14"],
    timeAgo: "1d",
    preview:
      "My mom asked if I still want to come back to Inglewood after I graduate. I said yes and she cried. I did not understand why until I realized she thought college was supposed to replace where I came from. It was never supposed to do that.",
    body: `My mom asked me this over the phone last month. The question came with weight. She has worked extremely hard so I could leave, and she wanted to know if I was going to.

I said yes, I want to come back. She got quiet in a way that turned into crying.

I did not understand the reaction at first. Then I realized she thought college was supposed to change what I wanted. That exposure to other places, other people, other ways of living was supposed to make Inglewood feel like a past tense thing.

For a lot of people it does work that way. And I understand it. You grow up somewhere that did not give you everything you needed and you build a path out and the path becomes the destination.

But I did not experience Inglewood as something to escape. I experienced it as a place with real problems and real people who are worth something and a community that made me who I am.

I want to work in communications, maybe media, and I want to use those skills in and for communities like the one I grew up in. That is the thing I almost never say because I have learned that people read it as small ambition.

It is not small ambition. It is specific ambition.

I told my mom that college did not replace where I came from. It gave me tools to come back to it with more.

That is what I am building toward.`,
    reactions: { think: 18, changed: 7, felt: 41, door: 15 },
  },

  {
    id: "brielle-1",
    user: USERS.brielle,
    dayLabel: "3d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "3d",
    preview:
      "I went to a networking event last week and collected twelve business cards and had zero real conversations. I have been to thirty of these things. I think the events designed to build relationships are often the worst way to build them.",
    body: `I go to a lot of networking events.

My business program basically requires it. Show up, circulate, collect cards, follow up, build your network. The formula is very clear.

I went last Thursday and had twelve cards by the end of the night. Twelve two-minute conversations about what I am studying and what I want to do. I came home and could not remember three of the names.

I have been to thirty of these. I have a spreadsheet of follow-ups. I have a LinkedIn that looks active.

I do not think I have made a single meaningful professional connection at a networking event.

The connections I have that actually matter came from classes, from working on projects together, from sitting next to someone on a flight and getting two hours deep on something real. From this thing, actually, writing something true and having someone respond with something equally true.

I am not saying networking events are wrong. I am saying I have been mistaking attendance for relationship building and they are not the same thing.

What would happen if I stopped going?

I think I would have more time to actually work with people and build the kind of track record that makes connections real instead of transactional.

I am not going to stop entirely. But I am going to stop counting events as progress.`,
    reactions: { think: 27, changed: 13, felt: 8, door: 17 },
  },

  {
    id: "nick-1",
    user: USERS.nick_p,
    dayLabel: "4d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "audio",
    audioDuration: "2:58",
    timeAgo: "4d",
    preview:
      "I deferred college for a year and most people assumed something went wrong. Nothing went wrong. I wanted to find out what I actually wanted before I committed two hundred thousand dollars to a direction.",
    body: `I told people I was taking a gap year and the responses sorted into two categories.

The first was people who assumed something had gone wrong. Rejected, had to reapply, family situation, mental health crisis. They were very kind about it. The kindness had an undercurrent of concern.

The second was people who said that sounds amazing and then listed things they wished they had done and clearly were not going to do.

Nobody in either group said: that sounds like a reasonable thing to do.

Which I think tells you something about how we talk about this.

I wanted to find out what I actually wanted to study before I signed up for four years and a large amount of debt. I knew I was interested in several things but I did not know which ones I wanted to commit to. I thought spending a year working and traveling and reading on my own would give me better information than going immediately because that was the expected timeline.

It did. I have much clearer ideas now about what I want to do and why.

The year was not a mistake. The only thing that was ever at risk was the narrative. Other people's timeline for my life.

I am starting next fall. I will be a year behind my high school classmates. I am genuinely not worried about it.

If you are listening to this and on the fence: the year will not ruin your life. The metrics that say it will are not your metrics.`,
    reactions: { think: 33, changed: 21, felt: 12, door: 24 },
  },

  // DISCOVERY STORIES

  {
    id: "kenji-1",
    user: KENJI,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "1h",
    isDiscovery: true,
    preview:
      "I have been studying the way silence functions in Japanese architecture. Ma, the negative space. The absence creates meaning. I keep wondering why we do not design social spaces with intentional emptiness.",
    body: `I have been studying ma, the Japanese concept of negative space, for a seminar on spatial philosophy. In traditional Japanese architecture, the empty space in a room is not the absence of design. It is the design. The void is load-bearing.

I keep returning to this in contexts far outside architecture.

Social media fills every gap. There is no empty space between posts, between reactions, between moments. Every interval is filled with content. The feed has no ma. It is pure positive space: all signal, no silence.

I wonder whether the reason it feels exhausting is not the content itself but the structure. We evolved in environments with natural silences, transitions, pauses. The design of digital social spaces removes all of those by default.

What would it mean to design social software with intentional emptiness? To build pauses into the experience that are not bugs but features? To treat the gap between stories as something worth preserving rather than colonizing?

I do not know the answer. But I think every platform that does not ask the question is making a choice they have not fully thought through.

The absence is not nothing. In architecture it is often everything.`,
    reactions: { think: 52, changed: 21, felt: 14, door: 17 },
  },

  {
    id: "leila-1",
    user: LEILA,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "audio",
    audioDuration: "2:38",
    timeAgo: "3h",
    isDiscovery: true,
    preview:
      "I keep returning to the same question: what does it mean to be efficient at the wrong things? I think I have been optimizing my whole life for the wrong output.",
    body: `I have a very clean system. I track everything. I know exactly where my hours go, what my output is, how I am trending week over week.

The question I have been unable to answer is: am I measuring the right things?

Efficiency is a ratio. Output over input. But the output has to mean something for the ratio to matter. And I am increasingly unsure whether the outputs I have been optimizing for are the ones that will add up to a life I am proud of.

I am not talking about meaningful vs. transactional work. I am talking about something more fundamental: what I am actually trying to produce with my life, versus what I have been producing because it was legible and trackable.

My system is excellent. My system tells me whether I hit my goals. My system does not tell me whether my goals were the right ones to have.

I turned 21 last month. I do not think I have ever really asked myself what I am for. I have asked what I am capable of, what opportunities are available, what outcomes are achievable. But not: what am I actually here to do?

The efficiency follows from the answer. I should have started there.`,
    reactions: { think: 44, changed: 23, felt: 19, door: 28 },
  },

  {
    id: "dani-1",
    user: DANI,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#1a2a4a", "#0d1a30"],
    photoUrl: "/images/story/dani-1.jpg",
    timeAgo: "5h",
    isDiscovery: true,
    preview:
      "Shot this on film last week. Something about the grain forces me to slow down and actually look. I have been thinking about what it means to pay attention in a medium that costs nothing to ignore.",
    body: `I have been thinking about what attention costs.

Digital photography costs nothing per frame. You can take 500 photos of the same thing and find the best one in post. The attention required is minimal because the commitment is minimal. You can decide later whether it mattered.

Film costs something per frame. Not a lot, but something. And that small cost changes everything. You have to decide whether a moment is worth taking before you take it. You have to pay attention before the shutter, not after.

I have been using this as a lens for how I consume content now. The things I read, watch, engage with: most of them cost me nothing to start and cost me nothing to stop. I can begin and abandon 50 things in a morning. The attention never really settles.

I wonder whether some of the anxious restlessness I feel online is a direct result of engaging with things that make no demands. If a piece of content places no demand on me to commit, to slow down, to actually decide it matters, then I never actually experience it. I just pass through it.

The grain in this photo does not make it better technically. But it makes me look at it differently. It feels like it asks something of me.

I think I have been confusing access to a lot of content with actually engaging with any of it.`,
    reactions: { think: 61, changed: 18, felt: 32, door: 12 },
  },

  {
    id: "yara-1",
    user: YARA,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "7h",
    isDiscovery: true,
    preview:
      "We have been trained to think vulnerability is weakness. I have been sitting with how that belief got into me, what it cost me to carry it, and what it will cost to put it down.",
    body: `In my research area we talk a lot about vulnerability as a construct: what it means socially, why it is distributed unequally, how it functions as both risk and resource. I can explain it cleanly in academic language.

What I am less good at is being vulnerable myself.

I trace this to a very specific lesson I absorbed early: vulnerability is something other people weaponize. Show someone where you hurt and you have given them a map. I was not wrong that this happens. I was wrong that the solution was to have no map.

The cost of that belief was that I have not let most people actually know me. I have been present for many relationships while being absent from them. I show up, I contribute, I care genuinely. But there is a layer of myself that I have kept behind glass.

I have started to notice that the relationships I feel most alive in are the ones where I have taken the risk. Where I said the thing I was not sure I should say, or admitted to being scared, or told someone the truth about something I usually perform away.

Those conversations have not been used against me. They have usually brought the other person closer.

I do not know why I still reach for the old strategy. But I am trying to notice when I do it and ask whether it is protection or just habit.`,
    reactions: { think: 72, changed: 31, felt: 48, door: 19 },
  },

  {
    id: "riku-1",
    user: RIKU,
    dayLabel: "Yesterday",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "1d",
    isDiscovery: true,
    preview:
      "I used to believe that good design was invisible. The structure is there to support the absence. Good design disappears. I am not sure that is right anymore.",
    body: `The first principle I learned in architecture school was Lao Tzu's: the usefulness of a room lies in its emptiness. The structure is there to support the absence. Good design disappears.

I built my whole early practice around this. Every decision was evaluated by whether it could be made invisible. If you noticed the choice, the choice was wrong.

But I have been working on something recently that is making me question this. There is a building in this city that is ugly by most formal standards. The joints are exposed. The materials are raw. The structure is aggressive and present. And people love it. Not despite the visibility of its construction but because of it.

The building is not invisible. It is honest.

I wonder whether "invisible design" is sometimes a way of hiding the choices you made from the people who have to live with them. If you cannot see how the thing was built, you cannot evaluate whether those choices were good. You just experience the outcome and trust the architect.

Maybe some structures should be visible. Not because subtlety is wrong, but because visibility is a form of accountability. The building that shows you how it works is the building that trusts you to judge it.

I do not know where this leaves the principle. But I am thinking differently about what "successful design" means.`,
    reactions: { think: 44, changed: 29, felt: 11, door: 22 },
  },

  {
    id: "amara-1",
    user: AMARA,
    dayLabel: "Yesterday",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "3:21",
    timeAgo: "1d",
    isDiscovery: true,
    preview:
      "My grandmother used to say that community is not a feeling, it is a practice. I thought I understood what she meant. I did not understand it until I had to choose between the two.",
    body: `My grandmother said community is not a feeling, it is a practice. She was a woman who showed up: funerals, celebrations, the moments nobody photographed. She did not wait to feel like going. She went.

I thought I had inherited this. I care about community deeply. I write about it academically. I believe in it at a values level.

But there was a period last winter where I was struggling and I pulled back from almost everyone I cared about. Not intentionally, or at least not consciously. I just let myself become unavailable. Too busy, too overwhelmed, too far inside my own head to reach out.

When I eventually came back up and looked around, the community I thought I was a part of had moved in ways I had missed. Things had shifted. Relationships had grown in directions I was not there for.

I had felt like a member of something while not actually practicing membership.

My grandmother would have understood the failure and not excused it. She would have said: you confused caring with showing up and they are not the same thing.

I think she is right. And I think I had been getting credit in my own mind for a form of commitment I was not actually practicing.

I am trying to show up differently now. Less conditional, less comfortable. More like a practice.`,
    reactions: { think: 38, changed: 14, felt: 52, door: 16 },
  },

  {
    id: "theo-1",
    user: THEO,
    dayLabel: "2d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "2d",
    isDiscovery: true,
    preview:
      "I have a theory about why smart people often make bad decisions: the difference between knowing something and acting as if you know it. Aristotle called it akrasia. We still mostly do not know how to solve it.",
    body: `I study economics. I know a lot about the theory of rational decision-making: how agents are supposed to process information, update on evidence, and optimize for outcomes.

I also make decisions in my daily life. The two are not as connected as you might expect.

The thing that separates people who know something from people who act as if they know it is an uncomfortable gap. You can understand that consistent small actions compound over time. You can know this deeply and cite the evidence and explain the mechanism. And still treat your daily choices as if they do not count.

There is a word for this in philosophy: akrasia. Acting against your own better judgment. Aristotle described it. We still mostly do not know how to solve it.

I have been avoiding a conversation about a project direction I know is wrong. I know it is wrong. I have the analysis, I have the data, I have thought through the alternatives. But the conversation requires saying that out loud to people who are committed to the current direction, and that is uncomfortable.

So I keep doing the equivalent of citing the evidence while making the worse choice.

I think the gap between knowledge and action is where most of human failure lives. Not ignorance. Akrasia.

I am going to have the conversation tomorrow. Writing this is part of making myself accountable to it.`,
    reactions: { think: 58, changed: 34, felt: 12, door: 21 },
  },

  {
    id: "preet-1",
    user: PREET,
    dayLabel: "2d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#0a1e3a", "#050f20"],
    photoUrl: "/images/story/preet-1.jpg",
    timeAgo: "2d",
    isDiscovery: true,
    preview:
      "I built a tool that does something useful. Then I realized the most interesting thing about it was the question it could not answer: what happens to the people the tool displaces?",
    body: `I built a classifier that can do in 4 seconds what used to take a junior analyst 3 hours. It is accurate. It is useful. The team that uses it gets measurably better outcomes.

I built it as a technical demonstration. I was proud of the engineering.

Then a few weeks after deployment, one of the junior analysts asked me quietly whether this meant her job was going away. She was not aggressive about it. She was just asking, in the way you ask someone when you already suspect the answer and you are hoping to be wrong.

I said I did not know. Which was true but also cowardly. I knew enough to know it was a reasonable fear. I knew the tool did not create new roles to replace the ones it made redundant. I knew the decision about her employment was above my level and probably happening in a conversation I was not in.

I have been avoiding thinking about this because the tool is genuinely useful and I do not want to feel bad about building something useful. But that avoidance is its own kind of dishonesty. I built the thing. I do not get to outsource the ethical accounting to someone else.

I am not sure what the right answer is. I am not sure there is one that makes everyone whole. But I think the first step is to stop pretending the question does not belong to me.`,
    reactions: { think: 64, changed: 28, felt: 21, door: 33 },
  },
];

export const STORIES: StoryPost[] = [..._BASE_STORIES, ...STORIES_EXTENDED];
