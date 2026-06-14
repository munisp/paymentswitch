import { eq, sql, and, gte, desc } from 'drizzle-orm';
import { getDb } from '../db';
import { users, participantApplications, technicalOnboardingReviews, certificationResults, productionCredentials } from '../../drizzle/schema';

/**
 * Admin Dashboard Service
 * Provides statistics and analytics for the admin panel
 */

export interface DashboardStats {
  totalUsers: number;
  totalParticipants: number;
  activeParticipants: number;
  pendingReviews: number;
  certifiedParticipants: number;
  productionParticipants: number;
  recentRegistrations: number;
  onboardingFunnel: {
    registered: number;
    technicalComplete: number;
    integrationComplete: number;
    certified: number;
    production: number;
  };
}

export interface ParticipantProgress {
  userId: number;
  userName: string;
  userEmail: string;
  merchantId: number;
  organizationName: string;
  businessType: string | null;
  registrationStatus: string;
  technicalStatus: string | null;
  integrationStatus: string | null;
  certificationStatus: string | null;
  productionStatus: string | null;
  currentStep: number;
  completionPercentage: number;
  createdAt: Date;
  lastUpdated: Date;
}

export async function getDashboardStatistics(): Promise<DashboardStats> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Get total users
  const totalUsersResult = await db.select({ count: sql<number>`count(*)` }).from(users);
  const totalUsers = Number(totalUsersResult[0]?.count || 0);

  // Get total participants
  const totalParticipantsResult = await db.select({ count: sql<number>`count(*)` }).from(participantApplications);
  const totalParticipants = Number(totalParticipantsResult[0]?.count || 0);

  // Get active participants (approved)
  const activeParticipantsResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(participantApplications)
    .where(eq(participantApplications.status, 'approved'));
  const activeParticipants = Number(activeParticipantsResult[0]?.count || 0);

  // Get pending reviews (technical onboarding)
  const pendingReviewsResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(technicalOnboardingReviews)
    .where(eq(technicalOnboardingReviews.status, 'pending'));
  const pendingReviews = Number(pendingReviewsResult[0]?.count || 0);

  // Get certified participants
  const certifiedParticipantsResult = await db
    .select({ count: sql<number>`count(distinct credentialId)` })
    .from(certificationResults)
    .where(eq(certificationResults.status, 'passed'));
  const certifiedParticipants = Number(certifiedParticipantsResult[0]?.count || 0);

  // Get production participants
  const productionParticipantsResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(productionCredentials)
    .where(eq(productionCredentials.status, 'active'));
  const productionParticipants = Number(productionParticipantsResult[0]?.count || 0);

  // Get recent registrations (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentRegistrationsResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(participantApplications)
    .where(gte(participantApplications.createdAt, thirtyDaysAgo));
  const recentRegistrations = Number(recentRegistrationsResult[0]?.count || 0);

  // Onboarding funnel
  const registered = totalParticipants;
  
  const technicalCompleteResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(technicalOnboardingReviews)
    .where(eq(technicalOnboardingReviews.status, 'approved'));
  const technicalComplete = Number(technicalCompleteResult[0]?.count || 0);

  // Integration complete (has certification results)
  const integrationCompleteResult = await db
    .select({ count: sql<number>`count(distinct credentialId)` })
    .from(certificationResults);
  const integrationComplete = Number(integrationCompleteResult[0]?.count || 0);

  const certified = certifiedParticipants;
  const production = productionParticipants;

  return {
    totalUsers,
    totalParticipants,
    activeParticipants,
    pendingReviews,
    certifiedParticipants,
    productionParticipants,
    recentRegistrations,
    onboardingFunnel: {
      registered,
      technicalComplete,
      integrationComplete,
      certified,
      production,
    },
  };
}

