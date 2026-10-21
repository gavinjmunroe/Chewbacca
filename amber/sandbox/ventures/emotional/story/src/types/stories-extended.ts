import type { StoryUser, StoryPost } from "./index";

// ── Inline user definitions (avoids circular imports) ──────────────────────────
const U_gabriel: StoryUser = { id: "gabriel", name: "Gabriel Moreau", initials: "GM", color: "#10b981", verified: true, campus: "Tufts, Biology" };
const U_destiny: StoryUser = { id: "destiny", name: "Destiny Washington", initials: "DW", color: "#b45309", verified: true, campus: "NC A&T, Engineering" };
const U_patrick: StoryUser = { id: "patrick", name: "Patrick Flynn", initials: "PF", color: "#6366f1", verified: true, campus: "Fordham, Philosophy" };
const U_ananya: StoryUser = { id: "ananya", name: "Ananya Krishnan", initials: "AK", color: "#a855f7", verified: true, campus: "Michigan, Biochem" };
const U_caden: StoryUser = { id: "caden", name: "Caden Brooks", initials: "CB", color: "#ef4444", verified: true, campus: "Arizona State, CS" };
const U_layla: StoryUser = { id: "layla", name: "Layla Ahmed", initials: "LA", color: "#059669", verified: true, campus: "UChicago, Sociology" };
const U_derek: StoryUser = { id: "derek", name: "Derek Johnson", initials: "DJ", color: "#3b82f6", verified: true, campus: "Georgetown, Business" };
const U_xiomara: StoryUser = { id: "xiomara", name: "Xiomara Cruz", initials: "XC", color: "#ec4899", verified: true, campus: "NYU, Dance" };
const U_cole: StoryUser = { id: "cole", name: "Cole Anderson", initials: "CA", color: "#f59e0b", verified: true, campus: "Duke, Engineering" };
const U_precious: StoryUser = { id: "precious", name: "Precious Obi", initials: "PO", color: "#0d9488", verified: true, campus: "Howard, Nursing" };
const U_felix: StoryUser = { id: "felix", name: "Felix Wagner", initials: "FW", color: "#2563eb", verified: true, campus: "Cornell, Architecture" };
const U_amara_k: StoryUser = { id: "amara_k", name: "Amara Keita", initials: "AK", color: "#9333ea", verified: true, campus: "Rutgers, Political Sci" };
const U_hunter: StoryUser = { id: "hunter", name: "Hunter Reeves", initials: "HR", color: "#16a34a", verified: true, campus: "Emory, Pre-Med" };
const U_zara: StoryUser = { id: "zara", name: "Zara Ali", initials: "ZA", color: "#f43f5e", verified: true, campus: "Princeton, Neuroscience" };
const U_brendon: StoryUser = { id: "brendon", name: "Brendon Lee", initials: "BL", color: "#78716c", verified: true, campus: "UC San Diego, CS" };
const U_kyla: StoryUser = { id: "kyla", name: "Kyla Morrison", initials: "KM", color: "#a16207", verified: true, campus: "Clark Atlanta, Marketing" };
const U_javier: StoryUser = { id: "javier", name: "Javier Morales", initials: "JM", color: "#0891b2", verified: true, campus: "Miami, Engineering" };
const U_grace: StoryUser = { id: "grace", name: "Grace Kim", initials: "GK", color: "#d946ef", verified: true, campus: "Northwestern, Music" };
const U_omar_b: StoryUser = { id: "omar_b", name: "Omar Bakr", initials: "OB", color: "#22c55e", verified: true, campus: "Harvard, Government" };
const U_stella: StoryUser = { id: "stella", name: "Stella Kowalczyk", initials: "SK", color: "#f97316", verified: true, campus: "UChicago, Economics" };
const U_michael: StoryUser = { id: "michael", name: "Michael Chen", initials: "MC", color: "#60a5fa", verified: true, campus: "Boston College, Finance" };
const U_nina: StoryUser = { id: "nina", name: "Nina Petrov", initials: "NP", color: "#f472b6", verified: true, campus: "NYU, Psychology" };
const U_sam_j: StoryUser = { id: "sam_j", name: "Sam Jackson", initials: "SJ", color: "#34d399", verified: true, campus: "Howard, Film" };
const U_phoenix: StoryUser = { id: "phoenix", name: "Phoenix Reed", initials: "PR", color: "#a78bfa", verified: true, campus: "Arizona State, Art" };
const U_tamara: StoryUser = { id: "tamara", name: "Tamara Okonkwo", initials: "TO", color: "#dc2626", verified: true, campus: "Columbia, Sociology" };
const U_evan: StoryUser = { id: "evan", name: "Evan Goldstein", initials: "EG", color: "#818cf8", verified: true, campus: "Penn, History" };
const U_riya: StoryUser = { id: "riya", name: "Riya Patel", initials: "RP", color: "#10b981", verified: true, campus: "Georgia Tech, CS" };
const U_alejandro: StoryUser = { id: "alejandro", name: "Alejandro Vega", initials: "AV", color: "#0ea5e9", verified: true, campus: "UT Austin, Physics" };
const U_serena: StoryUser = { id: "serena", name: "Serena Williams", initials: "SW", color: "#8b5cf6", verified: true, campus: "Duke, Education" };
const U_jalen: StoryUser = { id: "jalen", name: "Jalen Brooks", initials: "JB", color: "#e11d48", verified: true, campus: "Xavier, Political Sci" };
const U_hazel: StoryUser = { id: "hazel", name: "Hazel Kim", initials: "HK", color: "#fbbf24", verified: true, campus: "BU, Nursing" };
const U_diego: StoryUser = { id: "diego", name: "Diego Martinez", initials: "DM", color: "#92400e", verified: true, campus: "Berkeley, Math" };
const U_quinn: StoryUser = { id: "quinn", name: "Quinn Taylor", initials: "QT", color: "#9333ea", verified: true, campus: "Oberlin, Music" };
const U_monique: StoryUser = { id: "monique", name: "Monique Davis", initials: "MD", color: "#16a34a", verified: true, campus: "Spelman, Business" };
const U_ibrahim: StoryUser = { id: "ibrahim", name: "Ibrahim Al-Farsi", initials: "IA", color: "#3b82f6", verified: true, campus: "Georgetown, CS" };
const U_callie: StoryUser = { id: "callie", name: "Callie Nguyen", initials: "CN", color: "#f9a8d4", verified: true, campus: "UCLA, Psychology" };
const U_rafael: StoryUser = { id: "rafael", name: "Rafael Costa", initials: "RC", color: "#f97316", verified: true, campus: "Columbia, Architecture" };
const U_neha: StoryUser = { id: "neha", name: "Neha Sharma", initials: "NS", color: "#c084fc", verified: true, campus: "Michigan, Pre-Med" };
const U_brooks: StoryUser = { id: "brooks", name: "Brooks Hamilton", initials: "BH", color: "#059669", verified: true, campus: "Emory, Business" };
const U_tiana: StoryUser = { id: "tiana", name: "Tiana Johnson", initials: "TJ", color: "#a855f7", verified: true, campus: "Howard, Law" };
const U_pierre: StoryUser = { id: "pierre", name: "Pierre Dumont", initials: "PD", color: "#0891b2", verified: true, campus: "Georgetown, Philosophy" };
const U_luna: StoryUser = { id: "luna", name: "Luna Garcia", initials: "LG", color: "#f43f5e", verified: true, campus: "Stanford, Education" };
const U_deon: StoryUser = { id: "deon", name: "Deon Washington", initials: "DW", color: "#dc2626", verified: true, campus: "Morehouse, CS" };
const U_emma_f: StoryUser = { id: "emma_f", name: "Emma Fischer", initials: "EF", color: "#93c5fd", verified: true, campus: "Cornell, Literature" };
const U_fiona: StoryUser = { id: "fiona", name: "Fiona Walsh", initials: "FW", color: "#fb7185", verified: true, campus: "NYU, Journalism" };
const U_nadia: StoryUser = { id: "nadia", name: "Nadia Petersen", initials: "NP", color: "#34d399", verified: true, campus: "Yale, Cognitive Sci" };
const U_trevor: StoryUser = { id: "trevor", name: "Trevor Osei", initials: "TO", color: "#60a5fa", verified: true, campus: "Vanderbilt, Economics" };
const U_simone: StoryUser = { id: "simone", name: "Simone Beaumont", initials: "SB", color: "#e879f9", verified: true, campus: "UCLA, Film" };
const U_kai: StoryUser = { id: "kai", name: "Kai Nakamura", initials: "KN", color: "#f59e0b", verified: true, campus: "CalTech, Physics" };
const U_josephine: StoryUser = { id: "josephine", name: "Josephine Adeyemi", initials: "JA", color: "#4ade80", verified: true, campus: "Brown, Anthropology" };
const U_leon: StoryUser = { id: "leon", name: "Leon Bachmann", initials: "LB", color: "#818cf8", verified: true, campus: "Chicago, Statistics" };
const U_yasmin: StoryUser = { id: "yasmin", name: "Yasmin El-Amin", initials: "YE", color: "#f472b6", verified: true, campus: "Princeton, Near East" };
const U_tyrese: StoryUser = { id: "tyrese", name: "Tyrese Grant", initials: "TG", color: "#2dd4bf", verified: true, campus: "Morehouse, Business" };
const U_ingrid: StoryUser = { id: "ingrid", name: "Ingrid Sorensen", initials: "IS", color: "#a78bfa", verified: true, campus: "Northwestern, Design" };
const U_carlos: StoryUser = { id: "carlos", name: "Carlos Mendez", initials: "CM", color: "#fb923c", verified: true, campus: "UT Austin, CS" };
const U_jade: StoryUser = { id: "jade", name: "Jade Williams", initials: "JW", color: "#c084fc", verified: true, campus: "Hampton, Pre-Law" };
const U_andre: StoryUser = { id: "andre", name: "Andre Fontaine", initials: "AF", color: "#38bdf8", verified: true, campus: "Columbia, Finance" };
const U_preethi: StoryUser = { id: "preethi", name: "Preethi Nair", initials: "PN", color: "#a3e635", verified: true, campus: "Michigan, Bioengineering" };
const U_nate: StoryUser = { id: "nate", name: "Nate Coleman", initials: "NC", color: "#fb7185", verified: true, campus: "Ohio State, CS" };
const U_alicia: StoryUser = { id: "alicia", name: "Alicia Torres", initials: "AT", color: "#fde047", verified: true, campus: "USC, Public Policy" };
const U_felix_m: StoryUser = { id: "felix_m", name: "Felix Muller", initials: "FM", color: "#6ee7b7", verified: true, campus: "MIT, Math" };
const U_brianna: StoryUser = { id: "brianna", name: "Brianna Scott", initials: "BS", color: "#fca5a5", verified: true, campus: "Spelman, Pre-Med" };
const U_omar_s: StoryUser = { id: "omar_s", name: "Omar Shaikh", initials: "OS", color: "#93c5fd", verified: true, campus: "Stanford, CS" };
const U_mia: StoryUser = { id: "mia", name: "Mia Johansson", initials: "MJ", color: "#f0abfc", verified: true, campus: "UCLA, Neuroscience" };
const U_elijah: StoryUser = { id: "elijah", name: "Elijah Okafor", initials: "EO", color: "#4ade80", verified: true, campus: "Howard, Business" };
const U_sophie: StoryUser = { id: "sophie", name: "Sophie Laurent", initials: "SL", color: "#e2e8f0", verified: true, campus: "Georgetown, Int'l Rel" };
const U_kofi: StoryUser = { id: "kofi", name: "Kofi Asante", initials: "KA", color: "#fbbf24", verified: true, campus: "Yale, Economics" };
const U_aria: StoryUser = { id: "aria", name: "Aria Singh", initials: "AS", color: "#c4b5fd", verified: true, campus: "Caltech, Biochem" };
const U_jordan: StoryUser = { id: "jordan", name: "Jordan Mills", initials: "JM", color: "#67e8f9", verified: true, campus: "Duke, Environmental Sci" };
const U_kezia: StoryUser = { id: "kezia", name: "Kezia Amankwah", initials: "KA", color: "#fda4af", verified: true, campus: "Clark Atlanta, English" };
const U_tobias: StoryUser = { id: "tobias", name: "Tobias Reinholt", initials: "TR", color: "#86efac", verified: true, campus: "Yale, Linguistics" };
const U_farah: StoryUser = { id: "farah", name: "Farah Mansouri", initials: "FM", color: "#fdba74", verified: true, campus: "BU, Political Sci" };
const U_marcus_j: StoryUser = { id: "marcus_j", name: "Marcus Johnson", initials: "MJ", color: "#a5b4fc", verified: true, campus: "Xavier, Pre-Law" };
const U_esther: StoryUser = { id: "esther", name: "Esther Osei", initials: "EO", color: "#6ee7b7", verified: true, campus: "Fisk, Biology" };
const U_drew: StoryUser = { id: "drew", name: "Drew Chen", initials: "DC", color: "#f9a8d4", verified: true, campus: "Berkeley, EECS" };
const U_amani: StoryUser = { id: "amani", name: "Amani Wambua", initials: "AW", color: "#bef264", verified: true, campus: "Howard, Psychology" };
const U_julian: StoryUser = { id: "julian", name: "Julian Reyes", initials: "JR", color: "#7dd3fc", verified: true, campus: "Columbia, History" };
const U_skye: StoryUser = { id: "skye", name: "Skye Hoffmann", initials: "SH", color: "#f0abfc", verified: true, campus: "Northwestern, Journalism" };
const U_cyrus: StoryUser = { id: "cyrus", name: "Cyrus Tehrani", initials: "CT", color: "#a3e635", verified: true, campus: "UT Austin, Philosophy" };
const U_naomi: StoryUser = { id: "naomi", name: "Naomi Okafor", initials: "NO", color: "#fb923c", verified: true, campus: "Spelman, Sociology" };
const U_luca: StoryUser = { id: "luca", name: "Luca Bernardi", initials: "LB", color: "#818cf8", verified: true, campus: "Cornell, Architecture" };
const U_zoe: StoryUser = { id: "zoe", name: "Zoe Ashworth", initials: "ZA", color: "#f472b6", verified: true, campus: "Penn, Communications" };
const U_kwame: StoryUser = { id: "kwame", name: "Kwame Asare", initials: "KA", color: "#4ade80", verified: true, campus: "Yale, Philosophy" };
const U_priya_r: StoryUser = { id: "priya_r", name: "Priya Rao", initials: "PR", color: "#a855f7", verified: true, campus: "Brown, CS" };
const U_isaiah: StoryUser = { id: "isaiah", name: "Isaiah Thompson", initials: "IT", color: "#60a5fa", verified: true, campus: "Duke, Pre-Law" };
const U_elena: StoryUser = { id: "elena", name: "Elena Vasquez", initials: "EV", color: "#e879f9", verified: true, campus: "Stanford, Product" };
const U_jerome: StoryUser = { id: "jerome", name: "Jerome Williams", initials: "JW", color: "#2dd4bf", verified: true, campus: "Howard, Econ" };
const U_freya: StoryUser = { id: "freya", name: "Freya Andersen", initials: "FA", color: "#fde047", verified: true, campus: "MIT, CS" };
const U_moses: StoryUser = { id: "moses", name: "Moses Kimani", initials: "MK", color: "#34d399", verified: true, campus: "Georgetown, Global Dev" };
const U_vivian: StoryUser = { id: "vivian", name: "Vivian Huang", initials: "VH", color: "#fb7185", verified: true, campus: "NYU, Finance" };

