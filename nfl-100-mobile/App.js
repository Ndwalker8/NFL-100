// App.js
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
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView,
} from "react-native";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";
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
const REG_WEEKS = 18;

/** ---- Reusable gradient header that reaches under the notch ---- */
function GradientHeader({ children }) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={["#7c3aed", "#06b6d4"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        S.headerFull,
        {
          marginTop: -insets.top,
          paddingTop: insets.top + 40,
          paddingBottom: 24,
        },
      ]}
    >
      <StatusBar style="light" translucent backgroundColor="transparent" />
      {children}
    </LinearGradient>
  );
}

/** ---- Root ---- */
export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="light" translucent />
      <AuthProvider>
        <Navigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function Navigator() {
  const [screen, setScreen] = useState("home"); // 'home' | 'picks' | 'picksNBA' | 'profile'

  // NFL draft persisted while navigating
  const [draft, setDraft] = useState({ QB: null, RB: null, WR: null, TE: null });

  if (screen === "picks")
    return <PickScreen draft={draft} setDraft={setDraft} goBack={() => setScreen("home")} />;
  if (screen === "picksNBA")
    return <PickScreenNBA goBack={() => setScreen("home")} />;
  if (screen === "profile")
    return <ProfileScreen goBack={() => setScreen("home")} />;
  return <HomeScreen goToPicksNFL={() => setScreen("picks")} goToPicksNBA={() => setScreen("picksNBA")} goToProfile={() => setScreen("profile")} />;
}

/** ---- Shared: fetch current {season, week} (NFL) ---- */
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
        const txt = await r.text();
        let j = null;
        try { j = JSON.parse(txt); } catch (e) { throw new Error(`JSON parse error: ${txt.slice(0,140)}`); }
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

// DiceBear "thumbs" URL builder with seed + colors
function buildThumbUrl({ seed = "User", bg = "#e2e8f0", body = "#111827" } = {}) {
  const bgHex = (bg || "#e2e8f0").replace("#", "");
  const bodyHex = (body || "#111827").replace("#", "");
  const seedEnc = encodeURIComponent(seed);
  return `https://api.dicebear.com/7.x/thumbs/png?seed=${seedEnc}&backgroundColor=${bgHex}&shapeColor=${bodyHex}&radius=50`;
}

function defaultAvatarUrl(name = "User") {
  return buildThumbUrl({ seed: name, bg: "#0ea5e9", body: "#ffffff" });
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

// previous week helper (NFL)
function previousWeekOf(season, week) {
  if (week > 1) return { season, week: week - 1 };
  return { season: season - 1, week: REG_WEEKS };
}

/** ===================== HOME ===================== */
function HomeScreen({ goToPicksNFL, goToPicksNBA, goToProfile }) {
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
      const disp = displayNameFrom(user, prof);
      setUsername(disp);
      setAvatar(prof?.avatar_url ?? defaultAvatarUrl(disp));
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
    <SafeAreaView style={S.container} edges={['left','right','bottom']}>
      <GradientHeader>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={S.appTitle}>Fantasy Hundred</Text>
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
      </GradientHeader>

      <View style={{ gap: 12 }}>
        <TouchableOpacity activeOpacity={0.9} onPress={goToPicksNFL} >
          <LinearGradient colors={["#0ea5e9","#22c55e"]} start={{x:0,y:0}} end={{x:1,y:1}} style={S.bigTile}>
            <Text style={S.bigTileTxt}>NFL</Text>
            <Text style={S.bigTileSub}>{metaLoading ? "Loading…" : "Play the 100-point challenge"}</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* NBA enabled */}
        <TouchableOpacity activeOpacity={0.9} onPress={goToPicksNBA}>
          <LinearGradient colors={["#7c3aed","#06b6d4"]} start={{x:0,y:0}} end={{x:1,y:1}} style={S.bigTile}>
            <Text style={S.bigTileTxt}>NBA</Text>
            <Text style={S.bigTileSub}>Pick C • PF • SF • SG • PG</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Keep NHL disabled for now */}
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

