import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const revalidate = 0;
export const dynamic = "force-dynamic";

type Player = {
  id: string;          // ESPN athlete id
  name: string;        // "First Last"
  team: string | null; // e.g. "BOS"
  posNBA: "C" | "F" | "G";
  active: boolean;
};

function toYYYYMMDD(dateISO: string) {
  // input: "YYYY-MM-DD" → "YYYYMMDD"
  return dateISO.replace(/-/g, "");
}

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json() as Promise<T>;
}

// Get the daily scoreboard to learn which teams are playing
async function getDailyTeams(dateISO: string) {
  const ymd = toYYYYMMDD(dateISO);
  const url = `https://site.web.api.espn.com/apis/v2/sports/basketball/nba/scoreboard?dates=${ymd}`;
  const data = await fetchJSON<any>(url);

  const events: any[] = data?.events ?? [];
  const teamIds = new Set<string>();
  const teamAbbr = new Map<string, string>();

  for (const ev of events) {
    const comps = ev?.competitions ?? [];
    for (const c of comps) {
      const compsCompetitors = c?.competitors ?? [];
      for (const comp of compsCompetitors) {
        const team = comp?.team;
        if (team?.id) {
          teamIds.add(String(team.id));
          if (team?.abbreviation) {
            teamAbbr.set(String(team.id), String(team.abbreviation));
          }
        }
      }
    }
  }
  return { teamIds: Array.from(teamIds), teamAbbr };
}

// Pull all athletes for a team
async function getTeamAthletes(teamId: string) {
  // Limit high to grab full roster
  const url = `https://site.web.api.espn.com/apis/v2/sports/basketball/nba/athletes?team=${encodeURIComponent(teamId)}&limit=300`;
  const data = await fetchJSON<any>(url);
  const items: any[] = data?.items ?? [];
  return items;
}

function normPos(abbr: string | undefined): "C" | "F" | "G" {
  const p = (abbr || "").toUpperCase();
  if (p.includes("C")) return "C";
  if (p.includes("F")) return "F";
  return "G"; // default guards
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || new Date().toISOString().slice(0, 10);

    const { teamIds, teamAbbr } = await getDailyTeams(date);
    if (teamIds.length === 0) {
      return NextResponse.json({ count: 0, players: [] }, { status: 200 });
    }

    // Fetch rosters in parallel
    const rosters = await Promise.all(teamIds.map(getTeamAthletes));

    const players: Player[] = [];
    for (let i = 0; i < rosters.length; i++) {
      const items = rosters[i];
      for (const a of items) {
        const id = String(a?.id ?? "");
        const name = a?.fullName || [a?.firstName, a?.lastName].filter(Boolean).join(" ");
        const pos = a?.position?.abbreviation || a?.position?.name || "";
        const teams = a?.team ?? a?.teams ?? null;

        // Prefer the team we got from the scoreboard mapping
        // If ESPN athlete payload has no abbrev, fallback to that map.
        let team: string | null = null;
        if (Array.isArray(teams) && teams[0]?.abbreviation) team = String(teams[0].abbreviation);
        else if (typeof teams?.abbreviation === "string") team = String(teams.abbreviation);

        // If missing, try to infer using the team id we are iterating
        if (!team) {
          const tid = (Array.isArray(teams) ? teams[0]?.id : teams?.id) ?? "";
          if (tid) team = teamAbbr.get(String(tid)) ?? null;
        }

        if (!id || !name) continue;
        players.push({
          id,
          name: String(name),
          team,
          posNBA: normPos(pos),
          active: true,
        });
      }
    }

    // De-dup (some feeds repeat athletes)
    const dedup = new Map<string, Player>();
    for (const p of players) {
      dedup.set(p.id, p);
    }

    // Stable sort by name
    const list = Array.from(dedup.values()).sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ date, count: list.length, players: list }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "nba/players failed" }, { status: 502 });
  }
}
