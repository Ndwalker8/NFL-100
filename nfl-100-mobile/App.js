import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  FlatList,
  Text,
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
  TextInput,
  Alert,
} from "react-native";
import Constants from "expo-constants";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import AuthModal from "./screens/AuthModal";
import { supabase } from "./lib/supabase";

/** ---- App level constants ---- */
const BASE_URL =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_API_URL ??
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.select({
    ios: "http://localhost:3000",
    android: "http://10.0.2.2:3000",
    default: "http://192.168.0.137:3000",
  }));
const MODE = "ppr";
const POS_ORDER = ["QB", "RB", "WR", "TE"];

/** ---- Root ---- */
export default function App() {
  return (
    <AuthProvider>
      <Navigator />
    </AuthProvider>
  );
}

function Navigator() {
  const [screen, setScreen] = useState("home"); // 'home' | 'picks' | 'profile'
  if (screen === "picks")   return <PickScreen goBack={() => setScreen("home")} />;
  if (screen === "profile") return <ProfileScreen goBack={() => setScreen("home")} />;
  return <HomeScreen goToPicks={() => setScreen("picks")} goToProfile={() => setScreen("profile")} />;
}

/** ---- Shared: fetch current {season, week} ---- */
function useLatestMeta() {
  const [meta, setMeta] = useState({ season: null, week: null });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const r = await fetch(`${BASE_URL}/api/meta`);
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "meta fetch failed");
        if (on) setMeta({ season: j.season, week: j.week });
      } catch (e) {
        if (on) setErr(String(e?.message || e));
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, []);

  return { ...meta, loading, err };
}

/** ---- Utilities ---- */
function displayNameFrom(user, profile) {
  return (
    profile?.username ??
    user?.user_metadata?.username ??
    (user?.email ? user.email.split("@")[0] : null) ??
    "User"
  );
}
function defaultAvatarUrl(name = "User") {
  const seed = encodeURIComponent(name);
  return `https://api.dicebear.com/7.x/thumbs/png?seed=${seed}`;
}
async function ensureProfile(user) {
  if (!user) return null;
  const { data: prof, error } = await supabase
    .from("profiles").select("id, username, avatar_url")
    .eq("id", user.id).maybeSingle();
  if (error) return null;
  if (prof) return prof;

  const username = displayNameFrom(user, null);
  const avatar_url = defaultAvatarUrl(username);
  const { data: created } = await supabase
    .from("profiles")
    .insert({ id: user.id, username, avatar_url })
    .select("id, username, avatar_url")
    .maybeSingle();
  return created ?? null;
}
function hasStarted(s) {
  if (!s) return false;
  for (const k of ["passYds","passTD","passINT","rushYds","rushTD","rec","recYds","recTD"]) {
    const v = s[k]; if (typeof v === "number" && v > 0) return true;
  }
  return false;
}

