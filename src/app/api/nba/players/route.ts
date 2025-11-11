// Next.js (app router) API route: /api/nba/players?date=YYYY-MM-DD (optional)
// Builds a player pool for teams that play on the given date
import { NextResponse } from "next/server";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
// ^ NOTE: host is site.api.espn.com (NOT site.web.api.espn.com)

function yyyymmdd(input?: string) {
  // accept YYYY-MM-DD or already-compact YYYYMMDD; default = today ET
  if (input && /^\d{8}$/.test(input)) return input;
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input.replaceAll("-", "");
  const now = new Date();
  // You can improve this to convert to America/New_York if you want exact ET
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}${mm}${dd}`;
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, next: { revalidate: 60 } });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json() as Promise<T>;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date") || undefined;
    const compact = yyyymmdd(dateParam);

    // 1) Get slate (events -> competitions -> teams)
    const sb = await j<any>(`${SCOREBOARD}?dates=${compact}`);
    const events: any[] = sb?.events ?? [];

    if (!events.length) {
      return NextResponse.json({ players: [] }, { status: 200 });
    }

    // Grab unique team ids + map to abbreviations from the scoreboard
    const teamIdToAbbr = new Map<string, string>();
    const teamIds: Set<string> = new Set();

    for (const ev of events) {
      for (const comp of ev?.competitions ?? []) {
        for (const c of comp?.competitors ?? []) {
          const id = String(c?.team?.id ?? "");
          if (!id) continue;
          teamIds.add(id);
          const abbr = c?.team?.abbreviation || c?.team?.shortDisplayName || "";
          if (abbr) teamIdToAbbr.set(id, abbr);
        }
      }
    }

    if (!teamIds.size) {
      return NextResponse.json({ players: [] }, { status: 200 });
    }

    // 2) For each team, pull roster from the core API
    // Example: https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/teams/{id}/athletes?limit=200
    const rosterUrls = [...teamIds].map(
      (id) => `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/teams/${id}/athletes?limit=200`
    );

    const allPlayers: any[] = [];
    await Promise.all(
      rosterUrls.map(async (url, idx) => {
        try {
          const rosterIndex = await j<any>(url);
          const items: any[] = rosterIndex?.items ?? [];
          const teamId = [...teamIds][idx];
          const teamAbbr = teamIdToAbbr.get(teamId) ?? "NBA";

          // Each item is a link to an athlete resource; fetch in small batches
          // Keep it simple: fetch up to 20 per team to avoid hammering
          const slice = items.slice(0, 20);
          const athletes = await Promise.all(
            slice.map(async (it) => {
              try {
                return await j<any>(it?.$ref || it?.href || "");
              } catch {
                return null;
              }
            })
          );

          for (const a of athletes) {
            if (!a) continue;
            const id = String(a.id);
            const displayName = a?.displayName || a?.fullName || "";
            const pos = a?.position?.abbreviation || a?.position?.name || ""; // C/F/G etc.
            allPlayers.push({
              id: `nba:${id}`,
              name: displayName,
              team: teamAbbr,
              posNBA: pos === "Center" ? "C" : pos === "Forward" ? "F" : pos === "Guard" ? "G" : (pos || "G"),
            });
          }
        } catch {
          // ignore a team failure; move on
        }
      })
    );

    // Deduplicate by id
    const dedup = Object.values(
      allPlayers.reduce((acc, p: any) => {
        acc[p.id] = acc[p.id] || p;
        return acc;
      }, {} as Record<string, any>)
    );

    // Sort by team/name for stable UI
    dedup.sort((a: any, b: any) => (a.team || "").localeCompare(b.team || "") || a.name.localeCompare(b.name));

    return NextResponse.json({ players: dedup }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
