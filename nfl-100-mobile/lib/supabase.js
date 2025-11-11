// lib/supabase.js

// Polyfills MUST load before supabase-js (URL, crypto.getRandomValues)
import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';

// Prefer Expo 'extra' (works at runtime in RN); fall back to env if present
const SUPABASE_URL =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_URL ??
  process.env.EXPO_PUBLIC_SUPABASE_URL;

const SUPABASE_ANON_KEY =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_SUPABASE_ANON ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    '[supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON. ' +
    'Verify app.config.js -> extra or your .env injection.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // not needed in RN
    // AsyncStorage adapter
    storage: {
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
      removeItem: (key) => AsyncStorage.removeItem(key),
    },
  },
});

// (Optional sanity log — remove later)
console.log('[supabase url]', SUPABASE_URL);
