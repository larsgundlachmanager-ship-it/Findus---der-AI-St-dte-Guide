/**
 * Node mocks for RN/Expo — before any reisebüro/funnel import.
 */
const Module = require('module');

const asyncStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
  multiGet: async () => [],
  multiSet: async () => {},
};

const mocks = {
  'react-native': {
    Linking: {
      openURL: async () => false,
      canOpenURL: async () => false,
    },
    Platform: { OS: 'android', select: (x) => x?.android ?? x?.default },
    StyleSheet: { create: (x) => x },
    View: 'View',
    Text: 'Text',
    Alert: { alert: () => {} },
    NativeModules: {},
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  },
  'expo-constants': {
    default: {
      expoConfig: { extra: {} },
      manifest: { extra: {} },
    },
    expoConfig: { extra: {} },
  },
  'expo-file-system': {
    documentDirectory: null,
    cacheDirectory: null,
    readAsStringAsync: async () => '',
    writeAsStringAsync: async () => {},
    getInfoAsync: async () => ({ exists: false }),
    deleteAsync: async () => {},
    makeDirectoryAsync: async () => {},
  },
  'expo-sqlite': {
    openDatabaseSync: () => ({
      execSync: () => {},
      getAllSync: () => [],
      getFirstSync: () => null,
      runSync: () => ({ changes: 0, lastInsertRowId: 0 }),
      closeSync: () => {},
    }),
    openDatabaseAsync: async () => ({
      execAsync: async () => {},
      getAllAsync: async () => [],
      getFirstAsync: async () => null,
      runAsync: async () => ({ changes: 0, lastInsertRowId: 0 }),
      closeAsync: async () => {},
    }),
  },
  expo: {
    reloadAppAsync: async () => {},
  },
  'expo-asset': {
    Asset: { fromModule: () => ({ downloadAsync: async () => {} }) },
  },
  '@react-native/assets-registry/registry': {
    registerAsset: () => 1,
    getAssetByID: () => null,
  },
  '@react-native-async-storage/async-storage': {
    default: asyncStorage,
    ...asyncStorage,
  },
};

const pathMocks = [
  {
    test: (id) => /(?:^|[\\/])userProfileService(?:\.(?:ts|js|tsx))?$/i.test(id),
    value: {
      getCachedUserProfile: () => null,
      loadUserProfile: async () => null,
      saveUserProfile: async () => {},
      updateUserProfile: async () => {},
      resetUserProfile: async () => {},
      subscribeUserProfile: () => () => {},
      isDataSaverActive: () => false,
      getAudioOutputMode: () => 'speaker',
      wantsSpokenAudio: () => true,
      getProfileFilePath: () => '',
      getVoiceSettingsForTour: async () => ({}),
    },
  },
  {
    test: (id) => /(?:^|[\\/])useGpsStore(?:\.(?:ts|js|tsx))?$/i.test(id),
    value: {
      useGpsStore: {
        getState: () => ({ lat: null, lng: null }),
        setState: () => {},
        subscribe: () => () => {},
      },
    },
  },
  {
    test: (id) => /(?:^|[\\/])db[\\/]database(?:\.(?:ts|js))?$/i.test(id),
    value: {
      getDb: async () => null,
      withDb: async () => null,
    },
  },
  {
    test: (id) => /(?:^|[\\/])notificationService(?:\.(?:ts|js|tsx))?$/i.test(id),
    value: {
      scheduleLocalNotification: async () => null,
      cancelNotification: async () => {},
      ensureNotificationPermissions: async () => false,
      setNotificationHandler: () => {},
    },
  },
  {
    test: (id) => /(?:^|[\\/])findusResponsePolicy(?:\.(?:ts|js|tsx))?$/i.test(id),
    value: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === '__esModule') return true;
          if (typeof prop === 'string' && prop.startsWith('FINDUS_')) {
            return `[mock ${prop}]`;
          }
          return undefined;
        },
      },
    ),
  },
];

const packagePrefixMocks = [
  { prefix: 'expo-modules-core', value: { EventEmitter: class {}, NativeModule: class {}, requireNativeModule: () => ({}) } },
  { prefix: 'expo-sqlite', value: mocks['expo-sqlite'] },
  { prefix: 'expo-asset', value: mocks['expo-asset'] },
  { prefix: 'expo-file-system', value: mocks['expo-file-system'] },
  { prefix: 'expo-constants', value: mocks['expo-constants'] },
];

function resolveMock(request, _parent) {
  if (Object.prototype.hasOwnProperty.call(mocks, request)) {
    return mocks[request];
  }
  for (const m of pathMocks) {
    if (m.test(request)) return m.value;
  }
  for (const m of packagePrefixMocks) {
    if (request === m.prefix || request.startsWith(m.prefix + '/')) return m.value;
  }
  // Blanket: any expo-* package (haptics, location, …) → soft stub
  if (request === 'expo' || request.startsWith('expo-') || request.startsWith('expo/')) {
    return {
      default: {},
      ...mocks.expo,
      impactAsync: async () => {},
      notificationAsync: async () => {},
      selectionAsync: async () => {},
      requireOptionalNativeModule: () => null,
      requireNativeModule: () => ({}),
      EventEmitter: class {},
      setNotificationHandler: () => {},
      getPermissionsAsync: async () => ({ status: 'denied' }),
      requestPermissionsAsync: async () => ({ status: 'denied' }),
      scheduleNotificationAsync: async () => 'mock',
      cancelScheduledNotificationAsync: async () => {},
      AndroidImportance: { DEFAULT: 3 },
    };
  }
  if (request.startsWith('@react-native/')) {
    return { registerAsset: () => 1, getAssetByID: () => null, default: {} };
  }
  return null;
}

let installed = false;

function installReisebueroNodeMocks() {
  if (installed) return;
  installed = true;
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    const hit = resolveMock(request, parent);
    if (hit) return hit;
    try {
      return orig.apply(this, arguments);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (/Unexpected token 'export'|Cannot use import|Unexpected "typeof"/.test(msg)) {
        console.error(
          '[node-mocks] load fail',
          request,
          'from',
          parent && parent.filename,
          msg.slice(0, 100),
        );
      }
      throw e;
    }
  };
}

installReisebueroNodeMocks();
module.exports = { installReisebueroNodeMocks, mocks };
