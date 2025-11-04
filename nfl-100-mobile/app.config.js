// app.config.js
export default ({ config }) => ({
  ...config,
  name: "NFL 100",
  slug: "nfl-100",
  scheme: "nfl100",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#0f172a",
  },

  // EAS Updates (already tied to your project)
  updates: {
    url: "https://u.expo.dev/zxaspfbgvaycrhqfjclb",
  },
  runtimeVersion: { policy: "sdkVersion" },

  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.nicholaswalker.nfl100",
    buildNumber: "1",
  },
  android: {
    package: "com.nicholaswalker.nfl100",
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#0f172a",
    },
  },

  extra: {
    eas: { projectId: "zxaspfbgvaycrhqfjclb" },

    // pull from your .env at build & dev time
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON: process.env.EXPO_PUBLIC_SUPABASE_ANON,

    // NEW: the public API base URL the app will fetch from
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  },

  plugins: [
    "expo-linear-gradient",
    "expo-constants",
    "expo-updates",
  ],
});