/** ===================== PROFILE (unchanged) ===================== */
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

  // Friend lineup modal
  const [friendLineupOpen, setFriendLineupOpen] = useState(false);
  const [friendFocus, setFriendFocus] = useState(null); // {id, username, avatar_url}

  // Avatar customizer modal
  const [avatarOpen, setAvatarOpen] = useState(false);

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

        const { data: mutuals, error: rpcErr } = await supabase.rpc("mutual_friends", { this_user: user.id });
        if (rpcErr && (rpcErr.code === "42883" || /mutual_friends/i.test(rpcErr.message || ""))) {
          if (on) setFriends([]); // RPC missing yet
          return;
        }
        if (rpcErr) throw rpcErr;

        const friendIds = (mutuals ?? []).map(r => r.friend_id);
        if (!friendIds.length) { if (on) setFriends([]); return; }

        const { data: profs, error: profErr } = await supabase
          .from("profiles")
          .select("id, username, avatar_url")
          .in("id", friendIds);
        if (profErr) throw profErr;

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

  if (!user) {
    return (
      <SafeAreaView style={S.center} edges={['left','right','bottom']}>
        <Text style={S.title}>Please sign in</Text>
        <Text style={S.muted}>Go back and tap “Sign In”.</Text>
      </SafeAreaView>
    );
  }
  if (loading || metaLoading) {
    return (
      <SafeAreaView style={S.center} edges={['left','right','bottom']}>
        <ActivityIndicator size="large" />
        <Text style={S.muted}>Loading profile…</Text>
      </SafeAreaView>
    );
  }

  const losses = Math.max(0, attempts - wins);

  return (
    <SafeAreaView style={S.container} edges={['left','right','bottom']}>
      <GradientHeader>
        <TouchableOpacity onPress={goBack} style={S.smallBtn}><Text style={S.smallBtnTxt}>← Home</Text></TouchableOpacity>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Image source={{ uri: avatar }} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: "rgba(255,255,255,0.5)" }} />
          <View>
            <Text style={S.appTitle}>@{username}</Text>
            <Text style={S.appSub}>Season {SEASON} · Week {WEEK} · {MODE.toUpperCase()}</Text>
          </View>
        </View>
        <View style={{ width: 64 }} />
      </GradientHeader>

      <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
        <TouchableOpacity onPress={() => setAvatarOpen(true)} style={[S.smallBtn,{ backgroundColor:"rgba(255,255,255,0.9)"}]}>
          <Text style={[S.smallBtnTxt,{ color:"#0f172a"}]}>Edit Avatar</Text>
        </TouchableOpacity>
      </View>

      <View style={S.profileGrid}>
        <StatCard title="Wins (100/100)" value={String(wins)} />
        <StatCard title="Attempts" value={String(attempts)} />
        <StatCard title="Record" value={`${wins}-${losses}`} />
        <StatCard title="Best Week" value={best ? `${best.total_points.toFixed(2)} pts (S${best.season} W${best.week})` : "—"} />
      </View>

      <FriendsList
        loading={friendsLoading}
        error={friendsErr}
        friends={friends}
        onAdd={() => setAddOpen(true)}
        onOpenFriend={(f) => { setFriendFocus(f); setFriendLineupOpen(true); }}
      />

      <AddFriendModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={async (handle) => {
          const res = await addFriendByUsername(handle, user);
          Alert.alert(res.ok ? "Success" : "Hmm", res.msg);
          if (res.ok) setAddOpen(false);
        }}
      />

      <FriendLineupModal
        visible={friendLineupOpen}
        onClose={() => setFriendLineupOpen(false)}
        friend={friendFocus}
        season={SEASON}
        week={WEEK}
      />

      <AvatarCustomizerModal
        visible={avatarOpen}
        onClose={() => setAvatarOpen(false)}
        currentUrl={avatar}
        onSaved={(newUrl) => setAvatar(newUrl)}
        user={user}
      />
    </SafeAreaView>
  );
}

