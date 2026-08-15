import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import {
  provisionSandboxEnvironment,
  getIntegrationEnvironment,
  getApiCredentials,
  recordSdkDownload,
  runIntegrationTest,
  getIntegrationTests,
  getSdkDownloads,
} from './integrationService';

// SDK package sizes by type and version
function getSdkSize(sdkType: string, version: string): string {
  const sizes: Record<string, string> = {
    'node': '3.2 MB',
    'python': '2.1 MB',
    'java': '5.8 MB',
    'go': '1.9 MB',
    'dotnet': '4.5 MB',
    'php': '1.6 MB',
    'ruby': '1.4 MB',
    'flutter': '6.2 MB',
    'react-native': '4.8 MB',
  };
  return sizes[sdkType] || '2.4 MB';
}

export const integrationRouter = router({
  // Provision sandbox environment
  provisionSandbox: protectedProcedure
    .input(z.object({
      applicationId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      return await provisionSandboxEnvironment(input.applicationId, ctx.user.id);
    }),

  // Get environment details
  getEnvironment: protectedProcedure
    .input(z.object({
      applicationId: z.number(),
      environmentType: z.enum(['sandbox', 'staging', 'production']),
    }))
    .query(async ({ input }) => {
      const environment = await getIntegrationEnvironment(input.applicationId, input.environmentType);
      
      if (environment) {
        const credentials = await getApiCredentials(Number(environment.id));
        return {
          ...environment,
          credentials,
        };
      }
      
      return null;
    }),

  // Download SDK
  downloadSdk: protectedProcedure
    .input(z.object({
      applicationId: z.number(),
      sdkType: z.enum(['javascript', 'python', 'java', 'php', 'dotnet']),
      version: z.string(),
    }))
    .mutation(async ({ input }) => {
      await recordSdkDownload(input.applicationId, input.sdkType, input.version);
      
      // In real implementation, this would generate/fetch actual SDK package
      const downloadUrl = `https://cdn.payment-switch.dev/sdks/${input.sdkType}/${input.version}/sdk.zip`;
      
      return {
        downloadUrl,
        sdkType: input.sdkType,
        version: input.version,
        size: getSdkSize(input.sdkType, input.version),
      };
    }),

  // Run integration test
  runTest: protectedProcedure
    .input(z.object({
      applicationId: z.number(),
      testType: z.string(),
      testName: z.string(),
    }))
    .mutation(async ({ input }) => {
      return await runIntegrationTest(input.applicationId, input.testType, input.testName);
    }),

  // Get all tests for application
  getTests: protectedProcedure
    .input(z.object({
      applicationId: z.number(),
    }))
    .query(async ({ input }) => {
      return await getIntegrationTests(input.applicationId);
    }),

  // Get SDK download history
  getDownloads: protectedProcedure
    .input(z.object({
      applicationId: z.number(),
    }))
    .query(async ({ input }) => {
      return await getSdkDownloads(input.applicationId);
    }),

  // Get API documentation
  getApiDocs: protectedProcedure
    .query(() => {
      // In real implementation, this would fetch from documentation service
      return {
        version: '1.0.0',
        baseUrl: 'https://api.payment-switch.dev',
        endpoints: [
          {
            method: 'POST',
            path: '/v1/transactions',
            description: 'Create a new transaction',
            parameters: [
              { name: 'amount', type: 'number', required: true },
              { name: 'currency', type: 'string', required: true },
              { name: 'merchant_id', type: 'string', required: true },
            ],
          },
          {
            method: 'GET',
            path: '/v1/transactions/:id',
            description: 'Get transaction details',
            parameters: [
              { name: 'id', type: 'string', required: true },
            ],
          },
        ],
      };
    }),
});
