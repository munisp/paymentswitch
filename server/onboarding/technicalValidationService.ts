import axios from 'axios';
import { X509Certificate } from 'crypto';

/**
 * Technical Onboarding Validation Service
 * Provides validation and testing for technical configurations
 */

export interface EndpointTestResult {
  success: boolean;
  statusCode?: number;
  responseTime?: number;
  error?: string;
}

export interface CertificateValidationResult {
  valid: boolean;
  issuer?: string;
  subject?: string;
  validFrom?: Date;
  validTo?: Date;
  daysUntilExpiry?: number;
  error?: string;
}

/**
 * Test endpoint connectivity
 */
export async function testEndpointConnectivity(
  endpoint: string,
  timeout: number = 5000
): Promise<EndpointTestResult> {
  try {
    const startTime = Date.now();
    
    const response = await axios.get(endpoint, {
      timeout,
      validateStatus: () => true, // Accept any status code
    });
    
    const responseTime = Date.now() - startTime;
    
    return {
      success: response.status >= 200 && response.status < 500,
      statusCode: response.status,
      responseTime,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Connection failed',
    };
  }
}

/**
 * Validate SSL/TLS certificate
 */
export function validateCertificate(
  certificatePem: string
): CertificateValidationResult {
  try {
    // Remove any whitespace and ensure proper PEM format
    const cleanPem = certificatePem.trim();
    
    if (!cleanPem.includes('BEGIN CERTIFICATE')) {
      return {
        valid: false,
        error: 'Invalid PEM format - missing BEGIN CERTIFICATE marker',
      };
    }
    
    const cert = new X509Certificate(cleanPem);
    
    const validFrom = new Date(cert.validFrom);
    const validTo = new Date(cert.validTo);
    const now = new Date();
    
    const daysUntilExpiry = Math.floor(
      (validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    const isExpired = now > validTo;
    const isNotYetValid = now < validFrom;
    
    if (isExpired) {
      return {
        valid: false,
        issuer: cert.issuer,
        subject: cert.subject,
        validFrom,
        validTo,
        daysUntilExpiry,
        error: 'Certificate has expired',
      };
    }
    
    if (isNotYetValid) {
      return {
        valid: false,
        issuer: cert.issuer,
        subject: cert.subject,
        validFrom,
        validTo,
        daysUntilExpiry,
        error: 'Certificate is not yet valid',
      };
    }
    
    // Warn if expiring soon (within 30 days)
    if (daysUntilExpiry < 30) {
      return {
        valid: true,
        issuer: cert.issuer,
        subject: cert.subject,
        validFrom,
        validTo,
        daysUntilExpiry,
        error: `Certificate expires in ${daysUntilExpiry} days`,
      };
    }
    
    return {
      valid: true,
      issuer: cert.issuer,
      subject: cert.subject,
      validFrom,
      validTo,
      daysUntilExpiry,
    };
  } catch (error: any) {
    return {
      valid: false,
      error: `Certificate validation failed: ${error.message}`,
    };
  }
}

/**
 * Validate IP address format
 */
export function validateIPAddress(ip: string): boolean {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  
  if (ipv4Regex.test(ip)) {
    const parts = ip.split('.');
    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }
  
  return ipv6Regex.test(ip);
}

/**
 * Validate URL format
 */
export function validateURL(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate API key
 */
export function generateAPIKey(): string {
  const { randomBytes } = require('crypto');
  return `pk_${randomBytes(24).toString('base64url')}`;
}

/**
 * Validate transaction limits
 */
export function validateTransactionLimits(
  minAmount: number,
  maxAmount: number,
  dailyLimit: number
): { valid: boolean; error?: string } {
  if (minAmount < 0) {
    return { valid: false, error: 'Minimum amount cannot be negative' };
  }
  
  if (maxAmount < minAmount) {
    return { valid: false, error: 'Maximum amount must be greater than minimum amount' };
  }
  
  if (dailyLimit < maxAmount) {
    return { valid: false, error: 'Daily limit must be greater than maximum transaction amount' };
  }
  
  return { valid: true };
}

/**
 * Test health check endpoint
 */
export async function testHealthCheck(
  healthCheckUrl: string
): Promise<EndpointTestResult> {
  try {
    const startTime = Date.now();
    
    const response = await axios.get(healthCheckUrl, {
      timeout: 3000,
    });
    
    const responseTime = Date.now() - startTime;
    
    // Health check should return 200
    if (response.status === 200) {
      return {
        success: true,
        statusCode: response.status,
        responseTime,
      };
    }
    
    return {
      success: false,
      statusCode: response.status,
      responseTime,
      error: 'Health check endpoint did not return 200 OK',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Health check failed',
    };
  }
}
