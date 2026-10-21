export const onboardingPrompts = {
  family: { title: 'Who is in your family?', detail: 'The people who feel like home. Tell us their names, how you’re related, and what matters to them.' },
  nearby: { title: 'Who lives near you?', detail: 'Friends around the corner, a neighbor, your weekend crew. Who would you like to see more often?' },
  priorities: { title: 'Who matters this month?', detail: 'Love, family, fitness, work, learning or faith. What would you like more of this month, and who could help?' },
};
export type OnboardingPrompt = keyof typeof onboardingPrompts;
export const connectionPriorities = ['romantic', 'family', 'fitness', 'professional', 'academic', 'religious'] as const;
export function promptMemoTitle(prompt: OnboardingPrompt) { return 'Getting to know you · ' + onboardingPrompts[prompt].title; }