// ── Extended stories: 5 per new circle member (90 users, 450 stories) ──────
export const STORIES_EXTENDED: StoryPost[] = [
  {
    id: "gabriel-1",
    user: U_gabriel,
    dayLabel: "Yesterday",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 4, changed: 2, felt: 3, door: 1 },
  },

  {
    id: "gabriel-2",
    user: U_gabriel,
    dayLabel: "Today",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "The thing that changed my mind was not an argument. It was a single observation I could not explain away with the model I was running.",
    body: `The thing that shifted was not logic. It was a single observation that did not fit my current model. I spent a week trying to explain it away. Eventually I updated the model instead.

I notice now that my model updates almost always come from observations, not arguments. Arguments make me defend. Observations make me wonder.`,
    reactions: { think: 15, changed: 15, felt: 12, door: 8 },
  },

  {
    id: "gabriel-3",
    user: U_gabriel,
    dayLabel: "7d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "5d",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 26, changed: 28, felt: 21, door: 15 },
  },

  {
    id: "gabriel-4",
    user: U_gabriel,
    dayLabel: "6d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "2:15",
    timeAgo: "4d",
    preview: "A twenty-minute conversation two years ago rerouted something that had been set for years. The person said one thing and I could not put it back where it was.",
    body: `A twenty-minute conversation two years ago changed something I had thought was settled. The person did not make an argument. They described something they had observed, and I could not fit it into my existing model.

I still think about that conversation. I am not sure I would have been ready for it a year earlier.`,
    reactions: { think: 37, changed: 10, felt: 30, door: 22 },
  },

  {
    id: "gabriel-5",
    user: U_gabriel,
    dayLabel: "5d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 48, changed: 23, felt: 39, door: 2 },
  },

  {
    id: "destiny-1",
    user: U_destiny,
    dayLabel: "4d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 11, changed: 5, felt: 8, door: 12 },
  },

  {
    id: "destiny-2",
    user: U_destiny,
    dayLabel: "3d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "My inner critic does not speak in logic. It speaks in fear, specifically the fear that this failure is evidence of something permanent.",
    body: `My inner critic speaks in absolutes. Not 'that did not work' but 'you do not have what it takes.' I have been trying to understand where the absolutism came from.

I think it predates any actual failure. It was installed before I had enough experience to verify it. I am trying to rewrite it with more accurate language.`,
    reactions: { think: 22, changed: 18, felt: 17, door: 19 },
  },

  {
    id: "destiny-3",
    user: U_destiny,
    dayLabel: "2d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "8h",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 33, changed: 31, felt: 26, door: 26 },
  },

  {
    id: "destiny-4",
    user: U_destiny,
    dayLabel: "Yesterday",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:44",
    timeAgo: "5h",
    preview: "A belief I held for years: intelligence would protect me from most serious mistakes. It does not. It just makes the mistakes more elaborate.",
    body: `For a long time I thought intelligence was the primary factor in avoiding serious mistakes. I have accumulated enough evidence against this that I have had to revise the model.

What I think now: intelligence mostly helps you build more convincing justifications for what you already wanted to do. The hard part is wanting the right things.`,
    reactions: { think: 44, changed: 13, felt: 35, door: 6 },
  },

  {
    id: "destiny-5",
    user: U_destiny,
    dayLabel: "Today",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 8, changed: 26, felt: 44, door: 13 },
  },

  {
    id: "patrick-1",
    user: U_patrick,
    dayLabel: "7d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 18, changed: 8, felt: 13, door: 23 },
  },

  {
    id: "patrick-2",
    user: U_patrick,
    dayLabel: "6d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "The thing I almost never say: I want to build something that is still being used by people I will never meet. Everything else is practice.",
    body: `I want to build something that makes the people who encounter it feel more capable, not more dependent. That goal has been hard to articulate without sounding vague. I know what I mean by it specifically.

Most of what I have built so far does not fully achieve this. I am still figuring out the gap.`,
    reactions: { think: 29, changed: 21, felt: 22, door: 3 },
  },

  {
    id: "patrick-3",
    user: U_patrick,
    dayLabel: "5d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "3d",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 40, changed: 3, felt: 31, door: 10 },
  },

  {
    id: "patrick-4",
    user: U_patrick,
    dayLabel: "4d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:08",
    timeAgo: "2d",
    preview: "The thing that changed my mind was not an argument. It was a single observation I could not explain away with the model I was running.",
    body: `The thing that shifted was not logic. It was a single observation that did not fit my current model. I spent a week trying to explain it away. Eventually I updated the model instead.

I notice now that my model updates almost always come from observations, not arguments. Arguments make me defend. Observations make me wonder.`,
    reactions: { think: 4, changed: 16, felt: 40, door: 17 },
  },

  {
    id: "patrick-5",
    user: U_patrick,
    dayLabel: "3d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 15, changed: 29, felt: 6, door: 24 },
  },

  {
    id: "ananya-1",
    user: U_ananya,
    dayLabel: "2d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 25, changed: 11, felt: 18, door: 7 },
  },

  {
    id: "ananya-2",
    user: U_ananya,
    dayLabel: "Yesterday",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "5h",
    preview: "Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed initially. Then I realized the disagreement was the point.",
    body: `Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed. Then I sat with the disagreement for two weeks. Then I updated most of my approach.

I think I learn more from honest feedback delivered without agenda than from anything else. I am trying to create more conditions for it.`,
    reactions: { think: 36, changed: 24, felt: 27, door: 14 },
  },

  {
    id: "ananya-3",
    user: U_ananya,
    dayLabel: "Today",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "2h",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 47, changed: 6, felt: 36, door: 21 },
  },

  {
    id: "ananya-4",
    user: U_ananya,
    dayLabel: "7d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "2:33",
    timeAgo: "5d",
    preview: "My inner critic does not speak in logic. It speaks in fear, specifically the fear that this failure is evidence of something permanent.",
    body: `My inner critic speaks in absolutes. Not 'that did not work' but 'you do not have what it takes.' I have been trying to understand where the absolutism came from.

I think it predates any actual failure. It was installed before I had enough experience to verify it. I am trying to rewrite it with more accurate language.`,
    reactions: { think: 11, changed: 19, felt: 45, door: 1 },
  },

  {
    id: "ananya-5",
    user: U_ananya,
    dayLabel: "6d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 22, changed: 32, felt: 11, door: 8 },
  },

  {
    id: "caden-1",
    user: U_caden,
    dayLabel: "5d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 32, changed: 14, felt: 23, door: 18 },
  },

  {
    id: "caden-2",
    user: U_caden,
    dayLabel: "4d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "2d",
    preview: "I used to believe that consistency was the highest virtue. I am less certain now. Some things need to break before they can be rebuilt right.",
    body: `I used to believe consistency was the highest form of discipline. Show up every day, do the work, let compound interest handle the rest.

I still believe this in some domains. In others I have watched people be consistently wrong for years. Consistency is only a virtue if you are pointed at the right target.`,
    reactions: { think: 43, changed: 27, felt: 32, door: 25 },
  },

  {
    id: "caden-3",
    user: U_caden,
    dayLabel: "3d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "1d",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 7, changed: 9, felt: 41, door: 5 },
  },

  {
    id: "caden-4",
    user: U_caden,
    dayLabel: "2d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "3:01",
    timeAgo: "8h",
    preview: "The thing I almost never say: I want to build something that is still being used by people I will never meet. Everything else is practice.",
    body: `I want to build something that makes the people who encounter it feel more capable, not more dependent. That goal has been hard to articulate without sounding vague. I know what I mean by it specifically.

Most of what I have built so far does not fully achieve this. I am still figuring out the gap.`,
    reactions: { think: 18, changed: 22, felt: 7, door: 12 },
  },

  {
    id: "caden-5",
    user: U_caden,
    dayLabel: "Yesterday",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 29, changed: 4, felt: 16, door: 19 },
  },

  {
    id: "layla-1",
    user: U_layla,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 39, changed: 17, felt: 28, door: 2 },
  },

  {
    id: "layla-2",
    user: U_layla,
    dayLabel: "7d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "A conversation last semester changed something I had held as settled. The person did not argue me out of it. They just described what they saw differently.",
    body: `A conversation last semester moved something that had felt settled. The person did not present a counter-argument. They just described what they saw and asked if I saw it the same way. I did not.

I have been trying to figure out what they did differently. I think they made it safe to revise without making me wrong.`,
    reactions: { think: 50, changed: 30, felt: 37, door: 9 },
  },

  {
    id: "layla-3",
    user: U_layla,
    dayLabel: "6d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "4d",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 14, changed: 12, felt: 3, door: 16 },
  },

  {
    id: "layla-4",
    user: U_layla,
    dayLabel: "5d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "3:17",
    timeAgo: "3d",
    preview: "Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed initially. Then I realized the disagreement was the point.",
    body: `Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed. Then I sat with the disagreement for two weeks. Then I updated most of my approach.

I think I learn more from honest feedback delivered without agenda than from anything else. I am trying to create more conditions for it.`,
    reactions: { think: 25, changed: 25, felt: 12, door: 23 },
  },

  {
    id: "layla-5",
    user: U_layla,
    dayLabel: "4d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 36, changed: 7, felt: 21, door: 3 },
  },

  {
    id: "derek-1",
    user: U_derek,
    dayLabel: "3d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 46, changed: 20, felt: 33, door: 13 },
  },

  {
    id: "derek-2",
    user: U_derek,
    dayLabel: "2d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "I have been tracing where my self-critic learned its script. Most of it predates any actual failure. It was there to prevent vulnerability, not to assess performance.",
    body: `I have been listening to my inner voice differently lately. Less like an opponent to defeat and more like a scared version of me that needs information, not combat.

When I ask it what it is actually afraid of, I usually get a more useful answer than when I try to argue it into silence.`,
    reactions: { think: 10, changed: 2, felt: 42, door: 20 },
  },

  {
    id: "derek-3",
    user: U_derek,
    dayLabel: "Yesterday",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "5h",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 21, changed: 15, felt: 8, door: 27 },
  },

  {
    id: "derek-4",
    user: U_derek,
    dayLabel: "Today",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:58",
    timeAgo: "2h",
    preview: "I used to believe that consistency was the highest virtue. I am less certain now. Some things need to break before they can be rebuilt right.",
    body: `I used to believe consistency was the highest form of discipline. Show up every day, do the work, let compound interest handle the rest.

I still believe this in some domains. In others I have watched people be consistently wrong for years. Consistency is only a virtue if you are pointed at the right target.`,
    reactions: { think: 32, changed: 28, felt: 17, door: 7 },
  },

  {
    id: "derek-5",
    user: U_derek,
    dayLabel: "7d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 43, changed: 10, felt: 26, door: 14 },
  },

  {
    id: "xiomara-1",
    user: U_xiomara,
    dayLabel: "6d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 6, changed: 23, felt: 38, door: 24 },
  },

  {
    id: "xiomara-2",
    user: U_xiomara,
    dayLabel: "5d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "What I am building toward is a kind of work that does not make people feel smaller for encountering it. That sounds vague. I know what I mean by it.",
    body: `What I am building toward, and almost never say: I want to make something that is still being used ten years from now by people who do not know my name. Everything I am doing now feels like practice for that.

I do not know if that makes the current work less important. I think it might make it more.`,
    reactions: { think: 17, changed: 5, felt: 4, door: 4 },
  },

  {
    id: "xiomara-3",
    user: U_xiomara,
    dayLabel: "4d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "2d",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 28, changed: 18, felt: 13, door: 11 },
  },

  {
    id: "xiomara-4",
    user: U_xiomara,
    dayLabel: "3d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:52",
    timeAgo: "1d",
    preview: "A conversation last semester changed something I had held as settled. The person did not argue me out of it. They just described what they saw differently.",
    body: `A conversation last semester moved something that had felt settled. The person did not present a counter-argument. They just described what they saw and asked if I saw it the same way. I did not.

I have been trying to figure out what they did differently. I think they made it safe to revise without making me wrong.`,
    reactions: { think: 39, changed: 31, felt: 22, door: 18 },
  },

  {
    id: "xiomara-5",
    user: U_xiomara,
    dayLabel: "2d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 50, changed: 13, felt: 31, door: 25 },
  },

  {
    id: "cole-1",
    user: U_cole,
    dayLabel: "Yesterday",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 13, changed: 26, felt: 43, door: 8 },
  },

  {
    id: "cole-2",
    user: U_cole,
    dayLabel: "Today",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "2h",
    preview: "The conversation that changed my direction was not about my future. It was about something adjacent. The shift happened quietly and I only understood it weeks later.",
    body: `The conversation that changed my direction was not about my career or my future. It was about something smaller. But the thing it moved had been load-bearing and I did not know it.

I think important conversations often disguise themselves as unimportant ones.`,
    reactions: { think: 24, changed: 8, felt: 9, door: 15 },
  },

  {
    id: "cole-3",
    user: U_cole,
    dayLabel: "7d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "5d",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 35, changed: 21, felt: 18, door: 22 },
  },

  {
    id: "cole-4",
    user: U_cole,
    dayLabel: "6d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "3:24",
    timeAgo: "4d",
    preview: "I have been tracing where my self-critic learned its script. Most of it predates any actual failure. It was there to prevent vulnerability, not to assess performance.",
    body: `I have been listening to my inner voice differently lately. Less like an opponent to defeat and more like a scared version of me that needs information, not combat.

When I ask it what it is actually afraid of, I usually get a more useful answer than when I try to argue it into silence.`,
    reactions: { think: 46, changed: 3, felt: 27, door: 2 },
  },

  {
    id: "cole-5",
    user: U_cole,
    dayLabel: "5d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 10, changed: 16, felt: 36, door: 9 },
  },

  {
    id: "precious-1",
    user: U_precious,
    dayLabel: "4d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 20, changed: 29, felt: 5, door: 19 },
  },

  {
    id: "precious-2",
    user: U_precious,
    dayLabel: "3d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "1d",
    preview: "I spent years thinking that certainty was a sign of clear thinking. I now suspect certainty is often a defense against having to think further.",
    body: `I held the belief that certainty was a sign of intellectual rigor. The people I respected most seemed certain. I worked to become certain too.

I think I had it backwards. The people doing the most interesting thinking I know are the ones who hold their models loosely and update quickly. Certainty seems more like a comfort than a conclusion.`,
    reactions: { think: 31, changed: 11, felt: 14, door: 26 },
  },

  {
    id: "precious-3",
    user: U_precious,
    dayLabel: "2d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "8h",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 42, changed: 24, felt: 23, door: 6 },
  },

  {
    id: "precious-4",
    user: U_precious,
    dayLabel: "Yesterday",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "1:36",
    timeAgo: "5h",
    preview: "What I am building toward is a kind of work that does not make people feel smaller for encountering it. That sounds vague. I know what I mean by it.",
    body: `What I am building toward, and almost never say: I want to make something that is still being used ten years from now by people who do not know my name. Everything I am doing now feels like practice for that.

I do not know if that makes the current work less important. I think it might make it more.`,
    reactions: { think: 6, changed: 6, felt: 32, door: 13 },
  },

  {
    id: "precious-5",
    user: U_precious,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 17, changed: 19, felt: 41, door: 20 },
  },

  {
    id: "felix-1",
    user: U_felix,
    dayLabel: "7d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 27, changed: 32, felt: 10, door: 3 },
  },

  {
    id: "felix-2",
    user: U_felix,
    dayLabel: "6d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "I changed my mind when I watched someone do the thing I had theorized about and realized my theory was missing two dimensions.",
    body: `I changed my mind watching someone implement an idea I had theorized about. My theory was missing the part where it is actually hard. Seeing the real version changed my understanding of what the problem was.

I think I learn more from watching things fail in the real world than from any amount of analysis. The map is not the territory.`,
    reactions: { think: 38, changed: 14, felt: 19, door: 10 },
  },

  {
    id: "felix-3",
    user: U_felix,
    dayLabel: "5d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "3d",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 49, changed: 27, felt: 28, door: 17 },
  },

  {
    id: "felix-4",
    user: U_felix,
    dayLabel: "4d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "2:15",
    timeAgo: "2d",
    preview: "The conversation that changed my direction was not about my future. It was about something adjacent. The shift happened quietly and I only understood it weeks later.",
    body: `The conversation that changed my direction was not about my career or my future. It was about something smaller. But the thing it moved had been load-bearing and I did not know it.

I think important conversations often disguise themselves as unimportant ones.`,
    reactions: { think: 13, changed: 9, felt: 37, door: 24 },
  },

  {
    id: "felix-5",
    user: U_felix,
    dayLabel: "3d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 24, changed: 22, felt: 3, door: 4 },
  },

  {
    id: "amara_k-1",
    user: U_amara_k,
    dayLabel: "2d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 34, changed: 4, felt: 15, door: 14 },
  },

  {
    id: "amara_k-2",
    user: U_amara_k,
    dayLabel: "Yesterday",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "The voice that shows up when I fail sounds like someone who needed me to be more in order to feel safe. I have been trying to figure out who taught it that.",
    body: `The voice that shows up when I fail sounds like it learned its script from someone who needed me to be invulnerable. I was not allowed to fail in certain contexts. So the voice decided to prevent failure by making it catastrophic.

Understanding that origin has not made the voice quieter. But it has made it less authoritative.`,
    reactions: { think: 45, changed: 17, felt: 24, door: 21 },
  },

  {
    id: "amara_k-3",
    user: U_amara_k,
    dayLabel: "Today",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "2h",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 9, changed: 30, felt: 33, door: 1 },
  },

  {
    id: "amara_k-4",
    user: U_amara_k,
    dayLabel: "7d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:44",
    timeAgo: "5d",
    preview: "I spent years thinking that certainty was a sign of clear thinking. I now suspect certainty is often a defense against having to think further.",
    body: `I held the belief that certainty was a sign of intellectual rigor. The people I respected most seemed certain. I worked to become certain too.

I think I had it backwards. The people doing the most interesting thinking I know are the ones who hold their models loosely and update quickly. Certainty seems more like a comfort than a conclusion.`,
    reactions: { think: 20, changed: 12, felt: 42, door: 8 },
  },

  {
    id: "amara_k-5",
    user: U_amara_k,
    dayLabel: "6d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 31, changed: 25, felt: 8, door: 15 },
  },

  {
    id: "hunter-1",
    user: U_hunter,
    dayLabel: "5d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 41, changed: 7, felt: 20, door: 25 },
  },

  {
    id: "hunter-2",
    user: U_hunter,
    dayLabel: "4d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "I want to make something that feels necessary. Not useful in a transactional way. Necessary in the way that certain books feel necessary.",
    body: `The version of my work I almost never say out loud: I want it to change how someone thinks, not just what they can do. That is a different target than what most of my current projects aim at.

I am trying to figure out how to build toward it more directly.`,
    reactions: { think: 5, changed: 20, felt: 29, door: 5 },
  },

  {
    id: "hunter-3",
    user: U_hunter,
    dayLabel: "3d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "1d",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 16, changed: 2, felt: 38, door: 12 },
  },

  {
    id: "hunter-4",
    user: U_hunter,
    dayLabel: "2d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:08",
    timeAgo: "8h",
    preview: "I changed my mind when I watched someone do the thing I had theorized about and realized my theory was missing two dimensions.",
    body: `I changed my mind watching someone implement an idea I had theorized about. My theory was missing the part where it is actually hard. Seeing the real version changed my understanding of what the problem was.

I think I learn more from watching things fail in the real world than from any amount of analysis. The map is not the territory.`,
    reactions: { think: 27, changed: 15, felt: 4, door: 19 },
  },

  {
    id: "hunter-5",
    user: U_hunter,
    dayLabel: "Yesterday",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 38, changed: 28, felt: 13, door: 26 },
  },

  {
    id: "zara-1",
    user: U_zara,
    dayLabel: "Today",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 48, changed: 10, felt: 25, door: 9 },
  },

  {
    id: "zara-2",
    user: U_zara,
    dayLabel: "7d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "5d",
    preview: "A twenty-minute conversation two years ago rerouted something that had been set for years. The person said one thing and I could not put it back where it was.",
    body: `A twenty-minute conversation two years ago changed something I had thought was settled. The person did not make an argument. They described something they had observed, and I could not fit it into my existing model.

I still think about that conversation. I am not sure I would have been ready for it a year earlier.`,
    reactions: { think: 12, changed: 23, felt: 34, door: 16 },
  },

  {
    id: "zara-3",
    user: U_zara,
    dayLabel: "6d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "4d",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 23, changed: 5, felt: 43, door: 23 },
  },

  {
    id: "zara-4",
    user: U_zara,
    dayLabel: "5d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "2:33",
    timeAgo: "3d",
    preview: "The voice that shows up when I fail sounds like someone who needed me to be more in order to feel safe. I have been trying to figure out who taught it that.",
    body: `The voice that shows up when I fail sounds like it learned its script from someone who needed me to be invulnerable. I was not allowed to fail in certain contexts. So the voice decided to prevent failure by making it catastrophic.

Understanding that origin has not made the voice quieter. But it has made it less authoritative.`,
    reactions: { think: 34, changed: 18, felt: 9, door: 3 },
  },

  {
    id: "zara-5",
    user: U_zara,
    dayLabel: "4d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 45, changed: 31, felt: 18, door: 10 },
  },

  {
    id: "brendon-1",
    user: U_brendon,
    dayLabel: "3d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 8, changed: 13, felt: 30, door: 20 },
  },

  {
    id: "brendon-2",
    user: U_brendon,
    dayLabel: "2d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "8h",
    preview: "A belief I held for years: intelligence would protect me from most serious mistakes. It does not. It just makes the mistakes more elaborate.",
    body: `For a long time I thought intelligence was the primary factor in avoiding serious mistakes. I have accumulated enough evidence against this that I have had to revise the model.

What I think now: intelligence mostly helps you build more convincing justifications for what you already wanted to do. The hard part is wanting the right things.`,
    reactions: { think: 19, changed: 26, felt: 39, door: 27 },
  },

  {
    id: "brendon-3",
    user: U_brendon,
    dayLabel: "Yesterday",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "5h",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 30, changed: 8, felt: 5, door: 7 },
  },

  {
    id: "brendon-4",
    user: U_brendon,
    dayLabel: "Today",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "3:01",
    timeAgo: "2h",
    preview: "I want to make something that feels necessary. Not useful in a transactional way. Necessary in the way that certain books feel necessary.",
    body: `The version of my work I almost never say out loud: I want it to change how someone thinks, not just what they can do. That is a different target than what most of my current projects aim at.

I am trying to figure out how to build toward it more directly.`,
    reactions: { think: 41, changed: 21, felt: 14, door: 14 },
  },

  {
    id: "brendon-5",
    user: U_brendon,
    dayLabel: "7d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 5, changed: 3, felt: 23, door: 21 },
  },

  {
    id: "kyla-1",
    user: U_kyla,
    dayLabel: "6d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 15, changed: 16, felt: 35, door: 4 },
  },

  {
    id: "kyla-2",
    user: U_kyla,
    dayLabel: "5d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "The thing that changed my mind was not an argument. It was a single observation I could not explain away with the model I was running.",
    body: `The thing that shifted was not logic. It was a single observation that did not fit my current model. I spent a week trying to explain it away. Eventually I updated the model instead.

I notice now that my model updates almost always come from observations, not arguments. Arguments make me defend. Observations make me wonder.`,
    reactions: { think: 26, changed: 29, felt: 44, door: 11 },
  },

  {
    id: "kyla-3",
    user: U_kyla,
    dayLabel: "4d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "2d",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 37, changed: 11, felt: 10, door: 18 },
  },

  {
    id: "kyla-4",
    user: U_kyla,
    dayLabel: "3d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "3:17",
    timeAgo: "1d",
    preview: "A twenty-minute conversation two years ago rerouted something that had been set for years. The person said one thing and I could not put it back where it was.",
    body: `A twenty-minute conversation two years ago changed something I had thought was settled. The person did not make an argument. They described something they had observed, and I could not fit it into my existing model.

I still think about that conversation. I am not sure I would have been ready for it a year earlier.`,
    reactions: { think: 48, changed: 24, felt: 19, door: 25 },
  },

  {
    id: "kyla-5",
    user: U_kyla,
    dayLabel: "2d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 12, changed: 6, felt: 28, door: 5 },
  },

  {
    id: "javier-1",
    user: U_javier,
    dayLabel: "Yesterday",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 22, changed: 19, felt: 40, door: 15 },
  },

  {
    id: "javier-2",
    user: U_javier,
    dayLabel: "Today",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "My inner critic does not speak in logic. It speaks in fear, specifically the fear that this failure is evidence of something permanent.",
    body: `My inner critic speaks in absolutes. Not 'that did not work' but 'you do not have what it takes.' I have been trying to understand where the absolutism came from.

I think it predates any actual failure. It was installed before I had enough experience to verify it. I am trying to rewrite it with more accurate language.`,
    reactions: { think: 33, changed: 32, felt: 6, door: 22 },
  },

  {
    id: "javier-3",
    user: U_javier,
    dayLabel: "7d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "5d",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 44, changed: 14, felt: 15, door: 2 },
  },

  {
    id: "javier-4",
    user: U_javier,
    dayLabel: "6d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:58",
    timeAgo: "4d",
    preview: "A belief I held for years: intelligence would protect me from most serious mistakes. It does not. It just makes the mistakes more elaborate.",
    body: `For a long time I thought intelligence was the primary factor in avoiding serious mistakes. I have accumulated enough evidence against this that I have had to revise the model.

What I think now: intelligence mostly helps you build more convincing justifications for what you already wanted to do. The hard part is wanting the right things.`,
    reactions: { think: 8, changed: 27, felt: 24, door: 9 },
  },

  {
    id: "javier-5",
    user: U_javier,
    dayLabel: "5d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 19, changed: 9, felt: 33, door: 16 },
  },

  {
    id: "grace-1",
    user: U_grace,
    dayLabel: "4d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 29, changed: 22, felt: 45, door: 26 },
  },

  {
    id: "grace-2",
    user: U_grace,
    dayLabel: "3d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "The thing I almost never say: I want to build something that is still being used by people I will never meet. Everything else is practice.",
    body: `I want to build something that makes the people who encounter it feel more capable, not more dependent. That goal has been hard to articulate without sounding vague. I know what I mean by it specifically.

Most of what I have built so far does not fully achieve this. I am still figuring out the gap.`,
    reactions: { think: 40, changed: 4, felt: 11, door: 6 },
  },

  {
    id: "grace-3",
    user: U_grace,
    dayLabel: "2d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "8h",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 4, changed: 17, felt: 20, door: 13 },
  },

  {
    id: "grace-4",
    user: U_grace,
    dayLabel: "Yesterday",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:52",
    timeAgo: "5h",
    preview: "The thing that changed my mind was not an argument. It was a single observation I could not explain away with the model I was running.",
    body: `The thing that shifted was not logic. It was a single observation that did not fit my current model. I spent a week trying to explain it away. Eventually I updated the model instead.

I notice now that my model updates almost always come from observations, not arguments. Arguments make me defend. Observations make me wonder.`,
    reactions: { think: 15, changed: 30, felt: 29, door: 20 },
  },

  {
    id: "grace-5",
    user: U_grace,
    dayLabel: "Today",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 26, changed: 12, felt: 38, door: 27 },
  },

  {
    id: "omar_b-1",
    user: U_omar_b,
    dayLabel: "7d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 36, changed: 25, felt: 7, door: 10 },
  },

  {
    id: "omar_b-2",
    user: U_omar_b,
    dayLabel: "6d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "4d",
    preview: "Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed initially. Then I realized the disagreement was the point.",
    body: `Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed. Then I sat with the disagreement for two weeks. Then I updated most of my approach.

I think I learn more from honest feedback delivered without agenda than from anything else. I am trying to create more conditions for it.`,
    reactions: { think: 47, changed: 7, felt: 16, door: 17 },
  },

  {
    id: "omar_b-3",
    user: U_omar_b,
    dayLabel: "5d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "3d",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 11, changed: 20, felt: 25, door: 24 },
  },

  {
    id: "omar_b-4",
    user: U_omar_b,
    dayLabel: "4d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "3:24",
    timeAgo: "2d",
    preview: "My inner critic does not speak in logic. It speaks in fear, specifically the fear that this failure is evidence of something permanent.",
    body: `My inner critic speaks in absolutes. Not 'that did not work' but 'you do not have what it takes.' I have been trying to understand where the absolutism came from.

I think it predates any actual failure. It was installed before I had enough experience to verify it. I am trying to rewrite it with more accurate language.`,
    reactions: { think: 22, changed: 2, felt: 34, door: 4 },
  },

  {
    id: "omar_b-5",
    user: U_omar_b,
    dayLabel: "3d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 33, changed: 15, felt: 43, door: 11 },
  },

  {
    id: "stella-1",
    user: U_stella,
    dayLabel: "2d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 43, changed: 28, felt: 12, door: 21 },
  },

  {
    id: "stella-2",
    user: U_stella,
    dayLabel: "Yesterday",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "5h",
    preview: "I used to believe that consistency was the highest virtue. I am less certain now. Some things need to break before they can be rebuilt right.",
    body: `I used to believe consistency was the highest form of discipline. Show up every day, do the work, let compound interest handle the rest.

I still believe this in some domains. In others I have watched people be consistently wrong for years. Consistency is only a virtue if you are pointed at the right target.`,
    reactions: { think: 7, changed: 10, felt: 21, door: 1 },
  },

  {
    id: "stella-3",
    user: U_stella,
    dayLabel: "Today",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "2h",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 18, changed: 23, felt: 30, door: 8 },
  },

  {
    id: "stella-4",
    user: U_stella,
    dayLabel: "7d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "1:36",
    timeAgo: "5d",
    preview: "The thing I almost never say: I want to build something that is still being used by people I will never meet. Everything else is practice.",
    body: `I want to build something that makes the people who encounter it feel more capable, not more dependent. That goal has been hard to articulate without sounding vague. I know what I mean by it specifically.

Most of what I have built so far does not fully achieve this. I am still figuring out the gap.`,
    reactions: { think: 29, changed: 5, felt: 39, door: 15 },
  },

  {
    id: "stella-5",
    user: U_stella,
    dayLabel: "6d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 40, changed: 18, felt: 5, door: 22 },
  },

  {
    id: "michael-1",
    user: U_michael,
    dayLabel: "5d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 50, changed: 31, felt: 17, door: 5 },
  },

  {
    id: "michael-2",
    user: U_michael,
    dayLabel: "4d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "A conversation last semester changed something I had held as settled. The person did not argue me out of it. They just described what they saw differently.",
    body: `A conversation last semester moved something that had felt settled. The person did not present a counter-argument. They just described what they saw and asked if I saw it the same way. I did not.

I have been trying to figure out what they did differently. I think they made it safe to revise without making me wrong.`,
    reactions: { think: 14, changed: 13, felt: 26, door: 12 },
  },

  {
    id: "michael-3",
    user: U_michael,
    dayLabel: "3d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "1d",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 25, changed: 26, felt: 35, door: 19 },
  },

  {
    id: "michael-4",
    user: U_michael,
    dayLabel: "2d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "2:15",
    timeAgo: "8h",
    preview: "Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed initially. Then I realized the disagreement was the point.",
    body: `Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed. Then I sat with the disagreement for two weeks. Then I updated most of my approach.

I think I learn more from honest feedback delivered without agenda than from anything else. I am trying to create more conditions for it.`,
    reactions: { think: 36, changed: 8, felt: 44, door: 26 },
  },

  {
    id: "michael-5",
    user: U_michael,
    dayLabel: "Yesterday",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 47, changed: 21, felt: 10, door: 6 },
  },

  {
    id: "nina-1",
    user: U_nina,
    dayLabel: "Today",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 10, changed: 3, felt: 22, door: 16 },
  },

  {
    id: "nina-2",
    user: U_nina,
    dayLabel: "7d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "I have been tracing where my self-critic learned its script. Most of it predates any actual failure. It was there to prevent vulnerability, not to assess performance.",
    body: `I have been listening to my inner voice differently lately. Less like an opponent to defeat and more like a scared version of me that needs information, not combat.

When I ask it what it is actually afraid of, I usually get a more useful answer than when I try to argue it into silence.`,
    reactions: { think: 21, changed: 16, felt: 31, door: 23 },
  },

  {
    id: "nina-3",
    user: U_nina,
    dayLabel: "6d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "4d",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 32, changed: 29, felt: 40, door: 3 },
  },

  {
    id: "nina-4",
    user: U_nina,
    dayLabel: "5d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:44",
    timeAgo: "3d",
    preview: "I used to believe that consistency was the highest virtue. I am less certain now. Some things need to break before they can be rebuilt right.",
    body: `I used to believe consistency was the highest form of discipline. Show up every day, do the work, let compound interest handle the rest.

I still believe this in some domains. In others I have watched people be consistently wrong for years. Consistency is only a virtue if you are pointed at the right target.`,
    reactions: { think: 43, changed: 11, felt: 6, door: 10 },
  },

  {
    id: "nina-5",
    user: U_nina,
    dayLabel: "4d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 7, changed: 24, felt: 15, door: 17 },
  },

  {
    id: "sam_j-1",
    user: U_sam_j,
    dayLabel: "3d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 17, changed: 6, felt: 27, door: 27 },
  },

  {
    id: "sam_j-2",
    user: U_sam_j,
    dayLabel: "2d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "What I am building toward is a kind of work that does not make people feel smaller for encountering it. That sounds vague. I know what I mean by it.",
    body: `What I am building toward, and almost never say: I want to make something that is still being used ten years from now by people who do not know my name. Everything I am doing now feels like practice for that.

I do not know if that makes the current work less important. I think it might make it more.`,
    reactions: { think: 28, changed: 19, felt: 36, door: 7 },
  },

  {
    id: "sam_j-3",
    user: U_sam_j,
    dayLabel: "Yesterday",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "5h",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 39, changed: 32, felt: 45, door: 14 },
  },

  {
    id: "sam_j-4",
    user: U_sam_j,
    dayLabel: "Today",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:08",
    timeAgo: "2h",
    preview: "A conversation last semester changed something I had held as settled. The person did not argue me out of it. They just described what they saw differently.",
    body: `A conversation last semester moved something that had felt settled. The person did not present a counter-argument. They just described what they saw and asked if I saw it the same way. I did not.

I have been trying to figure out what they did differently. I think they made it safe to revise without making me wrong.`,
    reactions: { think: 50, changed: 14, felt: 11, door: 21 },
  },

  {
    id: "sam_j-5",
    user: U_sam_j,
    dayLabel: "7d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 14, changed: 27, felt: 20, door: 1 },
  },

  {
    id: "phoenix-1",
    user: U_phoenix,
    dayLabel: "6d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 24, changed: 9, felt: 32, door: 11 },
  },

  {
    id: "phoenix-2",
    user: U_phoenix,
    dayLabel: "5d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "3d",
    preview: "The conversation that changed my direction was not about my future. It was about something adjacent. The shift happened quietly and I only understood it weeks later.",
    body: `The conversation that changed my direction was not about my career or my future. It was about something smaller. But the thing it moved had been load-bearing and I did not know it.

I think important conversations often disguise themselves as unimportant ones.`,
    reactions: { think: 35, changed: 22, felt: 41, door: 18 },
  },

  {
    id: "phoenix-3",
    user: U_phoenix,
    dayLabel: "4d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "2d",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 46, changed: 4, felt: 7, door: 25 },
  },

  {
    id: "phoenix-4",
    user: U_phoenix,
    dayLabel: "3d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "2:33",
    timeAgo: "1d",
    preview: "I have been tracing where my self-critic learned its script. Most of it predates any actual failure. It was there to prevent vulnerability, not to assess performance.",
    body: `I have been listening to my inner voice differently lately. Less like an opponent to defeat and more like a scared version of me that needs information, not combat.

When I ask it what it is actually afraid of, I usually get a more useful answer than when I try to argue it into silence.`,
    reactions: { think: 10, changed: 17, felt: 16, door: 5 },
  },

  {
    id: "phoenix-5",
    user: U_phoenix,
    dayLabel: "2d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 21, changed: 30, felt: 25, door: 12 },
  },

  {
    id: "tamara-1",
    user: U_tamara,
    dayLabel: "Yesterday",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 31, changed: 12, felt: 37, door: 22 },
  },

  {
    id: "tamara-2",
    user: U_tamara,
    dayLabel: "Today",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "2h",
    preview: "I spent years thinking that certainty was a sign of clear thinking. I now suspect certainty is often a defense against having to think further.",
    body: `I held the belief that certainty was a sign of intellectual rigor. The people I respected most seemed certain. I worked to become certain too.

I think I had it backwards. The people doing the most interesting thinking I know are the ones who hold their models loosely and update quickly. Certainty seems more like a comfort than a conclusion.`,
    reactions: { think: 42, changed: 25, felt: 3, door: 2 },
  },

  {
    id: "tamara-3",
    user: U_tamara,
    dayLabel: "7d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "5d",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 6, changed: 7, felt: 12, door: 9 },
  },

  {
    id: "tamara-4",
    user: U_tamara,
    dayLabel: "6d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "3:01",
    timeAgo: "4d",
    preview: "What I am building toward is a kind of work that does not make people feel smaller for encountering it. That sounds vague. I know what I mean by it.",
    body: `What I am building toward, and almost never say: I want to make something that is still being used ten years from now by people who do not know my name. Everything I am doing now feels like practice for that.

I do not know if that makes the current work less important. I think it might make it more.`,
    reactions: { think: 17, changed: 20, felt: 21, door: 16 },
  },

  {
    id: "tamara-5",
    user: U_tamara,
    dayLabel: "5d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 28, changed: 2, felt: 30, door: 23 },
  },

  {
    id: "evan-1",
    user: U_evan,
    dayLabel: "4d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 38, changed: 15, felt: 42, door: 6 },
  },

  {
    id: "evan-2",
    user: U_evan,
    dayLabel: "3d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "I changed my mind when I watched someone do the thing I had theorized about and realized my theory was missing two dimensions.",
    body: `I changed my mind watching someone implement an idea I had theorized about. My theory was missing the part where it is actually hard. Seeing the real version changed my understanding of what the problem was.

I think I learn more from watching things fail in the real world than from any amount of analysis. The map is not the territory.`,
    reactions: { think: 49, changed: 28, felt: 8, door: 13 },
  },

  {
    id: "evan-3",
    user: U_evan,
    dayLabel: "2d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "8h",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 13, changed: 10, felt: 17, door: 20 },
  },

  {
    id: "evan-4",
    user: U_evan,
    dayLabel: "Yesterday",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "3:17",
    timeAgo: "5h",
    preview: "The conversation that changed my direction was not about my future. It was about something adjacent. The shift happened quietly and I only understood it weeks later.",
    body: `The conversation that changed my direction was not about my career or my future. It was about something smaller. But the thing it moved had been load-bearing and I did not know it.

I think important conversations often disguise themselves as unimportant ones.`,
    reactions: { think: 24, changed: 23, felt: 26, door: 27 },
  },

  {
    id: "evan-5",
    user: U_evan,
    dayLabel: "Today",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 35, changed: 5, felt: 35, door: 7 },
  },

  {
    id: "riya-1",
    user: U_riya,
    dayLabel: "7d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 45, changed: 18, felt: 4, door: 17 },
  },

  {
    id: "riya-2",
    user: U_riya,
    dayLabel: "6d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "The voice that shows up when I fail sounds like someone who needed me to be more in order to feel safe. I have been trying to figure out who taught it that.",
    body: `The voice that shows up when I fail sounds like it learned its script from someone who needed me to be invulnerable. I was not allowed to fail in certain contexts. So the voice decided to prevent failure by making it catastrophic.

Understanding that origin has not made the voice quieter. But it has made it less authoritative.`,
    reactions: { think: 9, changed: 31, felt: 13, door: 24 },
  },

  {
    id: "riya-3",
    user: U_riya,
    dayLabel: "5d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "3d",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 20, changed: 13, felt: 22, door: 4 },
  },

  {
    id: "riya-4",
    user: U_riya,
    dayLabel: "4d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:58",
    timeAgo: "2d",
    preview: "I spent years thinking that certainty was a sign of clear thinking. I now suspect certainty is often a defense against having to think further.",
    body: `I held the belief that certainty was a sign of intellectual rigor. The people I respected most seemed certain. I worked to become certain too.

I think I had it backwards. The people doing the most interesting thinking I know are the ones who hold their models loosely and update quickly. Certainty seems more like a comfort than a conclusion.`,
    reactions: { think: 31, changed: 26, felt: 31, door: 11 },
  },

  {
    id: "riya-5",
    user: U_riya,
    dayLabel: "3d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 42, changed: 8, felt: 40, door: 18 },
  },

  {
    id: "alejandro-1",
    user: U_alejandro,
    dayLabel: "2d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 5, changed: 21, felt: 9, door: 1 },
  },

  {
    id: "alejandro-2",
    user: U_alejandro,
    dayLabel: "Yesterday",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "I want to make something that feels necessary. Not useful in a transactional way. Necessary in the way that certain books feel necessary.",
    body: `The version of my work I almost never say out loud: I want it to change how someone thinks, not just what they can do. That is a different target than what most of my current projects aim at.

I am trying to figure out how to build toward it more directly.`,
    reactions: { think: 16, changed: 3, felt: 18, door: 8 },
  },

  {
    id: "alejandro-3",
    user: U_alejandro,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "2h",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 27, changed: 16, felt: 27, door: 15 },
  },

  {
    id: "alejandro-4",
    user: U_alejandro,
    dayLabel: "7d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:52",
    timeAgo: "5d",
    preview: "I changed my mind when I watched someone do the thing I had theorized about and realized my theory was missing two dimensions.",
    body: `I changed my mind watching someone implement an idea I had theorized about. My theory was missing the part where it is actually hard. Seeing the real version changed my understanding of what the problem was.

I think I learn more from watching things fail in the real world than from any amount of analysis. The map is not the territory.`,
    reactions: { think: 38, changed: 29, felt: 36, door: 22 },
  },

  {
    id: "alejandro-5",
    user: U_alejandro,
    dayLabel: "6d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 49, changed: 11, felt: 45, door: 2 },
  },

  {
    id: "serena-1",
    user: U_serena,
    dayLabel: "5d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 12, changed: 24, felt: 14, door: 12 },
  },

  {
    id: "serena-2",
    user: U_serena,
    dayLabel: "4d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "2d",
    preview: "A twenty-minute conversation two years ago rerouted something that had been set for years. The person said one thing and I could not put it back where it was.",
    body: `A twenty-minute conversation two years ago changed something I had thought was settled. The person did not make an argument. They described something they had observed, and I could not fit it into my existing model.

I still think about that conversation. I am not sure I would have been ready for it a year earlier.`,
    reactions: { think: 23, changed: 6, felt: 23, door: 19 },
  },

  {
    id: "serena-3",
    user: U_serena,
    dayLabel: "3d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "1d",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 34, changed: 19, felt: 32, door: 26 },
  },

  {
    id: "serena-4",
    user: U_serena,
    dayLabel: "2d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "3:24",
    timeAgo: "8h",
    preview: "The voice that shows up when I fail sounds like someone who needed me to be more in order to feel safe. I have been trying to figure out who taught it that.",
    body: `The voice that shows up when I fail sounds like it learned its script from someone who needed me to be invulnerable. I was not allowed to fail in certain contexts. So the voice decided to prevent failure by making it catastrophic.

Understanding that origin has not made the voice quieter. But it has made it less authoritative.`,
    reactions: { think: 45, changed: 32, felt: 41, door: 6 },
  },

  {
    id: "serena-5",
    user: U_serena,
    dayLabel: "Yesterday",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 9, changed: 14, felt: 7, door: 13 },
  },

  {
    id: "jalen-1",
    user: U_jalen,
    dayLabel: "Today",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 19, changed: 27, felt: 19, door: 23 },
  },

  {
    id: "jalen-2",
    user: U_jalen,
    dayLabel: "7d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "5d",
    preview: "A belief I held for years: intelligence would protect me from most serious mistakes. It does not. It just makes the mistakes more elaborate.",
    body: `For a long time I thought intelligence was the primary factor in avoiding serious mistakes. I have accumulated enough evidence against this that I have had to revise the model.

What I think now: intelligence mostly helps you build more convincing justifications for what you already wanted to do. The hard part is wanting the right things.`,
    reactions: { think: 30, changed: 9, felt: 28, door: 3 },
  },

  {
    id: "jalen-3",
    user: U_jalen,
    dayLabel: "6d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "4d",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 41, changed: 22, felt: 37, door: 10 },
  },

  {
    id: "jalen-4",
    user: U_jalen,
    dayLabel: "5d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "1:36",
    timeAgo: "3d",
    preview: "I want to make something that feels necessary. Not useful in a transactional way. Necessary in the way that certain books feel necessary.",
    body: `The version of my work I almost never say out loud: I want it to change how someone thinks, not just what they can do. That is a different target than what most of my current projects aim at.

I am trying to figure out how to build toward it more directly.`,
    reactions: { think: 5, changed: 4, felt: 3, door: 17 },
  },

  {
    id: "jalen-5",
    user: U_jalen,
    dayLabel: "4d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 16, changed: 17, felt: 12, door: 24 },
  },

  {
    id: "hazel-1",
    user: U_hazel,
    dayLabel: "3d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 26, changed: 30, felt: 24, door: 7 },
  },

  {
    id: "hazel-2",
    user: U_hazel,
    dayLabel: "2d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "The thing that changed my mind was not an argument. It was a single observation I could not explain away with the model I was running.",
    body: `The thing that shifted was not logic. It was a single observation that did not fit my current model. I spent a week trying to explain it away. Eventually I updated the model instead.

I notice now that my model updates almost always come from observations, not arguments. Arguments make me defend. Observations make me wonder.`,
    reactions: { think: 37, changed: 12, felt: 33, door: 14 },
  },

  {
    id: "hazel-3",
    user: U_hazel,
    dayLabel: "Yesterday",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "5h",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 48, changed: 25, felt: 42, door: 21 },
  },

  {
    id: "hazel-4",
    user: U_hazel,
    dayLabel: "Today",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "2:15",
    timeAgo: "2h",
    preview: "A twenty-minute conversation two years ago rerouted something that had been set for years. The person said one thing and I could not put it back where it was.",
    body: `A twenty-minute conversation two years ago changed something I had thought was settled. The person did not make an argument. They described something they had observed, and I could not fit it into my existing model.

I still think about that conversation. I am not sure I would have been ready for it a year earlier.`,
    reactions: { think: 12, changed: 7, felt: 8, door: 1 },
  },

  {
    id: "hazel-5",
    user: U_hazel,
    dayLabel: "7d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 23, changed: 20, felt: 17, door: 8 },
  },

  {
    id: "diego-1",
    user: U_diego,
    dayLabel: "6d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 33, changed: 2, felt: 29, door: 18 },
  },

  {
    id: "diego-2",
    user: U_diego,
    dayLabel: "5d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "My inner critic does not speak in logic. It speaks in fear, specifically the fear that this failure is evidence of something permanent.",
    body: `My inner critic speaks in absolutes. Not 'that did not work' but 'you do not have what it takes.' I have been trying to understand where the absolutism came from.

I think it predates any actual failure. It was installed before I had enough experience to verify it. I am trying to rewrite it with more accurate language.`,
    reactions: { think: 44, changed: 15, felt: 38, door: 25 },
  },

  {
    id: "diego-3",
    user: U_diego,
    dayLabel: "4d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "2d",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 8, changed: 28, felt: 4, door: 5 },
  },

  {
    id: "diego-4",
    user: U_diego,
    dayLabel: "3d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:44",
    timeAgo: "1d",
    preview: "A belief I held for years: intelligence would protect me from most serious mistakes. It does not. It just makes the mistakes more elaborate.",
    body: `For a long time I thought intelligence was the primary factor in avoiding serious mistakes. I have accumulated enough evidence against this that I have had to revise the model.

What I think now: intelligence mostly helps you build more convincing justifications for what you already wanted to do. The hard part is wanting the right things.`,
    reactions: { think: 19, changed: 10, felt: 13, door: 12 },
  },

  {
    id: "diego-5",
    user: U_diego,
    dayLabel: "2d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 30, changed: 23, felt: 22, door: 19 },
  },

  {
    id: "quinn-1",
    user: U_quinn,
    dayLabel: "Yesterday",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 40, changed: 5, felt: 34, door: 2 },
  },

  {
    id: "quinn-2",
    user: U_quinn,
    dayLabel: "Today",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "The thing I almost never say: I want to build something that is still being used by people I will never meet. Everything else is practice.",
    body: `I want to build something that makes the people who encounter it feel more capable, not more dependent. That goal has been hard to articulate without sounding vague. I know what I mean by it specifically.

Most of what I have built so far does not fully achieve this. I am still figuring out the gap.`,
    reactions: { think: 4, changed: 18, felt: 43, door: 9 },
  },

  {
    id: "quinn-3",
    user: U_quinn,
    dayLabel: "7d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "5d",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 15, changed: 31, felt: 9, door: 16 },
  },

  {
    id: "quinn-4",
    user: U_quinn,
    dayLabel: "6d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:08",
    timeAgo: "4d",
    preview: "The thing that changed my mind was not an argument. It was a single observation I could not explain away with the model I was running.",
    body: `The thing that shifted was not logic. It was a single observation that did not fit my current model. I spent a week trying to explain it away. Eventually I updated the model instead.

I notice now that my model updates almost always come from observations, not arguments. Arguments make me defend. Observations make me wonder.`,
    reactions: { think: 26, changed: 13, felt: 18, door: 23 },
  },

  {
    id: "quinn-5",
    user: U_quinn,
    dayLabel: "5d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 37, changed: 26, felt: 27, door: 3 },
  },

  {
    id: "monique-1",
    user: U_monique,
    dayLabel: "4d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 47, changed: 8, felt: 39, door: 13 },
  },

  {
    id: "monique-2",
    user: U_monique,
    dayLabel: "3d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "1d",
    preview: "Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed initially. Then I realized the disagreement was the point.",
    body: `Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed. Then I sat with the disagreement for two weeks. Then I updated most of my approach.

I think I learn more from honest feedback delivered without agenda than from anything else. I am trying to create more conditions for it.`,
    reactions: { think: 11, changed: 21, felt: 5, door: 20 },
  },

  {
    id: "monique-3",
    user: U_monique,
    dayLabel: "2d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "8h",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 22, changed: 3, felt: 14, door: 27 },
  },

  {
    id: "monique-4",
    user: U_monique,
    dayLabel: "Yesterday",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "2:33",
    timeAgo: "5h",
    preview: "My inner critic does not speak in logic. It speaks in fear, specifically the fear that this failure is evidence of something permanent.",
    body: `My inner critic speaks in absolutes. Not 'that did not work' but 'you do not have what it takes.' I have been trying to understand where the absolutism came from.

I think it predates any actual failure. It was installed before I had enough experience to verify it. I am trying to rewrite it with more accurate language.`,
    reactions: { think: 33, changed: 16, felt: 23, door: 7 },
  },

  {
    id: "monique-5",
    user: U_monique,
    dayLabel: "Today",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 44, changed: 29, felt: 32, door: 14 },
  },

  {
    id: "ibrahim-1",
    user: U_ibrahim,
    dayLabel: "7d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 7, changed: 11, felt: 44, door: 24 },
  },

  {
    id: "ibrahim-2",
    user: U_ibrahim,
    dayLabel: "6d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "4d",
    preview: "I used to believe that consistency was the highest virtue. I am less certain now. Some things need to break before they can be rebuilt right.",
    body: `I used to believe consistency was the highest form of discipline. Show up every day, do the work, let compound interest handle the rest.

I still believe this in some domains. In others I have watched people be consistently wrong for years. Consistency is only a virtue if you are pointed at the right target.`,
    reactions: { think: 18, changed: 24, felt: 10, door: 4 },
  },

  {
    id: "ibrahim-3",
    user: U_ibrahim,
    dayLabel: "5d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "3d",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 29, changed: 6, felt: 19, door: 11 },
  },

  {
    id: "ibrahim-4",
    user: U_ibrahim,
    dayLabel: "4d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "3:01",
    timeAgo: "2d",
    preview: "The thing I almost never say: I want to build something that is still being used by people I will never meet. Everything else is practice.",
    body: `I want to build something that makes the people who encounter it feel more capable, not more dependent. That goal has been hard to articulate without sounding vague. I know what I mean by it specifically.

Most of what I have built so far does not fully achieve this. I am still figuring out the gap.`,
    reactions: { think: 40, changed: 19, felt: 28, door: 18 },
  },

  {
    id: "ibrahim-5",
    user: U_ibrahim,
    dayLabel: "3d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 4, changed: 32, felt: 37, door: 25 },
  },

  {
    id: "callie-1",
    user: U_callie,
    dayLabel: "2d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 14, changed: 14, felt: 6, door: 8 },
  },

  {
    id: "callie-2",
    user: U_callie,
    dayLabel: "Yesterday",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "A conversation last semester changed something I had held as settled. The person did not argue me out of it. They just described what they saw differently.",
    body: `A conversation last semester moved something that had felt settled. The person did not present a counter-argument. They just described what they saw and asked if I saw it the same way. I did not.

I have been trying to figure out what they did differently. I think they made it safe to revise without making me wrong.`,
    reactions: { think: 25, changed: 27, felt: 15, door: 15 },
  },

  {
    id: "callie-3",
    user: U_callie,
    dayLabel: "Today",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "2h",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 36, changed: 9, felt: 24, door: 22 },
  },

  {
    id: "callie-4",
    user: U_callie,
    dayLabel: "7d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "3:17",
    timeAgo: "5d",
    preview: "Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed initially. Then I realized the disagreement was the point.",
    body: `Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed. Then I sat with the disagreement for two weeks. Then I updated most of my approach.

I think I learn more from honest feedback delivered without agenda than from anything else. I am trying to create more conditions for it.`,
    reactions: { think: 47, changed: 22, felt: 33, door: 2 },
  },

  {
    id: "callie-5",
    user: U_callie,
    dayLabel: "6d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 11, changed: 4, felt: 42, door: 9 },
  },

  {
    id: "rafael-1",
    user: U_rafael,
    dayLabel: "5d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 21, changed: 17, felt: 11, door: 19 },
  },

  {
    id: "rafael-2",
    user: U_rafael,
    dayLabel: "4d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "I have been tracing where my self-critic learned its script. Most of it predates any actual failure. It was there to prevent vulnerability, not to assess performance.",
    body: `I have been listening to my inner voice differently lately. Less like an opponent to defeat and more like a scared version of me that needs information, not combat.

When I ask it what it is actually afraid of, I usually get a more useful answer than when I try to argue it into silence.`,
    reactions: { think: 32, changed: 30, felt: 20, door: 26 },
  },

  {
    id: "rafael-3",
    user: U_rafael,
    dayLabel: "3d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "1d",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 43, changed: 12, felt: 29, door: 6 },
  },

  {
    id: "rafael-4",
    user: U_rafael,
    dayLabel: "2d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:58",
    timeAgo: "8h",
    preview: "I used to believe that consistency was the highest virtue. I am less certain now. Some things need to break before they can be rebuilt right.",
    body: `I used to believe consistency was the highest form of discipline. Show up every day, do the work, let compound interest handle the rest.

I still believe this in some domains. In others I have watched people be consistently wrong for years. Consistency is only a virtue if you are pointed at the right target.`,
    reactions: { think: 7, changed: 25, felt: 38, door: 13 },
  },

  {
    id: "rafael-5",
    user: U_rafael,
    dayLabel: "Yesterday",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 18, changed: 7, felt: 4, door: 20 },
  },

  {
    id: "neha-1",
    user: U_neha,
    dayLabel: "Today",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 28, changed: 20, felt: 16, door: 3 },
  },

  {
    id: "neha-2",
    user: U_neha,
    dayLabel: "7d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "What I am building toward is a kind of work that does not make people feel smaller for encountering it. That sounds vague. I know what I mean by it.",
    body: `What I am building toward, and almost never say: I want to make something that is still being used ten years from now by people who do not know my name. Everything I am doing now feels like practice for that.

I do not know if that makes the current work less important. I think it might make it more.`,
    reactions: { think: 39, changed: 2, felt: 25, door: 10 },
  },

  {
    id: "neha-3",
    user: U_neha,
    dayLabel: "6d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "4d",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 50, changed: 15, felt: 34, door: 17 },
  },

  {
    id: "neha-4",
    user: U_neha,
    dayLabel: "5d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:52",
    timeAgo: "3d",
    preview: "A conversation last semester changed something I had held as settled. The person did not argue me out of it. They just described what they saw differently.",
    body: `A conversation last semester moved something that had felt settled. The person did not present a counter-argument. They just described what they saw and asked if I saw it the same way. I did not.

I have been trying to figure out what they did differently. I think they made it safe to revise without making me wrong.`,
    reactions: { think: 14, changed: 28, felt: 43, door: 24 },
  },

  {
    id: "neha-5",
    user: U_neha,
    dayLabel: "4d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 25, changed: 10, felt: 9, door: 4 },
  },

  {
    id: "brooks-1",
    user: U_brooks,
    dayLabel: "3d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 35, changed: 23, felt: 21, door: 14 },
  },

  {
    id: "brooks-2",
    user: U_brooks,
    dayLabel: "2d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "8h",
    preview: "The conversation that changed my direction was not about my future. It was about something adjacent. The shift happened quietly and I only understood it weeks later.",
    body: `The conversation that changed my direction was not about my career or my future. It was about something smaller. But the thing it moved had been load-bearing and I did not know it.

I think important conversations often disguise themselves as unimportant ones.`,
    reactions: { think: 46, changed: 5, felt: 30, door: 21 },
  },

  {
    id: "brooks-3",
    user: U_brooks,
    dayLabel: "Yesterday",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "5h",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 10, changed: 18, felt: 39, door: 1 },
  },

  {
    id: "brooks-4",
    user: U_brooks,
    dayLabel: "Today",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "3:24",
    timeAgo: "2h",
    preview: "I have been tracing where my self-critic learned its script. Most of it predates any actual failure. It was there to prevent vulnerability, not to assess performance.",
    body: `I have been listening to my inner voice differently lately. Less like an opponent to defeat and more like a scared version of me that needs information, not combat.

When I ask it what it is actually afraid of, I usually get a more useful answer than when I try to argue it into silence.`,
    reactions: { think: 21, changed: 31, felt: 5, door: 8 },
  },

  {
    id: "brooks-5",
    user: U_brooks,
    dayLabel: "7d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 32, changed: 13, felt: 14, door: 15 },
  },

  {
    id: "tiana-1",
    user: U_tiana,
    dayLabel: "6d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 42, changed: 26, felt: 26, door: 25 },
  },

  {
    id: "tiana-2",
    user: U_tiana,
    dayLabel: "5d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "3d",
    preview: "I spent years thinking that certainty was a sign of clear thinking. I now suspect certainty is often a defense against having to think further.",
    body: `I held the belief that certainty was a sign of intellectual rigor. The people I respected most seemed certain. I worked to become certain too.

I think I had it backwards. The people doing the most interesting thinking I know are the ones who hold their models loosely and update quickly. Certainty seems more like a comfort than a conclusion.`,
    reactions: { think: 6, changed: 8, felt: 35, door: 5 },
  },

  {
    id: "tiana-3",
    user: U_tiana,
    dayLabel: "4d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "2d",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 17, changed: 21, felt: 44, door: 12 },
  },

  {
    id: "tiana-4",
    user: U_tiana,
    dayLabel: "3d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "1:36",
    timeAgo: "1d",
    preview: "What I am building toward is a kind of work that does not make people feel smaller for encountering it. That sounds vague. I know what I mean by it.",
    body: `What I am building toward, and almost never say: I want to make something that is still being used ten years from now by people who do not know my name. Everything I am doing now feels like practice for that.

I do not know if that makes the current work less important. I think it might make it more.`,
    reactions: { think: 28, changed: 3, felt: 10, door: 19 },
  },

  {
    id: "tiana-5",
    user: U_tiana,
    dayLabel: "2d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 39, changed: 16, felt: 19, door: 26 },
  },

  {
    id: "pierre-1",
    user: U_pierre,
    dayLabel: "Yesterday",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 49, changed: 29, felt: 31, door: 9 },
  },

  {
    id: "pierre-2",
    user: U_pierre,
    dayLabel: "Today",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "I changed my mind when I watched someone do the thing I had theorized about and realized my theory was missing two dimensions.",
    body: `I changed my mind watching someone implement an idea I had theorized about. My theory was missing the part where it is actually hard. Seeing the real version changed my understanding of what the problem was.

I think I learn more from watching things fail in the real world than from any amount of analysis. The map is not the territory.`,
    reactions: { think: 13, changed: 11, felt: 40, door: 16 },
  },

  {
    id: "pierre-3",
    user: U_pierre,
    dayLabel: "7d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "5d",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 24, changed: 24, felt: 6, door: 23 },
  },

  {
    id: "pierre-4",
    user: U_pierre,
    dayLabel: "6d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "2:15",
    timeAgo: "4d",
    preview: "The conversation that changed my direction was not about my future. It was about something adjacent. The shift happened quietly and I only understood it weeks later.",
    body: `The conversation that changed my direction was not about my career or my future. It was about something smaller. But the thing it moved had been load-bearing and I did not know it.

I think important conversations often disguise themselves as unimportant ones.`,
    reactions: { think: 35, changed: 6, felt: 15, door: 3 },
  },

  {
    id: "pierre-5",
    user: U_pierre,
    dayLabel: "5d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 46, changed: 19, felt: 24, door: 10 },
  },

  {
    id: "luna-1",
    user: U_luna,
    dayLabel: "4d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 9, changed: 32, felt: 36, door: 20 },
  },

  {
    id: "luna-2",
    user: U_luna,
    dayLabel: "3d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "The voice that shows up when I fail sounds like someone who needed me to be more in order to feel safe. I have been trying to figure out who taught it that.",
    body: `The voice that shows up when I fail sounds like it learned its script from someone who needed me to be invulnerable. I was not allowed to fail in certain contexts. So the voice decided to prevent failure by making it catastrophic.

Understanding that origin has not made the voice quieter. But it has made it less authoritative.`,
    reactions: { think: 20, changed: 14, felt: 45, door: 27 },
  },

  {
    id: "luna-3",
    user: U_luna,
    dayLabel: "2d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "8h",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 31, changed: 27, felt: 11, door: 7 },
  },

  {
    id: "luna-4",
    user: U_luna,
    dayLabel: "Yesterday",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:44",
    timeAgo: "5h",
    preview: "I spent years thinking that certainty was a sign of clear thinking. I now suspect certainty is often a defense against having to think further.",
    body: `I held the belief that certainty was a sign of intellectual rigor. The people I respected most seemed certain. I worked to become certain too.

I think I had it backwards. The people doing the most interesting thinking I know are the ones who hold their models loosely and update quickly. Certainty seems more like a comfort than a conclusion.`,
    reactions: { think: 42, changed: 9, felt: 20, door: 14 },
  },

  {
    id: "luna-5",
    user: U_luna,
    dayLabel: "Today",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 6, changed: 22, felt: 29, door: 21 },
  },

  {
    id: "deon-1",
    user: U_deon,
    dayLabel: "7d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 16, changed: 4, felt: 41, door: 4 },
  },

  {
    id: "deon-2",
    user: U_deon,
    dayLabel: "6d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "I want to make something that feels necessary. Not useful in a transactional way. Necessary in the way that certain books feel necessary.",
    body: `The version of my work I almost never say out loud: I want it to change how someone thinks, not just what they can do. That is a different target than what most of my current projects aim at.

I am trying to figure out how to build toward it more directly.`,
    reactions: { think: 27, changed: 17, felt: 7, door: 11 },
  },

  {
    id: "deon-3",
    user: U_deon,
    dayLabel: "5d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "3d",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 38, changed: 30, felt: 16, door: 18 },
  },

  {
    id: "deon-4",
    user: U_deon,
    dayLabel: "4d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:08",
    timeAgo: "2d",
    preview: "I changed my mind when I watched someone do the thing I had theorized about and realized my theory was missing two dimensions.",
    body: `I changed my mind watching someone implement an idea I had theorized about. My theory was missing the part where it is actually hard. Seeing the real version changed my understanding of what the problem was.

I think I learn more from watching things fail in the real world than from any amount of analysis. The map is not the territory.`,
    reactions: { think: 49, changed: 12, felt: 25, door: 25 },
  },

  {
    id: "deon-5",
    user: U_deon,
    dayLabel: "3d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 13, changed: 25, felt: 34, door: 5 },
  },

  {
    id: "emma_f-1",
    user: U_emma_f,
    dayLabel: "2d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 23, changed: 7, felt: 3, door: 15 },
  },

  {
    id: "emma_f-2",
    user: U_emma_f,
    dayLabel: "Yesterday",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "5h",
    preview: "A twenty-minute conversation two years ago rerouted something that had been set for years. The person said one thing and I could not put it back where it was.",
    body: `A twenty-minute conversation two years ago changed something I had thought was settled. The person did not make an argument. They described something they had observed, and I could not fit it into my existing model.

I still think about that conversation. I am not sure I would have been ready for it a year earlier.`,
    reactions: { think: 34, changed: 20, felt: 12, door: 22 },
  },

  {
    id: "emma_f-3",
    user: U_emma_f,
    dayLabel: "Today",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "2h",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 45, changed: 2, felt: 21, door: 2 },
  },

  {
    id: "emma_f-4",
    user: U_emma_f,
    dayLabel: "7d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "2:33",
    timeAgo: "5d",
    preview: "The voice that shows up when I fail sounds like someone who needed me to be more in order to feel safe. I have been trying to figure out who taught it that.",
    body: `The voice that shows up when I fail sounds like it learned its script from someone who needed me to be invulnerable. I was not allowed to fail in certain contexts. So the voice decided to prevent failure by making it catastrophic.

Understanding that origin has not made the voice quieter. But it has made it less authoritative.`,
    reactions: { think: 9, changed: 15, felt: 30, door: 9 },
  },

  {
    id: "emma_f-5",
    user: U_emma_f,
    dayLabel: "6d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 20, changed: 28, felt: 39, door: 16 },
  },

  {
    id: "fiona-1",
    user: U_fiona,
    dayLabel: "5d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 30, changed: 10, felt: 8, door: 26 },
  },

  {
    id: "fiona-2",
    user: U_fiona,
    dayLabel: "4d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "2d",
    preview: "A belief I held for years: intelligence would protect me from most serious mistakes. It does not. It just makes the mistakes more elaborate.",
    body: `For a long time I thought intelligence was the primary factor in avoiding serious mistakes. I have accumulated enough evidence against this that I have had to revise the model.

What I think now: intelligence mostly helps you build more convincing justifications for what you already wanted to do. The hard part is wanting the right things.`,
    reactions: { think: 41, changed: 23, felt: 17, door: 6 },
  },

  {
    id: "fiona-3",
    user: U_fiona,
    dayLabel: "3d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "1d",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 5, changed: 5, felt: 26, door: 13 },
  },

  {
    id: "fiona-4",
    user: U_fiona,
    dayLabel: "2d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "3:01",
    timeAgo: "8h",
    preview: "I want to make something that feels necessary. Not useful in a transactional way. Necessary in the way that certain books feel necessary.",
    body: `The version of my work I almost never say out loud: I want it to change how someone thinks, not just what they can do. That is a different target than what most of my current projects aim at.

I am trying to figure out how to build toward it more directly.`,
    reactions: { think: 16, changed: 18, felt: 35, door: 20 },
  },

  {
    id: "fiona-5",
    user: U_fiona,
    dayLabel: "Yesterday",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 27, changed: 31, felt: 44, door: 27 },
  },

  {
    id: "nadia-1",
    user: U_nadia,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 37, changed: 13, felt: 13, door: 10 },
  },

  {
    id: "nadia-2",
    user: U_nadia,
    dayLabel: "7d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "The thing that changed my mind was not an argument. It was a single observation I could not explain away with the model I was running.",
    body: `The thing that shifted was not logic. It was a single observation that did not fit my current model. I spent a week trying to explain it away. Eventually I updated the model instead.

I notice now that my model updates almost always come from observations, not arguments. Arguments make me defend. Observations make me wonder.`,
    reactions: { think: 48, changed: 26, felt: 22, door: 17 },
  },

  {
    id: "nadia-3",
    user: U_nadia,
    dayLabel: "6d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "4d",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 12, changed: 8, felt: 31, door: 24 },
  },

  {
    id: "nadia-4",
    user: U_nadia,
    dayLabel: "5d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "3:17",
    timeAgo: "3d",
    preview: "A twenty-minute conversation two years ago rerouted something that had been set for years. The person said one thing and I could not put it back where it was.",
    body: `A twenty-minute conversation two years ago changed something I had thought was settled. The person did not make an argument. They described something they had observed, and I could not fit it into my existing model.

I still think about that conversation. I am not sure I would have been ready for it a year earlier.`,
    reactions: { think: 23, changed: 21, felt: 40, door: 4 },
  },

  {
    id: "nadia-5",
    user: U_nadia,
    dayLabel: "4d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 34, changed: 3, felt: 6, door: 11 },
  },

  {
    id: "trevor-1",
    user: U_trevor,
    dayLabel: "3d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 44, changed: 16, felt: 18, door: 21 },
  },

  {
    id: "trevor-2",
    user: U_trevor,
    dayLabel: "2d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "My inner critic does not speak in logic. It speaks in fear, specifically the fear that this failure is evidence of something permanent.",
    body: `My inner critic speaks in absolutes. Not 'that did not work' but 'you do not have what it takes.' I have been trying to understand where the absolutism came from.

I think it predates any actual failure. It was installed before I had enough experience to verify it. I am trying to rewrite it with more accurate language.`,
    reactions: { think: 8, changed: 29, felt: 27, door: 1 },
  },

  {
    id: "trevor-3",
    user: U_trevor,
    dayLabel: "Yesterday",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "5h",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 19, changed: 11, felt: 36, door: 8 },
  },

  {
    id: "trevor-4",
    user: U_trevor,
    dayLabel: "Today",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:58",
    timeAgo: "2h",
    preview: "A belief I held for years: intelligence would protect me from most serious mistakes. It does not. It just makes the mistakes more elaborate.",
    body: `For a long time I thought intelligence was the primary factor in avoiding serious mistakes. I have accumulated enough evidence against this that I have had to revise the model.

What I think now: intelligence mostly helps you build more convincing justifications for what you already wanted to do. The hard part is wanting the right things.`,
    reactions: { think: 30, changed: 24, felt: 45, door: 15 },
  },

  {
    id: "trevor-5",
    user: U_trevor,
    dayLabel: "7d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 41, changed: 6, felt: 11, door: 22 },
  },

  {
    id: "simone-1",
    user: U_simone,
    dayLabel: "6d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 4, changed: 19, felt: 23, door: 5 },
  },

  {
    id: "simone-2",
    user: U_simone,
    dayLabel: "5d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "The thing I almost never say: I want to build something that is still being used by people I will never meet. Everything else is practice.",
    body: `I want to build something that makes the people who encounter it feel more capable, not more dependent. That goal has been hard to articulate without sounding vague. I know what I mean by it specifically.

Most of what I have built so far does not fully achieve this. I am still figuring out the gap.`,
    reactions: { think: 15, changed: 32, felt: 32, door: 12 },
  },

  {
    id: "simone-3",
    user: U_simone,
    dayLabel: "4d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "2d",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 26, changed: 14, felt: 41, door: 19 },
  },

  {
    id: "simone-4",
    user: U_simone,
    dayLabel: "3d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:52",
    timeAgo: "1d",
    preview: "The thing that changed my mind was not an argument. It was a single observation I could not explain away with the model I was running.",
    body: `The thing that shifted was not logic. It was a single observation that did not fit my current model. I spent a week trying to explain it away. Eventually I updated the model instead.

I notice now that my model updates almost always come from observations, not arguments. Arguments make me defend. Observations make me wonder.`,
    reactions: { think: 37, changed: 27, felt: 7, door: 26 },
  },

  {
    id: "simone-5",
    user: U_simone,
    dayLabel: "2d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 48, changed: 9, felt: 16, door: 6 },
  },

  {
    id: "kai-1",
    user: U_kai,
    dayLabel: "Yesterday",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 11, changed: 22, felt: 28, door: 16 },
  },

  {
    id: "kai-2",
    user: U_kai,
    dayLabel: "Today",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "2h",
    preview: "Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed initially. Then I realized the disagreement was the point.",
    body: `Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed. Then I sat with the disagreement for two weeks. Then I updated most of my approach.

I think I learn more from honest feedback delivered without agenda than from anything else. I am trying to create more conditions for it.`,
    reactions: { think: 22, changed: 4, felt: 37, door: 23 },
  },

  {
    id: "kai-3",
    user: U_kai,
    dayLabel: "7d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "5d",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 33, changed: 17, felt: 3, door: 3 },
  },

  {
    id: "kai-4",
    user: U_kai,
    dayLabel: "6d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "3:24",
    timeAgo: "4d",
    preview: "My inner critic does not speak in logic. It speaks in fear, specifically the fear that this failure is evidence of something permanent.",
    body: `My inner critic speaks in absolutes. Not 'that did not work' but 'you do not have what it takes.' I have been trying to understand where the absolutism came from.

I think it predates any actual failure. It was installed before I had enough experience to verify it. I am trying to rewrite it with more accurate language.`,
    reactions: { think: 44, changed: 30, felt: 12, door: 10 },
  },

  {
    id: "kai-5",
    user: U_kai,
    dayLabel: "5d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 8, changed: 12, felt: 21, door: 17 },
  },

  {
    id: "josephine-1",
    user: U_josephine,
    dayLabel: "4d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 18, changed: 25, felt: 33, door: 27 },
  },

  {
    id: "josephine-2",
    user: U_josephine,
    dayLabel: "3d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "1d",
    preview: "I used to believe that consistency was the highest virtue. I am less certain now. Some things need to break before they can be rebuilt right.",
    body: `I used to believe consistency was the highest form of discipline. Show up every day, do the work, let compound interest handle the rest.

I still believe this in some domains. In others I have watched people be consistently wrong for years. Consistency is only a virtue if you are pointed at the right target.`,
    reactions: { think: 29, changed: 7, felt: 42, door: 7 },
  },

  {
    id: "josephine-3",
    user: U_josephine,
    dayLabel: "2d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "8h",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 40, changed: 20, felt: 8, door: 14 },
  },

  {
    id: "josephine-4",
    user: U_josephine,
    dayLabel: "Yesterday",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "1:36",
    timeAgo: "5h",
    preview: "The thing I almost never say: I want to build something that is still being used by people I will never meet. Everything else is practice.",
    body: `I want to build something that makes the people who encounter it feel more capable, not more dependent. That goal has been hard to articulate without sounding vague. I know what I mean by it specifically.

Most of what I have built so far does not fully achieve this. I am still figuring out the gap.`,
    reactions: { think: 4, changed: 2, felt: 17, door: 21 },
  },

  {
    id: "josephine-5",
    user: U_josephine,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 15, changed: 15, felt: 26, door: 1 },
  },

  {
    id: "leon-1",
    user: U_leon,
    dayLabel: "7d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 25, changed: 28, felt: 38, door: 11 },
  },

  {
    id: "leon-2",
    user: U_leon,
    dayLabel: "6d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "A conversation last semester changed something I had held as settled. The person did not argue me out of it. They just described what they saw differently.",
    body: `A conversation last semester moved something that had felt settled. The person did not present a counter-argument. They just described what they saw and asked if I saw it the same way. I did not.

I have been trying to figure out what they did differently. I think they made it safe to revise without making me wrong.`,
    reactions: { think: 36, changed: 10, felt: 4, door: 18 },
  },

  {
    id: "leon-3",
    user: U_leon,
    dayLabel: "5d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "3d",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 47, changed: 23, felt: 13, door: 25 },
  },

  {
    id: "leon-4",
    user: U_leon,
    dayLabel: "4d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "2:15",
    timeAgo: "2d",
    preview: "Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed initially. Then I realized the disagreement was the point.",
    body: `Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed. Then I sat with the disagreement for two weeks. Then I updated most of my approach.

I think I learn more from honest feedback delivered without agenda than from anything else. I am trying to create more conditions for it.`,
    reactions: { think: 11, changed: 5, felt: 22, door: 5 },
  },

  {
    id: "leon-5",
    user: U_leon,
    dayLabel: "3d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 22, changed: 18, felt: 31, door: 12 },
  },

  {
    id: "yasmin-1",
    user: U_yasmin,
    dayLabel: "2d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 32, changed: 31, felt: 43, door: 22 },
  },

  {
    id: "yasmin-2",
    user: U_yasmin,
    dayLabel: "Yesterday",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "I have been tracing where my self-critic learned its script. Most of it predates any actual failure. It was there to prevent vulnerability, not to assess performance.",
    body: `I have been listening to my inner voice differently lately. Less like an opponent to defeat and more like a scared version of me that needs information, not combat.

When I ask it what it is actually afraid of, I usually get a more useful answer than when I try to argue it into silence.`,
    reactions: { think: 43, changed: 13, felt: 9, door: 2 },
  },

  {
    id: "yasmin-3",
    user: U_yasmin,
    dayLabel: "Today",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "2h",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 7, changed: 26, felt: 18, door: 9 },
  },

  {
    id: "yasmin-4",
    user: U_yasmin,
    dayLabel: "7d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:44",
    timeAgo: "5d",
    preview: "I used to believe that consistency was the highest virtue. I am less certain now. Some things need to break before they can be rebuilt right.",
    body: `I used to believe consistency was the highest form of discipline. Show up every day, do the work, let compound interest handle the rest.

I still believe this in some domains. In others I have watched people be consistently wrong for years. Consistency is only a virtue if you are pointed at the right target.`,
    reactions: { think: 18, changed: 8, felt: 27, door: 16 },
  },

  {
    id: "yasmin-5",
    user: U_yasmin,
    dayLabel: "6d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 29, changed: 21, felt: 36, door: 23 },
  },

  {
    id: "tyrese-1",
    user: U_tyrese,
    dayLabel: "5d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 39, changed: 3, felt: 5, door: 6 },
  },

  {
    id: "tyrese-2",
    user: U_tyrese,
    dayLabel: "4d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "What I am building toward is a kind of work that does not make people feel smaller for encountering it. That sounds vague. I know what I mean by it.",
    body: `What I am building toward, and almost never say: I want to make something that is still being used ten years from now by people who do not know my name. Everything I am doing now feels like practice for that.

I do not know if that makes the current work less important. I think it might make it more.`,
    reactions: { think: 50, changed: 16, felt: 14, door: 13 },
  },

  {
    id: "tyrese-3",
    user: U_tyrese,
    dayLabel: "3d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "1d",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 14, changed: 29, felt: 23, door: 20 },
  },

  {
    id: "tyrese-4",
    user: U_tyrese,
    dayLabel: "2d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:08",
    timeAgo: "8h",
    preview: "A conversation last semester changed something I had held as settled. The person did not argue me out of it. They just described what they saw differently.",
    body: `A conversation last semester moved something that had felt settled. The person did not present a counter-argument. They just described what they saw and asked if I saw it the same way. I did not.

I have been trying to figure out what they did differently. I think they made it safe to revise without making me wrong.`,
    reactions: { think: 25, changed: 11, felt: 32, door: 27 },
  },

  {
    id: "tyrese-5",
    user: U_tyrese,
    dayLabel: "Yesterday",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 36, changed: 24, felt: 41, door: 7 },
  },

  {
    id: "ingrid-1",
    user: U_ingrid,
    dayLabel: "Today",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 46, changed: 6, felt: 10, door: 17 },
  },

  {
    id: "ingrid-2",
    user: U_ingrid,
    dayLabel: "7d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "5d",
    preview: "The conversation that changed my direction was not about my future. It was about something adjacent. The shift happened quietly and I only understood it weeks later.",
    body: `The conversation that changed my direction was not about my career or my future. It was about something smaller. But the thing it moved had been load-bearing and I did not know it.

I think important conversations often disguise themselves as unimportant ones.`,
    reactions: { think: 10, changed: 19, felt: 19, door: 24 },
  },

  {
    id: "ingrid-3",
    user: U_ingrid,
    dayLabel: "6d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "4d",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 21, changed: 32, felt: 28, door: 4 },
  },

  {
    id: "ingrid-4",
    user: U_ingrid,
    dayLabel: "5d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "2:33",
    timeAgo: "3d",
    preview: "I have been tracing where my self-critic learned its script. Most of it predates any actual failure. It was there to prevent vulnerability, not to assess performance.",
    body: `I have been listening to my inner voice differently lately. Less like an opponent to defeat and more like a scared version of me that needs information, not combat.

When I ask it what it is actually afraid of, I usually get a more useful answer than when I try to argue it into silence.`,
    reactions: { think: 32, changed: 14, felt: 37, door: 11 },
  },

  {
    id: "ingrid-5",
    user: U_ingrid,
    dayLabel: "4d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 43, changed: 27, felt: 3, door: 18 },
  },

  {
    id: "carlos-1",
    user: U_carlos,
    dayLabel: "3d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 6, changed: 9, felt: 15, door: 1 },
  },

  {
    id: "carlos-2",
    user: U_carlos,
    dayLabel: "2d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "8h",
    preview: "I spent years thinking that certainty was a sign of clear thinking. I now suspect certainty is often a defense against having to think further.",
    body: `I held the belief that certainty was a sign of intellectual rigor. The people I respected most seemed certain. I worked to become certain too.

I think I had it backwards. The people doing the most interesting thinking I know are the ones who hold their models loosely and update quickly. Certainty seems more like a comfort than a conclusion.`,
    reactions: { think: 17, changed: 22, felt: 24, door: 8 },
  },

  {
    id: "carlos-3",
    user: U_carlos,
    dayLabel: "Yesterday",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "5h",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 28, changed: 4, felt: 33, door: 15 },
  },

  {
    id: "carlos-4",
    user: U_carlos,
    dayLabel: "Today",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "3:01",
    timeAgo: "2h",
    preview: "What I am building toward is a kind of work that does not make people feel smaller for encountering it. That sounds vague. I know what I mean by it.",
    body: `What I am building toward, and almost never say: I want to make something that is still being used ten years from now by people who do not know my name. Everything I am doing now feels like practice for that.

I do not know if that makes the current work less important. I think it might make it more.`,
    reactions: { think: 39, changed: 17, felt: 42, door: 22 },
  },

  {
    id: "carlos-5",
    user: U_carlos,
    dayLabel: "7d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 50, changed: 30, felt: 8, door: 2 },
  },

  {
    id: "jade-1",
    user: U_jade,
    dayLabel: "6d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 13, changed: 12, felt: 20, door: 12 },
  },

  {
    id: "jade-2",
    user: U_jade,
    dayLabel: "5d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "I changed my mind when I watched someone do the thing I had theorized about and realized my theory was missing two dimensions.",
    body: `I changed my mind watching someone implement an idea I had theorized about. My theory was missing the part where it is actually hard. Seeing the real version changed my understanding of what the problem was.

I think I learn more from watching things fail in the real world than from any amount of analysis. The map is not the territory.`,
    reactions: { think: 24, changed: 25, felt: 29, door: 19 },
  },

  {
    id: "jade-3",
    user: U_jade,
    dayLabel: "4d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "2d",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 35, changed: 7, felt: 38, door: 26 },
  },

  {
    id: "jade-4",
    user: U_jade,
    dayLabel: "3d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "3:17",
    timeAgo: "1d",
    preview: "The conversation that changed my direction was not about my future. It was about something adjacent. The shift happened quietly and I only understood it weeks later.",
    body: `The conversation that changed my direction was not about my career or my future. It was about something smaller. But the thing it moved had been load-bearing and I did not know it.

I think important conversations often disguise themselves as unimportant ones.`,
    reactions: { think: 46, changed: 20, felt: 4, door: 6 },
  },

  {
    id: "jade-5",
    user: U_jade,
    dayLabel: "2d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 10, changed: 2, felt: 13, door: 13 },
  },

  {
    id: "andre-1",
    user: U_andre,
    dayLabel: "Yesterday",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 20, changed: 15, felt: 25, door: 23 },
  },

  {
    id: "andre-2",
    user: U_andre,
    dayLabel: "Today",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "The voice that shows up when I fail sounds like someone who needed me to be more in order to feel safe. I have been trying to figure out who taught it that.",
    body: `The voice that shows up when I fail sounds like it learned its script from someone who needed me to be invulnerable. I was not allowed to fail in certain contexts. So the voice decided to prevent failure by making it catastrophic.

Understanding that origin has not made the voice quieter. But it has made it less authoritative.`,
    reactions: { think: 31, changed: 28, felt: 34, door: 3 },
  },

  {
    id: "andre-3",
    user: U_andre,
    dayLabel: "7d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "5d",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 42, changed: 10, felt: 43, door: 10 },
  },

  {
    id: "andre-4",
    user: U_andre,
    dayLabel: "6d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:58",
    timeAgo: "4d",
    preview: "I spent years thinking that certainty was a sign of clear thinking. I now suspect certainty is often a defense against having to think further.",
    body: `I held the belief that certainty was a sign of intellectual rigor. The people I respected most seemed certain. I worked to become certain too.

I think I had it backwards. The people doing the most interesting thinking I know are the ones who hold their models loosely and update quickly. Certainty seems more like a comfort than a conclusion.`,
    reactions: { think: 6, changed: 23, felt: 9, door: 17 },
  },

  {
    id: "andre-5",
    user: U_andre,
    dayLabel: "5d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 17, changed: 5, felt: 18, door: 24 },
  },

  {
    id: "preethi-1",
    user: U_preethi,
    dayLabel: "4d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 27, changed: 18, felt: 30, door: 7 },
  },

  {
    id: "preethi-2",
    user: U_preethi,
    dayLabel: "3d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "I want to make something that feels necessary. Not useful in a transactional way. Necessary in the way that certain books feel necessary.",
    body: `The version of my work I almost never say out loud: I want it to change how someone thinks, not just what they can do. That is a different target than what most of my current projects aim at.

I am trying to figure out how to build toward it more directly.`,
    reactions: { think: 38, changed: 31, felt: 39, door: 14 },
  },

  {
    id: "preethi-3",
    user: U_preethi,
    dayLabel: "2d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "8h",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 49, changed: 13, felt: 5, door: 21 },
  },

  {
    id: "preethi-4",
    user: U_preethi,
    dayLabel: "Yesterday",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:52",
    timeAgo: "5h",
    preview: "I changed my mind when I watched someone do the thing I had theorized about and realized my theory was missing two dimensions.",
    body: `I changed my mind watching someone implement an idea I had theorized about. My theory was missing the part where it is actually hard. Seeing the real version changed my understanding of what the problem was.

I think I learn more from watching things fail in the real world than from any amount of analysis. The map is not the territory.`,
    reactions: { think: 13, changed: 26, felt: 14, door: 1 },
  },

  {
    id: "preethi-5",
    user: U_preethi,
    dayLabel: "Today",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 24, changed: 8, felt: 23, door: 8 },
  },

  {
    id: "nate-1",
    user: U_nate,
    dayLabel: "7d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 34, changed: 21, felt: 35, door: 18 },
  },

  {
    id: "nate-2",
    user: U_nate,
    dayLabel: "6d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "4d",
    preview: "A twenty-minute conversation two years ago rerouted something that had been set for years. The person said one thing and I could not put it back where it was.",
    body: `A twenty-minute conversation two years ago changed something I had thought was settled. The person did not make an argument. They described something they had observed, and I could not fit it into my existing model.

I still think about that conversation. I am not sure I would have been ready for it a year earlier.`,
    reactions: { think: 45, changed: 3, felt: 44, door: 25 },
  },

  {
    id: "nate-3",
    user: U_nate,
    dayLabel: "5d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "3d",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 9, changed: 16, felt: 10, door: 5 },
  },

  {
    id: "nate-4",
    user: U_nate,
    dayLabel: "4d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "3:24",
    timeAgo: "2d",
    preview: "The voice that shows up when I fail sounds like someone who needed me to be more in order to feel safe. I have been trying to figure out who taught it that.",
    body: `The voice that shows up when I fail sounds like it learned its script from someone who needed me to be invulnerable. I was not allowed to fail in certain contexts. So the voice decided to prevent failure by making it catastrophic.

Understanding that origin has not made the voice quieter. But it has made it less authoritative.`,
    reactions: { think: 20, changed: 29, felt: 19, door: 12 },
  },

  {
    id: "nate-5",
    user: U_nate,
    dayLabel: "3d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 31, changed: 11, felt: 28, door: 19 },
  },

  {
    id: "alicia-1",
    user: U_alicia,
    dayLabel: "2d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 41, changed: 24, felt: 40, door: 2 },
  },

  {
    id: "alicia-2",
    user: U_alicia,
    dayLabel: "Yesterday",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "5h",
    preview: "A belief I held for years: intelligence would protect me from most serious mistakes. It does not. It just makes the mistakes more elaborate.",
    body: `For a long time I thought intelligence was the primary factor in avoiding serious mistakes. I have accumulated enough evidence against this that I have had to revise the model.

What I think now: intelligence mostly helps you build more convincing justifications for what you already wanted to do. The hard part is wanting the right things.`,
    reactions: { think: 5, changed: 6, felt: 6, door: 9 },
  },

  {
    id: "alicia-3",
    user: U_alicia,
    dayLabel: "Today",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "2h",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 16, changed: 19, felt: 15, door: 16 },
  },

  {
    id: "alicia-4",
    user: U_alicia,
    dayLabel: "7d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "1:36",
    timeAgo: "5d",
    preview: "I want to make something that feels necessary. Not useful in a transactional way. Necessary in the way that certain books feel necessary.",
    body: `The version of my work I almost never say out loud: I want it to change how someone thinks, not just what they can do. That is a different target than what most of my current projects aim at.

I am trying to figure out how to build toward it more directly.`,
    reactions: { think: 27, changed: 32, felt: 24, door: 23 },
  },

  {
    id: "alicia-5",
    user: U_alicia,
    dayLabel: "6d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 38, changed: 14, felt: 33, door: 3 },
  },

  {
    id: "felix_m-1",
    user: U_felix_m,
    dayLabel: "5d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 48, changed: 27, felt: 45, door: 13 },
  },

  {
    id: "felix_m-2",
    user: U_felix_m,
    dayLabel: "4d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "The thing that changed my mind was not an argument. It was a single observation I could not explain away with the model I was running.",
    body: `The thing that shifted was not logic. It was a single observation that did not fit my current model. I spent a week trying to explain it away. Eventually I updated the model instead.

I notice now that my model updates almost always come from observations, not arguments. Arguments make me defend. Observations make me wonder.`,
    reactions: { think: 12, changed: 9, felt: 11, door: 20 },
  },

  {
    id: "felix_m-3",
    user: U_felix_m,
    dayLabel: "3d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "1d",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 23, changed: 22, felt: 20, door: 27 },
  },

  {
    id: "felix_m-4",
    user: U_felix_m,
    dayLabel: "2d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "2:15",
    timeAgo: "8h",
    preview: "A twenty-minute conversation two years ago rerouted something that had been set for years. The person said one thing and I could not put it back where it was.",
    body: `A twenty-minute conversation two years ago changed something I had thought was settled. The person did not make an argument. They described something they had observed, and I could not fit it into my existing model.

I still think about that conversation. I am not sure I would have been ready for it a year earlier.`,
    reactions: { think: 34, changed: 4, felt: 29, door: 7 },
  },

  {
    id: "felix_m-5",
    user: U_felix_m,
    dayLabel: "Yesterday",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 45, changed: 17, felt: 38, door: 14 },
  },

  {
    id: "brianna-1",
    user: U_brianna,
    dayLabel: "Today",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 8, changed: 30, felt: 7, door: 24 },
  },

  {
    id: "brianna-2",
    user: U_brianna,
    dayLabel: "7d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "My inner critic does not speak in logic. It speaks in fear, specifically the fear that this failure is evidence of something permanent.",
    body: `My inner critic speaks in absolutes. Not 'that did not work' but 'you do not have what it takes.' I have been trying to understand where the absolutism came from.

I think it predates any actual failure. It was installed before I had enough experience to verify it. I am trying to rewrite it with more accurate language.`,
    reactions: { think: 19, changed: 12, felt: 16, door: 4 },
  },

  {
    id: "brianna-3",
    user: U_brianna,
    dayLabel: "6d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "4d",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 30, changed: 25, felt: 25, door: 11 },
  },

  {
    id: "brianna-4",
    user: U_brianna,
    dayLabel: "5d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:44",
    timeAgo: "3d",
    preview: "A belief I held for years: intelligence would protect me from most serious mistakes. It does not. It just makes the mistakes more elaborate.",
    body: `For a long time I thought intelligence was the primary factor in avoiding serious mistakes. I have accumulated enough evidence against this that I have had to revise the model.

What I think now: intelligence mostly helps you build more convincing justifications for what you already wanted to do. The hard part is wanting the right things.`,
    reactions: { think: 41, changed: 7, felt: 34, door: 18 },
  },

  {
    id: "brianna-5",
    user: U_brianna,
    dayLabel: "4d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 5, changed: 20, felt: 43, door: 25 },
  },

  {
    id: "omar_s-1",
    user: U_omar_s,
    dayLabel: "3d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 15, changed: 2, felt: 12, door: 8 },
  },

  {
    id: "omar_s-2",
    user: U_omar_s,
    dayLabel: "2d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "The thing I almost never say: I want to build something that is still being used by people I will never meet. Everything else is practice.",
    body: `I want to build something that makes the people who encounter it feel more capable, not more dependent. That goal has been hard to articulate without sounding vague. I know what I mean by it specifically.

Most of what I have built so far does not fully achieve this. I am still figuring out the gap.`,
    reactions: { think: 26, changed: 15, felt: 21, door: 15 },
  },

  {
    id: "omar_s-3",
    user: U_omar_s,
    dayLabel: "Yesterday",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "5h",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 37, changed: 28, felt: 30, door: 22 },
  },

  {
    id: "omar_s-4",
    user: U_omar_s,
    dayLabel: "Today",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:08",
    timeAgo: "2h",
    preview: "The thing that changed my mind was not an argument. It was a single observation I could not explain away with the model I was running.",
    body: `The thing that shifted was not logic. It was a single observation that did not fit my current model. I spent a week trying to explain it away. Eventually I updated the model instead.

I notice now that my model updates almost always come from observations, not arguments. Arguments make me defend. Observations make me wonder.`,
    reactions: { think: 48, changed: 10, felt: 39, door: 2 },
  },

  {
    id: "omar_s-5",
    user: U_omar_s,
    dayLabel: "7d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 12, changed: 23, felt: 5, door: 9 },
  },

  {
    id: "mia-1",
    user: U_mia,
    dayLabel: "6d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 22, changed: 5, felt: 17, door: 19 },
  },

  {
    id: "mia-2",
    user: U_mia,
    dayLabel: "5d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "3d",
    preview: "Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed initially. Then I realized the disagreement was the point.",
    body: `Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed. Then I sat with the disagreement for two weeks. Then I updated most of my approach.

I think I learn more from honest feedback delivered without agenda than from anything else. I am trying to create more conditions for it.`,
    reactions: { think: 33, changed: 18, felt: 26, door: 26 },
  },

  {
    id: "mia-3",
    user: U_mia,
    dayLabel: "4d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "2d",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 44, changed: 31, felt: 35, door: 6 },
  },

  {
    id: "mia-4",
    user: U_mia,
    dayLabel: "3d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "2:33",
    timeAgo: "1d",
    preview: "My inner critic does not speak in logic. It speaks in fear, specifically the fear that this failure is evidence of something permanent.",
    body: `My inner critic speaks in absolutes. Not 'that did not work' but 'you do not have what it takes.' I have been trying to understand where the absolutism came from.

I think it predates any actual failure. It was installed before I had enough experience to verify it. I am trying to rewrite it with more accurate language.`,
    reactions: { think: 8, changed: 13, felt: 44, door: 13 },
  },

  {
    id: "mia-5",
    user: U_mia,
    dayLabel: "2d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 19, changed: 26, felt: 10, door: 20 },
  },

  {
    id: "elijah-1",
    user: U_elijah,
    dayLabel: "Yesterday",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 29, changed: 8, felt: 22, door: 3 },
  },

  {
    id: "elijah-2",
    user: U_elijah,
    dayLabel: "Today",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "2h",
    preview: "I used to believe that consistency was the highest virtue. I am less certain now. Some things need to break before they can be rebuilt right.",
    body: `I used to believe consistency was the highest form of discipline. Show up every day, do the work, let compound interest handle the rest.

I still believe this in some domains. In others I have watched people be consistently wrong for years. Consistency is only a virtue if you are pointed at the right target.`,
    reactions: { think: 40, changed: 21, felt: 31, door: 10 },
  },

  {
    id: "elijah-3",
    user: U_elijah,
    dayLabel: "7d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "5d",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 4, changed: 3, felt: 40, door: 17 },
  },

  {
    id: "elijah-4",
    user: U_elijah,
    dayLabel: "6d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "3:01",
    timeAgo: "4d",
    preview: "The thing I almost never say: I want to build something that is still being used by people I will never meet. Everything else is practice.",
    body: `I want to build something that makes the people who encounter it feel more capable, not more dependent. That goal has been hard to articulate without sounding vague. I know what I mean by it specifically.

Most of what I have built so far does not fully achieve this. I am still figuring out the gap.`,
    reactions: { think: 15, changed: 16, felt: 6, door: 24 },
  },

  {
    id: "elijah-5",
    user: U_elijah,
    dayLabel: "5d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 26, changed: 29, felt: 15, door: 4 },
  },

  {
    id: "sophie-1",
    user: U_sophie,
    dayLabel: "4d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 36, changed: 11, felt: 27, door: 14 },
  },

  {
    id: "sophie-2",
    user: U_sophie,
    dayLabel: "3d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "A conversation last semester changed something I had held as settled. The person did not argue me out of it. They just described what they saw differently.",
    body: `A conversation last semester moved something that had felt settled. The person did not present a counter-argument. They just described what they saw and asked if I saw it the same way. I did not.

I have been trying to figure out what they did differently. I think they made it safe to revise without making me wrong.`,
    reactions: { think: 47, changed: 24, felt: 36, door: 21 },
  },

  {
    id: "sophie-3",
    user: U_sophie,
    dayLabel: "2d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "8h",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 11, changed: 6, felt: 45, door: 1 },
  },

  {
    id: "sophie-4",
    user: U_sophie,
    dayLabel: "Yesterday",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "3:17",
    timeAgo: "5h",
    preview: "Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed initially. Then I realized the disagreement was the point.",
    body: `Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed. Then I sat with the disagreement for two weeks. Then I updated most of my approach.

I think I learn more from honest feedback delivered without agenda than from anything else. I am trying to create more conditions for it.`,
    reactions: { think: 22, changed: 19, felt: 11, door: 8 },
  },

  {
    id: "sophie-5",
    user: U_sophie,
    dayLabel: "Today",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 33, changed: 32, felt: 20, door: 15 },
  },

  {
    id: "kofi-1",
    user: U_kofi,
    dayLabel: "7d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 43, changed: 14, felt: 32, door: 25 },
  },

  {
    id: "kofi-2",
    user: U_kofi,
    dayLabel: "6d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "I have been tracing where my self-critic learned its script. Most of it predates any actual failure. It was there to prevent vulnerability, not to assess performance.",
    body: `I have been listening to my inner voice differently lately. Less like an opponent to defeat and more like a scared version of me that needs information, not combat.

When I ask it what it is actually afraid of, I usually get a more useful answer than when I try to argue it into silence.`,
    reactions: { think: 7, changed: 27, felt: 41, door: 5 },
  },

  {
    id: "kofi-3",
    user: U_kofi,
    dayLabel: "5d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "3d",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 18, changed: 9, felt: 7, door: 12 },
  },

  {
    id: "kofi-4",
    user: U_kofi,
    dayLabel: "4d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:58",
    timeAgo: "2d",
    preview: "I used to believe that consistency was the highest virtue. I am less certain now. Some things need to break before they can be rebuilt right.",
    body: `I used to believe consistency was the highest form of discipline. Show up every day, do the work, let compound interest handle the rest.

I still believe this in some domains. In others I have watched people be consistently wrong for years. Consistency is only a virtue if you are pointed at the right target.`,
    reactions: { think: 29, changed: 22, felt: 16, door: 19 },
  },

  {
    id: "kofi-5",
    user: U_kofi,
    dayLabel: "3d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 40, changed: 4, felt: 25, door: 26 },
  },

  {
    id: "aria-1",
    user: U_aria,
    dayLabel: "2d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 50, changed: 17, felt: 37, door: 9 },
  },

  {
    id: "aria-2",
    user: U_aria,
    dayLabel: "Yesterday",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "What I am building toward is a kind of work that does not make people feel smaller for encountering it. That sounds vague. I know what I mean by it.",
    body: `What I am building toward, and almost never say: I want to make something that is still being used ten years from now by people who do not know my name. Everything I am doing now feels like practice for that.

I do not know if that makes the current work less important. I think it might make it more.`,
    reactions: { think: 14, changed: 30, felt: 3, door: 16 },
  },

  {
    id: "aria-3",
    user: U_aria,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "2h",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 25, changed: 12, felt: 12, door: 23 },
  },

  {
    id: "aria-4",
    user: U_aria,
    dayLabel: "7d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:52",
    timeAgo: "5d",
    preview: "A conversation last semester changed something I had held as settled. The person did not argue me out of it. They just described what they saw differently.",
    body: `A conversation last semester moved something that had felt settled. The person did not present a counter-argument. They just described what they saw and asked if I saw it the same way. I did not.

I have been trying to figure out what they did differently. I think they made it safe to revise without making me wrong.`,
    reactions: { think: 36, changed: 25, felt: 21, door: 3 },
  },

  {
    id: "aria-5",
    user: U_aria,
    dayLabel: "6d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 47, changed: 7, felt: 30, door: 10 },
  },

  {
    id: "jordan-1",
    user: U_jordan,
    dayLabel: "5d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 10, changed: 20, felt: 42, door: 20 },
  },

  {
    id: "jordan-2",
    user: U_jordan,
    dayLabel: "4d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "2d",
    preview: "The conversation that changed my direction was not about my future. It was about something adjacent. The shift happened quietly and I only understood it weeks later.",
    body: `The conversation that changed my direction was not about my career or my future. It was about something smaller. But the thing it moved had been load-bearing and I did not know it.

I think important conversations often disguise themselves as unimportant ones.`,
    reactions: { think: 21, changed: 2, felt: 8, door: 27 },
  },

  {
    id: "jordan-3",
    user: U_jordan,
    dayLabel: "3d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "1d",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 32, changed: 15, felt: 17, door: 7 },
  },

  {
    id: "jordan-4",
    user: U_jordan,
    dayLabel: "2d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "3:24",
    timeAgo: "8h",
    preview: "I have been tracing where my self-critic learned its script. Most of it predates any actual failure. It was there to prevent vulnerability, not to assess performance.",
    body: `I have been listening to my inner voice differently lately. Less like an opponent to defeat and more like a scared version of me that needs information, not combat.

When I ask it what it is actually afraid of, I usually get a more useful answer than when I try to argue it into silence.`,
    reactions: { think: 43, changed: 28, felt: 26, door: 14 },
  },

  {
    id: "jordan-5",
    user: U_jordan,
    dayLabel: "Yesterday",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 7, changed: 10, felt: 35, door: 21 },
  },

  {
    id: "kezia-1",
    user: U_kezia,
    dayLabel: "Today",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 17, changed: 23, felt: 4, door: 4 },
  },

  {
    id: "kezia-2",
    user: U_kezia,
    dayLabel: "7d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "5d",
    preview: "I spent years thinking that certainty was a sign of clear thinking. I now suspect certainty is often a defense against having to think further.",
    body: `I held the belief that certainty was a sign of intellectual rigor. The people I respected most seemed certain. I worked to become certain too.

I think I had it backwards. The people doing the most interesting thinking I know are the ones who hold their models loosely and update quickly. Certainty seems more like a comfort than a conclusion.`,
    reactions: { think: 28, changed: 5, felt: 13, door: 11 },
  },

  {
    id: "kezia-3",
    user: U_kezia,
    dayLabel: "6d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "4d",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 39, changed: 18, felt: 22, door: 18 },
  },

  {
    id: "kezia-4",
    user: U_kezia,
    dayLabel: "5d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "1:36",
    timeAgo: "3d",
    preview: "What I am building toward is a kind of work that does not make people feel smaller for encountering it. That sounds vague. I know what I mean by it.",
    body: `What I am building toward, and almost never say: I want to make something that is still being used ten years from now by people who do not know my name. Everything I am doing now feels like practice for that.

I do not know if that makes the current work less important. I think it might make it more.`,
    reactions: { think: 50, changed: 31, felt: 31, door: 25 },
  },

  {
    id: "kezia-5",
    user: U_kezia,
    dayLabel: "4d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 14, changed: 13, felt: 40, door: 5 },
  },

  {
    id: "tobias-1",
    user: U_tobias,
    dayLabel: "3d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 24, changed: 26, felt: 9, door: 15 },
  },

  {
    id: "tobias-2",
    user: U_tobias,
    dayLabel: "2d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "I changed my mind when I watched someone do the thing I had theorized about and realized my theory was missing two dimensions.",
    body: `I changed my mind watching someone implement an idea I had theorized about. My theory was missing the part where it is actually hard. Seeing the real version changed my understanding of what the problem was.

I think I learn more from watching things fail in the real world than from any amount of analysis. The map is not the territory.`,
    reactions: { think: 35, changed: 8, felt: 18, door: 22 },
  },

  {
    id: "tobias-3",
    user: U_tobias,
    dayLabel: "Yesterday",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "5h",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 46, changed: 21, felt: 27, door: 2 },
  },

  {
    id: "tobias-4",
    user: U_tobias,
    dayLabel: "Today",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "2:15",
    timeAgo: "2h",
    preview: "The conversation that changed my direction was not about my future. It was about something adjacent. The shift happened quietly and I only understood it weeks later.",
    body: `The conversation that changed my direction was not about my career or my future. It was about something smaller. But the thing it moved had been load-bearing and I did not know it.

I think important conversations often disguise themselves as unimportant ones.`,
    reactions: { think: 10, changed: 3, felt: 36, door: 9 },
  },

  {
    id: "tobias-5",
    user: U_tobias,
    dayLabel: "7d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 21, changed: 16, felt: 45, door: 16 },
  },

  {
    id: "farah-1",
    user: U_farah,
    dayLabel: "6d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 31, changed: 29, felt: 14, door: 26 },
  },

  {
    id: "farah-2",
    user: U_farah,
    dayLabel: "5d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "The voice that shows up when I fail sounds like someone who needed me to be more in order to feel safe. I have been trying to figure out who taught it that.",
    body: `The voice that shows up when I fail sounds like it learned its script from someone who needed me to be invulnerable. I was not allowed to fail in certain contexts. So the voice decided to prevent failure by making it catastrophic.

Understanding that origin has not made the voice quieter. But it has made it less authoritative.`,
    reactions: { think: 42, changed: 11, felt: 23, door: 6 },
  },

  {
    id: "farah-3",
    user: U_farah,
    dayLabel: "4d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "2d",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 6, changed: 24, felt: 32, door: 13 },
  },

  {
    id: "farah-4",
    user: U_farah,
    dayLabel: "3d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:44",
    timeAgo: "1d",
    preview: "I spent years thinking that certainty was a sign of clear thinking. I now suspect certainty is often a defense against having to think further.",
    body: `I held the belief that certainty was a sign of intellectual rigor. The people I respected most seemed certain. I worked to become certain too.

I think I had it backwards. The people doing the most interesting thinking I know are the ones who hold their models loosely and update quickly. Certainty seems more like a comfort than a conclusion.`,
    reactions: { think: 17, changed: 6, felt: 41, door: 20 },
  },

  {
    id: "farah-5",
    user: U_farah,
    dayLabel: "2d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 28, changed: 19, felt: 7, door: 27 },
  },

  {
    id: "marcus_j-1",
    user: U_marcus_j,
    dayLabel: "Yesterday",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 38, changed: 32, felt: 19, door: 10 },
  },

  {
    id: "marcus_j-2",
    user: U_marcus_j,
    dayLabel: "Today",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "I want to make something that feels necessary. Not useful in a transactional way. Necessary in the way that certain books feel necessary.",
    body: `The version of my work I almost never say out loud: I want it to change how someone thinks, not just what they can do. That is a different target than what most of my current projects aim at.

I am trying to figure out how to build toward it more directly.`,
    reactions: { think: 49, changed: 14, felt: 28, door: 17 },
  },

  {
    id: "marcus_j-3",
    user: U_marcus_j,
    dayLabel: "7d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "5d",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 13, changed: 27, felt: 37, door: 24 },
  },

  {
    id: "marcus_j-4",
    user: U_marcus_j,
    dayLabel: "6d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:08",
    timeAgo: "4d",
    preview: "I changed my mind when I watched someone do the thing I had theorized about and realized my theory was missing two dimensions.",
    body: `I changed my mind watching someone implement an idea I had theorized about. My theory was missing the part where it is actually hard. Seeing the real version changed my understanding of what the problem was.

I think I learn more from watching things fail in the real world than from any amount of analysis. The map is not the territory.`,
    reactions: { think: 24, changed: 9, felt: 3, door: 4 },
  },

  {
    id: "marcus_j-5",
    user: U_marcus_j,
    dayLabel: "5d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 35, changed: 22, felt: 12, door: 11 },
  },

  {
    id: "esther-1",
    user: U_esther,
    dayLabel: "4d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 45, changed: 4, felt: 24, door: 21 },
  },

  {
    id: "esther-2",
    user: U_esther,
    dayLabel: "3d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "1d",
    preview: "A twenty-minute conversation two years ago rerouted something that had been set for years. The person said one thing and I could not put it back where it was.",
    body: `A twenty-minute conversation two years ago changed something I had thought was settled. The person did not make an argument. They described something they had observed, and I could not fit it into my existing model.

I still think about that conversation. I am not sure I would have been ready for it a year earlier.`,
    reactions: { think: 9, changed: 17, felt: 33, door: 1 },
  },

  {
    id: "esther-3",
    user: U_esther,
    dayLabel: "2d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "8h",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 20, changed: 30, felt: 42, door: 8 },
  },

  {
    id: "esther-4",
    user: U_esther,
    dayLabel: "Yesterday",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "2:33",
    timeAgo: "5h",
    preview: "The voice that shows up when I fail sounds like someone who needed me to be more in order to feel safe. I have been trying to figure out who taught it that.",
    body: `The voice that shows up when I fail sounds like it learned its script from someone who needed me to be invulnerable. I was not allowed to fail in certain contexts. So the voice decided to prevent failure by making it catastrophic.

Understanding that origin has not made the voice quieter. But it has made it less authoritative.`,
    reactions: { think: 31, changed: 12, felt: 8, door: 15 },
  },

  {
    id: "esther-5",
    user: U_esther,
    dayLabel: "Today",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 42, changed: 25, felt: 17, door: 22 },
  },

  {
    id: "drew-1",
    user: U_drew,
    dayLabel: "7d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 5, changed: 7, felt: 29, door: 5 },
  },

  {
    id: "drew-2",
    user: U_drew,
    dayLabel: "6d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "4d",
    preview: "A belief I held for years: intelligence would protect me from most serious mistakes. It does not. It just makes the mistakes more elaborate.",
    body: `For a long time I thought intelligence was the primary factor in avoiding serious mistakes. I have accumulated enough evidence against this that I have had to revise the model.

What I think now: intelligence mostly helps you build more convincing justifications for what you already wanted to do. The hard part is wanting the right things.`,
    reactions: { think: 16, changed: 20, felt: 38, door: 12 },
  },

  {
    id: "drew-3",
    user: U_drew,
    dayLabel: "5d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "3d",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 27, changed: 2, felt: 4, door: 19 },
  },

  {
    id: "drew-4",
    user: U_drew,
    dayLabel: "4d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "3:01",
    timeAgo: "2d",
    preview: "I want to make something that feels necessary. Not useful in a transactional way. Necessary in the way that certain books feel necessary.",
    body: `The version of my work I almost never say out loud: I want it to change how someone thinks, not just what they can do. That is a different target than what most of my current projects aim at.

I am trying to figure out how to build toward it more directly.`,
    reactions: { think: 38, changed: 15, felt: 13, door: 26 },
  },

  {
    id: "drew-5",
    user: U_drew,
    dayLabel: "3d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 49, changed: 28, felt: 22, door: 6 },
  },

  {
    id: "amani-1",
    user: U_amani,
    dayLabel: "2d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 12, changed: 10, felt: 34, door: 16 },
  },

  {
    id: "amani-2",
    user: U_amani,
    dayLabel: "Yesterday",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "The thing that changed my mind was not an argument. It was a single observation I could not explain away with the model I was running.",
    body: `The thing that shifted was not logic. It was a single observation that did not fit my current model. I spent a week trying to explain it away. Eventually I updated the model instead.

I notice now that my model updates almost always come from observations, not arguments. Arguments make me defend. Observations make me wonder.`,
    reactions: { think: 23, changed: 23, felt: 43, door: 23 },
  },

  {
    id: "amani-3",
    user: U_amani,
    dayLabel: "Today",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "2h",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 34, changed: 5, felt: 9, door: 3 },
  },

  {
    id: "amani-4",
    user: U_amani,
    dayLabel: "7d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "3:17",
    timeAgo: "5d",
    preview: "A twenty-minute conversation two years ago rerouted something that had been set for years. The person said one thing and I could not put it back where it was.",
    body: `A twenty-minute conversation two years ago changed something I had thought was settled. The person did not make an argument. They described something they had observed, and I could not fit it into my existing model.

I still think about that conversation. I am not sure I would have been ready for it a year earlier.`,
    reactions: { think: 45, changed: 18, felt: 18, door: 10 },
  },

  {
    id: "amani-5",
    user: U_amani,
    dayLabel: "6d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 9, changed: 31, felt: 27, door: 17 },
  },

  {
    id: "julian-1",
    user: U_julian,
    dayLabel: "5d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 19, changed: 13, felt: 39, door: 27 },
  },

  {
    id: "julian-2",
    user: U_julian,
    dayLabel: "4d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "My inner critic does not speak in logic. It speaks in fear, specifically the fear that this failure is evidence of something permanent.",
    body: `My inner critic speaks in absolutes. Not 'that did not work' but 'you do not have what it takes.' I have been trying to understand where the absolutism came from.

I think it predates any actual failure. It was installed before I had enough experience to verify it. I am trying to rewrite it with more accurate language.`,
    reactions: { think: 30, changed: 26, felt: 5, door: 7 },
  },

  {
    id: "julian-3",
    user: U_julian,
    dayLabel: "3d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "1d",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 41, changed: 8, felt: 14, door: 14 },
  },

  {
    id: "julian-4",
    user: U_julian,
    dayLabel: "2d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:58",
    timeAgo: "8h",
    preview: "A belief I held for years: intelligence would protect me from most serious mistakes. It does not. It just makes the mistakes more elaborate.",
    body: `For a long time I thought intelligence was the primary factor in avoiding serious mistakes. I have accumulated enough evidence against this that I have had to revise the model.

What I think now: intelligence mostly helps you build more convincing justifications for what you already wanted to do. The hard part is wanting the right things.`,
    reactions: { think: 5, changed: 21, felt: 23, door: 21 },
  },

  {
    id: "julian-5",
    user: U_julian,
    dayLabel: "Yesterday",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 16, changed: 3, felt: 32, door: 1 },
  },

  {
    id: "skye-1",
    user: U_skye,
    dayLabel: "Today",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 26, changed: 16, felt: 44, door: 11 },
  },

  {
    id: "skye-2",
    user: U_skye,
    dayLabel: "7d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "The thing I almost never say: I want to build something that is still being used by people I will never meet. Everything else is practice.",
    body: `I want to build something that makes the people who encounter it feel more capable, not more dependent. That goal has been hard to articulate without sounding vague. I know what I mean by it specifically.

Most of what I have built so far does not fully achieve this. I am still figuring out the gap.`,
    reactions: { think: 37, changed: 29, felt: 10, door: 18 },
  },

  {
    id: "skye-3",
    user: U_skye,
    dayLabel: "6d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "4d",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 48, changed: 11, felt: 19, door: 25 },
  },

  {
    id: "skye-4",
    user: U_skye,
    dayLabel: "5d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:52",
    timeAgo: "3d",
    preview: "The thing that changed my mind was not an argument. It was a single observation I could not explain away with the model I was running.",
    body: `The thing that shifted was not logic. It was a single observation that did not fit my current model. I spent a week trying to explain it away. Eventually I updated the model instead.

I notice now that my model updates almost always come from observations, not arguments. Arguments make me defend. Observations make me wonder.`,
    reactions: { think: 12, changed: 24, felt: 28, door: 5 },
  },

  {
    id: "skye-5",
    user: U_skye,
    dayLabel: "4d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 23, changed: 6, felt: 37, door: 12 },
  },

  {
    id: "cyrus-1",
    user: U_cyrus,
    dayLabel: "3d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 33, changed: 19, felt: 6, door: 22 },
  },

  {
    id: "cyrus-2",
    user: U_cyrus,
    dayLabel: "2d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "8h",
    preview: "Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed initially. Then I realized the disagreement was the point.",
    body: `Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed. Then I sat with the disagreement for two weeks. Then I updated most of my approach.

I think I learn more from honest feedback delivered without agenda than from anything else. I am trying to create more conditions for it.`,
    reactions: { think: 44, changed: 32, felt: 15, door: 2 },
  },

  {
    id: "cyrus-3",
    user: U_cyrus,
    dayLabel: "Yesterday",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "5h",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 8, changed: 14, felt: 24, door: 9 },
  },

  {
    id: "cyrus-4",
    user: U_cyrus,
    dayLabel: "Today",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "3:24",
    timeAgo: "2h",
    preview: "My inner critic does not speak in logic. It speaks in fear, specifically the fear that this failure is evidence of something permanent.",
    body: `My inner critic speaks in absolutes. Not 'that did not work' but 'you do not have what it takes.' I have been trying to understand where the absolutism came from.

I think it predates any actual failure. It was installed before I had enough experience to verify it. I am trying to rewrite it with more accurate language.`,
    reactions: { think: 19, changed: 27, felt: 33, door: 16 },
  },

  {
    id: "cyrus-5",
    user: U_cyrus,
    dayLabel: "7d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 30, changed: 9, felt: 42, door: 23 },
  },

  {
    id: "naomi-1",
    user: U_naomi,
    dayLabel: "6d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 40, changed: 22, felt: 11, door: 6 },
  },

  {
    id: "naomi-2",
    user: U_naomi,
    dayLabel: "5d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "3d",
    preview: "I used to believe that consistency was the highest virtue. I am less certain now. Some things need to break before they can be rebuilt right.",
    body: `I used to believe consistency was the highest form of discipline. Show up every day, do the work, let compound interest handle the rest.

I still believe this in some domains. In others I have watched people be consistently wrong for years. Consistency is only a virtue if you are pointed at the right target.`,
    reactions: { think: 4, changed: 4, felt: 20, door: 13 },
  },

  {
    id: "naomi-3",
    user: U_naomi,
    dayLabel: "4d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "2d",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 15, changed: 17, felt: 29, door: 20 },
  },

  {
    id: "naomi-4",
    user: U_naomi,
    dayLabel: "3d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "1:36",
    timeAgo: "1d",
    preview: "The thing I almost never say: I want to build something that is still being used by people I will never meet. Everything else is practice.",
    body: `I want to build something that makes the people who encounter it feel more capable, not more dependent. That goal has been hard to articulate without sounding vague. I know what I mean by it specifically.

Most of what I have built so far does not fully achieve this. I am still figuring out the gap.`,
    reactions: { think: 26, changed: 30, felt: 38, door: 27 },
  },

  {
    id: "naomi-5",
    user: U_naomi,
    dayLabel: "2d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "I am afraid of becoming technically excellent at something that turns out not to have been worth doing.",
    body: `I have a fear I rarely say out loud: that I will get good at the wrong things. Not fail at the right things, but succeed at ones that do not matter to me or to anyone else.

Most advice about ambition assumes you already know what you are aiming at. I am not always sure I do. I am trying to build a habit of asking that question more often.`,
    reactions: { think: 37, changed: 12, felt: 4, door: 7 },
  },

  {
    id: "luca-1",
    user: U_luca,
    dayLabel: "Yesterday",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 47, changed: 25, felt: 16, door: 17 },
  },

  {
    id: "luca-2",
    user: U_luca,
    dayLabel: "Today",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "A conversation last semester changed something I had held as settled. The person did not argue me out of it. They just described what they saw differently.",
    body: `A conversation last semester moved something that had felt settled. The person did not present a counter-argument. They just described what they saw and asked if I saw it the same way. I did not.

I have been trying to figure out what they did differently. I think they made it safe to revise without making me wrong.`,
    reactions: { think: 11, changed: 7, felt: 25, door: 24 },
  },

  {
    id: "luca-3",
    user: U_luca,
    dayLabel: "7d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "5d",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 22, changed: 20, felt: 34, door: 4 },
  },

  {
    id: "luca-4",
    user: U_luca,
    dayLabel: "6d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "2:15",
    timeAgo: "4d",
    preview: "Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed initially. Then I realized the disagreement was the point.",
    body: `Someone told me the truth about how they saw my work in a way I had not heard before. I disagreed. Then I sat with the disagreement for two weeks. Then I updated most of my approach.

I think I learn more from honest feedback delivered without agenda than from anything else. I am trying to create more conditions for it.`,
    reactions: { think: 33, changed: 2, felt: 43, door: 11 },
  },

  {
    id: "luca-5",
    user: U_luca,
    dayLabel: "5d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "I keep postponing the version of my work that actually scares me. The comfortable version does not ask enough of me or of the people I want to reach.",
    body: `The work I keep postponing is the version that actually challenges the people who encounter it. The easier version is polished and forgettable. I keep finishing the easier version.

I think what I am avoiding is the vulnerability of making something that takes a real position. That seems like the thing worth working toward.`,
    reactions: { think: 44, changed: 15, felt: 9, door: 18 },
  },

  {
    id: "zoe-1",
    user: U_zoe,
    dayLabel: "4d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 7, changed: 28, felt: 21, door: 1 },
  },

  {
    id: "zoe-2",
    user: U_zoe,
    dayLabel: "3d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "I have been tracing where my self-critic learned its script. Most of it predates any actual failure. It was there to prevent vulnerability, not to assess performance.",
    body: `I have been listening to my inner voice differently lately. Less like an opponent to defeat and more like a scared version of me that needs information, not combat.

When I ask it what it is actually afraid of, I usually get a more useful answer than when I try to argue it into silence.`,
    reactions: { think: 18, changed: 10, felt: 30, door: 8 },
  },

  {
    id: "zoe-3",
    user: U_zoe,
    dayLabel: "2d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "8h",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 29, changed: 23, felt: 39, door: 15 },
  },

  {
    id: "zoe-4",
    user: U_zoe,
    dayLabel: "Yesterday",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:44",
    timeAgo: "5h",
    preview: "I used to believe that consistency was the highest virtue. I am less certain now. Some things need to break before they can be rebuilt right.",
    body: `I used to believe consistency was the highest form of discipline. Show up every day, do the work, let compound interest handle the rest.

I still believe this in some domains. In others I have watched people be consistently wrong for years. Consistency is only a virtue if you are pointed at the right target.`,
    reactions: { think: 40, changed: 5, felt: 5, door: 22 },
  },

  {
    id: "zoe-5",
    user: U_zoe,
    dayLabel: "Today",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "The version of my work that no one would measure is more honest than the version I produce for evaluation. I want to close that gap.",
    body: `I would slow down. Almost everything I do under evaluation is done at the pace of what can be measured in a semester. The things I am most interested in do not fit that timeline.

I do not know how to fully solve the mismatch between evaluation timelines and meaningful work timelines. I am still working on it.`,
    reactions: { think: 4, changed: 18, felt: 14, door: 2 },
  },

  {
    id: "kwame-1",
    user: U_kwame,
    dayLabel: "7d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 14, changed: 31, felt: 26, door: 12 },
  },

  {
    id: "kwame-2",
    user: U_kwame,
    dayLabel: "6d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "What I am building toward is a kind of work that does not make people feel smaller for encountering it. That sounds vague. I know what I mean by it.",
    body: `What I am building toward, and almost never say: I want to make something that is still being used ten years from now by people who do not know my name. Everything I am doing now feels like practice for that.

I do not know if that makes the current work less important. I think it might make it more.`,
    reactions: { think: 25, changed: 13, felt: 35, door: 19 },
  },

  {
    id: "kwame-3",
    user: U_kwame,
    dayLabel: "5d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "3d",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 36, changed: 26, felt: 44, door: 26 },
  },

  {
    id: "kwame-4",
    user: U_kwame,
    dayLabel: "4d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:08",
    timeAgo: "2d",
    preview: "A conversation last semester changed something I had held as settled. The person did not argue me out of it. They just described what they saw differently.",
    body: `A conversation last semester moved something that had felt settled. The person did not present a counter-argument. They just described what they saw and asked if I saw it the same way. I did not.

I have been trying to figure out what they did differently. I think they made it safe to revise without making me wrong.`,
    reactions: { think: 47, changed: 8, felt: 10, door: 6 },
  },

  {
    id: "kwame-5",
    user: U_kwame,
    dayLabel: "3d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "The best listener I know asks one question and then goes completely quiet. She does not solve anything. She just holds space until I find the answer myself.",
    body: `The best listener I know is my older sister. What she does differently: she does not start solving until I have finished talking. Usually by the time I have finished talking, I have already found the answer.

I have been trying to do less premature solving in my own conversations. It is harder than it looks.`,
    reactions: { think: 11, changed: 21, felt: 19, door: 13 },
  },

  {
    id: "priya_r-1",
    user: U_priya_r,
    dayLabel: "2d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 21, changed: 3, felt: 31, door: 23 },
  },

  {
    id: "priya_r-2",
    user: U_priya_r,
    dayLabel: "Yesterday",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "5h",
    preview: "The conversation that changed my direction was not about my future. It was about something adjacent. The shift happened quietly and I only understood it weeks later.",
    body: `The conversation that changed my direction was not about my career or my future. It was about something smaller. But the thing it moved had been load-bearing and I did not know it.

I think important conversations often disguise themselves as unimportant ones.`,
    reactions: { think: 32, changed: 16, felt: 40, door: 3 },
  },

  {
    id: "priya_r-3",
    user: U_priya_r,
    dayLabel: "Today",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "2h",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 43, changed: 29, felt: 6, door: 10 },
  },

  {
    id: "priya_r-4",
    user: U_priya_r,
    dayLabel: "7d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "2:33",
    timeAgo: "5d",
    preview: "I have been tracing where my self-critic learned its script. Most of it predates any actual failure. It was there to prevent vulnerability, not to assess performance.",
    body: `I have been listening to my inner voice differently lately. Less like an opponent to defeat and more like a scared version of me that needs information, not combat.

When I ask it what it is actually afraid of, I usually get a more useful answer than when I try to argue it into silence.`,
    reactions: { think: 7, changed: 11, felt: 15, door: 17 },
  },

  {
    id: "priya_r-5",
    user: U_priya_r,
    dayLabel: "6d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "I present as someone who has a clear direction. I actually spend most of my time questioning whether the direction is correct.",
    body: `I present as someone with a clear direction. Internally I revise the direction regularly. The public version of certainty I project does not fully reflect how often the map changes.

I am trying to lead with the uncertain version more often. Not as a performance of humility but because it is more accurate.`,
    reactions: { think: 18, changed: 24, felt: 24, door: 24 },
  },

  {
    id: "isaiah-1",
    user: U_isaiah,
    dayLabel: "5d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 28, changed: 6, felt: 36, door: 7 },
  },

  {
    id: "isaiah-2",
    user: U_isaiah,
    dayLabel: "4d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "2d",
    preview: "I spent years thinking that certainty was a sign of clear thinking. I now suspect certainty is often a defense against having to think further.",
    body: `I held the belief that certainty was a sign of intellectual rigor. The people I respected most seemed certain. I worked to become certain too.

I think I had it backwards. The people doing the most interesting thinking I know are the ones who hold their models loosely and update quickly. Certainty seems more like a comfort than a conclusion.`,
    reactions: { think: 39, changed: 19, felt: 45, door: 14 },
  },

  {
    id: "isaiah-3",
    user: U_isaiah,
    dayLabel: "3d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "1d",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 50, changed: 32, felt: 11, door: 21 },
  },

  {
    id: "isaiah-4",
    user: U_isaiah,
    dayLabel: "2d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "3:01",
    timeAgo: "8h",
    preview: "What I am building toward is a kind of work that does not make people feel smaller for encountering it. That sounds vague. I know what I mean by it.",
    body: `What I am building toward, and almost never say: I want to make something that is still being used ten years from now by people who do not know my name. Everything I am doing now feels like practice for that.

I do not know if that makes the current work less important. I think it might make it more.`,
    reactions: { think: 14, changed: 14, felt: 20, door: 1 },
  },

  {
    id: "isaiah-5",
    user: U_isaiah,
    dayLabel: "Yesterday",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "I keep a list of what actually scares me. Most of the items are not about failing. They are about the wrong kind of winning.",
    body: `I keep a list of fears in a notes app. Looking at it, the interesting thing is what is not on it. Not failure, not being wrong, not embarrassment. The things that actually scare me are mostly about meaning.

I am still trying to figure out what that list is trying to tell me.`,
    reactions: { think: 25, changed: 27, felt: 29, door: 8 },
  },

  {
    id: "elena-1",
    user: U_elena,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 35, changed: 9, felt: 41, door: 18 },
  },

  {
    id: "elena-2",
    user: U_elena,
    dayLabel: "7d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "I changed my mind when I watched someone do the thing I had theorized about and realized my theory was missing two dimensions.",
    body: `I changed my mind watching someone implement an idea I had theorized about. My theory was missing the part where it is actually hard. Seeing the real version changed my understanding of what the problem was.

I think I learn more from watching things fail in the real world than from any amount of analysis. The map is not the territory.`,
    reactions: { think: 46, changed: 22, felt: 7, door: 25 },
  },

  {
    id: "elena-3",
    user: U_elena,
    dayLabel: "6d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "4d",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 10, changed: 4, felt: 16, door: 5 },
  },

  {
    id: "elena-4",
    user: U_elena,
    dayLabel: "5d ago",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "audio",
    audioDuration: "3:17",
    timeAgo: "3d",
    preview: "The conversation that changed my direction was not about my future. It was about something adjacent. The shift happened quietly and I only understood it weeks later.",
    body: `The conversation that changed my direction was not about my career or my future. It was about something smaller. But the thing it moved had been load-bearing and I did not know it.

I think important conversations often disguise themselves as unimportant ones.`,
    reactions: { think: 21, changed: 17, felt: 25, door: 12 },
  },

  {
    id: "elena-5",
    user: U_elena,
    dayLabel: "4d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "I have been avoiding a conversation that I know needs to happen. The cost of having it is one afternoon. The cost of avoiding it compounds daily.",
    body: `I have been avoiding a conversation with someone whose feedback I need and am afraid of. The math on this is simple: one uncomfortable hour versus ongoing uncertainty. I keep choosing the uncertainty.

I am writing this down because writing it down makes me more likely to actually have the conversation. That is tomorrow.`,
    reactions: { think: 32, changed: 30, felt: 34, door: 19 },
  },

  {
    id: "jerome-1",
    user: U_jerome,
    dayLabel: "3d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "text",
    timeAgo: "1d",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 42, changed: 12, felt: 3, door: 2 },
  },

  {
    id: "jerome-2",
    user: U_jerome,
    dayLabel: "2d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "The voice that shows up when I fail sounds like someone who needed me to be more in order to feel safe. I have been trying to figure out who taught it that.",
    body: `The voice that shows up when I fail sounds like it learned its script from someone who needed me to be invulnerable. I was not allowed to fail in certain contexts. So the voice decided to prevent failure by making it catastrophic.

Understanding that origin has not made the voice quieter. But it has made it less authoritative.`,
    reactions: { think: 6, changed: 25, felt: 12, door: 9 },
  },

  {
    id: "jerome-3",
    user: U_jerome,
    dayLabel: "Yesterday",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "5h",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 17, changed: 7, felt: 21, door: 16 },
  },

  {
    id: "jerome-4",
    user: U_jerome,
    dayLabel: "Today",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "audio",
    audioDuration: "1:58",
    timeAgo: "2h",
    preview: "I spent years thinking that certainty was a sign of clear thinking. I now suspect certainty is often a defense against having to think further.",
    body: `I held the belief that certainty was a sign of intellectual rigor. The people I respected most seemed certain. I worked to become certain too.

I think I had it backwards. The people doing the most interesting thinking I know are the ones who hold their models loosely and update quickly. Certainty seems more like a comfort than a conclusion.`,
    reactions: { think: 28, changed: 20, felt: 30, door: 23 },
  },

  {
    id: "jerome-5",
    user: U_jerome,
    dayLabel: "7d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "5d",
    preview: "Without external metrics, I would stop optimizing for legibility and start optimizing for whether the thing I am making is actually good.",
    body: `Without external evaluation, I would stop optimizing for legibility and start optimizing for whether the thing is actually good. Legibility is useful. But I have used it as a substitute for quality before.

The version of my work that I produce when no one is measuring it is usually the one I am most proud of later.`,
    reactions: { think: 39, changed: 2, felt: 39, door: 3 },
  },

  {
    id: "freya-1",
    user: U_freya,
    dayLabel: "6d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "text",
    timeAgo: "4d",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 49, changed: 15, felt: 8, door: 13 },
  },

  {
    id: "freya-2",
    user: U_freya,
    dayLabel: "5d ago",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "I want to make something that feels necessary. Not useful in a transactional way. Necessary in the way that certain books feel necessary.",
    body: `The version of my work I almost never say out loud: I want it to change how someone thinks, not just what they can do. That is a different target than what most of my current projects aim at.

I am trying to figure out how to build toward it more directly.`,
    reactions: { think: 13, changed: 28, felt: 17, door: 20 },
  },

  {
    id: "freya-3",
    user: U_freya,
    dayLabel: "4d ago",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "photo",
    photoGradient: ["#1a2a10", "#0a1408"],
    timeAgo: "2d",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 24, changed: 10, felt: 26, door: 27 },
  },

  {
    id: "freya-4",
    user: U_freya,
    dayLabel: "3d ago",
    promptText: "Describe a moment when you changed your mind. What made you?",
    mediaType: "audio",
    audioDuration: "2:52",
    timeAgo: "1d",
    preview: "I changed my mind when I watched someone do the thing I had theorized about and realized my theory was missing two dimensions.",
    body: `I changed my mind watching someone implement an idea I had theorized about. My theory was missing the part where it is actually hard. Seeing the real version changed my understanding of what the problem was.

I think I learn more from watching things fail in the real world than from any amount of analysis. The map is not the territory.`,
    reactions: { think: 35, changed: 23, felt: 35, door: 7 },
  },

  {
    id: "freya-5",
    user: U_freya,
    dayLabel: "2d ago",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "8h",
    preview: "What the good listeners in my life do differently: they treat silence as part of the conversation, not as a problem to fill.",
    body: `My best friend is a good listener because she does not treat silence as a problem. She will sit with me in uncertainty without trying to resolve it into a conclusion.

Most of the people in my life are uncomfortable with unresolved questions. She makes space for them. I find I think more clearly around her.`,
    reactions: { think: 46, changed: 5, felt: 44, door: 14 },
  },

  {
    id: "moses-1",
    user: U_moses,
    dayLabel: "Yesterday",
    promptText: "Who in your life is genuinely good at listening? What do they do differently?",
    mediaType: "text",
    timeAgo: "5h",
    preview: "My advisor listens in a way I have been trying to understand. He does not seem to be waiting for a gap. He seems to be actually receiving what I am saying.",
    body: `There is a professor I go to when I am genuinely stuck. He asks clarifying questions rather than offering directions. By the fourth question I usually understand what I actually think.

I have started to realize that good listening is mostly about asking questions that make the other person's thinking clearer to themselves.`,
    reactions: { think: 9, changed: 18, felt: 13, door: 24 },
  },

  {
    id: "moses-2",
    user: U_moses,
    dayLabel: "Today",
    promptText: "Describe a conversation that changed the direction of your life.",
    mediaType: "text",
    timeAgo: "2h",
    preview: "A twenty-minute conversation two years ago rerouted something that had been set for years. The person said one thing and I could not put it back where it was.",
    body: `A twenty-minute conversation two years ago changed something I had thought was settled. The person did not make an argument. They described something they had observed, and I could not fit it into my existing model.

I still think about that conversation. I am not sure I would have been ready for it a year earlier.`,
    reactions: { think: 20, changed: 31, felt: 22, door: 4 },
  },

  {
    id: "moses-3",
    user: U_moses,
    dayLabel: "7d ago",
    promptText: "What is something you have been avoiding, and what would happen if you stopped?",
    mediaType: "photo",
    photoGradient: ["#1a0a1a", "#0d070d"],
    timeAgo: "5d",
    preview: "Avoiding the honest version of what I want to do has become a habit. I do not think habits formed through avoidance are ones worth keeping.",
    body: `Avoidance has a texture. For me it feels like productivity: I stay busy with things adjacent to the thing I am not doing. I can go weeks without touching the actual problem.

When I stop avoiding it, usually what happens is the thing is not as hard as I feared. The avoidance was protecting something that did not need protection.`,
    reactions: { think: 31, changed: 13, felt: 31, door: 11 },
  },

  {
    id: "moses-4",
    user: U_moses,
    dayLabel: "6d ago",
    promptText: "What does your inner voice say when you fail? Where did it learn that?",
    mediaType: "audio",
    audioDuration: "3:24",
    timeAgo: "4d",
    preview: "The voice that shows up when I fail sounds like someone who needed me to be more in order to feel safe. I have been trying to figure out who taught it that.",
    body: `The voice that shows up when I fail sounds like it learned its script from someone who needed me to be invulnerable. I was not allowed to fail in certain contexts. So the voice decided to prevent failure by making it catastrophic.

Understanding that origin has not made the voice quieter. But it has made it less authoritative.`,
    reactions: { think: 42, changed: 26, felt: 40, door: 18 },
  },

  {
    id: "moses-5",
    user: U_moses,
    dayLabel: "5d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "3d",
    preview: "The version of me in professional contexts is assembled and ready. The real version is still figuring out whether the assembly was done right.",
    body: `The version of me in public contexts knows what to say. The private version is less certain and spends more time questioning whether the confident version has it right.

I do not know if the gap fully closes. I think closing it a little at a time is probably the right project.`,
    reactions: { think: 6, changed: 8, felt: 6, door: 25 },
  },

  {
    id: "vivian-1",
    user: U_vivian,
    dayLabel: "4d ago",
    promptText: "What is the gap between how you present yourself and who you actually are?",
    mediaType: "text",
    timeAgo: "2d",
    preview: "There is a layer of certainty in how I come across publicly that the private version of me does not have. I am trying to close that gap.",
    body: `There is a layer of readiness I project that the actual daily version of me does not always feel. The assembled version shows up for introductions. The real version is still assembling.

I think the goal is to make the real version interesting enough that it does not need assembly.`,
    reactions: { think: 16, changed: 21, felt: 18, door: 8 },
  },

  {
    id: "vivian-2",
    user: U_vivian,
    dayLabel: "3d ago",
    promptText: "Describe a belief you held for years that you are no longer sure about.",
    mediaType: "text",
    timeAgo: "1d",
    preview: "A belief I held for years: intelligence would protect me from most serious mistakes. It does not. It just makes the mistakes more elaborate.",
    body: `For a long time I thought intelligence was the primary factor in avoiding serious mistakes. I have accumulated enough evidence against this that I have had to revise the model.

What I think now: intelligence mostly helps you build more convincing justifications for what you already wanted to do. The hard part is wanting the right things.`,
    reactions: { think: 27, changed: 3, felt: 27, door: 15 },
  },

  {
    id: "vivian-3",
    user: U_vivian,
    dayLabel: "2d ago",
    promptText: "What would you do differently if no one was watching your metrics?",
    mediaType: "photo",
    photoGradient: ["#2a1a0a", "#140d05"],
    timeAgo: "8h",
    preview: "If no one could see my output, I would spend twice as long on the things that are hard to measure and half as long on the things that are easy to report.",
    body: `If no one could see my output metrics, I would spend most of my time on the work that is hard to measure. The things I can report on are not always the things that matter most.

What I track externally and what I actually care about are not perfectly aligned. I am trying to close that gap by being more honest about which is which.`,
    reactions: { think: 38, changed: 16, felt: 36, door: 22 },
  },

  {
    id: "vivian-4",
    user: U_vivian,
    dayLabel: "Yesterday",
    promptText: "What are you building toward that you almost never say out loud?",
    mediaType: "audio",
    audioDuration: "1:36",
    timeAgo: "5h",
    preview: "I want to make something that feels necessary. Not useful in a transactional way. Necessary in the way that certain books feel necessary.",
    body: `The version of my work I almost never say out loud: I want it to change how someone thinks, not just what they can do. That is a different target than what most of my current projects aim at.

I am trying to figure out how to build toward it more directly.`,
    reactions: { think: 49, changed: 29, felt: 45, door: 2 },
  },

  {
    id: "vivian-5",
    user: U_vivian,
    dayLabel: "Today",
    promptText: "What are you afraid of that you rarely talk about?",
    mediaType: "text",
    timeAgo: "2h",
    preview: "The fear I do not say out loud is not failure. It is succeeding at the wrong things for so long I forget to course correct.",
    body: `The fear is not failure. I have a decent relationship with failure. The fear is a particular kind of success: looking up at 35 and realizing I optimized for the wrong output for a decade.

I think about this most when I am busy. Busyness feels like momentum. I am not always sure it is.`,
    reactions: { think: 13, changed: 11, felt: 11, door: 9 },
  },
];
