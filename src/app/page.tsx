"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";

type Mode = "std" | "half" | "ppr";
type Player = { id: string; name: string; pos: "QB" | "RB" | "WR" | "TE"; team: string | null; active: boolean; };
type PointsMap = Record<string, number>;
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

  // Load points for the chosen week/mode
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
          setSeasonUsed(typeof j.seasonUsed === "number" ? j.seasonUsed : null);
          const msg = Array.isArray(j.warnings) && j.warnings.length ? String(j.warnings[0]) : null;
          setApiWarning(msg);
        } else {
          setPoints({});
          setSeasonUsed(null);
          setApiWarning(j?.error ?? null);
        }
      } catch (e) {
        console.error(e);
        setPoints({});
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
    const locked = ptsFor(pick) > 0;
    const options = useMemo(() => {
      const filtered = candidates.filter((p) => {
        if (!p.id) return false;
        if (pick && p.id === pick) return true;
        return !selectedIds.has(p.id);
      });
      filtered.sort((a, b) => {
        const da = ptsFor(a.id);
        const db = ptsFor(b.id);
        if (db !== da) return db - da;
        return a.name.localeCompare(b.name);
      });
      return filtered;
    }, [candidates, pick, selectedIds, points]);

    const livePts = pick ? ptsFor(pick).toFixed(2) : "0.00";

    return (
      <Card className="rounded-2xl shadow-lg backdrop-blur bg-white/70 border border-slate-200 transition hover:shadow-xl">
        <CardHeader className="pb-1">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{label}</CardTitle>
            <span className="text-xs text-slate-500">Week {week}</span>
          </div>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Select
            value={pick ?? ""}
            onValueChange={(v) => setPick(v || null)}
            disabled={locked || loadingPlayers}
          >
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

          {locked ? (
            <Button variant="secondary" onClick={() => setPick(null)}>Clear</Button>
          ) : null}
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
