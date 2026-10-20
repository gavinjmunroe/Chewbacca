import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logAudit, createAuditEntry } from '../audit-logger';

describe('audit-logger', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.HTTP_X_CLOUD_TRACE_CONTEXT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // =========================================================================
  // createAuditEntry()
  // =========================================================================

  describe('createAuditEntry()', () => {
    it('generates a valid UUID for audit_id', () => {
      const entry = createAuditEntry('search_patients', 'tenant-1', 'user-1', {}, 100, 'success');
      expect(entry.audit_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('sets audit field to string "true" (not boolean)', () => {
      const entry = createAuditEntry('search_patients', 'tenant-1', 'user-1', {}, 100, 'success');
      expect(entry.audit).toBe('true');
      expect(typeof entry.audit).toBe('string');
    });

    it('sets correct duration_ms', () => {
      const entry = createAuditEntry('search_patients', 'tenant-1', 'user-1', {}, 456, 'success');
      expect(entry.duration_ms).toBe(456);
    });

    it('sets success status', () => {
      const entry = createAuditEntry('search_patients', 'tenant-1', 'user-1', {}, 100, 'success');
      expect(entry.status).toBe('success');
    });

    it('sets error status with error_code', () => {
      const entry = createAuditEntry(
        'search_patients', 'tenant-1', 'user-1', {}, 100, 'error', 'RATE_LIMIT_EXCEEDED'
      );
      expect(entry.status).toBe('error');
      expect(entry.error_code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('omits error_code when not provided', () => {
      const entry = createAuditEntry('search_patients', 'tenant-1', 'user-1', {}, 100, 'success');
      expect(entry.error_code).toBeUndefined();
    });

    it('sets timestamp as ISO 8601 string', () => {
      const entry = createAuditEntry('search_patients', 'tenant-1', 'user-1', {}, 100, 'success');
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
    });

    it('includes client_id and user_id', () => {
      const entry = createAuditEntry('search_patients', 'org_abc', 'usr_xyz', {}, 100, 'success');
      expect(entry.client_id).toBe('org_abc');
      expect(entry.user_id).toBe('usr_xyz');
    });
  });

  // =========================================================================
  // Tool → entity/action mapping
  // =========================================================================

  describe('tool mapping', () => {
    const mappings: Array<[string, string, string]> = [
      ['create_patient', 'person', 'create'],
      ['get_patient', 'person', 'read'],
      ['update_patient', 'person', 'update'],
      ['search_patients', 'person', 'search'],
      ['enrich_contact', 'person', 'enrich'],
      ['enrich_company', 'company', 'enrich'],
      ['score_lead', 'person', 'score'],
      ['normalize_data', 'data', 'normalize'],
      ['query_data', 'data', 'query'],
      ['upload_file', 'file', 'upload'],
      ['process_file', 'file', 'process'],
      ['search_web', 'web', 'search'],
      ['health_check', 'system', 'health_check'],
    ];

    for (const [tool, entity, action] of mappings) {
      it(`maps ${tool} → entity_type=${entity}, action=${action}`, () => {
        const entry = createAuditEntry(tool, 'tenant', 'user', {}, 0, 'success');
        expect(entry.entity_type).toBe(entity);
        expect(entry.action).toBe(action);
      });
    }
  });

  // =========================================================================
  // inferEntityId()
  // =========================================================================

  describe('entity ID inference', () => {
    it('extracts person_id from args', () => {
      const entry = createAuditEntry('get_patient', 't', 'u', { person_id: 'p123' }, 0, 'success');
      expect(entry.entity_id).toBe('p123');
    });

    it('redacts identifier (could be email/name — PHI)', () => {
      const entry = createAuditEntry('enrich_contact', 't', 'u', { identifier: 'john@test.com' }, 0, 'success');
      expect(entry.entity_id).toBe('[redacted]');
      expect(entry.entity_id).not.toContain('john');
    });

    it('extracts domain from args', () => {
      const entry = createAuditEntry('enrich_company', 't', 'u', { domain: 'acme.com' }, 0, 'success');
      expect(entry.entity_id).toBe('acme.com');
    });

    it('extracts file_name from args', () => {
      const entry = createAuditEntry('upload_file', 't', 'u', { file_name: 'data.csv' }, 0, 'success');
      expect(entry.entity_id).toBe('data.csv');
    });

    it('returns undefined when no identifiable args', () => {
      const entry = createAuditEntry('health_check', 't', 'u', {}, 0, 'success');
      expect(entry.entity_id).toBeUndefined();
    });
  });

  // =========================================================================
  // logAudit() — stdout output
  // =========================================================================

  describe('logAudit()', () => {
    it('writes to process.stdout', () => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const entry = createAuditEntry('health_check', 't', 'u', {}, 0, 'success');
      logAudit(entry);
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it('outputs valid JSON', () => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const entry = createAuditEntry('health_check', 't', 'u', {}, 0, 'success');
      logAudit(entry);
      const output = (spy.mock.calls[0][0] as string).trim();
      expect(() => JSON.parse(output)).not.toThrow();
      spy.mockRestore();
    });

    it('output ends with newline', () => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const entry = createAuditEntry('health_check', 't', 'u', {}, 0, 'success');
      logAudit(entry);
      const output = spy.mock.calls[0][0] as string;
      expect(output.endsWith('\n')).toBe(true);
      spy.mockRestore();
    });

    it('JSON contains all required fields', () => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const entry = createAuditEntry('search_patients', 'org-1', 'usr-1', {}, 123, 'success');
      logAudit(entry);
      const parsed = JSON.parse((spy.mock.calls[0][0] as string).trim());
      expect(parsed.audit_id).toBeDefined();
      expect(parsed.audit).toBe('true');
      expect(parsed.client_id).toBe('org-1');
      expect(parsed.user_id).toBe('usr-1');
      expect(parsed.tool_name).toBe('search_patients');
      expect(parsed.duration_ms).toBe(123);
      expect(parsed.status).toBe('success');
      expect(parsed.timestamp).toBeDefined();
      spy.mockRestore();
    });
  });

  // =========================================================================
  // Cloud Trace correlation
  // =========================================================================

  describe('Cloud Trace correlation', () => {
    it('includes trace when HTTP_X_CLOUD_TRACE_CONTEXT is set', () => {
      process.env.HTTP_X_CLOUD_TRACE_CONTEXT = 'abc123def456/1;o=1';
      const entry = createAuditEntry('search_patients', 't', 'u', {}, 0, 'success');
      expect(entry['logging.googleapis.com/trace']).toBe(
        'projects/midyear-glazing-485303-u3/traces/abc123def456'
      );
    });

    it('omits trace when header is not set', () => {
      delete process.env.HTTP_X_CLOUD_TRACE_CONTEXT;
      const entry = createAuditEntry('search_patients', 't', 'u', {}, 0, 'success');
      expect(entry['logging.googleapis.com/trace']).toBeUndefined();
    });
  });

  // =========================================================================
  // PHI safety
  // =========================================================================

  describe('PHI safety', () => {
    it('never includes email in audit entry', () => {
      const entry = createAuditEntry(
        'enrich_contact', 't', 'u',
        { identifier: 'patient@hospital.com', email: 'patient@hospital.com' },
        0, 'success'
      );
      const json = JSON.stringify(entry);
      expect(json).not.toContain('patient@hospital.com');
    });

    it('never includes full name in audit entry', () => {
      const entry = createAuditEntry(
        'create_patient', 't', 'u',
        { full_name: 'John Doe', identifier: 'John Doe' },
        0, 'success'
      );
      // entity_id should be redacted, not the name
      expect(entry.entity_id).toBe('[redacted]');
    });
  });
});
