import { streamChat } from './chat';
import { callMedhaId } from './medhaId';
import { randomUUID } from 'expo-crypto';
/** The active Main chat handles research/drafting. It cannot operate a computer or send messages. */
export async function runCaptureTask(text: string): Promise<string> {
  let answer = '',
    failed = false,
    completed = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    await streamChat(
      `Help with this request by researching, drafting, or explaining the next steps. Do not claim that anything was sent, booked, or executed on a computer.\n\nRequest: ${text}`,
      {
        signal: controller.signal,
        followUp: true,
        source: 'soundboard',
        onEvent: (event) => {
          if (event.type === 'token') answer += event.text;
          if (event.type === 'clarify' || event.type === 'soft_confirm') answer += event.question;
          if (event.type === 'error') failed = true;
          if (event.type === 'complete') completed = true;
        },
      },
    );
    if (failed || !completed || !answer.trim())
      throw Error('Amber’s response was not confirmed. Your request is still here.');
    const saved = await callMedhaId({
      path: `/v1/me/journal/${encodeURIComponent(randomUUID())}`,
      method: 'PUT',
      requireAuth: true,
      body: {
        text: `Amber request: ${text}\n\n${answer}`.slice(0, 32000),
        voice: false,
        createdAt: new Date().toISOString(),
      },
    });
    return `${answer}${saved.ok ? '\n\nSaved to your journal.' : '\n\nResponse received; journal backup could not be confirmed.'}`;
  } finally {
    clearTimeout(timer);
  }
}
