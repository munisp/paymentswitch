/**
 * Secret Management with HashiCorp Vault Integration
 * 
 * Provides centralized secret management with:
 * - Automatic secret rotation
 * - Dynamic database credentials
 * - Transit encryption for sensitive data
 * - Audit logging for compliance
 */

import crypto from 'crypto';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('secretManager');

export interface VaultConfig {
  address: string;
  token?: string;
  roleId?: string;
  secretId?: string;
  namespace?: string;
  caCert?: string;
}

export interface Secret {
  key: string;
  value: string;
  version: number;
  createdAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, string>;
}

export interface DatabaseCredentials {
  username: string;
  password: string;
  host: string;
  port: number;
  database: string;
  expiresAt: Date;
}

/**
 * Secret Manager Interface
 */
export interface ISecretManager {
  getSecret(path: string): Promise<Secret | null>;
  setSecret(path: string, value: string, metadata?: Record<string, string>): Promise<void>;
  deleteSecret(path: string): Promise<void>;
  listSecrets(path: string): Promise<string[]>;
  getDatabaseCredentials(role: string): Promise<DatabaseCredentials>;
  encrypt(plaintext: string, keyName: string): Promise<string>;
  decrypt(ciphertext: string, keyName: string): Promise<string>;
  rotateSecret(path: string): Promise<Secret>;
}

/**
 * HashiCorp Vault Secret Manager
 */
export class VaultSecretManager implements ISecretManager {
  private config: VaultConfig;
  private token: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(config: VaultConfig) {
    this.config = config;
    this.token = config.token || null;
  }

