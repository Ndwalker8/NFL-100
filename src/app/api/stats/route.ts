import { NextRequest, NextResponse } from "next/server";
import { gunzipSync } from "zlib";
import { parse as parseCsvSync } from "csv-parse/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
const ALLOWED_POS = new Set(["QB", "RB", "WR", "TE"]);

function num(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function computeFantasyPoints(row: Row, mode: "std" | "half" | "ppr") {
  if (mode === "ppr" && row.fantasy_points_ppr != null) return num(row.fantasy_points_ppr);
  if (mode === "half" && row.fantasy_points_half_ppr != null) return num(row.fantasy_points_half_ppr);
  if (mode === "std" && row.fantasy_points != null) return num(row.fantasy_points);

  const passYd = num(row.passing_yards);
  const passTd = num(row.passing_tds);
  const passInt = num(row.passing_interceptions ?? row.interceptions);
  const rushYd = num(row.rushing_yards);
  const rushTd = num(row.rushing_tds);
  const recYd = num(row.receiving_yards);
  const recTd = num(row.receiving_tds);
  const rec = num(row.receptions);
  const fumblesLost = num(row.fumbles_lost ?? row.fumbles);

  let points =
    passYd / 25 +
    passTd * 4 +
    rushYd / 10 +
    recYd / 10 +
    rushTd * 6 +
    recTd * 6 -
    fumblesLost * 2 -
    passInt * 2;

  if (mode === "ppr") points += rec * 1.0;
  if (mode === "half") points += rec * 0.5;

  return points;
}

function getGsisId(row: Row): string | null {
  return row.player_id ?? row.gsis_id ?? row.gsis_player_id ?? row.gsisid ?? null;
}

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

async function fetchWeeklyCsvAny(season: number) {
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
      continue;
    }
  }
  throw new Error(
    `No weekly stats found for ${season}. Tried:\n` +
      candidates.map((c) => "- " + c.url).join("\n") +
      (lastErr ? `\nLast error: ${String(lastErr.message || lastErr)}` : "")
  );
}

function extractSeasonFromUrl(u: string): number | null {
  const m = u.match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const seasonStr = searchParams.get("season") ?? "";
    const weekStr = searchParams.get("week") ?? "";
    const mode = (searchParams.get("mode") ?? "ppr").toLowerCase() as "std" | "half" | "ppr";
    const debug = searchParams.get("debug") === "1";

    if (!/^\d{4}$/.test(seasonStr)) {
      return NextResponse.json({ error: "season must be YYYY" }, { status: 400 });
    }
    const season = Number(seasonStr);

    const week = Number(weekStr);
    if (!Number.isFinite(week) || week < 1 || week > 22) {
      return NextResponse.json({ error: "week must be between 1–22" }, { status: 400 });
    }

    let fetched: { buf: Buffer; gz: boolean; url: string } | null = null;

    try {
      fetched = await fetchWeeklyCsvAny(season);
    } catch (e: any) {
      if (season > 2024) {
        fetched = await fetchWeeklyCsvAny(season - 1);
      } else {
        throw e;
      }
    }

    if (!fetched) throw new Error("unexpected: no file fetched");

    const isGzipMagic =
      fetched.buf.length >= 2 && fetched.buf[0] === 0x1f && fetched.buf[1] === 0x8b;
    const csvBuffer = fetched.gz || isGzipMagic ? gunzipSync(fetched.buf) : fetched.buf;

    const rows = parseCsvSync(csvBuffer, { columns: true, skip_empty_lines: true }) as Row[];

    if (debug) {
      return NextResponse.json({
        debug: true,
        requested: { season, week, mode },
        fetched: { url: fetched.url, bytes: fetched.buf.length, gz: fetched.gz, parsedRows: rows.length },
        sample: rows.slice(0, 3),
      });
    }

    const pointsByGsis = new Map<string, number>();
    let missingId = 0;
    let matchedRows = 0;

    for (const row of rows) {
      const rowWeek = Number(row.week);
      if (rowWeek !== week) continue;

      const pos = String(row.position ?? row.position_group ?? "").toUpperCase();
      if (!ALLOWED_POS.has(pos)) continue;

      matchedRows++;

      const gsis = getGsisId(row);
      if (!gsis) {
        missingId++;
        continue;
      }

      const pts = computeFantasyPoints(row, mode);
      const prev = pointsByGsis.get(gsis);
      if (prev == null || pts > prev) pointsByGsis.set(gsis, pts);
    }

    const seasonUsed = extractSeasonFromUrl(fetched.url);

    return NextResponse.json(
      {
        seasonUsed,                // <— NEW (numeric, e.g. 2024)
        seasonResolvedFrom: fetched.url,
        week,
        mode,
        parsed_rows: rows.length,
        matched_rows: matchedRows,
        count: pointsByGsis.size,
        warnings: [
          ...(missingId > 0 ? [`${missingId} rows for week ${week} missing player_id (skipped)`] : []),
        ],
        points: Object.fromEntries(pointsByGsis),
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("[/api/stats] error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Unknown error in /api/stats" },
      { status: 502 }
    );
  }
}