export async function getAllParticipantsProgress(
  page: number = 1,
  limit: number = 20,
  statusFilter?: string
): Promise<{ participants: ParticipantProgress[]; total: number }> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const offset = (page - 1) * limit;

  // Build base query
  const query = db
    .select({
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      applicationId: participantApplications.id,
      organizationName: participantApplications.organizationName,
      businessType: participantApplications.businessType,
      registrationStatus: participantApplications.status,
      createdAt: participantApplications.createdAt,
      updatedAt: participantApplications.updatedAt,
    })
    .from(participantApplications)
    .innerJoin(users, eq(participantApplications.userId, users.id))
    .where(statusFilter ? eq(participantApplications.status, statusFilter as any) : undefined)
    .orderBy(desc(participantApplications.createdAt))
    .limit(limit)
    .offset(offset);

  const applicationsData = await query;

  // Get total count
  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(participantApplications)
    .where(statusFilter ? eq(participantApplications.status, statusFilter as any) : undefined);
  const total = Number(totalResult[0]?.count || 0);

  // For each application, get their progress across all steps
  const participants: ParticipantProgress[] = await Promise.all(
    applicationsData.map(async (m) => {
      // Get technical status
      const techReview = await db
        .select()
        .from(technicalOnboardingReviews)
        .where(eq(technicalOnboardingReviews.applicationId, m.applicationId))
        .limit(1);
      const technicalStatus = techReview[0]?.status || null;

      // Get certification status (using applicationId as credentialId)
      const certResults = await db
        .select()
        .from(certificationResults)
        .where(eq(certificationResults.credentialId, m.applicationId))
        .orderBy(desc(certificationResults.createdAt))
        .limit(1);
      const certificationStatusValue = certResults[0]?.status || null;

      // Get production status
      const prodCreds = await db
        .select()
        .from(productionCredentials)
        .where(eq(productionCredentials.applicationId, m.applicationId))
        .limit(1);
      const productionStatus = prodCreds[0]?.status === 'active' ? 'active' : null;

      // Calculate current step and completion percentage
      let currentStep = 1; // Registration
      let completionPercentage = 20; // 20% for registration

      if (m.registrationStatus === 'approved') {
        currentStep = 2; // Technical onboarding
        completionPercentage = 40;
      }

      if (technicalStatus === 'approved') {
        currentStep = 3; // Integration development
        completionPercentage = 60;
      }

      if (certificationStatusValue === 'passed') {
        currentStep = 4; // Testing & certification
        completionPercentage = 80;
      }

      if (productionStatus === 'active') {
        currentStep = 5; // Production
        completionPercentage = 100;
      }

      return {
        userId: m.userId,
        userName: m.userName || 'N/A',
        userEmail: m.userEmail || 'N/A',
        merchantId: m.applicationId,
        organizationName: m.organizationName,
        businessType: m.businessType,
        registrationStatus: m.registrationStatus,
        technicalStatus,
        integrationStatus: certResults[0] ? 'in_progress' : null,
        certificationStatus: certificationStatusValue,
        productionStatus,
        currentStep,
        completionPercentage,
        createdAt: m.createdAt,
        lastUpdated: m.updatedAt,
      };
    })
  );

  return { participants, total };
}

export async function getParticipantDetailedProgress(applicationId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  // Get application details
  const application = await db
    .select()
    .from(participantApplications)
    .where(eq(participantApplications.id, applicationId))
    .limit(1);

  if (!application[0]) {
    throw new Error('Application not found');
  }

  // Get user details
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, application[0].userId))
    .limit(1);

  // Get technical onboarding status
  const techReview = await db
    .select()
    .from(technicalOnboardingReviews)
    .where(eq(technicalOnboardingReviews.applicationId, applicationId))
    .limit(1);

  // Get certification results
  const certResults = await db
    .select()
    .from(certificationResults)
    .where(eq(certificationResults.credentialId, applicationId))
    .orderBy(desc(certificationResults.createdAt))
    .limit(1);

  // Get production credentials
  const prodCreds = await db
    .select()
    .from(productionCredentials)
    .where(eq(productionCredentials.applicationId, applicationId))
    .limit(1);

  return {
    application: application[0],
    user: user[0],
    technicalReview: techReview[0] || null,
    certificationResults: certResults[0] || null,
    productionCredentials: prodCreds[0] || null,
  };
}
