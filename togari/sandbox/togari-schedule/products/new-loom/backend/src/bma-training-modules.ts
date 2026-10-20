import type { TransformRule, VocabularyMapping } from '../../shared/src/types';

// ── Professional Vocabulary Mappings ──────────────────────────────────────────

export const VOCABULARY_MAPPINGS: VocabularyMapping[] = [
  { casual: 'look at', professional: 'analyze', context: 'examining data or situations' },
  { casual: 'look into', professional: 'investigate', context: 'researching a topic' },
  { casual: 'big', professional: 'significant', context: 'describing magnitude' },
  { casual: 'huge', professional: 'substantial', context: 'describing scale' },
  { casual: 'small', professional: 'marginal', context: 'describing limited impact' },
  { casual: 'think', professional: 'hypothesize', context: 'proposing ideas' },
  { casual: 'think about', professional: 'consider', context: 'evaluating options' },
  { casual: 'do', professional: 'execute', context: 'performing actions' },
  { casual: 'get', professional: 'obtain', context: 'acquiring resources' },
  { casual: 'get better', professional: 'optimize', context: 'improving performance' },
  { casual: 'fix', professional: 'remediate', context: 'addressing issues' },
  { casual: 'try', professional: 'pilot', context: 'testing approaches' },
  { casual: 'use', professional: 'leverage', context: 'utilizing resources' },
  { casual: 'help', professional: 'facilitate', context: 'enabling outcomes' },
  { casual: 'show', professional: 'demonstrate', context: 'presenting evidence' },
  { casual: 'tell', professional: 'communicate', context: 'sharing information' },
  { casual: 'talk about', professional: 'discuss', context: 'addressing topics' },
  { casual: 'figure out', professional: 'determine', context: 'reaching conclusions' },
  { casual: 'set up', professional: 'establish', context: 'creating structures' },
  { casual: 'come up with', professional: 'develop', context: 'creating solutions' },
  { casual: 'deal with', professional: 'address', context: 'handling challenges' },
  { casual: 'kind of', professional: '', context: 'hedge word — remove' },
  { casual: 'sort of', professional: '', context: 'hedge word — remove' },
  { casual: 'a lot of', professional: 'numerous', context: 'quantity description' },
  { casual: 'stuff', professional: 'components', context: 'describing elements' },
  { casual: 'things', professional: 'factors', context: 'describing elements' },
  { casual: 'good', professional: 'effective', context: 'quality assessment' },
  { casual: 'bad', professional: 'suboptimal', context: 'quality assessment' },
  { casual: 'problem', professional: 'challenge', context: 'describing obstacles' },
  { casual: 'hard', professional: 'complex', context: 'describing difficulty' },
  { casual: 'easy', professional: 'straightforward', context: 'describing simplicity' },
  { casual: 'fast', professional: 'accelerated', context: 'describing speed' },
  { casual: 'slow', professional: 'measured', context: 'describing pace' },
  { casual: 'make sure', professional: 'ensure', context: 'guaranteeing outcomes' },
  { casual: 'find out', professional: 'ascertain', context: 'discovering information' },
  { casual: 'point out', professional: 'highlight', context: 'drawing attention' },
  { casual: 'keep in mind', professional: 'note', context: 'important considerations' },
  { casual: 'at the end of the day', professional: 'ultimately', context: 'concluding' },
  { casual: 'going forward', professional: 'prospectively', context: 'future actions' },
  { casual: 'bottom line', professional: 'net impact', context: 'final assessment' },
  { casual: 'game changer', professional: 'paradigm shift', context: 'major change' },
  { casual: 'take a step back', professional: 'reassess', context: 'reconsidering approach' },
  { casual: 'move the needle', professional: 'drive measurable impact', context: 'creating results' },
  { casual: 'low-hanging fruit', professional: 'quick wins', context: 'easy opportunities' },
  { casual: 'deep dive', professional: 'comprehensive analysis', context: 'detailed examination' },
];

// ── Filler Words and Phrases ──────────────────────────────────────────────────

export const FILLER_WORDS: string[] = [
  'um',
  'uh',
  'like',
  'you know',
  'basically',
  'literally',
  'actually',
  'right',
  'so yeah',
  'I mean',
  'kind of like',
  'sort of like',
  'pretty much',
  'more or less',
  'I guess',
  'to be honest',
  'honestly',
  'obviously',
  'clearly',
  'essentially',
  'just',
  'really',
  'very',
  'totally',
  'absolutely',
  'definitely',
  'anyway',
  'anyways',
  'well',
  'okay so',
  'alright so',
];

// ── Hedge Phrase Strengthening ────────────────────────────────────────────────