  private async authenticate(): Promise<string> {
    if (this.token && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.token;
    }

    if (this.config.roleId && this.config.secretId) {
      // AppRole authentication
      const response = await fetch(`${this.config.address}/v1/auth/approle/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role_id: this.config.roleId,
          secret_id: this.config.secretId
        })
      });

      if (!response.ok) {
        throw new Error(`Vault authentication failed: ${response.statusText}`);
      }

      const data = await response.json();
      this.token = data.auth.client_token;
      this.tokenExpiry = new Date(Date.now() + data.auth.lease_duration * 1000);
      return this.token!;
    }

    if (this.config.token) {
      this.token = this.config.token;
      return this.token;
    }

    throw new Error('No authentication method configured for Vault');
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    const token = await this.authenticate();
    
    const headers: Record<string, string> = {
      'X-Vault-Token': token,
      'Content-Type': 'application/json'
    };

    if (this.config.namespace) {
      headers['X-Vault-Namespace'] = this.config.namespace;
    }

    const response = await fetch(`${this.config.address}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Vault request failed: ${response.statusText}`);
    }

    return response.json();
  }

  async getSecret(path: string): Promise<Secret | null> {
    const data = await this.request('GET', `/v1/secret/data/${path}`);
    if (!data) return null;

    return {
      key: path,
      value: data.data.data.value,
      version: data.data.metadata.version,
      createdAt: new Date(data.data.metadata.created_time),
      metadata: data.data.data.metadata
    };
  }

  async setSecret(path: string, value: string, metadata?: Record<string, string>): Promise<void> {
    await this.request('POST', `/v1/secret/data/${path}`, {
      data: { value, metadata }
    });
  }

  async deleteSecret(path: string): Promise<void> {
    await this.request('DELETE', `/v1/secret/data/${path}`);
  }

  async listSecrets(path: string): Promise<string[]> {
    const data = await this.request('LIST', `/v1/secret/metadata/${path}`);
    return data?.data?.keys || [];
  }

  async getDatabaseCredentials(role: string): Promise<DatabaseCredentials> {
    const data = await this.request('GET', `/v1/database/creds/${role}`);
    
    return {
      username: data.data.username,
      password: data.data.password,
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      database: process.env.DB_NAME || 'payment_switch',
      expiresAt: new Date(Date.now() + data.lease_duration * 1000)
    };
  }

  async encrypt(plaintext: string, keyName: string): Promise<string> {
    const encoded = Buffer.from(plaintext).toString('base64');
    const data = await this.request('POST', `/v1/transit/encrypt/${keyName}`, {
      plaintext: encoded
    });
    return data.data.ciphertext;
  }

  async decrypt(ciphertext: string, keyName: string): Promise<string> {
    const data = await this.request('POST', `/v1/transit/decrypt/${keyName}`, {
      ciphertext
    });
    return Buffer.from(data.data.plaintext, 'base64').toString('utf-8');
  }

  async rotateSecret(path: string): Promise<Secret> {
    // Generate new secret value
    const newValue = crypto.randomBytes(32).toString('hex');
    await this.setSecret(path, newValue);
    return (await this.getSecret(path))!;
  }
}

/**
 * Environment-based Secret Manager (for development/testing)
 */
export class EnvSecretManager implements ISecretManager {
  private secrets: Map<string, Secret> = new Map();
  private encryptionKey: Buffer;

  constructor() {
    // Use a fixed key for development (in production, use Vault)
    this.encryptionKey = crypto.scryptSync(
      process.env.SECRET_ENCRYPTION_KEY || 'dev-encryption-key',
      'salt',
      32
    );
    this.loadFromEnv();
  }

  private loadFromEnv(): void {
    // Load secrets from environment variables
    const secretPrefixes = ['API_KEY_', 'SECRET_', 'CREDENTIAL_'];
    
    for (const [key, value] of Object.entries(process.env)) {
      if (secretPrefixes.some(prefix => key.startsWith(prefix)) && value) {
        this.secrets.set(key.toLowerCase().replace(/_/g, '/'), {
          key: key.toLowerCase().replace(/_/g, '/'),
          value,
          version: 1,
          createdAt: new Date()
        });
      }
    }
  }

  async getSecret(path: string): Promise<Secret | null> {
    return this.secrets.get(path) || null;
  }

  async setSecret(path: string, value: string, metadata?: Record<string, string>): Promise<void> {
    const existing = this.secrets.get(path);
    this.secrets.set(path, {
      key: path,
      value,
      version: (existing?.version || 0) + 1,
      createdAt: new Date(),
      metadata
    });
  }

  async deleteSecret(path: string): Promise<void> {
    this.secrets.delete(path);
  }

  async listSecrets(path: string): Promise<string[]> {
    return Array.from(this.secrets.keys()).filter(k => k.startsWith(path));
  }

  async getDatabaseCredentials(_role: string): Promise<DatabaseCredentials> {
    return {
      username: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      database: process.env.DB_NAME || 'payment_switch',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    };
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  async decrypt(ciphertext: string): Promise<string> {
    const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  async rotateSecret(path: string): Promise<Secret> {
    const newValue = crypto.randomBytes(32).toString('hex');
    await this.setSecret(path, newValue);
    return (await this.getSecret(path))!;
  }
}

/**
 * Secret rotation scheduler
 */
export class SecretRotationScheduler {
  private manager: ISecretManager;
  private rotationIntervals: Map<string, NodeJS.Timeout> = new Map();
  private rotationCallbacks: Map<string, (secret: Secret) => void> = new Map();

  constructor(manager: ISecretManager) {
    this.manager = manager;
  }

  scheduleRotation(
    path: string,
    intervalMs: number,
    callback?: (secret: Secret) => void
  ): void {
    // Clear existing interval if any
    this.cancelRotation(path);

    if (callback) {
      this.rotationCallbacks.set(path, callback);
    }

    const interval = setInterval(async () => {
      try {
        const newSecret = await this.manager.rotateSecret(path);
        const cb = this.rotationCallbacks.get(path);
        if (cb) {
          cb(newSecret);
        }
        log.info(`[SecretRotation] Rotated secret: ${path}`);
      } catch (error) {
        log.error({ err: error }, `[SecretRotation] Failed to rotate secret ${path}:`);
      }
    }, intervalMs);

    this.rotationIntervals.set(path, interval);
  }

  cancelRotation(path: string): void {
    const interval = this.rotationIntervals.get(path);
    if (interval) {
      clearInterval(interval);
      this.rotationIntervals.delete(path);
    }
    this.rotationCallbacks.delete(path);
  }

  cancelAllRotations(): void {
    for (const path of Array.from(this.rotationIntervals.keys())) {
      this.cancelRotation(path);
    }
  }
}

/**
 * Create secret manager based on environment
 */
export function createSecretManager(): ISecretManager {
  if (process.env.VAULT_ADDR) {
    return new VaultSecretManager({
      address: process.env.VAULT_ADDR,
      token: process.env.VAULT_TOKEN,
      roleId: process.env.VAULT_ROLE_ID,
      secretId: process.env.VAULT_SECRET_ID,
      namespace: process.env.VAULT_NAMESPACE
    });
  }
  
  return new EnvSecretManager();
}

// Singleton instance
let secretManagerInstance: ISecretManager | null = null;

export function getSecretManager(): ISecretManager {
  if (!secretManagerInstance) {
    secretManagerInstance = createSecretManager();
  }
  return secretManagerInstance;
}

/**
 * Pre-defined secret paths for payment services
 */
export const SecretPaths = {
  // Payment provider API keys
  COINBASE_API_KEY: 'payment/coinbase/api-key',
  COINBASE_WEBHOOK_SECRET: 'payment/coinbase/webhook-secret',
  CIRCLE_API_KEY: 'payment/circle/api-key',
  NIBSS_API_KEY: 'payment/nibss/api-key',
  NIBSS_SECRET_KEY: 'payment/nibss/secret-key',
  
  // Identity verification
  SMILE_IDENTITY_API_KEY: 'identity/smile/api-key',
  SMILE_IDENTITY_PARTNER_ID: 'identity/smile/partner-id',
  
  // Communication providers
  TWILIO_ACCOUNT_SID: 'communication/twilio/account-sid',
  TWILIO_AUTH_TOKEN: 'communication/twilio/auth-token',
  SENDGRID_API_KEY: 'communication/sendgrid/api-key',
  
  // Database credentials
  DB_CREDENTIALS: 'database/postgres/credentials',
  REDIS_PASSWORD: 'database/redis/password',
  
  // Encryption keys
  JWT_SECRET: 'encryption/jwt-secret',
  HMAC_SECRET: 'encryption/hmac-secret',
  DATA_ENCRYPTION_KEY: 'encryption/data-key',
  
  // OAuth/Auth
  KEYCLOAK_CLIENT_SECRET: 'auth/keycloak/client-secret',
  OAUTH_CLIENT_SECRET: 'auth/oauth/client-secret'
};

export default getSecretManager;
