/**
 * In-memory meeting store (swap for Firestore in prod, same pattern as New Loom)
 */

import type { Meeting, Transcript, MeetingSummary, ActionItem, DealIntelligence } from '../../shared/src/types';

class MeetingStore {
  private meetings: Map<string, Meeting> = new Map();

  create(meeting: Meeting): void {
    this.meetings.set(meeting.id, meeting);
  }

  get(id: string): Meeting | undefined {
    return this.meetings.get(id);
  }

  list(): Meeting[] {
    return Array.from(this.meetings.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  update(id: string, fields: Partial<Meeting>): Meeting | undefined {
    const existing = this.meetings.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...fields, updatedAt: new Date().toISOString() };
    this.meetings.set(id, updated);
    return updated;
  }

  setTranscript(id: string, transcript: Transcript): void {
    const meeting = this.meetings.get(id);
    if (!meeting) return;
    meeting.transcript = transcript;
    meeting.status = 'transcribed';
    meeting.durationMs = transcript.durationMs;
    meeting.updatedAt = new Date().toISOString();
  }

  setSummary(id: string, summary: MeetingSummary): void {
    const meeting = this.meetings.get(id);
    if (!meeting) return;
    meeting.summary = summary;
    meeting.updatedAt = new Date().toISOString();
  }

  setActionItems(id: string, items: ActionItem[]): void {
    const meeting = this.meetings.get(id);
    if (!meeting) return;
    meeting.actionItems = items;
    meeting.updatedAt = new Date().toISOString();
  }

  setDealIntelligence(id: string, intel: DealIntelligence): void {
    const meeting = this.meetings.get(id);
    if (!meeting) return;
    meeting.dealIntelligence = intel;
    meeting.status = 'analyzed';
    meeting.updatedAt = new Date().toISOString();
  }

  delete(id: string): boolean {
    return this.meetings.delete(id);
  }

  search(query: string, limit = 20): Array<{ meeting: Meeting; matches: Array<{ text: string; speaker?: string; timestampMs: number }> }> {
    const q = query.toLowerCase();
    const results: Array<{ meeting: Meeting; matches: Array<{ text: string; speaker?: string; timestampMs: number }> }> = [];

    for (const meeting of this.meetings.values()) {
      if (!meeting.transcript) continue;
      const matches: Array<{ text: string; speaker?: string; timestampMs: number }> = [];
      for (const seg of meeting.transcript.segments) {
        if (seg.text.toLowerCase().includes(q)) {
          matches.push({ text: seg.text, speaker: seg.speaker, timestampMs: seg.startMs });
        }
      }
      if (matches.length > 0) {
        results.push({ meeting, matches });
      }
    }

    return results.slice(0, limit);
  }
}

export const store = new MeetingStore();
