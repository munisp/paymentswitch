import { getDb } from "../db";
import { apiKeyPermissions, apiPermissionTemplates } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

export interface Permission {
  resource: string;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

export interface PermissionTemplate {
  name: string;
  description: string;
  permissions: Permission[];
}

/**
 * Set permissions for an API key
 */
export async function setKeyPermissions(params: {
  credentialId: number;
  permissions: Permission[];
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Delete existing permissions
  await db.delete(apiKeyPermissions).where(eq(apiKeyPermissions.credentialId, params.credentialId));

  // Insert new permissions
  if (params.permissions.length > 0) {
    await db.insert(apiKeyPermissions).values(
      params.permissions.map((perm) => ({
        apiKeyId: params.credentialId,
        credentialId: params.credentialId,
        permission: perm.resource ?? '',
        resource: perm.resource,
        canRead: perm.canRead,
        canWrite: perm.canWrite,
        canDelete: perm.canDelete,
      }))
    );
  }
}

/**
 * Get all permissions for an API key
 */
export async function getKeyPermissions(credentialId: number): Promise<Permission[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const perms = await db
    .select()
    .from(apiKeyPermissions)
    .where(eq(apiKeyPermissions.credentialId, credentialId));

  return perms.map((p) => ({
    resource: p.resource ?? '',
    canRead: !!p.canRead,
    canWrite: !!p.canWrite,
    canDelete: !!p.canDelete,
  }));
}

/**
 * Check if a key has a specific permission
 */
export async function checkPermission(params: {
  credentialId: number;
  resource: string;
  action: "read" | "write" | "delete";
}): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [perm] = await db
    .select()
    .from(apiKeyPermissions)
    .where(
      and(
        eq(apiKeyPermissions.credentialId, params.credentialId),
        eq(apiKeyPermissions.resource, params.resource)
      )
    )
    .limit(1);

  if (!perm) return false;

  switch (params.action) {
    case "read":
      return !!perm.canRead;
    case "write":
      return !!perm.canWrite;
    case "delete":
      return !!perm.canDelete;
    default:
      return false;
  }
}

/**
 * Create a permission template
 */
export async function createPermissionTemplate(params: {
  name: string;
  description: string;
  permissions: Permission[];
  isSystem?: boolean;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [permInserted] = await db.insert(apiPermissionTemplates).values({
    name: params.name,
    description: params.description,
    permissions: JSON.stringify(params.permissions),
    isDefault: params.isSystem || false,
  }).returning({ id: apiPermissionTemplates.id });

  return permInserted.id;
}

/**
 * Get all permission templates
 */
export async function listPermissionTemplates(): Promise<PermissionTemplate[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const templates = await db.select().from(apiPermissionTemplates);

  return templates.map((t) => ({
    name: t.name,
    description: t.description || "",
    permissions: JSON.parse(t.permissions),
  }));
}

/**
 * Get a specific permission template
 */
export async function getPermissionTemplate(name: string): Promise<PermissionTemplate | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [template] = await db
    .select()
    .from(apiPermissionTemplates)
    .where(eq(apiPermissionTemplates.name, name))
    .limit(1);

  if (!template) return null;

  return {
    name: template.name,
    description: template.description || "",
    permissions: JSON.parse(template.permissions),
  };
}

/**
 * Initialize default permission templates
 */
export async function initializeDefaultTemplates(): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const defaultTemplates: PermissionTemplate[] = [
    {
      name: "readonly",
      description: "Read-only access to all resources",
      permissions: [
        { resource: "transactions", canRead: true, canWrite: false, canDelete: false },
        { resource: "webhooks", canRead: true, canWrite: false, canDelete: false },
        { resource: "reports", canRead: true, canWrite: false, canDelete: false },
        { resource: "settings", canRead: true, canWrite: false, canDelete: false },
      ],
    },
    {
      name: "readwrite",
      description: "Read and write access to all resources",
      permissions: [
        { resource: "transactions", canRead: true, canWrite: true, canDelete: false },
        { resource: "webhooks", canRead: true, canWrite: true, canDelete: false },
        { resource: "reports", canRead: true, canWrite: true, canDelete: false },
        { resource: "settings", canRead: true, canWrite: true, canDelete: false },
      ],
    },
    {
      name: "admin",
      description: "Full access to all resources",
      permissions: [
        { resource: "transactions", canRead: true, canWrite: true, canDelete: true },
        { resource: "webhooks", canRead: true, canWrite: true, canDelete: true },
        { resource: "reports", canRead: true, canWrite: true, canDelete: true },
        { resource: "settings", canRead: true, canWrite: true, canDelete: true },
      ],
    },
    {
      name: "transactions_only",
      description: "Access to transactions only",
      permissions: [
        { resource: "transactions", canRead: true, canWrite: true, canDelete: false },
      ],
    },
  ];

  for (const template of defaultTemplates) {
    // Check if template already exists
    const [existing] = await db
      .select()
      .from(apiPermissionTemplates)
      .where(eq(apiPermissionTemplates.name, template.name))
      .limit(1);

    if (!existing) {
      await createPermissionTemplate({
        ...template,
        isSystem: true,
      });
    }
  }
}