export const HEDGE_REPLACEMENTS: Array<{ hedge: string; strong: string }> = [
  { hedge: 'I think maybe', strong: 'Our analysis indicates' },
  { hedge: 'I think', strong: 'Our assessment suggests' },
  { hedge: 'maybe we could', strong: 'we recommend' },
  { hedge: 'we might want to', strong: 'we should' },
  { hedge: 'it seems like', strong: 'the data shows' },
  { hedge: 'it looks like', strong: 'evidence indicates' },
  { hedge: 'I feel like', strong: 'the analysis demonstrates' },
  { hedge: 'I believe', strong: 'the evidence supports' },
  { hedge: 'probably', strong: 'likely' },
  { hedge: 'possibly', strong: 'in select scenarios' },
  { hedge: 'I would say', strong: 'our position is' },
  { hedge: 'in my opinion', strong: 'based on our analysis' },
  { hedge: 'it could be that', strong: 'one hypothesis is that' },
  { hedge: 'we could potentially', strong: 'we propose to' },
  { hedge: 'there might be', strong: 'we have identified' },
  { hedge: 'it\'s worth noting that', strong: 'critically' },
  { hedge: 'we should probably', strong: 'we recommend' },
];

// ── McKinsey Structural Frameworks ────────────────────────────────────────────

export const MECE_FRAMEWORK_PROMPT = `
Apply the MECE (Mutually Exclusive, Collectively Exhaustive) framework:
1. Identify the core categories being discussed
2. Ensure each category is distinct and non-overlapping (Mutually Exclusive)
3. Ensure all categories together cover the full scope (Collectively Exhaustive)
4. Structure the argument so each point belongs to exactly one category
5. Use clear transitions between categories: "First...", "Second...", "Finally..."
6. If the original content has overlapping points, restructure them into clean buckets
`;

export const PYRAMID_PRINCIPLE_PROMPT = `
Apply the Pyramid Principle (Barbara Minto / McKinsey):
1. Lead with the answer — state the key recommendation or conclusion first
2. Follow with 3 supporting arguments grouped logically
3. Each supporting argument should have its own evidence
4. Structure: Answer → Key Line Arguments → Supporting Data
5. The audience should understand the main point within the first 10 seconds
6. Use "So what?" to test each point — if it doesn't advance the argument, cut it
`;

export const SCR_STRUCTURE_PROMPT = `
Apply the Situation-Complication-Resolution (SCR) framework:
1. SITUATION: State the current context that the audience already agrees with
2. COMPLICATION: Identify what changed or what's at stake — the tension point
3. RESOLUTION: Present the recommendation that addresses the complication
4. Keep the Situation brief (1-2 sentences)
5. Make the Complication specific and urgent
6. Make the Resolution actionable with clear next steps
`;

export const ACTION_ORIENTATION_PROMPT = `
Apply action-oriented communication principles:
1. Convert passive voice to active voice ("was decided" → "we decided")
2. Replace vague statements with specific, quantified claims where possible
3. Add "by [date]" or "within [timeframe]" to commitments
4. Replace "we need to" with "we will" or "our next step is"
5. End every section with a clear action item or decision point
6. Use command verbs: analyze, implement, deliver, accelerate, drive
`;

// ── Combined Transform Prompt ─────────────────────────────────────────────────

export function buildTransformPrompt(
  originalText: string,
  targetStructure: 'pyramid' | 'scr' | 'mece' | 'auto'
): string {
  const structurePrompt =
    targetStructure === 'pyramid' ? PYRAMID_PRINCIPLE_PROMPT :
    targetStructure === 'scr' ? SCR_STRUCTURE_PROMPT :
    targetStructure === 'mece' ? MECE_FRAMEWORK_PROMPT :
    `Choose the most appropriate structure (Pyramid Principle, SCR, or MECE) based on the content. Explain which you chose and why.`;

  const vocabExamples = VOCABULARY_MAPPINGS
    .slice(0, 15)
    .map(v => `  "${v.casual}" → "${v.professional}"`)
    .join('\n');

  const fillerList = FILLER_WORDS.slice(0, 15).join(', ');

  const hedgeExamples = HEDGE_REPLACEMENTS
    .slice(0, 8)
    .map(h => `  "${h.hedge}" → "${h.strong}"`)
    .join('\n');

  return `You are a McKinsey-trained communication coach. Transform the following transcript into a polished, professional script suitable for a business presentation or executive update.

## STRUCTURAL FRAMEWORK
${structurePrompt}

## VOCABULARY UPGRADE
Replace casual language with professional equivalents:
${vocabExamples}

## FILLER REMOVAL
Remove all filler words and phrases: ${fillerList}, etc.

## HEDGE STRENGTHENING
Replace weak hedge phrases with confident, evidence-based language:
${hedgeExamples}

## ACTION ORIENTATION
${ACTION_ORIENTATION_PROMPT}

## RULES
- Maintain the original meaning and intent
- Keep the speaker's personality while elevating the professionalism
- Do not add information that wasn't in the original
- Preserve any specific data points, names, dates, or figures mentioned
- The output should be speakable — not academic or stiff, but polished and commanding
- Aim for approximately the same duration when spoken aloud
- Use natural paragraph breaks for breathing/emphasis points

## ORIGINAL TRANSCRIPT
${originalText}

## OUTPUT FORMAT
Return a JSON object with these fields:
{
  "transformedText": "The full transformed script",
  "structureUsed": "pyramid_principle | scr_structure | mece_framework",
  "transformationsApplied": [
    {
      "moduleType": "professional_vocabulary | filler_removal | hedge_strengthening | action_orientation | pyramid_principle | scr_structure | mece_framework",
      "originalSnippet": "original text snippet",
      "transformedSnippet": "transformed text snippet",
      "explanation": "why this change was made"
    }
  ],
  "improvementScore": 0-100
}`;
}

