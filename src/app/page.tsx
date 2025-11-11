"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Mode = "std" | "half" | "ppr";
type Player = { id: string; name: string; pos: "QB" | "RB" | "WR" | "TE"; team: string | null; active: boolean; };
type PointsMap = Record<string, number>;

// --- NEW: stat line wiring ---
type StatLine = {
  pos: "QB" | "RB" | "WR" | "TE";
  passYds: number;
  passTD: number;
  passINT: number;
  rushYds: number;
  rushTD: number;
  rec: number;
  recYds: number;
  recTD: number;
  fumLost: number;
};
type StatsMap = Record<string, StatLine>;

const POS_ORDER: Player["pos"][] = ["QB", "RB", "WR", "TE"];

function useLocal<T>(key: string, init: T) {
  const [val, setVal] = useState<T>(init);
  useEffect(() => {
    try {
      const s = localStorage.getItem(key);
      if (s != null) setVal(JSON.parse(s) as T);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {}
  }, [key, val]);
  return [val, setVal] as const;
}

// Probe for latest week with data in a season
async function probeLatestWeek(season: number, mode: Mode): Promise<number | null> {
  for (let w = 22; w >= 1; w--) {
    try {
      const r = await fetch(`/api/stats?season=${season}&week=${w}&mode=${mode}`, { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      if (j?.count && j.count > 0) return w;
    } catch {}
  }
  return null;
}
async function autoSeasonWeek(mode: Mode): Promise<{ season: number; week: number } | null> {
  const seasonsToTry = [2025, 2024, 2023];
  for (const s of seasonsToTry) {
    const w = await probeLatestWeek(s, mode);
    if (w) return { season: s, week: w };
  }
  return null;
}

// --- NEW: small formatter for stat lines shown in UI ---
function formatStatsBrief(s?: StatLine) {
  if (!s) return "";
  const parts: string[] = [];
  if (s.passYds || s.passTD || s.passINT) {
    parts.push(`Pass ${s.passYds}y ${s.passTD}TD${s.passINT ? ` ${s.passINT}INT` : ""}`);
  }
  if (s.rushYds || s.rushTD) {
    parts.push(`Rush ${s.rushYds}y ${s.rushTD}TD`);
  }
  if (s.rec || s.recYds || s.recTD) {
    parts.push(`Rec ${s.rec}-${s.recYds}y ${s.recTD}TD`);
  }
  if (!parts.length) return "—";
  return parts.join(" • ");
}

export default function App() {
  // Persistent controls
  const [season, setSeason] = useLocal<number>("season", 2024);
  const [week, setWeek] = useLocal<number>("week", 1);
  const [mode, setMode] = useLocal<Mode>("mode", "ppr");
  const [target, setTarget] = useLocal<number>("target", 100);

  // Data
  const [pool, setPool] = useState<Player[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [points, setPoints] = useState<PointsMap>({});
  const [stats, setStats] = useState<StatsMap>({}); // NEW
  const [loadingStats, setLoadingStats] = useState(false);

  // Picks
  const [qb, setQB] = useLocal<string | null>("pick_qb", null);
  const [rb, setRB] = useLocal<string | null>("pick_rb", null);
  const [wr, setWR] = useLocal<string | null>("pick_wr", null);
  const [te, setTE] = useLocal<string | null>("pick_te", null);

  // Server hints
  const [seasonUsed, setSeasonUsed] = useState<number | null>(null);
  const [apiWarning, setApiWarning] = useState<string | null>(null);

  // Helpers
  const ptsFor = (gsis: string | null | undefined) => (gsis ? Number(points[gsis] ?? 0) : 0);
  const statsFor = (gsis: string | null | undefined) => (gsis ? stats[gsis] : undefined);
  const totalNum = ptsFor(qb) + ptsFor(rb) + ptsFor(wr) + ptsFor(te);
  const total = totalNum.toFixed(2);
  const won = totalNum >= target;
  const progressPct = Math.max(0, Math.min(100, Math.round((totalNum / target) * 100)));

  // Build SEASON player pool (ensures all players appear — even on bye/injury weeks)
  useEffect(() => {
    let ok = true;
    (async () => {
      setLoadingPlayers(true);
      try {
        const r = await fetch(`/api/players?season=${season}`, { cache: "no-store" });
        const j = await r.json();
        if (!ok) return;
        if (r.ok && j?.players) setPool(j.players as Player[]);
        else setPool([]);
      } catch (e) {
        console.error(e);
        setPool([]);
      } finally {
        if (ok) setLoadingPlayers(false);
      }
    })();
    return () => { ok = false; };
  }, [season]);

  // Load points + stats for the chosen week/mode
  useEffect(() => {
    let ok = true;
    (async () => {
      setLoadingStats(true);
      try {
        const r = await fetch(`/api/stats?season=${season}&week=${week}&mode=${mode}`, { cache: "no-store" });
        const j = await r.json();
        if (!ok) return;

        if (r.ok && j?.points) {
          setPoints(j.points as PointsMap);
          setStats((j.stats ?? {}) as StatsMap); // NEW
          setSeasonUsed(typeof j.seasonUsed === "number" ? j.seasonUsed : null);
          const msg = Array.isArray(j.warnings) && j.warnings.length ? String(j.warnings[0]) : null;
          setApiWarning(msg);
        } else {
          setPoints({});
          setStats({});
          setSeasonUsed(null);
          setApiWarning(j?.error ?? null);
        }
      } catch (e) {
        console.error(e);
        setPoints({});
        setStats({});
        setSeasonUsed(null);
        setApiWarning("Failed to load stats");
      } finally {
        if (ok) setLoadingStats(false);
      }
    })();
    return () => { ok = false; };
  }, [season, week, mode]);

  // Auto pick a valid season/week if current has no data
  useEffect(() => {
    let ok = true;
    (async () => {
      if (Object.keys(points).length > 0) return;
      const found = await autoSeasonWeek(mode);
      if (!ok) return;
      if (found) {
        if (found.season !== season) setSeason(found.season);
        if (found.week !== week) setWeek(found.week);
      }
    })();
    return () => { ok = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, points]);

  // Organize pool by position
  const poolByPos = useMemo(() => {
    const map: Record<Player["pos"], Player[]> = { QB: [], RB: [], WR: [], TE: [] };
    for (const p of pool) if (POS_ORDER.includes(p.pos)) map[p.pos].push(p);
    return map;
  }, [pool]);

  // Prevent duplicate selections
  const selectedIds = useMemo(() => {
    const s = new Set<string>();
    if (qb) s.add(qb);
    if (rb) s.add(rb);
    if (wr) s.add(wr);
    if (te) s.add(te);
    return s;
  }, [qb, rb, wr, te]);

  // Auto-fill: best scorer per slot, no duplicates
  function autoFillTop() {
    const picks: Partial<Record<Player["pos"], string>> = {};
    const used = new Set<string>();
    for (const pos of POS_ORDER) {
      const sorted = [...poolByPos[pos]].sort((a, b) => {
        const da = ptsFor(a.id);
        const db = ptsFor(b.id);
        if (db !== da) return db - da;
        return a.name.localeCompare(b.name);
      });
      for (const p of sorted) {
        if (!p.id) continue;
        if (used.has(p.id)) continue;
        picks[pos] = p.id;
        used.add(p.id);
        break;
      }
    }
    if (picks.QB) setQB(picks.QB!);
    if (picks.RB) setRB(picks.RB!);
    if (picks.WR) setWR(picks.WR!);
    if (picks.TE) setTE(picks.TE!);
  }
  function resetPicks() {
    setQB(null); setRB(null); setWR(null); setTE(null);
  }

  // Slot component — position-locked + sorted by THIS WEEK's points desc
function PlayerSlot({
  label, pick, setPick, candidates,
}: { label: Player["pos"]; pick: string | null; setPick: (v: string | null) => void; candidates: Player[]; }) {

  const [query, setQuery] = useState("");
  function normalize(s: string) {
    return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  }

  const options = useMemo(() => {
    const filtered = candidates.filter((p) => {
      if (!p.id) return false;
      if (pick && p.id === pick) return true; // keep current pick selectable
      return !selectedIds.has(p.id);
    });

    // apply name/team search
    const q = normalize(query);
    const filteredBySearch = q
      ? filtered.filter((p) => {
          const n = normalize(p.name);
          const t = p.team ? normalize(p.team) : "";
          return n.includes(q) || t.includes(q);
        })
      : filtered;

    // sort by this week's points desc, then name
    filteredBySearch.sort((a, b) => {
      const da = ptsFor(a.id);
      const db = ptsFor(b.id);
      if (db !== da) return db - da;
      return a.name.localeCompare(b.name);
    });

    return filteredBySearch;
  }, [candidates, pick, selectedIds, points, query]);

  const livePts = pick ? ptsFor(pick).toFixed(2) : "0.00";
  const s = statsFor(pick);

  return (
    <Card className="rounded-2xl shadow-lg backdrop-blur bg-white/70 border border-slate-200 transition hover:shadow-xl">
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{label}</CardTitle>
          <span className="text-xs text-slate-500">Week {week}</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Search input */}
        <Input
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          placeholder={`Search ${label} by name or team...`}
          className="mb-2"
        />
        {/* Picker row */}
        <div className="flex items-center gap-3">
          <Select value={pick ?? ""} onValueChange={(v) => setPick(v || null)} disabled={loadingPlayers}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={`Select ${label}`} />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {options.map((p) => {
                const pts = ptsFor(p.id).toFixed(2);
                return (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold">
                          {p.team ? p.team.slice(0, 3).toUpperCase() : "NFL"}
                        </span>
                        <span>{p.name}</span>
                      </span>
                      <span className="tabular-nums text-xs text-muted-foreground">{pts}</span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <div className="min-w-[84px] text-right">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Pts</div>
            <div className="tabular-nums font-semibold">{livePts}</div>
          </div>

          {pick ? <Button variant="secondary" onClick={() => setPick(null)}>Clear</Button> : null}
        </div>

        {/* Stats panel inside the box (only when a player is selected) */}
        {pick && s && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px] text-slate-700">
              {/* Passing */}
              {(s.passYds || s.passTD || s.passINT) ? (
                <div>
                  <div className="font-semibold text-slate-600 mb-0.5">Passing</div>
                  <div className="tabular-nums">Yds {s.passYds} • TD {s.passTD} • INT {s.passINT}</div>
                </div>
              ) : null}

              {/* Rushing */}
              {(s.rushYds || s.rushTD) ? (
                <div>
                  <div className="font-semibold text-slate-600 mb-0.5">Rushing</div>
                  <div className="tabular-nums">Yds {s.rushYds} • TD {s.rushTD}</div>
                </div>
              ) : null}

              {/* Receiving */}
              {(s.rec || s.recYds || s.recTD) ? (
                <div>
                  <div className="font-semibold text-slate-600 mb-0.5">Receiving</div>
                  <div className="tabular-nums">Rec {s.rec} • Yds {s.recYds} • TD {s.recTD}</div>
                </div>
              ) : null}

              {/* If no lines (e.g., TE with only blocking snaps) */}
              {!(s.passYds || s.passTD || s.passINT || s.rushYds || s.rushTD || s.rec || s.recYds || s.recTD) ? (
                <div className="text-slate-500">No counting stats recorded.</div>
              ) : null}
            </div>
            {/* Fumbles line (optional) */}
            {s.fumLost ? (
              <div className="mt-1 text-[11px] text-rose-700">Fumbles Lost: {s.fumLost}</div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* --- BRAND BACKGROUND --- */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120rem 60rem at -20% -10%, rgba(59,130,246,0.14), transparent 60%)," +
            "radial-gradient(100rem 50rem at 120% -10%, rgba(16,185,129,0.12), transparent 60%)",
        }}
      />
      <div className="absolute inset-0 [mask-image:radial-gradient(90rem_60rem_at_center,black,transparent)] bg-[linear-gradient(#e5e7eb_1px,transparent_1px),linear-gradient(90deg,#e5e7eb_1px,transparent_1px)] bg-[size:72px_72px]" />
      <motion.div
        aria-hidden
        className="absolute -top-40 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-gradient-to-tr from-emerald-400/20 via-blue-400/20 to-transparent blur-3xl"
        initial={{ opacity: 0.6 }}
        animate={{ opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 10, repeat: Infinity }}
      />

      {/* --- CONTENT --- */}
      <div className="relative mx-auto max-w-6xl px-4 py-10 space-y-8">
        {/* HERO */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row md:items-end md:justify-between gap-4"
        >
          <div className="space-y-2">
            <h1 className="text-4xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-emerald-600 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
                Gridiron Hundred
              </span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Pick a QB, RB, WR, and TE for the selected NFL week. If your four players reach the target, you win.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-emerald-300/60 bg-emerald-50/60 px-3 py-1 text-xs text-emerald-800">
              Mode: <span className="font-semibold uppercase">{mode}</span>
            </span>
            <span className="rounded-full border border-slate-300/60 bg-white/70 px-3 py-1 text-xs text-slate-700">
              Season {season} • Week {week}
            </span>
          </div>
        </motion.div>

        {/* CONTROLS */}
        <Card className="rounded-2xl shadow-lg backdrop-blur bg-white/70 border border-slate-200">
          <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Season */}
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Season</div>
              <Select value={String(season)} onValueChange={(v) => setSeason(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Season" /></SelectTrigger>
                <SelectContent>
                  {[2023, 2024, 2025].map((y) => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {/* Week */}
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Week</div>
              <Select value={String(week)} onValueChange={(v) => setWeek(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Week" /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 22 }, (_, i) => i + 1).map((w) => (
                    <SelectItem key={w} value={String(w)}>Week {w}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Scoring */}
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Scoring</div>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger><SelectValue placeholder="Scoring" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="std">Standard</SelectItem>
                  <SelectItem value="half">Half-PPR</SelectItem>
                  <SelectItem value="ppr">PPR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Target */}
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Target</div>
              <div className="px-1">
                <Slider min={60} max={150} step={1} value={[target]} onValueChange={([v]) => setTarget(v)} />
                <div className="text-right mt-1">{target} pts</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Season fallback banner */}
        {seasonUsed != null && seasonUsed !== season && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Heads up: {season} weekly stats aren’t published yet. Showing {seasonUsed} instead.
          </div>
        )}

        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="default" onClick={autoFillTop} disabled={loadingStats || loadingPlayers}>
            Auto-fill Top Scorers
          </Button>
          <Button variant="secondary" onClick={resetPicks}>
            Reset Picks
          </Button>
          {apiWarning && (
            <span className="text-xs text-muted-foreground">{apiWarning}</span>
          )}
        </div>

        {/* SLOTS */}
        <div className="grid md:grid-cols-2 gap-5">
          <PlayerSlot label="QB" pick={qb} setPick={setQB} candidates={poolByPos.QB} />
          <PlayerSlot label="RB" pick={rb} setPick={setRB} candidates={poolByPos.RB} />
          <PlayerSlot label="WR" pick={wr} setPick={setWR} candidates={poolByPos.WR} />
          <PlayerSlot label="TE" pick={te} setPick={setTE} candidates={poolByPos.TE} />
        </div>

        {/* TOTAL / PROGRESS */}
        <Card className="rounded-2xl shadow-lg backdrop-blur bg-white/70 border border-slate-200">
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div className="text-lg">
                Total: <span className="font-semibold tabular-nums">{total}</span>
                {loadingStats && <span className="ml-2 text-sm text-muted-foreground">(loading stats…)</span>}
              </div>
              <div className={`text-sm px-3 py-1 rounded-full ${won ? "bg-emerald-600 text-white" : "bg-muted"}`}>
                {won ? "✅ Hit the target!" : `Need ${(Math.max(0, target - totalNum)).toFixed(2)} more`}
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-2 rounded-full bg-gradient-to-r from-emerald-500 via-blue-500 to-indigo-500 transition-[width]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-right text-xs text-muted-foreground">{progressPct}% of {target}</div>
          </CardContent>
        </Card>

        {/* FOOTER */}
        <div className="py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Gridiron Hundred — built with Next.js, Tailwind, shadcn/ui
        </div>
      </div>
    </div>
  );
}
