// Next.js (App Router) API route: /api/nba/players?date=YYYY-MM-DD
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const TEAMS      = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams";
const TEAM_WITH_ROSTER = (teamId: string) =>
  `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}?enable=roster`;

function toYYYYMMDD(input?: string) {
  if (input && /^\d{8}$/.test(input)) return input;
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input.replaceAll("-", "");
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}${mm}${dd}`;
}

async function j<T>(url: string): Promise<T> {
  const r = await fetch(url, {
    headers: { "User-Agent": "fantasy-hundred/1.0" },
    cache: "no-store",
    next: { revalidate: 0 },
  });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json() as Promise<T>;
}

function normalizePos(posRaw: any): string {
  const p = String(posRaw || "").toUpperCase();
  if (["C", "PF", "SF", "SG", "PG"].includes(p)) return p;
  if (p === "F" || p === "G") return p;
  if (p.includes("CENTER")) return "C";
  if (p.includes("POINT"))  return "PG";
  if (p.includes("SHOOT") || p.includes("SG")) return "SG";
  if (p.includes("POWER") || p.includes("PF")) return "PF";
  if (p.includes("SMALL") || p.includes("SF")) return "SF";
  return "G";
}

function extractPlayersFromTeamPayload(payload: any, fallbackAbbr: string) {
  const out: Array<{ id: string; name: string; team: string; posNBA: string }> = [];
  const teamAbbr =
    payload?.team?.abbreviation ||
    payload?.abbreviation ||
    fallbackAbbr ||
    "NBA";

  const entriesA = payload?.team?.roster?.entries;
  if (Array.isArray(entriesA) && entriesA.length) {
    for (const e of entriesA) {
      const a = e?.player ?? e?.athlete ?? e;
      const id = a?.id ? String(a.id) : "";
      const name = a?.displayName || a?.fullName || a?.shortName || "";
      if (!id || !name) continue;
      const pos =
        a?.position?.abbreviation ||
        a?.position?.name ||
        e?.position?.abbreviation ||
        e?.position?.name ||
        a?.defaultPosition ||
        "";
      out.push({ id: `nba:${id}`, name, team: teamAbbr, posNBA: normalizePos(pos) });
    }
  }

  const groups = Array.isArray(payload?.athletes) ? payload.athletes : [];
  for (const g of groups) {
    const items = Array.isArray(g?.items) ? g.items : [];
    for (const a of items) {
      const id = a?.id ? String(a.id) : "";
      const name = a?.displayName || a?.fullName || a?.shortName || "";
      if (!id || !name) continue;
      const pos =
        a?.position?.abbreviation ||
        a?.position?.name ||
        g?.position?.abbreviation ||
        g?.position?.name ||
        a?.defaultPosition ||
        "";
      out.push({ id: `nba:${id}`, name, team: teamAbbr, posNBA: normalizePos(pos) });
    }
  }

  const athletesFlat = Array.isArray(payload?.team?.athletes) ? payload.team.athletes : [];
  for (const a of athletesFlat) {
    const id = a?.id ? String(a.id) : "";
    const name = a?.displayName || a?.fullName || a?.shortName || "";
    if (!id || !name) continue;
    const pos =
      a?.position?.abbreviation ||
      a?.position?.name ||
      a?.defaultPosition ||
      "";
    out.push({ id: `nba:${id}`, name, team: teamAbbr, posNBA: normalizePos(pos) });
  }

  return out;
}

function dedupPlayers(players: Array<{ id: string }>) {
  const m: Record<string, any> = {};
  for (const p of players) if (!m[p.id]) m[p.id] = p;
  return Object.values(m);
}

export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get("date") || undefined;
  const dates = toYYYYMMDD(dateParam);

  try {
    let teamIds: string[] = [];
    const teamIdToAbbr = new Map<string, string>();
    let usedFallbackTeams = false;

    // First try slate
    try {
      const sb = await j<any>(`${SCOREBOARD}?dates=${dates}`);
      const events: any[] = sb?.events ?? [];
      for (const ev of events) {
        for (const comp of ev?.competitions ?? []) {
          for (const c of comp?.competitors ?? []) {
            const id = String(c?.team?.id ?? "");
            if (!id) continue;
            if (!teamIdToAbbr.has(id)) {
              teamIdToAbbr.set(id, c?.team?.abbreviation || c?.team?.shortDisplayName || "");
            }
          }
        }
      }
      teamIds = [...teamIdToAbbr.keys()];
    } catch {
      // ignore; we'll fallback below
    }

    // If slate empty or ESPN rosters later fail → use league teams
    async function fetchLeagueTeamIds() {
      const teamsPayload = await j<any>(TEAMS);
      const list =
        teamsPayload?.sports?.[0]?.leagues?.[0]?.teams ??
        teamsPayload?.teams ??
        [];
      const ids: string[] = [];
      for (const tWrap of list) {
        const t = tWrap?.team ?? tWrap;
        const id = String(t?.id ?? "");
        if (!id) continue;
        ids.push(id);
        teamIdToAbbr.set(id, t?.abbreviation || t?.shortDisplayName || "");
      }
      return ids;
    }

    if (!teamIds.length) {
      usedFallbackTeams = true;
      teamIds = await fetchLeagueTeamIds();
    }

    const allPlayers: any[] = [];
    const sampleErrors: Array<{ teamId: string; err: string }> = [];
    let rosterOk = 0;

    await Promise.all(
      teamIds.map(async (tid) => {
        try {
          const teamPayload = await j<any>(TEAM_WITH_ROSTER(tid));
          const abbr = teamPayload?.team?.abbreviation || teamIdToAbbr.get(tid) || "NBA";
          const got = extractPlayersFromTeamPayload(teamPayload, abbr);
          if (got.length) { rosterOk++; allPlayers.push(...got); }
        } catch (e: any) {
          if (sampleErrors.length < 4) sampleErrors.push({ teamId: tid, err: String(e?.message || e) });
        }
      })
    );

    // If ESPN roster endpoints all flaked and we got nothing, re-fallback to league teams once more.
    if (!allPlayers.length && !usedFallbackTeams) {
      usedFallbackTeams = true;
      teamIds = await fetchLeagueTeamIds();
      await Promise.all(
        teamIds.map(async (tid) => {
          try {
            const teamPayload = await j<any>(TEAM_WITH_ROSTER(tid));
            const abbr = teamPayload?.team?.abbreviation || teamIdToAbbr.get(tid) || "NBA";
            const got = extractPlayersFromTeamPayload(teamPayload, abbr);
            if (got.length) { rosterOk++; allPlayers.push(...got); }
          } catch (e: any) {
            if (sampleErrors.length < 4) sampleErrors.push({ teamId: tid, err: String(e?.message || e) });
          }
        })
      );
    }

    const dedup = dedupPlayers(allPlayers).sort(
      (a: any, b: any) => (a.team || "").localeCompare(b.team || "") || a.name.localeCompare(b.name)
    );

    return NextResponse.json({
      players: dedup,
      meta: {
        usedDate: dateParam ?? "today",
        teamsTried: teamIds.length,
        rosterOk,
        usedFallbackTeams,
        players: dedup.length,
        sampleErrors,
      },
    }, {
      headers: {
        // hard no-cache on the response as well
        "Cache-Control": "no-store, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
