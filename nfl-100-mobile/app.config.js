export default {
  name: "NFL 100",
  slug: "nfl-100",
  version: "1.0.0", // marketing version (shows before parentheses)
  sdkVersion: "54.0.0",
  orientation: "portrait",
  scheme: "nfl100",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  plugins: ["expo-updates"],

  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#0f172a",
  },

  updates: {
    url: "https://u.expo.dev/23edf75a-7ee4-49dc-9196-9742892a50b2",
  },

  runtimeVersion: { policy: "sdkVersion" },

  ios: {
    supportsTablet: true,
    requireFullScreen: true,

    bundleIdentifier: "com.nicholaswalker.nfl100",

    // 🚨 BUMP THIS EVERY TIME YOU REBUILD FOR TESTFLIGHT
    buildNumber: "12",

    infoPlist: {
      CFBundleDisplayName: "NFL 100",
      ITSAppUsesNonExemptEncryption: false,
      LSRequiresIPhoneOS: true,
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
      },
    },

    runtimeVersion: { policy: "sdkVersion" },
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
    EXPO_PUBLIC_SUPABASE_URL: "https://zxaspfbgvaycrhqfjclb.supabase.co",
    EXPO_PUBLIC_SUPABASE_ANON: "sb_publishable_fY35U-Ezq6_PrX1kX5SLeg_zvr6gTYV",
    EXPO_PUBLIC_API_URL: "https://nfl-100.vercel.app",
    eas: {
      projectId: "23edf75a-7ee4-49dc-9196-9742892a50b2",
    },
  },
};
