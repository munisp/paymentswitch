import { NextResponse } from 'next/server';
import { refreshAccessToken } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await refreshAccessToken();
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, ...session }, {
    headers: { 'Cache-Control': 'no-store, private' },
  });
}