/** ===================== HOME ===================== */
function HomeScreen({ goToPicks, goToProfile }) {
  const { user } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [username, setUsername] = useState(null);
  const [avatar, setAvatar] = useState(null);
  const [hits100, setHits100] = useState(null);
  const { season: SEASON, week: WEEK, loading: metaLoading } = useLatestMeta();

  useEffect(() => {
    (async () => {
      if (!user) return;
      const prof = await ensureProfile(user);
      setUsername(displayNameFrom(user, prof));
      setAvatar(prof?.avatar_url ?? defaultAvatarUrl(displayNameFrom(user, prof)));
      if (authOpen) setAuthOpen(false);
    })();
  }, [user]);

  useEffect(() => {
    let on = true;
    (async () => {
      if (!user || !SEASON || !WEEK) { setHits100(null); return; }
      const { count } = await supabase
        .from("lineups").select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("season", SEASON)
        .lt("week", WEEK)
        .gte("total_points", 99.95).lte("total_points", 100.05);
      if (on) setHits100(count ?? 0);
    })();
    return () => { on = false; };
  }, [user, SEASON, WEEK]);

  const onPressProfile = () => { user ? goToProfile() : setAuthOpen(true); };

  return (
    <SafeAreaView style={S.container}>
      <LinearGradient colors={["#7c3aed","#06b6d4"]} start={{x:0,y:0}} end={{x:1,y:1}} style={S.headerFull}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={S.appTitle}>Gridiron Hundred</Text>
          <Text style={S.appSub}>
            {metaLoading || !SEASON || !WEEK ? "Loading week…" : `Season ${SEASON} · Week ${WEEK} · ${MODE.toUpperCase()}`}
          </Text>
          <View style={{ marginTop: 2, flexDirection: "row", alignItems: "center", gap: 10 }}>
            {user ? (
              <>
                <Image source={{ uri: avatar || defaultAvatarUrl(username || "User") }}
                       style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: "rgba(255,255,255,0.5)" }}/>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "white", fontWeight: "800" }}>@{username ?? "loading"} 👋</Text>
                  <Text style={{ color: "white", opacity: 0.95, fontWeight: "700" }}>
                    {hits100 === null ? "Loading your 100-point hits…" : `100-point hits (prior weeks): ${hits100}`}
                  </Text>
                </View>
              </>
            ) : (
              <Text style={{ color: "white", fontWeight: "800" }}>Welcome! Sign in to track your stats</Text>
            )}
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <TouchableOpacity onPress={onPressProfile} style={S.smallBtn}>
            <Text style={S.smallBtnTxt}>{user ? "Profile" : "Sign In"}</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <View style={{ gap: 12 }}>
        <TouchableOpacity activeOpacity={0.9} onPress={goToPicks} disabled={metaLoading || !SEASON || !WEEK}>
          <LinearGradient colors={["#0ea5e9","#22c55e"]} start={{x:0,y:0}} end={{x:1,y:1}} style={S.bigTile}>
            <Text style={S.bigTileTxt}>NFL</Text>
            <Text style={S.bigTileSub}>{metaLoading ? "Loading…" : "Play the 100-point challenge"}</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TileDisabled label="NBA" />
        <TileDisabled label="NHL" />
      </View>

      <Modal visible={authOpen} animationType="slide" onRequestClose={() => setAuthOpen(false)} transparent>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-end" }}>
          <AuthModal onClose={() => setAuthOpen(false)} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}
function TileDisabled({ label }) {
  return (
    <LinearGradient colors={["#94a3b8","#64748b"]} start={{x:0,y:0}} end={{x:1,y:1}} style={[S.bigTile,{opacity:0.6}]}>
      <Text style={S.bigTileTxt}>{label}</Text>
      <Text style={S.bigTileSub}>Coming soon</Text>
    </LinearGradient>
  );
}

