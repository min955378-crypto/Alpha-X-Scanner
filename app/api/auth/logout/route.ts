import { NextResponse } from 'next/server';

import { clearCookieHeader } from '@/server/engine/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set('set-cookie', clearCookieHeader());
  return res;
}
