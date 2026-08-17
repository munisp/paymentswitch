import { NextResponse } from 'next/server';
import { endSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  await endSession();
  return NextResponse.json({ authenticated: false }, {
    headers: { 'Cache-Control': 'no-store, private' },
  });
}
