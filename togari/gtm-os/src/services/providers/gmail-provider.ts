/**
 * @togari/bma-content/services/providers/gmail-provider
 * ToolProvider implementation for Gmail email operations
 * Operations: send, draft, schedule
 */

import { BaseToolProvider, HealthCheckResult } from './tool-provider';

interface GmailSendParams {
  to: string | string[];
  subject: string;
  body: string;
  html?: boolean;
  cc?: string[];
  bcc?: string[];
}

interface GmailDraftParams {
  to: string | string[];
  subject: string;
  body: string;
  html?: boolean;
}

interface GmailScheduleParams {
  to: string | string[];
  subject: string;
  body: string;
  send_at: Date | string; // ISO 8601 or Date
  html?: boolean;
}

export class GmailProvider extends BaseToolProvider {
  name = 'Gmail';
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private apiBase = 'https://www.googleapis.com/gmail/v1';
  private dailyLimitResetTime: Date | null = null;
  private emailsSentToday = 0;
  private maxEmailsPerDay = 1000; // Gmail's soft limit

  constructor(accessToken?: string, refreshToken?: string) {
    super();
    this.accessToken = accessToken || process.env.GMAIL_ACCESS_TOKEN || null;
    this.refreshToken = refreshToken || process.env.GMAIL_REFRESH_TOKEN || null;
    if (!this.accessToken) {
      console.warn('GmailProvider: GMAIL_ACCESS_TOKEN not configured');
    }
  }

  async execute<T = any>(operation: string, params: Record<string, any>): Promise<T> {
    const startTime = Date.now();

    try {
      if (!this.accessToken) {
        throw new Error('GMAIL_ACCESS_TOKEN not configured');
      }

      let result: T;

      switch (operation) {
        case 'send':
          result = (await this.send(params as GmailSendParams)) as T;
          break;
        case 'draft':
          result = (await this.draft(params as GmailDraftParams)) as T;
          break;
        case 'schedule':
          result = (await this.schedule(params as GmailScheduleParams)) as T;
          break;
        default:
          throw new Error(`Unknown Gmail operation: ${operation}`);
      }

      const latency = Date.now() - startTime;
      this.recordMetric(operation, latency);
      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.recordMetric(operation, latency);
      throw error;
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      if (!this.accessToken) {
        return {
          healthy: false,
          latency_ms: 0,
          error: 'GMAIL_ACCESS_TOKEN not configured',
          lastChecked: new Date(),
        };
      }

      // Check token validity by calling the profile endpoint
      const res = await fetch(`${this.apiBase}/users/me/profile`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });

      const latency_ms = Date.now() - startTime;

      if (!res.ok) {
        // Try to refresh token if 401
        if (res.status === 401 && this.refreshToken) {
          await this.refreshAccessToken();
          return {
            healthy: true,
            latency_ms,
            lastChecked: new Date(),
          };
        }

        return {
          healthy: false,
          latency_ms,
          error: `HTTP ${res.status}`,
          lastChecked: new Date(),
        };
      }

      return {
        healthy: true,
        latency_ms,
        lastChecked: new Date(),
      };
    } catch (error) {
      const latency_ms = Date.now() - startTime;
      return {
        healthy: false,
        latency_ms,
        error: error instanceof Error ? error.message : String(error),
        lastChecked: new Date(),
      };
    }
  }

  async fallback<T = any>(operation: string, params: Record<string, any>): Promise<T> {
    // Return queued/pending result
    switch (operation) {
      case 'send':
        return {
          messageId: null,
          status: 'queued',
          fallback: true,
        } as T;
      case 'draft':
        return {
          draftId: null,
          status: 'queued',
          fallback: true,
        } as T;
      case 'schedule':
        return {
          messageId: null,
          status: 'scheduled_queued',
          fallback: true,
        } as T;
      default:
        throw new Error(`No fallback for Gmail.${operation}`);
    }
  }

  /**
   * Send an email immediately
   */
  private async send(params: GmailSendParams): Promise<Record<string, any>> {
    this.resetDailyLimitIfNeeded();
    if (this.emailsSentToday >= this.maxEmailsPerDay) {
      throw new Error(`Gmail daily limit (${this.maxEmailsPerDay}) reached`);
    }

    const message = this.buildMessage(params);

    const res = await fetch(`${this.apiBase}/users/me/messages/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: Buffer.from(message).toString('base64') }),
    });

    if (!res.ok) {
      throw new Error(`Gmail send failed: ${res.status}`);
    }

    this.emailsSentToday++;
    const result = await res.json();
    return {
      messageId: (result as any).id,
      status: 'sent',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Save an email as a draft
   */
  private async draft(params: GmailDraftParams): Promise<Record<string, any>> {
    const message = this.buildMessage(params);

    const res = await fetch(`${this.apiBase}/users/me/drafts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: { raw: Buffer.from(message).toString('base64') } }),
    });

    if (!res.ok) {
      throw new Error(`Gmail draft failed: ${res.status}`);
    }

    const result = await res.json();
    return {
      draftId: (result as any).id,
      status: 'draft',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Schedule an email to be sent at a future time
   */
  private async schedule(params: GmailScheduleParams): Promise<Record<string, any>> {
    // Note: Gmail doesn't have native scheduled send in the API.
    // This is a placeholder for integration with a scheduling system.
    const sendAt = new Date(params.send_at);

    const message = this.buildMessage({
      to: params.to,
      subject: params.subject,
      body: params.body,
      html: params.html,
    });

    return {
      messageId: null,
      status: 'scheduled',
      send_at: sendAt.toISOString(),
      message: Buffer.from(message).toString('base64'),
      note: 'Actual scheduling requires a separate scheduled-send service',
    };
  }

  /**
   * Build a MIME message from email parameters
   */
  private buildMessage(params: GmailSendParams | GmailDraftParams): string {
    const recipients = Array.isArray(params.to) ? params.to.join(', ') : params.to;
    const contentType = params.html ? 'text/html' : 'text/plain';

    let message = '';
    message += `To: ${recipients}\n`;
    message += `Subject: ${params.subject}\n`;

    if ('cc' in params && params.cc?.length) {
      message += `Cc: ${params.cc.join(', ')}\n`;
    }
    if ('bcc' in params && params.bcc?.length) {
      message += `Bcc: ${params.bcc.join(', ')}\n`;
    }

    message += `Content-Type: ${contentType}; charset="UTF-8"\n`;
    message += 'Content-Transfer-Encoding: 7bit\n\n';
    message += params.body;

    return message;
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Gmail client credentials not configured');
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      throw new Error(`Token refresh failed: ${res.status}`);
    }

    const data = await res.json();
    this.accessToken = (data as any).access_token;
    this.tokenExpiry = new Date(Date.now() + (data as any).expires_in * 1000);
  }

  /**
   * Reset daily counter at midnight UTC
   */
  private resetDailyLimitIfNeeded(): void {
    const now = new Date();
    const today = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    if (!this.dailyLimitResetTime || this.dailyLimitResetTime < today) {
      this.dailyLimitResetTime = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      this.emailsSentToday = 0;
    }
  }
}
