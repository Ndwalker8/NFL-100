import { NextRequest, NextResponse } from "next/server";
import { gunzipSync } from "zlib";
import { parse as parseCsvSync } from "csv-parse/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Sources:
 *   RAW (primary): https://raw.githubusercontent.com/nflverse/nflfastR-data/master/data/player_stats/player_stats_<SEASON>.csv.gz
 *   Releases (fallbacks):
 *     https://github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_<SEASON>.csv[.gz]
 *     https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_<SEASON>.csv[.gz]
 */
const RAW_BASE =
  process.env.NFLVERSE_PLAYER_STATS_RAW_BASE ??
  "https://raw.githubusercontent.com/nflverse/nflfastR-data/master/data/player_stats";
const REL_BASE_1 =
  process.env.NFLVERSE_PLAYER_STATS_RELEASE_BASE ??
  "https://github.com/nflverse/nflverse-data/releases/download/player_stats";
const REL_BASE_2 =
  process.env.NFLVERSE_PLAYER_STATS_RELEASE_BASE_ALT ??
  "https://github.com/nflverse/nflverse-data/releases/download/stats_player";

type Row = Record<string, string>;
type Player = { id: string; name: string; pos: "QB" | "RB" | "WR" | "TE"; team: string | null; active: boolean };

const ALLOWED_POS = new Set(["QB", "RB", "WR", "TE"]);

async function fetchArrayBuffer(url: string) {
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    headers: {
      Accept: "text/csv,application/octet-stream,application/gzip",
      "User-Agent": "nfl-100pt-challenge/1.0",
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const err = new Error(`Fetch ${url} -> ${res.status}\n${txt.slice(0, 200)}`);
    // @ts-ignore
    err.status = res.status;
    throw err;
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function fetchSeasonCsvAny(season: number) {
  const candidates: { url: string; gz: boolean }[] = [
    { url: `${RAW_BASE}/player_stats_${season}.csv.gz`, gz: true },
    { url: `${REL_BASE_1}/stats_player_week_${season}.csv`, gz: false },
    { url: `${REL_BASE_1}/stats_player_week_${season}.csv.gz`, gz: true },
    { url: `${REL_BASE_2}/stats_player_week_${season}.csv`, gz: false },
    { url: `${REL_BASE_2}/stats_player_week_${season}.csv.gz`, gz: true },
  ];
  let lastErr: any = null;
  for (const c of candidates) {
    try {
      const buf = await fetchArrayBuffer(c.url);
      return { buf, gz: c.gz, url: c.url };
    } catch (e: any) {
      lastErr = e;
    }
  }
  throw new Error(
    `No weekly stats file found for ${season}.\n` +
      (lastErr?.message ? `Last error: ${lastErr.message}` : "")
  );
}

function pick<T>(row: Record<string, any>, keys: string[]): T | null {
  for (const k of keys) if (row[k] != null && row[k] !== "") return row[k] as T;
  return null;
}

// Extract players for a single week
function playersFromWeek(rows: Row[], week: number): Player[] {
  const byId = new Map<string, Player>();
  for (const r of rows) {
    const w = Number(r.week);
    if (!Number.isFinite(w) || w !== week) continue;

    const pos = String(r.position ?? r.position_group ?? "").toUpperCase();
    if (!ALLOWED_POS.has(pos)) continue;

    const id = pick<string>(r, ["player_id", "gsis_id", "gsis_player_id", "gsisid"]);
    if (!id) continue;

    const name = pick<string>(r, ["player_name", "name"]) ?? "Unknown";
    const team = pick<string>(r, ["recent_team", "team", "recent_team_abbr"]) ?? null;

    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name,
        pos: pos as Player["pos"],
        team,
        active: true,
      });
    }
  }
  const players = Array.from(byId.values());
  players.sort((a, b) => a.name.localeCompare(b.name));
  return players;
}

// Extract unique players for the whole season
function playersFromSeason(rows: Row[]): Player[] {
  const byId = new Map<string, Player>();
  for (const r of rows) {
    const pos = String(r.position ?? r.position_group ?? "").toUpperCase();
    if (!ALLOWED_POS.has(pos)) continue;

    const id = pick<string>(r, ["player_id", "gsis_id", "gsis_player_id", "gsisid"]);
    if (!id) continue;

    const prev = byId.get(id);
    if (prev) continue;

    const name = pick<string>(r, ["player_name", "name"]) ?? "Unknown";
    const team = pick<string>(r, ["recent_team", "team", "recent_team_abbr"]) ?? null;

    byId.set(id, {
      id,
      name,
      pos: pos as Player["pos"],
      team,
      active: true,
    });
  }
  const players = Array.from(byId.values());
  players.sort((a, b) => a.name.localeCompare(b.name));
  return players;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const seasonStr = searchParams.get("season") ?? "";
    const weekStr = searchParams.get("week"); // optional

    if (!/^\d{4}$/.test(seasonStr)) {
      return NextResponse.json({ error: "season (YYYY) is required" }, { status: 400 });
    }
    const season = Number(seasonStr);
    const week = weekStr && /^\d{1,2}$/.test(weekStr) ? Number(weekStr) : undefined;

    const fetched = await fetchSeasonCsvAny(season);
    const isGzipMagic =
      fetched.buf.length >= 2 && fetched.buf[0] === 0x1f && fetched.buf[1] === 0x8b;
    const csvBuffer = fetched.gz || isGzipMagic ? gunzipSync(fetched.buf) : fetched.buf;
    const rows = parseCsvSync(csvBuffer, { columns: true, skip_empty_lines: true }) as Row[];

    const players = week != null ? playersFromWeek(rows, week) : playersFromSeason(rows);

    return NextResponse.json(
      { season, ...(week != null ? { week } : {}), count: players.length, players },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("[/api/players] error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Unknown error in /api/players" },
      { status: 502 }
    );
  }
}
