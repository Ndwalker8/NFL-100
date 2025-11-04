// src/app/api/meta/route.ts
import { NextResponse } from "next/server";

/**
 * Cache strategy
 * - CDN cache (s-maxage) for 1 hour
 * - Serve stale for up to 24h while revalidating in background
 * - Dev mode: Next.js ignores caching (so you'll always see fresh values)
 */
export const runtime = "edge";     // optional: faster, fine for this route
export const revalidate = 3600;    // hint for Next.js caching layer (1 hour)

function firstMondayOfSeptemberUTC(year: number) {
  const d = new Date(Date.UTC(year, 8, 1)); // Sep 1 UTC
  const dow = d.getUTCDay();                // 0=Sun..6=Sat
  const delta = dow === 1 ? 0 : (8 - dow) % 7; // to Monday
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

function firstThursdayAfter(dateUTC: Date) {
  const d = new Date(dateUTC.getTime());
  const dow = d.getUTCDay();
  const delta = ((4 - dow + 7) % 7) || 7; // strictly after
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

function inferSeasonAndWeek(now = new Date()) {
  const y = now.getUTCFullYear();
  const month = now.getUTCMonth();     // 0..11
  const season = month >= 8 ? y : y - 1;

  const firstMon = firstMondayOfSeptemberUTC(season);
  const kickoff = firstThursdayAfter(firstMon);

  // if before kickoff, roll back one season
  if (now < kickoff) {
    const ps = season - 1;
    const pm = firstMondayOfSeptemberUTC(ps);
    const pk = firstThursdayAfter(pm);
    const w = Math.floor((+now - +pk) / (7 * 24 * 3600 * 1000)) + 1;
    return { season: ps, week: Math.min(Math.max(w, 1), 18) };
  }

  const w = Math.floor((+now - +kickoff) / (7 * 24 * 3600 * 1000)) + 1;
  return { season, week: Math.min(Math.max(w, 1), 18) };
}

export async function GET() {
  const meta = inferSeasonAndWeek(new Date());

  // Build response with strong cache headers + simple ETag
  const res = NextResponse.json(meta, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      ETag: `"${meta.season}-${meta.week}"`,
    },
  });

  return res;
}