// ── Export all transform rules for reference ──────────────────────────────────

export function getAllTransformRules(): TransformRule[] {
  const rules: TransformRule[] = [];

  // Vocabulary rules
  for (const mapping of VOCABULARY_MAPPINGS) {
    rules.push({
      moduleType: 'professional_vocabulary',
      description: `Replace "${mapping.casual}" with "${mapping.professional}"`,
      pattern: mapping.casual,
      replacement: mapping.professional,
      instruction: mapping.context,
    });
  }

  // Filler removal rules
  for (const filler of FILLER_WORDS) {
    rules.push({
      moduleType: 'filler_removal',
      description: `Remove filler word/phrase: "${filler}"`,
      pattern: filler,
      replacement: '',
    });
  }

  // Hedge strengthening rules
  for (const hedge of HEDGE_REPLACEMENTS) {
    rules.push({
      moduleType: 'hedge_strengthening',
      description: `Strengthen: "${hedge.hedge}" → "${hedge.strong}"`,
      pattern: hedge.hedge,
      replacement: hedge.strong,
    });
  }

  // Framework rules
  rules.push({
    moduleType: 'mece_framework',
    description: 'Apply MECE (Mutually Exclusive, Collectively Exhaustive) structure',
    instruction: MECE_FRAMEWORK_PROMPT,
  });

  rules.push({
    moduleType: 'pyramid_principle',
    description: 'Apply Pyramid Principle: lead with the answer',
    instruction: PYRAMID_PRINCIPLE_PROMPT,
  });

  rules.push({
    moduleType: 'scr_structure',
    description: 'Apply Situation-Complication-Resolution structure',
    instruction: SCR_STRUCTURE_PROMPT,
  });

  rules.push({
    moduleType: 'action_orientation',
    description: 'Convert to action-oriented communication',
    instruction: ACTION_ORIENTATION_PROMPT,
  });

  return rules;
}

// ── Quick local transform (no LLM needed) ────────────────────────────────────

export function quickLocalTransform(text: string): {
  transformed: string;
  changes: Array<{ original: string; replacement: string; type: string }>;
} {
  let transformed = text;
  const changes: Array<{ original: string; replacement: string; type: string }> = [];

  // Remove filler words (case-insensitive, word boundary aware)
  for (const filler of FILLER_WORDS) {
    const regex = new RegExp(`\\b${escapeRegex(filler)}\\b[,\\s]*`, 'gi');
    const matches = transformed.match(regex);
    if (matches) {
      for (const match of matches) {
        changes.push({ original: match.trim(), replacement: '', type: 'filler_removal' });
      }
      transformed = transformed.replace(regex, ' ');
    }
  }

  // Apply vocabulary mappings
  for (const mapping of VOCABULARY_MAPPINGS) {
    if (!mapping.professional) continue; // skip removals (handled by hedge)
    const regex = new RegExp(`\\b${escapeRegex(mapping.casual)}\\b`, 'gi');
    const matches = transformed.match(regex);
    if (matches) {
      for (const match of matches) {
        changes.push({
          original: match,
          replacement: mapping.professional,
          type: 'professional_vocabulary',
        });
      }
      transformed = transformed.replace(regex, mapping.professional);
    }
  }

  // Apply hedge strengthening
  for (const hedge of HEDGE_REPLACEMENTS) {
    const regex = new RegExp(escapeRegex(hedge.hedge), 'gi');
    const matches = transformed.match(regex);
    if (matches) {
      for (const match of matches) {
        changes.push({
          original: match,
          replacement: hedge.strong,
          type: 'hedge_strengthening',
        });
      }
      transformed = transformed.replace(regex, hedge.strong);
    }
  }

  // Clean up multiple spaces
  transformed = transformed.replace(/\s{2,}/g, ' ').trim();

  return { transformed, changes };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
