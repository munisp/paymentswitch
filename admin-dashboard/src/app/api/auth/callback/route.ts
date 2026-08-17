import { NextRequest, NextResponse } from 'next/server';
import { completeAuthorization } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  if (!code || !state) {
    return NextResponse.json({ error: 'Missing authorization code or state' }, { status: 400 });
  }
  try {
    const { returnTo } = await completeAuthorization(code, state);
    return NextResponse.redirect(new URL(returnTo, request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authorization callback failed';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
