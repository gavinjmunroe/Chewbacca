import { callMedhaId, type MedhaIdResult } from './medhaId';

// Amber Questions (in-app Q&A loop) REST surface on medha-id. Same authed
// transport + typed {ok} envelope as lib/connect.ts — callers branch on
// `res.ok` the same way. This feature talks ONLY to medha-id via callMedhaId;
// it shares nothing with the AgentChat/ChatSurface (medha-platform) networking.

export type AnswerType = 'text' | 'multiple_choice';

export type AnswerVisibility = 'private' | 'network';

export type InboxItem = {
  threadId: string;
  questionId: string;
  prompt: string;
  answerType: AnswerType;
  options: string[] | null;
  createdAt: string;
};

export type QuestionThread = {
  id: string;
  questionId: string;
  kind: string;
  createdAt: string;
};

export type ThreadMessage = {
  id: string;
  threadId: string;
  role: 'amber' | 'user';
  content: string;
  createdAt: string;
};

export type Answer = {
  id: string;
  answerType: AnswerType;
  answerText: string | null;
  answerChoice: string | null;
  visibility: AnswerVisibility;
};

export function getInbox(): Promise<MedhaIdResult<{ questions: InboxItem[] }>> {
  return callMedhaId<{ questions: InboxItem[] }>({
    path: '/v1/me/questions/inbox',
    method: 'GET',
    requireAuth: true,
  });
}

export function getThread(
  id: string,
): Promise<MedhaIdResult<{ thread: QuestionThread; messages: ThreadMessage[] }>> {
  return callMedhaId<{ thread: QuestionThread; messages: ThreadMessage[] }>({
    path: `/v1/me/questions/threads/${encodeURIComponent(id)}`,
    method: 'GET',
    requireAuth: true,
  });
}

export function sendThreadMessage(
  id: string,
  content: string,
): Promise<MedhaIdResult<{ userMessage: ThreadMessage; amberMessage: ThreadMessage | null }>> {
  return callMedhaId<{ userMessage: ThreadMessage; amberMessage: ThreadMessage | null }>({
    path: `/v1/me/questions/threads/${encodeURIComponent(id)}/messages`,
    method: 'POST',
    body: { content },
    requireAuth: true,
  });
}

export function suggestAnswer(id: string): Promise<
  MedhaIdResult<{
    answered: boolean;
    suggestedAnswer: string | null;
    suggestedChoice: string | null;
    answerType: AnswerType;
    options: string[] | null;
  }>
> {
  return callMedhaId<{
    answered: boolean;
    suggestedAnswer: string | null;
    suggestedChoice: string | null;
    answerType: AnswerType;
    options: string[] | null;
  }>({
    path: `/v1/me/questions/threads/${encodeURIComponent(id)}/suggest-answer`,
    method: 'POST',
    requireAuth: true,
  });
}

export function submitAnswer(
  id: string,
  input: {
    answerType: AnswerType;
    answerText?: string;
    answerChoice?: string;
    visibility: AnswerVisibility;
  },
): Promise<MedhaIdResult<{ answer: Answer }>> {
  return callMedhaId<{ answer: Answer }>({
    path: `/v1/me/questions/threads/${encodeURIComponent(id)}/answer`,
    method: 'POST',
    body: input,
    requireAuth: true,
  });
}

export function setAnswerVisibility(
  answerId: string,
  visibility: AnswerVisibility,
): Promise<MedhaIdResult<{ answer: Answer }>> {
  return callMedhaId<{ answer: Answer }>({
    path: `/v1/me/answers/${encodeURIComponent(answerId)}/visibility`,
    method: 'PATCH',
    body: { visibility },
    requireAuth: true,
  });
}
