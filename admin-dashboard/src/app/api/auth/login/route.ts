import { NextRequest, NextResponse } from 'next/server';
import { beginAuthorization } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const returnTo = request.nextUrl.searchParams.get('returnTo');
    return NextResponse.redirect(beginAuthorization(returnTo));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start sign-in';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