/** ===================== PROFILE ===================== */
function ProfileScreen({ goBack }) {
  const { user } = useAuth();
  const { season: SEASON, week: WEEK, loading: metaLoading } = useLatestMeta();

  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("User");
  const [avatar, setAvatar] = useState(defaultAvatarUrl("User"));
  const [wins, setWins] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [best, setBest] = useState(null);

  // Friends state
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [friends, setFriends] = useState([]); // [{id, username, avatar_url, wins}]
  const [friendsErr, setFriendsErr] = useState(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        setLoading(true);
        if (!user) return;
        const prof = await ensureProfile(user);
        const display = displayNameFrom(user, prof);
        setUsername(display);
        setAvatar(prof?.avatar_url ?? defaultAvatarUrl(display));

        if (SEASON && WEEK) {
          const [{ count: w }, { count: a }, bestRes] = await Promise.all([
            supabase.from("lineups")
              .select("id", { count: "exact", head: true })
              .eq("user_id", user.id)
              .eq("season", SEASON)
              .lt("week", WEEK)
              .gte("total_points", 99.95).lte("total_points", 100.05),
            supabase.from("lineups")
              .select("id", { count: "exact", head: true })
              .eq("user_id", user.id)
              .eq("season", SEASON).lt("week", WEEK),
            supabase.from("lineups")
              .select("season, week, total_points")
              .eq("user_id", user.id)
              .order("total_points", { ascending: false })
              .limit(1),
          ]);
          if (on) {
            setWins(w ?? 0);
            setAttempts(a ?? 0);
            setBest(bestRes?.data?.[0] ?? null);
          }
        }
      } finally { if (on) setLoading(false); }
    })();
    return () => { on = false; };
  }, [user, SEASON, WEEK]);

  // Friends loader (mutual follows)
  useEffect(() => {
    let on = true;
    (async () => {
      setFriendsLoading(true);
      setFriendsErr(null);
      try {
        if (!user || !SEASON || !WEEK) { setFriends([]); return; }

        // 1) mutual friend IDs via RPC
        const { data: mutuals, error: rpcErr } = await supabase.rpc("mutual_friends", { this_user: user.id });
        if (rpcErr && (rpcErr.code === "42883" || /mutual_friends/i.test(rpcErr.message || ""))) {
          if (on) setFriends([]); // RPC missing yet
          return;
        }
        if (rpcErr) throw rpcErr;

        const friendIds = (mutuals ?? []).map(r => r.friend_id);
        if (!friendIds.length) { if (on) setFriends([]); return; }

        // 2) profiles
        const { data: profs, error: profErr } = await supabase
          .from("profiles")
          .select("id, username, avatar_url")
          .in("id", friendIds);
        if (profErr) throw profErr;

        // 3) prior-week wins
        const { data: winRows, error: winsErr } = await supabase
          .from("lineups")
          .select("user_id, total_points")
          .eq("season", SEASON)
          .lt("week", WEEK)
          .gte("total_points", 99.95).lte("total_points", 100.05)
          .in("user_id", friendIds);
        if (winsErr) throw winsErr;

        const winCounts = {};
        for (const r of winRows ?? []) winCounts[r.user_id] = (winCounts[r.user_id] ?? 0) + 1;

        const shaped = (profs ?? []).map(p => ({
          id: p.id,
          username: p.username ?? "User",
          avatar_url: p.avatar_url ?? defaultAvatarUrl(p.username ?? "User"),
          wins: winCounts[p.id] ?? 0,
        })).sort((a, b) => b.wins - a.wins);

        if (on) setFriends(shaped);
      } catch (e) {
        if (on) setFriendsErr(String(e?.message || e));
      } finally {
        if (on) setFriendsLoading(false);
      }
    })();
    return () => { on = false; };
  }, [user, SEASON, WEEK]);

  // Add friend handler
  const addFriendByUsername = async (usernameInput) => {
    const handle = (usernameInput || "").trim().replace(/^@/, "");
    if (!handle) return { ok: false, msg: "Enter a username" };
    if (!user) return { ok: false, msg: "Please sign in" };

    // find user by username (case-insensitive)
    const { data: target, error: findErr } = await supabase
      .from("profiles")
      .select("id, username")
      .ilike("username", handle)
      .maybeSingle();
    if (findErr) return { ok: false, msg: findErr.message };
    if (!target) return { ok: false, msg: "User not found" };
    if (target.id === user.id) return { ok: false, msg: "You can’t follow yourself" };

    // insert follow edge (ignore if already exists)
    const { error: insErr } = await supabase
      .from("follows")
      .insert({ follower: user.id, following: target.id })
      .select("follower, following")
      .maybeSingle();

    if (insErr?.code === "23505") return { ok: true, msg: `Already following @${target.username}` }; // PK conflict
    if (insErr) return { ok: false, msg: insErr.message };

    return { ok: true, msg: `Now following @${target.username}. When they follow back you’ll be friends.` };
  };

  if (!user) {
    return (
      <SafeAreaView style={S.center}>
        <Text style={S.title}>Please sign in</Text>
        <Text style={S.muted}>Go back and tap “Sign In”.</Text>
      </SafeAreaView>
    );
  }
  if (loading || metaLoading) {
    return (
      <SafeAreaView style={S.center}>
        <ActivityIndicator size="large" />
        <Text style={S.muted}>Loading profile…</Text>
      </SafeAreaView>
    );
  }

  const losses = Math.max(0, attempts - wins);

  return (
    <SafeAreaView style={S.container}>
      <LinearGradient colors={["#7c3aed","#06b6d4"]} start={{x:0,y:0}} end={{x:1,y:1}} style={S.headerFull}>
        <TouchableOpacity onPress={goBack} style={S.smallBtn}><Text style={S.smallBtnTxt}>← Home</Text></TouchableOpacity>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Image source={{ uri: avatar }} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: "rgba(255,255,255,0.5)" }} />
          <View>
            <Text style={S.appTitle}>@{username}</Text>
            <Text style={S.appSub}>Season {SEASON} · Week {WEEK} · {MODE.toUpperCase()}</Text>
          </View>
        </View>
        <View style={{ width: 64 }} />
      </LinearGradient>

      <View style={S.profileGrid}>
        <StatCard title="Wins (100/100)" value={String(wins)} />
        <StatCard title="Attempts" value={String(attempts)} />
        <StatCard title="Record" value={`${wins}-${losses}`} />
        <StatCard title="Best Week" value={best ? `${best.total_points.toFixed(2)} pts (S${best.season} W${best.week})` : "—"} />
      </View>

      {/* Friends section */}
      <FriendsList
        loading={friendsLoading}
        error={friendsErr}
        friends={friends}
        onAdd={() => setAddOpen(true)}
      />

      {/* Add Friend Modal */}
      <AddFriendModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={async (handle) => {
          const res = await addFriendByUsername(handle);
          Alert.alert(res.ok ? "Success" : "Hmm", res.msg);
          if (res.ok) setAddOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

function StatCard({ title, value }) {
  return (
    <View style={S.statCard}>
      <Text style={S.statTitle}>{title}</Text>
      <Text style={S.statValue}>{value}</Text>
    </View>
  );
}

function FriendsList({ loading, error, friends, onAdd }) {
  return (
    <View style={S.friendsBlock}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={S.sectionTitle}>Friends</Text>
        <TouchableOpacity onPress={onAdd} style={S.addBtn}><Text style={S.addBtnTxt}>+ Add</Text></TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ paddingVertical: 10, alignItems: "center", gap: 8 }}>
          <ActivityIndicator />
          <Text style={S.muted}>Loading friends…</Text>
        </View>
      ) : error ? (
        <Text style={S.error}>{error}</Text>
      ) : !friends?.length ? (
        <View style={S.emptyBox}>
          <Text style={S.muted}>No friends yet.</Text>
          <Text style={S.muted}>Follow each other to appear here.</Text>
        </View>
      ) : (
        friends.map((f) => (
          <View key={f.id} style={S.friendRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Image source={{ uri: f.avatar_url }} style={S.friendAvatar} />
              <View>
                <Text style={S.friendName}>@{f.username}</Text>
                <Text style={S.friendMeta}>100/100 (prior weeks): {f.wins}</Text>
              </View>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function AddFriendModal({ visible, onClose, onSubmit }) {
  const [handle, setHandle] = useState("");
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-end" }}>
        <View style={S.addModal}>
          <Text style={S.addTitle}>Add Friend</Text>
          <Text style={S.muted}>Enter their @username</Text>
          <TextInput
            value={handle}
            onChangeText={setHandle}
            placeholder="@username"
            autoCapitalize="none"
            autoCorrect={false}
            style={S.input}
          />
          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <TouchableOpacity onPress={onClose} style={[S.smallBtn,{ backgroundColor: "#e5e7eb" }]}><Text style={[S.smallBtnTxt,{ color:"#111827"}]}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => onSubmit(handle)} style={S.primaryBtn}><Text style={S.primaryBtnTxt}>Follow</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** ===================== PICK (NFL) ===================== */
function PickScreen({ goBack }) {
  const { user } = useAuth();

  const [players, setPlayers] = useState([]);
  const [points, setPoints] = useState({});
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [pickQB, setPickQB] = useState(null);
  const [pickRB, setPickRB] = useState(null);
  const [pickWR, setPickWR] = useState(null);
  const [pickTE, setPickTE] = useState(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState("QB");
  const [authOpen, setAuthOpen] = useState(false);

  const { season: SEASON, week: WEEK, loading: metaLoading, err: metaErr } = useLatestMeta();

  useEffect(() => {
    let ok = true;
    if (!SEASON || !WEEK) return;
    (async () => {
      try {
        setLoading(true); setError(null);
        const [pRes, sRes] = await Promise.all([
          fetch(`${BASE_URL}/api/players?season=${SEASON}`),
          fetch(`${BASE_URL}/api/stats?season=${SEASON}&week=${WEEK}&mode=${MODE}`),
        ]);
        const pJson = await pRes.json();
        const sJson = await sRes.json();
        if (!ok) return;
        if (!pRes.ok) throw new Error(pJson?.error || "Failed to load players");
        if (!sRes.ok) throw new Error(sJson?.error || "Failed to load stats");
        setPlayers(pJson.players || []);
        setPoints(sJson.points || {});
        setStats(sJson.stats || {});
      } catch (e) {
        setError(String(e?.message || e));
      } finally { if (ok) setLoading(false); }
    })();
    return () => { ok = false; };
  }, [SEASON, WEEK]);

  const pts = (id) => Number(points[id] ?? 0);
  const statLine = (id) => formatLine(stats[id]);

  const poolByPos = useMemo(() => {
    const map = { QB: [], RB: [], WR: [], TE: [] };
    for (const p of players) if (map[p.pos]) map[p.pos].push(p);
    for (const k of POS_ORDER) map[k].sort((a, b) => pts(b.id) - pts(a.id));
    return map;
  }, [players, points]);

  const lockedByPos = {
    QB: pickQB ? hasStarted(stats[pickQB]) : false,
    RB: pickRB ? hasStarted(stats[pickRB]) : false,
    WR: pickWR ? hasStarted(stats[pickWR]) : false,
    TE: pickTE ? hasStarted(stats[pickTE]) : false,
  };

  const selected = {
    QB: pickQB ? players.find((p) => p.id === pickQB) ?? null : null,
    RB: pickRB ? players.find((p) => p.id === pickRB) ?? null : null,
    WR: pickWR ? players.find((p) => p.id === pickWR) ?? null : null,
    TE: pickTE ? players.find((p) => p.id === pickTE) ?? null : null,
  };

  const total =
    (pickQB ? pts(pickQB) : 0) +
    (pickRB ? pts(pickRB) : 0) +
    (pickWR ? pts(pickWR) : 0) +
    (pickTE ? pts(pickTE) : 0);

  const shareLineup = async () => {
    if (!user) return setAuthOpen(true);
    if (!pickQB || !pickRB || !pickWR || !pickTE) return alert("Pick all 4 positions first.");
    const { error } = await supabase.from("lineups").insert({
      user_id: user.id,
      season: SEASON, week: WEEK,
      qb: pickQB, rb: pickRB, wr: pickWR, te: pickTE,
      total_points: total, visibility: "friends",
    });
    if (error) alert(error.message); else alert("Shared with your friends!");
  };

  if (metaLoading) {
    return (
      <SafeAreaView style={S.center}>
        <ActivityIndicator size="large" />
        <Text style={S.muted}>Loading current week…</Text>
      </SafeAreaView>
    );
  }
  if (metaErr || !SEASON || !WEEK) {
    return (
      <SafeAreaView style={S.center}>
        <Text style={S.title}>Couldn’t load current week</Text>
        <Text style={S.error}>{metaErr || "No meta returned"}</Text>
      </SafeAreaView>
    );
  }
  if (loading) {
    return (
      <SafeAreaView style={S.center}>
        <ActivityIndicator size="large" />
        <Text style={S.muted}>Loading from {BASE_URL}…</Text>
        <Text style={S.mono}>Season {SEASON} · Week {WEEK} · {MODE.toUpperCase()}</Text>
      </SafeAreaView>
    );
  }
  if (error) {
    return (
      <SafeAreaView style={S.center}>
        <Text style={S.title}>Connection Error</Text>
        <Text style={S.error}>{error}</Text>
        <Text style={S.muted}>Check that the web app is running and BASE_URL is correct.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={S.container}>
      {/* Header with back + centered Week + total */}
      <LinearGradient colors={["#7c3aed","#06b6d4"]} start={{x:0,y:0}} end={{x:1,y:1}} style={S.headerFull}>
        <View style={{ width: 72, alignItems: "flex-start" }}>
          <TouchableOpacity onPress={goBack} style={S.smallBtn}><Text style={S.smallBtnTxt}>← Home</Text></TouchableOpacity>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={S.weekBig}>Week {WEEK}</Text>
        </View>
        <View style={{ width: 72, alignItems: "flex-end" }}>
          <Text style={S.headerTotalTop}>Total</Text>
          <Text style={S.headerTotal}>{total.toFixed(2)}</Text>
        </View>
      </LinearGradient>

      <Card label="QB" gradient={["#60a5fa","#34d399"]}
        player={selected.QB} points={pickQB ? pts(pickQB).toFixed(2) : null}
        stats={pickQB ? statLine(pickQB) : null} locked={lockedByPos.QB}
        onPress={() => { if (!lockedByPos.QB) { setPickerPos("QB"); setPickerOpen(true); } }}
        onClear={() => { if (!lockedByPos.QB) setPickQB(null); }} />
      <Card label="RB" gradient={["#f59e0b","#ef4444"]}
        player={selected.RB} points={pickRB ? pts(pickRB).toFixed(2) : null}
        stats={pickRB ? statLine(pickRB) : null} locked={lockedByPos.RB}
        onPress={() => { if (!lockedByPos.RB) { setPickerPos("RB"); setPickerOpen(true); } }}
        onClear={() => { if (!lockedByPos.RB) setPickRB(null); }} />
      <Card label="WR" gradient={["#a78bfa","#22c55e"]}
        player={selected.WR} points={pickWR ? pts(pickWR).toFixed(2) : null}
        stats={pickWR ? statLine(pickWR) : null} locked={lockedByPos.WR}
        onPress={() => { if (!lockedByPos.WR) { setPickerPos("WR"); setPickerOpen(true); } }}
        onClear={() => { if (!lockedByPos.WR) setPickWR(null); }} />
      <Card label="TE" gradient={["#f472b6","#3b82f6"]}
        player={selected.TE} points={pickTE ? pts(pickTE).toFixed(2) : null}
        stats={pickTE ? statLine(pickTE) : null} locked={lockedByPos.TE}
        onPress={() => { if (!lockedByPos.TE) { setPickerPos("TE"); setPickerOpen(true); } }}
        onClear={() => { if (!lockedByPos.TE) setPickTE(null); }} />

      <TouchableOpacity onPress={shareLineup} style={S.shareBtn}>
        <Text style={S.shareTxt}>{user ? "Share with Friends" : "Sign in to Share"}</Text>
      </TouchableOpacity>

      {/* Player picker */}
      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: "#0f172a" }}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ color: "white", fontSize: 18, fontWeight: "700" }}>Select {pickerPos}</Text>
          </View>
          <FlatList
            style={{ backgroundColor: "white", borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
            contentContainerStyle={{ padding: 12 }}
            data={poolByPos[pickerPos] ?? []}
            keyExtractor={(p) => p.id}
            renderItem={({ item: p }) => {
              const started = hasStarted(stats[p.id]);
              return (
                <TouchableOpacity
                  style={[S.pickRow, started && { opacity: 0.5 }]}
                  activeOpacity={started ? 1 : 0.8}
                  onPress={() => {
                    if (started) return;
                    if (pickerPos === "QB") setPickQB(p.id);
                    if (pickerPos === "RB") setPickRB(p.id);
                    if (pickerPos === "WR") setPickWR(p.id);
                    if (pickerPos === "TE") setPickTE(p.id);
                    setPickerOpen(false);
                  }}
                >
                  <View>
                    <Text style={S.pickName}>{p.name}</Text>
                    <Text style={S.pickMeta}>{p.team ?? "NFL"} · {p.pos}</Text>
                  </View>
                  <Text style={[S.pickPts, started && { color: "#64748b" }]}>
                    {started ? "LOCKED" : (points[p.id] ?? 0).toFixed(2)}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
          <TouchableOpacity onPress={() => setPickerOpen(false)} style={{ padding: 16, alignItems: "center" }}>
            <Text style={{ color: "white", fontWeight: "600" }}>Close</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>

      {/* Auth modal */}
      <Modal visible={authOpen} animationType="slide" onRequestClose={() => setAuthOpen(false)} transparent>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-end" }}>
          <AuthModal onClose={() => setAuthOpen(false)} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/** ---- Shared UI ---- */
function Card({ label, gradient, player, points, stats, locked, onPress, onClear }) {
  return (
    <TouchableOpacity activeOpacity={locked ? 1 : 0.9} onPress={onPress} style={S.cardOuter}>
      <LinearGradient colors={gradient} start={{x:0,y:0}} end={{x:1,y:1}} style={[S.card, S.cardNarrow, locked && { opacity: 0.85 }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={S.cardLabel}>{label}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {locked && (
              <View style={{ backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                <Text style={{ color: "white", fontWeight: "800", fontSize: 12 }}>Locked</Text>
              </View>
            )}
            {points != null ? <Text style={S.cardPts}>{points}</Text> : null}
          </View>
        </View>

        {player ? (
          <>
            <Text style={S.cardName}>{player.name}</Text>
            <Text style={S.cardMeta}>{player.team ?? "NFL"} · {player.pos}</Text>
            <View style={S.statRow}>
              <Text style={S.cardStats} numberOfLines={1} ellipsizeMode="tail" adjustsFontSizeToFit minimumFontScale={0.92}>
                {stats}
              </Text>
              {!locked && (
                <TouchableOpacity onPress={onClear} style={S.clearInlineBtn}>
                  <Text style={S.clearInlineTxt}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        ) : (
          <Text style={S.cardPickHint}>{locked ? "Locked" : `Tap to choose a ${label}`}</Text>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}
function formatLine(s) {
  if (!s) return "—";
  const parts = [];
  if (s.passYds || s.passTD || s.passINT) parts.push(`Pass ${s.passYds}y ${s.passTD}TD${s.passINT ? ` ${s.passINT}INT` : ""}`);
  if (s.rushYds || s.rushTD) parts.push(`Rush ${s.rushYds}y ${s.rushTD}TD`);
  if (s.rec || s.recYds || s.recTD) parts.push(`Rec ${s.rec}-${s.recYds}y ${s.recTD}TD`);
  if (!parts.length) return "No counting stats.";
  return parts.join(" · ");
}

/** ---- Styles ---- */
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#eef2ff", padding: 16, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc", gap: 8 },
  muted: { fontSize: 12, color: "#64748b" },
  mono: { fontSize: 11, color: "#475569", fontFamily: "Courier" },
  title: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  error: { fontSize: 13, color: "#b91c1c", textAlign: "center", paddingHorizontal: 24 },

  headerFull: {
    marginHorizontal: -16, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16,
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
  },
  appTitle: { color: "white", fontSize: 24, fontWeight: "800" },
  appSub: { color: "white", opacity: 0.9, marginTop: 2, fontWeight: "600" },
  headerTotalTop: { color: "white", opacity: 0.8, fontSize: 12 },
  headerTotal: { color: "white", fontSize: 26, fontWeight: "900" },
  smallBtn: { backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  smallBtnTxt: { color: "white", fontWeight: "700" },

  bigTile: { borderRadius: 18, padding: 18, justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8 },
  bigTileTxt: { color: "white", fontSize: 20, fontWeight: "900" },
  bigTileSub: { color: "white", opacity: 0.95, marginTop: 6, fontWeight: "700" },

  // Profile stat cards
  profileGrid: { marginTop: 12, gap: 12 },
  statCard: { backgroundColor: "white", borderRadius: 14, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: "#e2e8f0" },
  statTitle: { fontSize: 12, color: "#64748b", fontWeight: "700" },
  statValue: { fontSize: 18, color: "#0f172a", fontWeight: "900", marginTop: 4 },

  // Friends
  sectionTitle: { fontSize: 16, fontWeight: "900", color: "#0f172a" },
  friendsBlock: {
    marginTop: 12, backgroundColor: "white", borderRadius: 14, padding: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#e2e8f0", gap: 10,
  },
  emptyBox: {
    backgroundColor: "#f8fafc", borderRadius: 12, padding: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#e2e8f0", alignItems: "center", gap: 4,
  },
  friendRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb" },
  friendAvatar: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: "#e2e8f0" },
  friendName: { fontWeight: "800", color: "#0f172a" },
  friendMeta: { fontSize: 12, color: "#64748b", marginTop: 2 },

  // Add Friend modal
  addModal: {
    backgroundColor: "white", padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#e5e7eb",
  },
  addTitle: { fontSize: 18, fontWeight: "900", color: "#0f172a", marginBottom: 6 },
  input: {
    marginTop: 8, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff",
  },
  addBtn: { backgroundColor: "#0ea5e9", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  addBtnTxt: { color: "white", fontWeight: "800" },
  primaryBtn: { backgroundColor: "#0ea5e9", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  primaryBtnTxt: { color: "white", fontWeight: "800" },

  // pick cards
  cardOuter: { marginBottom: 12, alignItems: "center" },
  cardNarrow: { width: "92%", alignSelf: "center" },
  card: {
    borderRadius: 18, paddingVertical: 14, paddingHorizontal: 14,
    shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, backgroundColor: "white",
  },
  cardLabel: { color: "white", fontSize: 15, fontWeight: "800" },
  cardPts: { color: "white", fontSize: 19, fontWeight: "900" },
  cardName: { color: "white", fontSize: 17, fontWeight: "800", marginTop: 6 },
  cardMeta: { color: "white", opacity: 0.9, marginTop: 2, fontWeight: "600" },
  statRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  cardStats: { color: "white", fontWeight: "600", lineHeight: 18, fontSize: 14, flex: 1, marginRight: 8 },
  clearInlineBtn: { backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  clearInlineTxt: { color: "white", fontWeight: "700" },
  cardPickHint: { color: "white", marginTop: 8, opacity: 0.9, fontWeight: "600" },

  pickRow: {
    backgroundColor: "white", borderRadius: 12, padding: 14, marginBottom: 8,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#e2e8f0",
  },
  pickName: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  pickMeta: { fontSize: 12, color: "#64748b" },
  pickPts: { fontSize: 14, fontWeight: "800", color: "#0ea5e9" },

  shareBtn: { alignSelf: "center", marginTop: 6, backgroundColor: "#0ea5e9", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  shareTxt: { color: "white", fontWeight: "800" },

  // header tweak for big week
  weekBig: { color: "white", fontSize: 30, fontWeight: "900", letterSpacing: 0.5 },
});
