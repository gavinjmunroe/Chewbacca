/**
 * PRIVACY-01: Multi-tier privacy system — server-enforced field-level permissions
 *
 * Three tiers:
 *   local_only   — nothing syncs. API rejects any field-write not explicitly permitted.
 *   selective    — user picks which fields sync.
 *   full_social  — all permitted fields sync.
 *
 * Field types: 'contacts' | 'birthday' | 'health' | 'calendar' | 'location' | 'alma_mater' | 'hometown' | 'city'
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { eq, and } from 'drizzle-orm';
import { authenticate, AuthenticatedRequest } from '../auth/middleware.js';

const VALID_FIELDS = [
  'contacts', 'birthday', 'health', 'calendar', 'location',
  'alma_mater', 'hometown', 'city',
] as const;
type FieldType = (typeof VALID_FIELDS)[number];

const PrivacyTierSchema = z.object({
  tier: z.enum(['local_only', 'selective', 'full_social']),
});

const FieldPermissionSchema = z.object({
  fieldType: z.enum(VALID_FIELDS),
  syncEnabled: z.boolean(),
});

const BulkPermissionsSchema = z.object({
  permissions: z.array(FieldPermissionSchema),
});

async function auditPermissionChange(
  userId: number,
  fieldType: string,
  oldValue: boolean | null,
  newValue: boolean,
) {
  await db.insert(schema.permissionAuditLog).values({
    userId,
    fieldType,
    oldValue: oldValue ?? undefined,
    newValue,
  });
}

export async function registerPrivacyRoutes(app: FastifyInstance) {
  /**
   * GET /privacy/tier
   * Returns current privacy tier for the authenticated user
   */
  app.get('/privacy/tier', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    const [user] = await db
      .select({ privacyTier: schema.users.privacyTier })
      .from(schema.users)
      .where(eq(schema.users.id, req.userId!))
      .limit(1);
    return { tier: user?.privacyTier ?? 'local_only' };
  });

  /**
   * PUT /privacy/tier
   * Change privacy tier. Downgrading to local_only triggers cloud data deletion.
   */
  app.put('/privacy/tier', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    const { tier } = PrivacyTierSchema.parse(req.body);

    const [current] = await db
      .select({ privacyTier: schema.users.privacyTier })
      .from(schema.users)
      .where(eq(schema.users.id, req.userId!))
      .limit(1);

    const isDowngrade =
      (current?.privacyTier === 'full_social' && tier !== 'full_social') ||
      (current?.privacyTier === 'selective' && tier === 'local_only');

    await db
      .update(schema.users)
      .set({ privacyTier: tier })
      .where(eq(schema.users.id, req.userId!));

    if (isDowngrade) {
      // Delete synced contact data for users downgrading — cloud data must go
      await db.delete(schema.contacts).where(eq(schema.contacts.userId, req.userId!));
      // Mark all permissions as disabled
      await db
        .update(schema.userPermissions)
        .set({ syncEnabled: false, updatedAt: new Date() })
        .where(eq(schema.userPermissions.userId, req.userId!));
    }

    return { tier, wasDowngrade: isDowngrade };
  });

  /**
   * GET /privacy/permissions
   * Returns field-level sync permissions for the authenticated user
   */
  app.get('/privacy/permissions', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    const perms = await db
      .select()
      .from(schema.userPermissions)
      .where(eq(schema.userPermissions.userId, req.userId!));
    return perms;
  });

  /**
   * PUT /privacy/permissions
   * Upsert one or many field-level permissions.
   * Server rejects writes for fields the user hasn't opted into (enforced in other routes).
   */
  app.put('/privacy/permissions', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    const { permissions } = BulkPermissionsSchema.parse(req.body);

    // Check current tier — local_only cannot enable any sync
    const [user] = await db
      .select({ privacyTier: schema.users.privacyTier })
      .from(schema.users)
      .where(eq(schema.users.id, req.userId!))
      .limit(1);

    if (user?.privacyTier === 'local_only') {
      return { error: 'tier_violation', message: 'Upgrade your privacy tier before enabling field sync.' };
    }

    const results = [];
    for (const { fieldType, syncEnabled } of permissions) {
      const [existing] = await db
        .select()
        .from(schema.userPermissions)
        .where(
          and(
            eq(schema.userPermissions.userId, req.userId!),
            eq(schema.userPermissions.fieldType, fieldType),
          ),
        )
        .limit(1);

      await auditPermissionChange(req.userId!, fieldType, existing?.syncEnabled ?? null, syncEnabled);

      if (existing) {
        const [updated] = await db
          .update(schema.userPermissions)
          .set({ syncEnabled, updatedAt: new Date() })
          .where(eq(schema.userPermissions.id, existing.id))
          .returning();
        results.push(updated);
      } else {
        const [created] = await db
          .insert(schema.userPermissions)
          .values({ userId: req.userId!, fieldType, syncEnabled })
          .returning();
        results.push(created);
      }
    }

    return results;
  });

  /**
   * GET /privacy/audit
   * Returns the permission change audit log for the authenticated user
   */
  app.get('/privacy/audit', { preHandler: authenticate }, async (req: AuthenticatedRequest) => {
    return await db
      .select()
      .from(schema.permissionAuditLog)
      .where(eq(schema.permissionAuditLog.userId, req.userId!))
      .orderBy(schema.permissionAuditLog.changedAt);
  });
}

/**
 * Utility: used by other routes to check if a field is permitted to sync.
 * Throws 403 if the user has not opted into syncing this field.
 */
export async function requireFieldPermission(userId: number, fieldType: FieldType): Promise<void> {
  const [user] = await db
    .select({ privacyTier: schema.users.privacyTier })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (user?.privacyTier === 'local_only') {
    throw Object.assign(new Error('Field sync blocked: user is in local_only tier'), { statusCode: 403 });
  }

  if (user?.privacyTier === 'selective') {
    const [perm] = await db
      .select()
      .from(schema.userPermissions)
      .where(
        and(
          eq(schema.userPermissions.userId, userId),
          eq(schema.userPermissions.fieldType, fieldType),
        ),
      )
      .limit(1);
    if (!perm?.syncEnabled) {
      throw Object.assign(
        new Error(`Field sync blocked: '${fieldType}' is not enabled for this user`),
        { statusCode: 403 },
      );
    }
  }
}