function AddFriendModal({ visible, onClose, onSubmit }) {
  const [handle, setHandle] = useState("");

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-end" }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={12}
          style={{ width: "100%" }}
        >
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
              <TouchableOpacity onPress={onClose} style={[S.smallBtn, { backgroundColor: "#e5e7eb" }]}>
                <Text style={[S.smallBtnTxt, { color: "#111827" }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onSubmit(handle)} style={S.primaryBtn}>
                <Text style={S.primaryBtnTxt}>Follow</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

async function addFriendByUsername(usernameInput, user) {
  const handle = (usernameInput || "").trim().replace(/^@/, "");
  if (!handle) return { ok: false, msg: "Enter a username" };
  if (!user) return { ok: false, msg: "Please sign in" };

  const { data: target, error: findErr } = await supabase
    .from("profiles")
    .select("id, username")
    .ilike("username", handle)
    .maybeSingle();
  if (findErr) return { ok: false, msg: findErr.message };
  if (!target) return { ok: false, msg: "User not found" };
  if (target.id === user.id) return { ok: false, msg: "You can’t follow yourself" };

  const { error: insErr } = await supabase
    .from("follows")
    .insert({ follower: user.id, following: target.id })
    .select("follower, following")
    .maybeSingle();

  if (insErr?.code === "23505") return { ok: true, msg: `Already following @${target.username}` };
  if (insErr) return { ok: false, msg: insErr.message };

  return { ok: true, msg: `Now following @${target.username}. When they follow back you’ll be friends.` };
}

function StatCard({ title, value }) {
  return (
    <View style={S.statCard}>
      <Text style={S.statTitle}>{title}</Text>
      <Text style={S.statValue}>{value}</Text>
    </View>
  );
}

function FriendsList({ loading, error, friends, onAdd, onOpenFriend }) {
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
          <TouchableOpacity key={f.id} onPress={() => onOpenFriend(f)} style={S.friendRow} activeOpacity={0.8}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Image source={{ uri: f.avatar_url }} style={S.friendAvatar} />
              <View>
                <Text style={S.friendName}>@{f.username}</Text>
                <Text style={S.friendMeta}>100/100 (prior weeks): {f.wins}</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

/** Friend lineup modal (read-only, NFL) */
function FriendLineupModal({ visible, onClose, friend, season, week }) {
  const [loading, setLoading] = useState(true);
  const [lineup, setLineup] = useState(null);
  const [players, setPlayers] = useState([]);
  const [stats, setStats] = useState({});
  const [points, setPoints] = useState({});
  const [err, setErr] = useState(null);

  useEffect(() => {
    let on = true;
    (async () => {
      if (!visible || !friend || !season || !week) return;
      try {
        setLoading(true); setErr(null);

        const { data: rows, error: le } = await supabase
          .from("lineups")
          .select("qb, rb, wr, te, total_points, visibility")
          .eq("user_id", friend.id)
          .eq("season", season)
          .eq("week", week)
          .limit(1);
        if (le) throw le;
        const row = rows?.[0] ?? null;
        setLineup(row);

        const [pRes, sRes] = await Promise.all([
          fetch(`${BASE_URL}/api/players?season=${season}`),
          fetch(`${BASE_URL}/api/stats?season=${season}&week=${week}&mode=${MODE}`),
        ]);

        const pTxt = await pRes.text();
        const sTxt = await sRes.text();
        let pJson = null, sJson = null;
        try { pJson = JSON.parse(pTxt); } catch (e) { throw new Error(`players JSON parse error: ${pTxt.slice(0,140)}`); }
        try { sJson = JSON.parse(sTxt); } catch (e) { throw new Error(`stats JSON parse error: ${sTxt.slice(0,140)}`); }

        if (!pRes.ok) throw new Error(pJson?.error || "Failed to load players");
        if (!sRes.ok) throw new Error(sJson?.error || "Failed to load stats");
        if (!on) return;
        setPlayers(pJson.players || []);
        setStats(sJson.stats || {});
        setPoints(sJson.points || {});
      } catch (e) {
        if (on) setErr(String(e?.message || e));
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, [visible, friend, season, week]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const getName = (id) => byId.get(id)?.name ?? "—";
  const getTeam = (id) => byId.get(id)?.team ?? "NFL";
  const getPos  = (id) => byId.get(id)?.pos ?? "";
  const format = (id) => formatLine(stats[id]);
  const pts = (id) => (points[id] != null ? Number(points[id]).toFixed(2) : null);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#eef2ff" }} edges={['left','right','bottom']}>
        <GradientHeader>
          <TouchableOpacity onPress={onClose} style={S.smallBtn}><Text style={S.smallBtnTxt}>← Back</Text></TouchableOpacity>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={S.appTitle}>@{friend?.username ?? "friend"}</Text>
            <Text style={S.appSub}>Week {week} · {MODE.toUpperCase()}</Text>
          </View>
          <View style={{ width: 64 }} />
        </GradientHeader>

        {loading ? (
          <View style={S.center}><ActivityIndicator /><Text style={S.muted}>Loading lineup…</Text></View>
        ) : err ? (
          <View style={S.center}><Text style={S.error}>{err}</Text></View>
        ) : !lineup ? (
          <View style={S.center}><Text style={S.muted}>No lineup shared for this week.</Text></View>
        ) : (
          <View style={{ flex: 1, padding: 16, gap: 12 }}>
            <ReadonlyCard
              label="QB" gradient={["#60a5fa","#34d399"]}
              name={getName(lineup.qb)} meta={`${getTeam(lineup.qb)} · ${getPos(lineup.qb)}`}
              stats={format(lineup.qb)} points={pts(lineup.qb)}
            />
            <ReadonlyCard
              label="RB" gradient={["#f59e0b","#ef4444"]}
              name={getName(lineup.rb)} meta={`${getTeam(lineup.rb)} · ${getPos(lineup.rb)}`}
              stats={format(lineup.rb)} points={pts(lineup.rb)}
            />
            <ReadonlyCard
              label="WR" gradient={["#a78bfa","#22c55e"]}
              name={getName(lineup.wr)} meta={`${getTeam(lineup.wr)} · ${getPos(lineup.wr)}`}
              stats={format(lineup.wr)} points={pts(lineup.wr)}
            />
            <ReadonlyCard
              label="TE" gradient={["#f472b6","#3b82f6"]}
              name={getName(lineup.te)} meta={`${getTeam(lineup.te)} · ${getPos(lineup.te)}`}
              stats={format(lineup.te)} points={pts(lineup.te)}
            />

            <View style={{ alignItems: "center", marginTop: 6 }}>
              <Text style={{ color: "#0f172a", fontWeight: "900" }}>
                Total: {[
                  pts(lineup.qb), pts(lineup.rb), pts(lineup.wr), pts(lineup.te)
                ].map(x => Number(x || 0)).reduce((a,b)=>a+b,0).toFixed(2)}
              </Text>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function ReadonlyCard({ label, gradient, name, meta, stats, points }) {
  return (
    <LinearGradient colors={gradient} start={{x:0,y:0}} end={{x:1,y:1}} style={[S.card, S.cardNarrow]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={S.cardLabel}>{label}</Text>
      {points != null ? <Text style={S.cardPts}>{points}</Text> : null}
      </View>
      <Text style={S.cardName}>{name}</Text>
      <Text style={S.cardMeta}>{meta}</Text>
      <Text style={[S.cardStats, { marginTop: 6 }]} numberOfLines={1} ellipsizeMode="tail">{stats || "—"}</Text>
    </LinearGradient>
  );
}

/** Avatar customizer (unchanged) */
function AvatarCustomizerModal({ visible, onClose, currentUrl, onSaved, user }) {
  const [seed, setSeed] = useState("1");
  const [bg, setBg] = useState("#0ea5e9");
  const [body, setBody] = useState("#ffffff");

  useEffect(() => {
    try {
      if (!currentUrl) return;
      const url = new URL(currentUrl);
      const params = new URLSearchParams(url.search);
      const s = params.get("seed");
      const bc = params.get("backgroundColor");
      const sc = params.get("shapeColor");
      if (s) setSeed(decodeURIComponent(s));
      if (bc) setBg("#" + bc);
      if (sc) setBody("#" + sc);
    } catch {}
  }, [currentUrl, visible]);

  const preview = buildThumbUrl({ seed, bg, body });

  const presets = ["1", "2", "3", "4", "5", "6", "7", "8"];
  const paletteBg = ["#0ea5e9","#7c3aed","#06b6d4","#22c55e","#f59e0b","#ef4444","#111827","#e2e8f0"];
  const paletteBody = ["#ffffff","#111827","#0ea5e9","#f59e0b","#ef4444","#22c55e","#a78bfa","#06b6d4"];

  const save = async () => {
    const url = buildThumbUrl({ seed, bg, body });
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: url })
      .eq("id", user.id);
    if (error) Alert.alert("Avatar", error.message);
    else {
      onSaved?.(url);
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-end" }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={12}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={S.customModal}>
              <Text style={S.addTitle}>Customize Avatar</Text>
              <View style={{ alignItems: "center", marginVertical: 8 }}>
                <Image source={{ uri: preview }} style={{ width: 96, height: 96, borderRadius: 48, borderWidth: 1, borderColor: "#e5e7eb" }} />
              </View>

              <Text style={[S.statTitle, { marginTop: 8 }]}>Preset (seed)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
                {presets.map((p) => (
                  <TouchableOpacity key={p} onPress={() => setSeed(p)} style={[S.pill, seed === p && S.pillActive]}>
                    <Text style={[S.pillTxt, seed === p && S.pillTxtActive]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={[S.statTitle, { marginTop: 8 }]}>Background color</Text>
              <View style={S.swatchRow}>
                {paletteBg.map(c => (
                  <TouchableOpacity key={c} onPress={() => setBg(c)} style={[S.swatch, { backgroundColor: c }, bg === c && S.swatchActive]} />
                ))}
              </View>

              <Text style={[S.statTitle, { marginTop: 8 }]}>Avatar (body) color</Text>
              <View style={S.swatchRow}>
                {paletteBody.map(c => (
                  <TouchableOpacity key={c} onPress={() => setBody(c)} style={[S.swatch, { backgroundColor: c }, body === c && S.swatchActive]} />
                ))}
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <TouchableOpacity onPress={onClose} style={[S.smallBtn,{ backgroundColor: "#e5e7eb" }]}><Text style={[S.smallBtnTxt,{ color:"#111827"}]}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity onPress={save} style={S.primaryBtn}><Text style={S.primaryBtnTxt}>Save</Text></TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/** ===================== PICK (NFL) ===================== */
function PickScreen({ goBack, draft, setDraft }) {
  const { user } = useAuth();

  const [players, setPlayers] = useState([]);
  const [points, setPoints] = useState({});
  const [stats, setStats] = useState({});
  const [prevPoints, setPrevPoints] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [pickQB, setPickQB] = useState(draft.QB);
  const [pickRB, setPickRB] = useState(draft.RB);
  const [pickWR, setPickWR] = useState(draft.WR);
  const [pickTE, setPickTE] = useState(draft.TE);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState("QB");
  const [authOpen, setAuthOpen] = useState(false);

  const { season: SEASON, week: WEEK, loading: metaLoading, err: metaErr } = useLatestMeta();

  useEffect(() => {
    setPickQB(draft.QB); setPickRB(draft.RB); setPickWR(draft.WR); setPickTE(draft.TE);
  }, [draft.QB, draft.RB, draft.WR, draft.TE]);

  useEffect(() => {
    let ok = true;
    if (!SEASON || !WEEK) return;

    (async () => {
      try {
        setLoading(true); setError(null);

        const prev = previousWeekOf(SEASON, WEEK);

        const [pRes, sRes, sPrevRes] = await Promise.all([
          fetch(`${BASE_URL}/api/players?season=${SEASON}`),
          fetch(`${BASE_URL}/api/stats?season=${SEASON}&week=${WEEK}&mode=${MODE}`),
          fetch(`${BASE_URL}/api/stats?season=${prev.season}&week=${prev.week}&mode=${MODE}`),
        ]);

        const pTxt = await pRes.text();
        const sTxt = await sRes.text();
        const sPrevTxt = await sPrevRes.text();

        let pJson = null, sJson = null, sPrevJson = null;
        try { pJson = JSON.parse(pTxt); } catch { throw new Error(`players JSON parse error: ${pTxt.slice(0,140)}`); }
        try { sJson = JSON.parse(sTxt); } catch { throw new Error(`stats JSON parse error: ${sTxt.slice(0,140)}`); }
        try { sPrevJson = JSON.parse(sPrevTxt); } catch { sPrevJson = {}; }

        if (!pRes.ok) throw new Error(pJson?.error || "Failed to load players");
        if (!sRes.ok) throw new Error(sJson?.error || "Failed to load stats");

        setPlayers(pJson.players || []);
        setPoints(sJson.points || {});
        setStats(sJson.stats || {});
        setPrevPoints((sPrevJson && sPrevJson.points) ? sPrevJson.points : {});
      } catch (e) {
        setError(String(e?.message || e));
      } finally { if (ok) setLoading(false); }
    })();

    return () => { ok = false; };
  }, [SEASON, WEEK]);

  const pts = (id) => Number(points[id] ?? 0);
  const statLine = (id) => formatLine(stats[id]);
  const prevPts = (id) => {
    const v = prevPoints[id];
    return (v === undefined || v === null) ? Number.NEGATIVE_INFINITY : Number(v);
  };

  const poolByPos = useMemo(() => {
    const map = { QB: [], RB: [], WR: [], TE: [] };
    for (const p of players) if (map[p.pos]) map[p.pos].push(p);
    for (const k of POS_ORDER) {
      map[k].sort((a, b) => {
        const pa = prevPts(a.id), pb = prevPts(b.id);
        if (pb !== pa) return pb - pa;
        return a.name.localeCompare(b.name);
      });
    }
    return map;
  }, [players, prevPoints]);

  const [query, setQuery] = useState("");
  useEffect(() => {
    if (pickerOpen) setQuery("");
  }, [pickerOpen, pickerPos]);

  const listForPos = useMemo(
    () => (poolByPos && poolByPos[pickerPos]) ? poolByPos[pickerPos] : [],
    [poolByPos, pickerPos]
  );

  const filtered = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) return listForPos;
    return listForPos.filter(p => {
      const name = (p?.name || "").toLowerCase();
      const team = (p?.team || "").toLowerCase();
      const pos  = (p?.pos  || "").toLowerCase();
      return name.includes(q) || team.includes(q) || pos.includes(q);
    });
  }, [listForPos, query]);

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

  const choose = (pos, id) => {
    if (pos === "QB") setPickQB(id);
    if (pos === "RB") setPickRB(id);
    if (pos === "WR") setPickWR(id);
    if (pos === "TE") setPickTE(id);
    setDraft(prev => ({ ...prev, [pos]: id }));
  };

  const shareLineup = async () => {
    const { user } = useAuth();
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
      <SafeAreaView style={S.center} edges={['left','right','bottom']}>
        <ActivityIndicator size="large" />
        <Text style={S.muted}>Loading current week…</Text>
      </SafeAreaView>
    );
  }
  if (metaErr || !SEASON || !WEEK) {
    return (
      <SafeAreaView style={S.center} edges={['left','right','bottom']}>
        <Text style={S.title}>Couldn’t load current week</Text>
        <Text style={S.error}>{metaErr || "No meta returned"}</Text>
      </SafeAreaView>
    );
  }
  if (loading) {
    return (
      <SafeAreaView style={S.center} edges={['left','right','bottom']}>
        <ActivityIndicator size="large" />
        <Text style={S.muted}>Loading from {BASE_URL}…</Text>
        <Text style={S.mono}>Season {SEASON} · Week {WEEK} · {MODE.toUpperCase()}</Text>
      </SafeAreaView>
    );
  }
  if (error) {
    return (
      <SafeAreaView style={S.center} edges={['left','right','bottom']}>
        <Text style={S.title}>Connection Error</Text>
        <Text style={S.error}>{error}</Text>
        <Text style={S.muted}>Check that the web app is running and BASE_URL is correct.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={S.container} edges={['left','right','bottom']}>
      <GradientHeader>
        <View style={{ width: 72, alignItems: "flex-start" }}>
          <TouchableOpacity onPress={goBack} style={S.smallBtn}><Text style={S.smallBtnTxt}>← Home</Text></TouchableOpacity>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={S.weekBig}>Week {WEEK}</Text>
        </View>
        <HeaderTotal value={total} />
      </GradientHeader>

      <Card label="QB" gradient={["#60a5fa","#34d399"]}
        player={selected.QB} points={pickQB ? pts(pickQB).toFixed(2) : null}
        stats={pickQB ? statLine(pickQB) : null} locked={lockedByPos.QB}
        onPress={() => { if (!lockedByPos.QB) { setPickerPos("QB"); setPickerOpen(true); } }}
        onClear={() => { if (!lockedByPos.QB) choose("QB", null); }} />
      <Card label="RB" gradient={["#f59e0b","#ef4444"]}
        player={selected.RB} points={pickRB ? pts(pickRB).toFixed(2) : null}
        stats={pickRB ? statLine(pickRB) : null} locked={lockedByPos.RB}
        onPress={() => { if (!lockedByPos.RB) { setPickerPos("RB"); setPickerOpen(true); } }}
        onClear={() => { if (!lockedByPos.RB) choose("RB", null); }} />
      <Card label="WR" gradient={["#a78bfa","#22c55e"]}
        player={selected.WR} points={pickWR ? pts(pickWR).toFixed(2) : null}
        stats={pickWR ? statLine(pickWR) : null} locked={lockedByPos.WR}
        onPress={() => { if (!lockedByPos.WR) { setPickerPos("WR"); setPickerOpen(true); } }}
        onClear={() => { if (!lockedByPos.WR) choose("WR", null); }} />
      <Card label="TE" gradient={["#f472b6","#3b82f6"]}
        player={selected.TE} points={pickTE ? pts(pickTE).toFixed(2) : null}
        stats={pickTE ? statLine(pickTE) : null} locked={lockedByPos.TE}
        onPress={() => { if (!lockedByPos.TE) { setPickerPos("TE"); setPickerOpen(true); } }}
        onClear={() => { if (!lockedByPos.TE) choose("TE", null); }} />

      <TouchableOpacity onPress={shareLineup} style={S.shareBtn}>
        <Text style={S.shareTxt}>Share with Friends</Text>
      </TouchableOpacity>

      {/* Player picker */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
        presentationStyle="fullScreen"
        statusBarTranslucent={false}
      >
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <SafeAreaView style={{ flex: 1, backgroundColor: "#0f172a" }} edges={['top','left','right','bottom']}>
            <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
              <Text style={{ color: "white", fontSize: 18, fontWeight: "700" }}>
                Select {pickerPos}
              </Text>
            </View>

            <FlatList
              style={{ backgroundColor: "white", borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
              contentContainerStyle={{ paddingBottom: 12 }}
              data={filtered}
              keyExtractor={(p) => p.id}
              stickyHeaderIndices={[0]}
              ListHeaderComponent={
                <View style={S.searchWrap}>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder={`Search ${pickerPos} by name or team…`}
                    placeholderTextColor="#94a3b8"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    style={S.searchInput}
                  />
                  {query.length > 0 && (
                    <TouchableOpacity onPress={() => setQuery("")} style={S.searchClear}>
                      <Text style={{ color: "#64748b", fontWeight: "800" }}>×</Text>
                    </TouchableOpacity>
                  )}
                </View>
              }
              renderItem={({ item: p }) => {
                const started = hasStarted(stats[p.id]);
                const lwRaw = prevPts(p.id);
                const lastWeek = (lwRaw === Number.NEGATIVE_INFINITY ? 0 : lwRaw);
                const live = pts(p.id);
                const valueToShow = started ? live : lastWeek;

                return (
                  <TouchableOpacity
                    style={[S.pickRow, started && { opacity: 0.65 }]}
                    activeOpacity={started ? 1 : 0.8}
                    onPress={() => {
                      if (started) return;
                      choose(pickerPos, p.id);
                      setPickerOpen(false);
                    }}
                  >
                    <View>
                      <Text style={S.pickName}>{p.name}</Text>
                      <Text style={S.pickMeta}>{p.team ?? "NFL"} · {p.pos}</Text>
                    </View>
                    <Text style={[S.pickPts, !started && { color: "#64748b" }]}>
                      {valueToShow.toFixed(2)}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />

            <TouchableOpacity onPress={() => setPickerOpen(false)} style={{ padding: 16, alignItems: "center" }}>
              <Text style={{ color: "white", fontWeight: "600" }}>Close</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </SafeAreaView>
  );
}

function HeaderTotal({ value }) {
  return (
    <View style={{ width: 72, alignItems: "flex-end" }}>
      <Text style={S.headerTotalTop}>Total</Text>
      <Text style={S.headerTotal}>{value.toFixed(2)}</Text>
    </View>
  );
}

/** ===================== PICK (NBA) ===================== */
function PickScreenNBA({ goBack }) {
  const POS_NBA = ["C", "PF", "SF", "SG", "PG"];

  const todayISO = new Date().toISOString().slice(0,10);
  const [date, setDate] = useState(todayISO);

  const [players, setPlayers] = useState([]);
  const [points, setPoints] = useState({});
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [pickC, setPickC] = useState(null);
  const [pickPF, setPickPF] = useState(null);
  const [pickSF, setPickSF] = useState(null);
  const [pickSG, setPickSG] = useState(null);
  const [pickPG, setPickPG] = useState(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState("C");

  // load players
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        setLoading(true); setError(null);
        const r = await fetch(`${BASE_URL}/api/nba/players`);
        const txt = await r.text();
        let j = null;
        try { j = JSON.parse(txt); } catch { throw new Error(`Unexpected response (${r.status}). ${txt.slice(0,140)}`); }
        if (!r.ok) throw new Error(j?.error || `players ${r.status}`);
        if (!on) return;
        setPlayers(j.players || []);
      } catch (e) {
        setError(String(e?.message || e));
      } finally { if (on) setLoading(false); }
    })();
    return () => { on = false; };
  }, []);

  // load stats by date
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        setLoading(true); setError(null);
        const r = await fetch(`${BASE_URL}/api/nba/stats?date=${encodeURIComponent(date)}`);
        const txt = await r.text();
        let j = null;
        try { j = JSON.parse(txt); } catch { throw new Error(`Unexpected response (${r.status}). ${txt.slice(0,140)}`); }
        if (!r.ok) throw new Error(j?.error || `stats ${r.status}`);
        if (!on) return;
        setPoints(j.points || {});
        setStats(j.stats || {});
      } catch (e) {
        setError(String(e?.message || e));
      } finally { if (on) setLoading(false); }
    })();
    return () => { on = false; };
  }, [date]);

  const pts = (id) => Number(points[id] ?? 0);
  const hasStartedNBA = (id) => {
    const s = stats[id]; if (!s) return false;
    return !!(s.pts || s.reb || s.ast || s.stl || s.blk || s.tov || s.fg3m || s.min);
  };

  // map positions from API (C/F/G) into 5 slots
  const poolByPos = useMemo(() => {
    const map = { C:[], PF:[], SF:[], SG:[], PG:[] };
    for (const p of players) {
      if (p.posNBA === "C") map.C.push(p);
      if (p.posNBA === "F") { map.PF.push(p); map.SF.push(p); }
      if (p.posNBA === "G") { map.SG.push(p); map.PG.push(p); }
    }
    for (const k of POS_NBA) {
      map[k].sort((a,b) => {
        const db = pts(b.id) - pts(a.id);
        return db !== 0 ? db : a.name.localeCompare(b.name);
      });
    }
    return map;
  }, [players, points]);

  const selected = {
    C:  pickC  ? players.find(p=>p.id===pickC)  : null,
    PF: pickPF ? players.find(p=>p.id===pickPF) : null,
    SF: pickSF ? players.find(p=>p.id===pickSF) : null,
    SG: pickSG ? players.find(p=>p.id===pickSG) : null,
    PG: pickPG ? players.find(p=>p.id===pickPG) : null,
  };

  const lockedByPos = {
    C:  pickC  ? hasStartedNBA(pickC)  : false,
    PF: pickPF ? hasStartedNBA(pickPF) : false,
    SF: pickSF ? hasStartedNBA(pickSF) : false,
    SG: pickSG ? hasStartedNBA(pickSG) : false,
    PG: pickPG ? hasStartedNBA(pickPG) : false,
  };

  const formatLineNBA = (id) => {
    const s = stats[id]; if (!s) return null;
    const parts = [];
    parts.push(`Pts ${s.pts}  Reb ${s.reb}  Ast ${s.ast}`);
    if (s.stl || s.blk) parts.push(`Stl ${s.stl}  Blk ${s.blk}`);
    parts.push(`3PM ${s.fg3m}  TOV ${s.tov}`);
    return parts.join(" · ");
  };

  const total = (
    (pickC  ? pts(pickC)  : 0) +
    (pickPF ? pts(pickPF) : 0) +
    (pickSF ? pts(pickSF) : 0) +
    (pickSG ? pts(pickSG) : 0) +
    (pickPG ? pts(pickPG) : 0)
  );

  const choose = (pos, id) => {
    if (pos === "C")  setPickC(id);
    if (pos === "PF") setPickPF(id);
    if (pos === "SF") setPickSF(id);
    if (pos === "SG") setPickSG(id);
    if (pos === "PG") setPickPG(id);
  };

  const [query, setQuery] = useState("");
  const listForPos = useMemo(() => poolByPos[pickerPos] || [], [poolByPos, pickerPos]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return listForPos;
    return listForPos.filter(p =>
      (p.name||"").toLowerCase().includes(q) ||
      (p.team||"").toLowerCase().includes(q)
    );
  }, [listForPos, query]);

  if (loading) {
    return (
      <SafeAreaView style={S.center} edges={['left','right','bottom']}>
        <ActivityIndicator size="large" />
        <Text style={S.muted}>Loading NBA slate for {date}…</Text>
      </SafeAreaView>
    );
  }
  if (error) {
    return (
      <SafeAreaView style={S.center} edges={['left','right','bottom']}>
        <Text style={S.title}>Connection Error</Text>
        <Text style={S.error}>{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={S.container} edges={['left','right','bottom']}>
      <GradientHeader>
        <View style={{ width: 72 }}>
          <TouchableOpacity onPress={goBack} style={S.smallBtn}><Text style={S.smallBtnTxt}>← Home</Text></TouchableOpacity>
        </View>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={S.weekBig}>NBA · {date}</Text>
        </View>
        <HeaderTotal value={total} />
      </GradientHeader>

      {/* date control */}
      <View style={{ alignItems: "center", marginTop: -6 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Text style={S.muted}>Game Date:</Text>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            autoCorrect={false}
            style={[S.input,{backgroundColor:"#fff", minWidth: 130, paddingVertical: 6}]}
          />
        </View>
      </View>

      {/* cards */}
      <Card label="C"  gradient={["#60a5fa","#34d399"]}
        player={selected.C} points={pickC ? pts(pickC).toFixed(2) : null}
        stats={pickC ? formatLineNBA(pickC) : null} locked={lockedByPos.C}
        onPress={() => { if (!lockedByPos.C) { setPickerPos("C"); setPickerOpen(true); } }}
        onClear={() => { if (!lockedByPos.C) choose("C", null); }} />
      <Card label="PF" gradient={["#f59e0b","#ef4444"]}
        player={selected.PF} points={pickPF ? pts(pickPF).toFixed(2) : null}
        stats={pickPF ? formatLineNBA(pickPF) : null} locked={lockedByPos.PF}
        onPress={() => { if (!lockedByPos.PF) { setPickerPos("PF"); setPickerOpen(true); } }}
        onClear={() => { if (!lockedByPos.PF) choose("PF", null); }} />
      <Card label="SF" gradient={["#a78bfa","#22c55e"]}
        player={selected.SF} points={pickSF ? pts(pickSF).toFixed(2) : null}
        stats={pickSF ? formatLineNBA(pickSF) : null} locked={lockedByPos.SF}
        onPress={() => { if (!lockedByPos.SF) { setPickerPos("SF"); setPickerOpen(true); } }}
        onClear={() => { if (!lockedByPos.SF) choose("SF", null); }} />
      <Card label="SG" gradient={["#f472b6","#3b82f6"]}
        player={selected.SG} points={pickSG ? pts(pickSG).toFixed(2) : null}
        stats={pickSG ? formatLineNBA(pickSG) : null} locked={lockedByPos.SG}
        onPress={() => { if (!lockedByPos.SG) { setPickerPos("SG"); setPickerOpen(true); } }}
        onClear={() => { if (!lockedByPos.SG) choose("SG", null); }} />
      <Card label="PG" gradient={["#06b6d4","#7c3aed"]}
        player={selected.PG} points={pickPG ? pts(pickPG).toFixed(2) : null}
        stats={pickPG ? formatLineNBA(pickPG) : null} locked={lockedByPos.PG}
        onPress={() => { if (!lockedByPos.PG) { setPickerPos("PG"); setPickerOpen(true); } }}
        onClear={() => { if (!lockedByPos.PG) choose("PG", null); }} />

      {/* Picker modal */}
      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)} presentationStyle="fullScreen">
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <SafeAreaView style={{ flex: 1, backgroundColor: "#0f172a" }} edges={['top','left','right','bottom']}>
            <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
              <Text style={{ color: "white", fontSize: 18, fontWeight: "700" }}>
                Select {pickerPos}
              </Text>
            </View>
            <FlatList
              style={{ backgroundColor: "white", borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
              contentContainerStyle={{ paddingBottom: 12 }}
              data={filtered}
              keyExtractor={(p) => p.id}
              stickyHeaderIndices={[0]}
              ListHeaderComponent={
                <View style={S.searchWrap}>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder={`Search ${pickerPos} by name or team…`}
                    placeholderTextColor="#94a3b8"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    style={S.searchInput}
                  />
                  {query.length > 0 && (
                    <TouchableOpacity onPress={() => setQuery("")} style={S.searchClear}>
                      <Text style={{ color: "#64748b", fontWeight: "800" }}>×</Text>
                    </TouchableOpacity>
                  )}
                </View>
              }
              renderItem={({ item: p }) => {
                const started = hasStartedNBA(p.id);
                const live = pts(p.id);
                return (
                  <TouchableOpacity
                    style={[S.pickRow, started && { opacity: 0.65 }]}
                    activeOpacity={started ? 1 : 0.8}
                    onPress={() => {
                      if (started) return;
                      choose(pickerPos, p.id);
                      setPickerOpen(false);
                    }}
                  >
                    <View>
                      <Text style={S.pickName}>{p.name}</Text>
                      <Text style={S.pickMeta}>{(p.team ?? "NBA")} · {p.posNBA}</Text>
                    </View>
                    <Text style={[S.pickPts, !started && { color: "#64748b" }]}>
                      {live.toFixed(2)}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
            <TouchableOpacity onPress={() => setPickerOpen(false)} style={{ padding: 16, alignItems: "center" }}>
              <Text style={{ color: "white", fontWeight: "600" }}>Close</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </SafeAreaProvider>
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
            <Text style={S.cardMeta}>{player.team ?? (label === "C" || label === "PF" || label === "SF" || label === "SG" || label === "PG" ? "NBA" : "NFL")} · {player.pos ?? player.posNBA}</Text>
            <View style={S.statRow}>
              <Text style={S.cardStats} numberOfLines={1} ellipsizeMode="tail" adjustsFontSizeToFit minimumFontScale={0.92}>
                {stats || "—"}
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
    marginHorizontal: -16,
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
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
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#e2e8f0",
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

  weekBig: { color: "white", fontSize: 30, fontWeight: "900", letterSpacing: 0.5 },
  searchWrap: {
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "white",
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e2e8f0",
  },
  searchInput: {
    height: 40, backgroundColor: "#f1f5f9", borderRadius: 10,
    paddingHorizontal: 12, fontSize: 14, color: "#0f172a",
  },
  searchClear: {
    position: "absolute", right: 18, top: 16, width: 24, height: 24, alignItems: "center", justifyContent: "center",
  },

  // Avatar customizer
  customModal: {
    backgroundColor: "white", padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#e2e8f0",
  },
  pill: {
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#e5e7eb", borderRadius: 999,
  },
  pillActive: { backgroundColor: "#0ea5e9" },
  pillTxt: { color: "#0f172a", fontWeight: "700" },
  pillTxtActive: { color: "white" },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: "#e2e8f0" },
  swatchActive: { borderColor: "#0ea5e9", borderWidth: 2 },
});

/* end file */
