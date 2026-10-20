/**
 * @togari/bma-content/services/providers/calendar-provider
 * ToolProvider implementation for Google Calendar operations
 * Operations: events, freebusy
 */

import { BaseToolProvider, HealthCheckResult } from './tool-provider';

interface CalendarEventsParams {
  calendarId?: string;
  timeMin?: string; // ISO 8601
  timeMax?: string;
  maxResults?: number;
  q?: string; // Search query
}

interface CalendarFreebusyParams {
  calendars: string[];
  timeMin: string; // ISO 8601
  timeMax: string;
}

export class CalendarProvider extends BaseToolProvider {
  name = 'Calendar';
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private apiBase = 'https://www.googleapis.com/calendar/v3';

  constructor(accessToken?: string, refreshToken?: string) {
    super();
    this.accessToken = accessToken || process.env.GOOGLE_CALENDAR_ACCESS_TOKEN || null;
    this.refreshToken = refreshToken || process.env.GOOGLE_CALENDAR_REFRESH_TOKEN || null;
    if (!this.accessToken) {
      console.warn('CalendarProvider: GOOGLE_CALENDAR_ACCESS_TOKEN not configured');
    }
  }

  async execute<T = any>(operation: string, params: Record<string, any>): Promise<T> {
    const startTime = Date.now();

    try {
      if (!this.accessToken) {
        throw new Error('GOOGLE_CALENDAR_ACCESS_TOKEN not configured');
      }

      let result: T;

      switch (operation) {
        case 'events':
          result = (await this.listEvents(params as CalendarEventsParams)) as T;
          break;
        case 'freebusy':
          result = (await this.queryFreebusy(params as CalendarFreebusyParams)) as T;
          break;
        default:
          throw new Error(`Unknown Calendar operation: ${operation}`);
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
          error: 'GOOGLE_CALENDAR_ACCESS_TOKEN not configured',
          lastChecked: new Date(),
        };
      }

      // Check token validity by listing primary calendar
      const res = await fetch(`${this.apiBase}/calendars/primary`, {
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
    // Return empty results
    switch (operation) {
      case 'events':
        return {
          events: [],
          fallback: true,
        } as T;
      case 'freebusy':
        return {
          calendars: {},
          fallback: true,
        } as T;
      default:
        throw new Error(`No fallback for Calendar.${operation}`);
    }
  }

  /**
   * List events from a calendar
   */
  private async listEvents(params: CalendarEventsParams): Promise<Record<string, any>> {
    const calendarId = params.calendarId || 'primary';
    const queryParams = new URLSearchParams();

    if (params.timeMin) queryParams.set('timeMin', params.timeMin);
    if (params.timeMax) queryParams.set('timeMax', params.timeMax);
    if (params.maxResults) queryParams.set('maxResults', String(params.maxResults));
    if (params.q) queryParams.set('q', params.q);

    const url = `${this.apiBase}/calendars/${encodeURIComponent(calendarId)}/events?${queryParams}`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Calendar listEvents failed: ${res.status}`);
    }

    const data = await res.json();
    return {
      events: (data as any).items || [],
      nextPageToken: (data as any).nextPageToken,
    };
  }

  /**
   * Query freebusy for multiple calendars
   */
  private async queryFreebusy(params: CalendarFreebusyParams): Promise<Record<string, any>> {
    const { calendars, timeMin, timeMax } = params;

    const body = {
      timeMin,
      timeMax,
      items: calendars.map(id => ({ id })),
    };

    const res = await fetch(`${this.apiBase}/freeBusy`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Calendar queryFreebusy failed: ${res.status}`);
    }

    const data = await res.json();
    return {
      calendars: (data as any).calendars,
      timeMin,
      timeMax,
    };
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Google client credentials not configured');
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
}
