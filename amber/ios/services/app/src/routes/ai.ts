import { FastifyInstance } from 'fastify';
import { authenticate, AuthenticatedRequest } from '../auth/middleware.js';

/**
 * AI routes: streaming LLM responses
 */
export async function registerAiRoutes(app: FastifyInstance) {
  /**
   * GET /ai/stream
   * Stream AI responses (SSE) for authenticated user
   */
  app.get('/ai/stream', { preHandler: authenticate }, async (req: AuthenticatedRequest, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    const encoder = new TextEncoder();
    function send(event: string, data: string) {
      const chunk = `event: ${event}\ndata: ${data}\n\n`;
      reply.raw.write(encoder.encode(chunk));
    }

    send('message', JSON.stringify({ type: 'start' }));
    send('message', JSON.stringify({ token: 'hello' }));
    send('message', JSON.stringify({ token: ' world' }));
    send('message', JSON.stringify({ type: 'done' }));
    reply.raw.end();
    return reply;
  });
}



