/**
 * Test User Seed Script
 * 
 * Creates test users for manual OAuth and 2FA testing.
 * Run: pnpm seed:test-users
 * 
 * NOTE: This script creates database records directly.
 * In production, users are created via OAuth flow only.
 */

import { getDb, upsertUser } from '../db';
import { ENV } from '../_core/env';

interface TestUser {
  openId: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  loginMethod: string;
}

const TEST_USERS: TestUser[] = [
  {
    openId: 'test-admin-001',
    name: 'Test Admin',
    email: 'admin@test.local',
    role: 'admin',
    loginMethod: 'manus-oauth',
  },
  {
    openId: 'test-user-001',
    name: 'Test User 1',
    email: 'user1@test.local',
    role: 'user',
    loginMethod: 'manus-oauth',
  },
  {
    openId: 'test-user-002',
    name: 'Test User 2',
    email: 'user2@test.local',
    role: 'user',
    loginMethod: 'manus-oauth',
  },
  {
    openId: 'test-user-003',
    name: 'Test User 3 (2FA Enabled)',
    email: 'user3@test.local',
    role: 'user',
    loginMethod: 'manus-oauth',
  },
];

async function seedTestUsers(): Promise<void> {
  console.log('🌱 Seeding Test Users...\n');

  const db = await getDb();
  if (!db) {
    console.error('❌ Database connection failed');
    console.error('   Ensure DATABASE_URL is set in your environment');
    process.exit(1);
  }

  console.log('📋 Test Users to Create:\n');

  for (const user of TEST_USERS) {
    console.log(`   • ${user.name} (${user.email})`);
    console.log(`     Role: ${user.role}`);
    console.log(`     OpenID: ${user.openId}`);
    console.log();
  }

  console.log('⚠️  WARNING: This will create/update users in the database.');
  console.log('   These are test accounts for development and testing only.\n');

  // In a real scenario, you'd prompt for confirmation
  // For automation, we proceed directly

  let created = 0;
  let updated = 0;

  for (const user of TEST_USERS) {
    try {
      // Check if user exists
      const { users } = await import('../../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.sub, user.openId))
        .limit(1);

      await upsertUser({
        sub: user.openId,
        name: user.name,
        email: user.email,
        role: user.role,
        loginMethod: user.loginMethod,
        lastSignedIn: new Date(),
      });

      if (existing.length > 0) {
        updated++;
        console.log(`✅ Updated: ${user.name}`);
      } else {
        created++;
        console.log(`✅ Created: ${user.name}`);
      }
    } catch (error) {
      console.error(`❌ Failed to create ${user.name}:`, error);
    }
  }

  console.log();
  console.log('═'.repeat(60));
  console.log();
  console.log('📊 Summary:');
  console.log(`   Created: ${created} users`);
  console.log(`   Updated: ${updated} users`);
  console.log(`   Total: ${TEST_USERS.length} users`);
  console.log();

  console.log('🔐 Test Account Credentials:\n');
  console.log('   These accounts use Manus OAuth for authentication.');
  console.log('   You cannot log in with these credentials directly.\n');
  
  console.log('📖 How to Use Test Accounts:\n');
  console.log('   1. These records exist in the database');
  console.log('   2. When you log in via Manus OAuth, the system will:');
  console.log('      - Match your OAuth openId with these records');
  console.log('      - Update the user record with your OAuth data');
  console.log('      - Preserve the role (admin/user) assigned here\n');
  
  console.log('🧪 Testing 2FA:\n');
  console.log('   1. Log in as any test user via OAuth');
  console.log('   2. Navigate to Settings → 2FA Settings');
  console.log('   3. Enable 2FA and scan QR code');
  console.log('   4. Log out and log in again to test 2FA flow\n');

  console.log('🔧 Manual Testing Checklist:\n');
  console.log('   See docs/OAUTH_TESTING_CHECKLIST.md for comprehensive testing guide\n');

  console.log('💡 Next Steps:\n');
  console.log('   • Run the platform: pnpm dev');
  console.log('   • Open in browser: http://localhost:3000');
  console.log('   • Click "Sign In" and authenticate via Manus OAuth');
  console.log('   • Your OAuth account will be matched to a test user\n');

  console.log('⚠️  Production Note:\n');
  console.log('   In production, DO NOT create users manually.');
  console.log('   All users must be created via OAuth flow only.\n');
}

// Run the seed script
seedTestUsers().catch((error) => {
  console.error('❌ Seed script failed:', error);
  process.exit(1);
});
