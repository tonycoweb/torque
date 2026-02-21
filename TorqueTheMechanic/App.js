// App.js (FULL FILE) — updated for ServiceBox backend integration (minimal deltas)
//
// ✅ ADDED IN THIS REVISION (keeps your current flow intact)
// 1) Adds API_GENERATE_SERVICE_URL constant
// 2) Adds authed helper: generateServiceRecommendations({ vehicle, currentMileage })
// 3) Adds onGenerateServiceRecs + onRefreshEnergy props to <ServiceBox />
//    - ServiceBox can call the backend directly through App (auth + energy + consistent errors)
// 4) Passes selectedVehicle + mileage hint (from vehicle.mileage if present) safely

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
  Keyboard,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import HomeHeader from './components/HomeHeader';
import ServiceBox from './components/ServiceBox';
import RobotAssistant from './components/RobotAssistant';
import ChatMessages from './components/ChatMessages';
import ChatBoxFixed from './components/ChatBoxFixed';
import SavedChatsPanel from './components/SavedChatsPanel';
import VehicleSelector from './components/VehicleSelector';
import VehiclePhotoModal from './components/VehiclePhotoModal';
import LoginScreen from './components/LoginScreen';
import SettingsModal from './components/SettingsModal';

import VinCamera from './components/VinCamera';
import VinPreview from './components/VinPreview';
import AudioRecorderModal from './components/AudioRecorderModal';

import { saveChat, getAllChats, getChat } from './utils/storage';
import { getAllVehicles, saveVehicle } from './utils/VehicleStorage';

import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import EnergyPill from './components/EnergyPill';

import mobileAds, { RewardedAd, RewardedAdEventType, AdEventType } from 'react-native-google-mobile-ads';

// ===================== BACKEND =====================
// ✅ LIVE deployed SAM API (HTTP API)
const BACKEND_BASE = 'https://rd9gvjuco8.execute-api.us-east-2.amazonaws.com';

const API_CHAT_URL = `${BACKEND_BASE}/chat`;
const API_AUDIO_URL = `${BACKEND_BASE}/audio-diagnose`;
const API_IMAGE_URL = `${BACKEND_BASE}/image-diagnose`;
const API_DECODE_VIN_URL = `${BACKEND_BASE}/decode-vin`;
const API_DECODE_VIN_TEXT_URL = `${BACKEND_BASE}/decode-vin-text`;
const API_ME_URL = `${BACKEND_BASE}/me`;

// ✅ NEW: Service recs endpoint (matches Lambda route you pasted)
const API_GENERATE_SERVICE_URL = `${BACKEND_BASE}/generate-service-recommendations`;

// ===================== TOKENS =====================
// Legacy single-JSON key (your older LoginScreen)
const LEGACY_TOKEN_KEY = 'cognito_tokens_v1';

// New split keys (your updated LoginScreen fix)
const KEY_ID = 'pm_id_token_v1';
const KEY_ACCESS = 'pm_access_token_v1';
const KEY_REFRESH = 'pm_refresh_token_v1';
const KEY_META = 'pm_token_meta_v1';

// ===================== ADS =====================
const adUnitId = __DEV__
  ? Platform.OS === 'ios'
    ? 'ca-app-pub-3940256099942544/1712485313'
    : 'ca-app-pub-3940256099942544/5224354917'
  : 'your-real-admob-id-here';

// ===================== HELPERS =====================
const LAST_CHAT_ID_KEY = 'last_chat_id';
const LAST_CHAT_BY_VEHICLE_KEY = 'last_chat_id_by_vehicle';

const trimTurns = (history, maxTurns = 6) => {
  const out = [];
  for (let i = history.length - 1; i >= 0 && out.length < maxTurns * 2; i--) {
    const m = history[i];
    if (m.role === 'user' || m.role === 'assistant') out.unshift(m);
  }
  return out;
};

const normalizeVehicle = (v = {}) => {
  const id =
    v.id?.toString?.() ||
    (v.vin ? String(v.vin) : undefined) ||
    [v.year, v.make, v.model].filter(Boolean).join('-') ||
    Math.random().toString(36).slice(2);
  return { ...v, id };
};

const getVehicleKey = (v) => {
  if (!v) return null;
  if (v.vin) return String(v.vin).toUpperCase().trim();
  if (v.id) return String(v.id);
  return null;
};

const findVehicleByKey = async (key) => {
  if (!key) return null;
  try {
    const saved = await getAllVehicles();
    const list = (saved || []).map(normalizeVehicle);

    const upper = String(key).toUpperCase().trim();
    return (
      list.find((v) => (v?.vin ? String(v.vin).toUpperCase().trim() : null) === upper) ||
      list.find((v) => String(v?.id) === String(key)) ||
      null
    );
  } catch {
    return null;
  }
};

const readLastChatByVehicleMap = async () => {
  try {
    const raw = await AsyncStorage.getItem(LAST_CHAT_BY_VEHICLE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const writeLastChatByVehicleMap = async (mapObj) => {
  try {
    await AsyncStorage.setItem(LAST_CHAT_BY_VEHICLE_KEY, JSON.stringify(mapObj || {}));
  } catch {}
};

const normalizeMsgContent = (content) => {
  if (content == null) return '';
  if (typeof content === 'string') return content;

  if (typeof content === 'object' && content.type === 'text' && typeof content.text === 'string') {
    return content.text;
  }

  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p?.type === 'text' && typeof p.text === 'string') return p.text;
        if (p?.type === 'image_url') return '[image]';
        if (p?.type === 'input_audio') return '[audio]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
};

const stripDataUrl = (b64OrDataUrl) => {
  if (!b64OrDataUrl) return null;
  const s = String(b64OrDataUrl);
  const idx = s.indexOf('base64,');
  if (s.startsWith('data:') && idx !== -1) return s.slice(idx + 'base64,'.length);
  return s;
};

const asDataUrlJpeg = (b64) => {
  if (!b64) return null;
  const s = String(b64);
  if (s.startsWith('data:image/')) return s;
  return `data:image/jpeg;base64,${s}`;
};

const inferAudioMeta = (uri = '') => {
  const clean = String(uri).split('?')[0];
  const ext = (clean.split('.').pop() || '').toLowerCase();

  const map = {
    m4a: { mimeType: 'audio/mp4', filename: 'audio.m4a' },
    mp4: { mimeType: 'audio/mp4', filename: 'audio.mp4' },
    aac: { mimeType: 'audio/aac', filename: 'audio.aac' },
    caf: { mimeType: 'audio/x-caf', filename: 'audio.caf' },
    wav: { mimeType: 'audio/wav', filename: 'audio.wav' },
    mp3: { mimeType: 'audio/mpeg', filename: 'audio.mp3' },
  };

  return map[ext] || { mimeType: 'audio/mp4', filename: 'audio.m4a' };
};

const normalizeFileUri = (input) => {
  let uri =
    typeof input === 'string'
      ? input
      : input?.uri || input?.soundUri || input?.soundURI || input?.recordingUri || input?.recordingURI;

  if (!uri) return null;

  uri = String(uri).trim();

  if (uri.startsWith('Optional(') && uri.endsWith(')')) {
    uri = uri.slice('Optional('.length, -1);
  }

  uri = uri.replace(/^"+|"+$/g, '');
  return uri;
};

// ===================== TOKEN HELPERS =====================
async function clearAllTokens() {
  await SecureStore.deleteItemAsync(KEY_ID).catch(() => {});
  await SecureStore.deleteItemAsync(KEY_ACCESS).catch(() => {});
  await SecureStore.deleteItemAsync(KEY_REFRESH).catch(() => {});
  await SecureStore.deleteItemAsync(KEY_META).catch(() => {});
  await SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY).catch(() => {});
}

// ✅ reads split tokens first, falls back to legacy JSON, returns idToken||accessToken
async function getJwtForApi() {
  // 1) new split format
  const [idToken, accessToken] = await Promise.all([
    SecureStore.getItemAsync(KEY_ID).catch(() => null),
    SecureStore.getItemAsync(KEY_ACCESS).catch(() => null),
  ]);

  if (idToken || accessToken) {
    return idToken || accessToken || null;
  }

  // 2) legacy JSON blob (fallback)
  const raw = await SecureStore.getItemAsync(LEGACY_TOKEN_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const tokens = JSON.parse(raw);
    return tokens?.idToken || tokens?.accessToken || null;
  } catch {
    return null;
  }
}

async function authedFetch(url, options = {}) {
  const token = await getJwtForApi();
  if (!token) {
    const err = new Error('NOT_LOGGED_IN');
    err.code = 'NOT_LOGGED_IN';
    throw err;
  }

  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  const resp = await fetch(url, { ...options, headers });

  // centralized 401 handling so callers don’t forget
  if (resp.status === 401) {
    const txt = await resp.text().catch(() => '');
    const err = new Error(`UNAUTHORIZED: ${txt || 'Token rejected/expired'}`);
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  return resp;
}

// ===================== API CALLS =====================
async function chatWithBackend({ messages, vehicle }) {
  const resp = await authedFetch(API_CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, vehicle: vehicle || null, convoId: 'default' }),
  });

  let data = null;
  try {
    data = await resp.json();
  } catch {}

  if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
  return data;
}

async function sendAudioToBackend({ uri, prompt, vehicle, mimeType, filename }) {
  const cleanUri = normalizeFileUri(uri);
  if (!cleanUri) throw new Error('Audio URI is missing/invalid (could not normalize).');

  const info = await FileSystem.getInfoAsync(cleanUri);
  if (!info?.exists) throw new Error(`Audio file not found: ${cleanUri}`);

  const base64 = await FileSystem.readAsStringAsync(cleanUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const resp = await authedFetch(API_AUDIO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioBase64: base64,
      prompt: prompt || 'Diagnose this sound.',
      vehicle: vehicle || null,
      mimeType: mimeType || 'audio/mp4',
      filename: filename || 'audio.m4a',
    }),
  });

  let data = null;
  try {
    data = await resp.json();
  } catch {}

  if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
  return data;
}

async function sendImageToBackend({ base64, text, vehicle }) {
  const resp = await authedFetch(API_IMAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: asDataUrlJpeg(stripDataUrl(base64)),
      text: (text || '').trim(),
      vehicle: vehicle || null,
    }),
  });

  let data = null;
  try {
    data = await resp.json();
  } catch {}

  if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
  return data;
}

// ✅ NEW: service recommendations (authed, centralized errors, matches Lambda response)
// expected response (from your updated lambda):
// { compact:[15], result:[15], flags, usage, mileage_used }
async function generateServiceRecommendations({ vehicle, currentMileage }) {
  const resp = await authedFetch(API_GENERATE_SERVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehicle: vehicle || null,
      currentMileage: currentMileage ?? null,
    }),
  });

  let data = null;
  try {
    data = await resp.json();
  } catch {}

  if (!resp.ok) {
    const msg = data?.error || `Service recs failed (HTTP ${resp.status})`;
    const err = new Error(msg);
    err.code = data?.error === 'Insufficient energy' ? 'INSUFFICIENT_ENERGY' : 'SERVICE_RECS_FAILED';
    err.data = data;
    throw err;
  }

  return data;
}

// ===================== AD HELPERS =====================
const runRewardedAd = async (unitId, { timeoutMs = 20000 } = {}) => {
  return new Promise((resolve) => {
    const rewarded = RewardedAd.createForAdRequest(unitId, {
      requestNonPersonalizedAdsOnly: true,
    });

    const unsubs = [];
    const cleanup = () => {
      while (unsubs.length) {
        try {
          const u = unsubs.pop();
          typeof u === 'function' ? u() : u?.remove?.();
        } catch {}
      }
    };

    let settled = false;
    const resolveOnce = (val) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };

    const timeoutId = setTimeout(() => resolveOnce(false), timeoutMs);

    // Rewarded-specific events (these exist)
    unsubs.push(
      rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        try {
          rewarded.show();
        } catch {
          clearTimeout(timeoutId);
          resolveOnce(false);
        }
      })
    );

    unsubs.push(
      rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        clearTimeout(timeoutId);
        resolveOnce(true);
      })
    );

    // Generic ad lifecycle events (use AdEventType, not RewardedAdEventType)
    if (AdEventType?.CLOSED) {
      unsubs.push(
        rewarded.addAdEventListener(AdEventType.CLOSED, () => {
          clearTimeout(timeoutId);
          resolveOnce(false);
        })
      );
    }

    if (AdEventType?.ERROR) {
      unsubs.push(
        rewarded.addAdEventListener(AdEventType.ERROR, () => {
          clearTimeout(timeoutId);
          resolveOnce(false);
        })
      );
    }

    try {
      rewarded.load();
    } catch {
      clearTimeout(timeoutId);
      resolveOnce(false);
    }
  });
};

export default function App() {
  const [energyBalance, setEnergyBalance] = useState(null);
  const [energyLoading, setEnergyLoading] = useState(false);

  const [vehicle, setVehicle] = useState(null);
  const [garageName, setGarageName] = useState('');

  const [messages, setMessages] = useState([]); // UI
  const [chatHistory, setChatHistory] = useState([]); // backend history

  const [isChatting, setIsChatting] = useState(false);
  const [showSavedChats, setShowSavedChats] = useState(false);

  // null = loading, false = show login, true = app
  const [isLoggedIn, setIsLoggedIn] = useState(null);

  const [loading, setLoading] = useState(false);
  const [chatID, setChatID] = useState(null);

  const [showSettings, setShowSettings] = useState(false);

  // Attachments
  const [attachedImage, setAttachedImage] = useState(null);
  const [attachedAudio, setAttachedAudio] = useState(null);
  const [attachmentLocked, setAttachmentLocked] = useState(false);

  const [showAudioRecorder, setShowAudioRecorder] = useState(false);

  // VIN camera flow
  const [showCamera, setShowCamera] = useState(false);
  const [vinPhoto, setVinPhoto] = useState(null);
  const [showDecodingModal, setShowDecodingModal] = useState(false);

  const [activeChatVehicle, setActiveChatVehicle] = useState(null);

  const [focusTick, setFocusTick] = useState(0);
  const [threadKey, setThreadKey] = useState('new');
  const [threadVehicleKey, setThreadVehicleKey] = useState(null);

  // ✅ prevent energy spam
  const lastEnergyFetchRef = useRef(0);
  // ✅ prevent multiple simultaneous VIN decodes (camera or typed)
  const decodeVinInFlightRef = useRef(false);

  // ✅ FIX A: remember user’s selected vehicle when a saved chat temporarily switches it
  const chatVehicleRestoreRef = useRef({
    shouldRestore: false,
    vehicleObj: null,
    vehicleKey: null,
  });

  const refreshEnergy = async ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && now - lastEnergyFetchRef.current < 8000) return; // 8s cooldown
    lastEnergyFetchRef.current = now;

    try {
      setEnergyLoading(true);
      const r = await authedFetch(API_ME_URL, { method: 'GET' });
      const data = await r.json().catch(() => null);
      if (r.ok && data && typeof data.energy_balance === 'number') {
        setEnergyBalance(data.energy_balance);
      }
    } catch (e) {
      // auth failures handled elsewhere
    } finally {
      setEnergyLoading(false);
    }
  };

  // ✅ vehicle photo modal state (hosted at App root)
  const [photoModalVisible, setPhotoModalVisible] = useState(false);
  const [photoTargetKey, setPhotoTargetKey] = useState(null);

  const openVehiclePhoto = (v) => {
    const key = getVehicleKey(v);
    if (!key) return;
    setPhotoTargetKey(key);
    setPhotoModalVisible(true);
  };

  const pickVehiclePhotoFromLibrary = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm?.granted) {
        Alert.alert('Permission needed', 'Enable Photo Library access in Settings.');
        return null;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.9,
      });

      if (result.canceled) return null;

      const uri = result.assets?.[0]?.uri;
      return uri || null;
    } catch (e) {
      Alert.alert('Photo error', e?.message || 'Could not open photo library.');
      return null;
    }
  };

  const handleSaveVehiclePhoto = async (uri) => {
    try {
      const key = photoTargetKey;
      if (!key || !uri) return;

      const target = await findVehicleByKey(key);
      if (!target) return;

      const updated = normalizeVehicle({ ...target, photoUri: uri });
      await saveVehicle(updated);

      // ✅ Update home-selected vehicle instantly if it matches
      const selectedKey = getVehicleKey(vehicle);
      const updatedKey = getVehicleKey(updated);
      if (selectedKey && updatedKey && selectedKey === updatedKey) {
        setVehicle(updated);
      }
    } catch (e) {
      console.warn('handleSaveVehiclePhoto failed:', e?.message || e);
    }
  };

  // ===================== Robot anim =====================
  const robotTranslateY = useRef(new Animated.Value(0)).current;
  const robotScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(robotTranslateY, {
      toValue: isChatting ? -80 : 0,
      duration: 450,
      useNativeDriver: true,
    }).start();
    Animated.timing(robotScale, {
      toValue: isChatting ? 0.6 : 1,
      duration: 450,
      useNativeDriver: true,
    }).start();
  }, [isChatting, robotTranslateY, robotScale]);

  // ===================== Init login =====================
  useEffect(() => {
    (async () => {
      try {
        const jwt = await getJwtForApi();

        // No tokens saved → must login
        if (!jwt) {
          setIsLoggedIn(false);
          return;
        }

        // Tokens exist → verify they're accepted by API Gateway (/me)
        try {
          await authedFetch(API_ME_URL, { method: 'GET' });
          setIsLoggedIn(true);
          refreshEnergy({ force: true });
        } catch (e) {
          // Token rejected/expired/audience mismatch → wipe + show login
          await clearAllTokens();
          setIsLoggedIn(false);
        }
      } catch (e) {
        setIsLoggedIn(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===================== Load vehicles =====================
  useEffect(() => {
    (async () => {
      try {
        const saved = await getAllVehicles();
        const list = (saved || []).map(normalizeVehicle);
        if (list.length === 0) return;

        const rawSel = await AsyncStorage.getItem('selectedVehicle');
        if (rawSel) {
          try {
            const parsed = JSON.parse(rawSel);
            const key = getVehicleKey(parsed);
            const found = key ? await findVehicleByKey(key) : null;
            if (found) {
              setVehicle(found);
              return;
            }
          } catch {}
        }

        setVehicle(list[0]);
      } catch (e) {
        console.warn('Load vehicles failed:', e?.message || e);
      }
    })();
  }, []);

  useEffect(() => {
    if (vehicle) {
      AsyncStorage.setItem('selectedVehicle', JSON.stringify(vehicle)).catch(() => {});
      setActiveChatVehicle(null);
    }
  }, [vehicle]);

  // ===================== AdMob init =====================
  useEffect(() => {
    (async () => {
      try {
        await mobileAds().initialize();
      } catch (e) {
        console.error('AdMob init failed:', e);
      }
    })();
  }, []);

  const showRewardedAd = async () => runRewardedAd(adUnitId, { timeoutMs: 10000 });

  // ===================== THREAD LOAD HELPERS =====================
  const loadChatThread = async (idToLoad) => {
    if (!idToLoad) return false;

    const loaded = await getChat(idToLoad);
    if (!Array.isArray(loaded) || loaded.length === 0) return false;

    let metaKey = null;
    try {
      const all = await getAllChats();
      const val = all?.[idToLoad];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        metaKey = val.vehicleKey || null;
      }
    } catch {}

    setChatID(idToLoad);
    setThreadKey(idToLoad);
    setThreadVehicleKey(metaKey);
    setChatHistory(loaded);
    setMessages(
      loaded.map((m) => ({
        sender: m.role === 'user' ? 'user' : 'api',
        text: normalizeMsgContent(m.content),
      }))
    );
    setFocusTick((x) => x + 1);
    return true;
  };

  const loadLastChatForSelectedVehicle = async () => {
    try {
      const vKey = getVehicleKey(vehicle);

      if (
        (!messages || messages.length === 0) &&
        chatID &&
        Array.isArray(chatHistory) &&
        chatHistory.length > 0 &&
        threadVehicleKey === vKey
      ) {
        setThreadKey(chatID);
        setMessages(
          chatHistory.map((m) => ({
            sender: m.role === 'user' ? 'user' : 'api',
            text: normalizeMsgContent(m.content),
          }))
        );
        setFocusTick((x) => x + 1);
        return;
      }

      if (messages && messages.length) return;

      if (!vKey) {
        const globalLastId = await AsyncStorage.getItem(LAST_CHAT_ID_KEY);
        if (globalLastId) await loadChatThread(globalLastId);
        return;
      }

      const map = await readLastChatByVehicleMap();
      const mappedId = map?.[vKey];

      if (mappedId) {
        const ok = await loadChatThread(mappedId);
        if (ok) return;

        delete map[vKey];
        await writeLastChatByVehicleMap(map);
      }

      const all = await getAllChats();
      const entries = Object.entries(all || {});

      let bestId = null;
      let bestTs = 0;

      for (const [id, val] of entries) {
        const isObj = val && typeof val === 'object' && !Array.isArray(val);
        const metaKey = isObj ? val.vehicleKey : null;
        if (metaKey !== vKey) continue;

        const ts = (isObj && Number(val.updatedAt)) || Number(id) || 0;
        if (ts > bestTs) {
          bestTs = ts;
          bestId = id;
        }
      }

      if (bestId) {
        const ok = await loadChatThread(bestId);
        if (ok) {
          const nextMap = await readLastChatByVehicleMap();
          nextMap[vKey] = bestId;
          await writeLastChatByVehicleMap(nextMap);
          return;
        }
      }

      setChatID(null);
      setThreadKey('new');
      setThreadVehicleKey(vKey);
      setChatHistory([]);
      setMessages([]);
      setFocusTick((x) => x + 1);
    } catch (e) {
      console.warn('loadLastChatForSelectedVehicle failed:', e?.message || e);
    }
  };

  useEffect(() => {
    if (isChatting) loadLastChatForSelectedVehicle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChatting, vehicle?.vin, vehicle?.id, threadVehicleKey]);

  // ===================== Attachments =====================
  const hasAnyAttachment = () => !!attachedImage || !!attachedAudio;

  const openChat = () => {
    if (!isChatting) setIsChatting(true);
    setShowSavedChats(false);
    setFocusTick((x) => x + 1);
  };

  const handleCameraPress = async () => {
    if (loading || attachmentLocked) return;
    if (hasAnyAttachment()) {
      Alert.alert('One attachment at a time', 'Remove the current attachment before adding another.');
      return;
    }

    try {
      openChat();

      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm?.granted) {
        Alert.alert('Camera permission needed', 'Enable camera access in Settings.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.7,
        base64: true,
        allowsEditing: false,
      });

      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.uri) {
        Alert.alert('Photo error', 'Could not read photo URI. Try again.');
        return;
      }

      let b64 = asset.base64;
      if (!b64) {
        try {
          b64 = await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
        } catch {
          b64 = null;
        }
      }

      if (!b64) {
        Alert.alert('Photo error', 'Could not read photo data. Try again.');
        return;
      }

      setAttachedImage({ uri: asset.uri, base64: b64 });
    } catch (e) {
      Alert.alert('Camera error', e?.message || 'Could not open camera.');
    }
  };

  const handleMicPress = () => {
    if (loading || attachmentLocked) return;
    if (hasAnyAttachment()) {
      Alert.alert('One attachment at a time', 'Remove the current attachment before adding another.');
      return;
    }
    openChat();
    setShowAudioRecorder(true);
  };

  const clearAttachedImage = () => {
    if (loading || attachmentLocked) return;
    setAttachedImage(null);
  };

  const clearAttachedAudio = () => {
    if (loading || attachmentLocked) return;
    setAttachedAudio(null);
  };

  // ===================== Sending =====================
  const handleSend = async (textOrPayload) => {
    if (loading) return;

    openChat();

    const text = typeof textOrPayload === 'string' ? textOrPayload : textOrPayload?.text || '';

    const hasText = !!text.trim();
    const hasImg = !!attachedImage?.base64;
    const hasAudio = !!attachedAudio?.uri;

    if (!hasText && !hasImg && !hasAudio) return;

    if (/new issue|start over|reset/i.test(text)) {
      setChatHistory([]);
      setMessages([]);
      setChatID(null);
      setThreadKey('new');
      setActiveChatVehicle(null);
      setAttachedImage(null);
      setAttachedAudio(null);
      setAttachmentLocked(false);

      AsyncStorage.removeItem(LAST_CHAT_ID_KEY).catch(() => {});
      return;
    }

    const userLineParts = [];
    if (hasText) userLineParts.push(text.trim());
    if (hasImg) userLineParts.push('📎 Photo attached');
    if (hasAudio) userLineParts.push('🎙️ Audio attached');
    const userLine = userLineParts.join('\n');

    setShowSavedChats(false);
    setLoading(true);

    if (hasImg || hasAudio) setAttachmentLocked(true);

    const imgSnap = attachedImage;
    const audioSnap = attachedAudio;

    if (hasImg) setAttachedImage(null);
    if (hasAudio) setAttachedAudio(null);

    setMessages((prev) => [...prev, { sender: 'user', text: userLine }]);

    const newHistory = [...chatHistory, { role: 'user', content: userLine }];
    setChatHistory(newHistory);

    const trimmedHistory = trimTurns(newHistory);
    const vehicleForChat = activeChatVehicle?.source === 'overridden' ? activeChatVehicle : vehicle;

    try {
      let replyText = '';

      if (hasAudio) {
        const data = await sendAudioToBackend({
          uri: audioSnap?.uri,
          prompt: hasText ? text.trim() : 'Diagnose this sound.',
          vehicle: vehicleForChat,
          mimeType: audioSnap?.mimeType,
          filename: audioSnap?.filename,
        });
        replyText = data?.reply || '⚠️ No response from audio endpoint.';
      } else if (hasImg) {
        const data = await sendImageToBackend({
          base64: imgSnap?.base64,
          text: hasText ? text.trim() : '',
          vehicle: vehicleForChat,
        });
        replyText = data?.reply || '⚠️ No response from image endpoint.';
      } else {
        const data = await chatWithBackend({
          messages: trimmedHistory,
          vehicle: vehicleForChat,
        });
        replyText = data?.reply || '';
        if (data?.vehicle_used) setActiveChatVehicle(data.vehicle_used);
      }

      const updatedHistory = [...newHistory, { role: 'assistant', content: replyText }];
      setChatHistory(updatedHistory);
      setMessages((prev) => [...prev, { sender: 'api', text: replyText }]);

      const id = chatID || Date.now().toString();
      setChatID(id);
      setThreadKey(id);

      const vKey = getVehicleKey(vehicleForChat);
      await saveChat(id, updatedHistory, {
        vehicleKey: vKey,
        vehicleVin: vehicleForChat?.vin ? String(vehicleForChat.vin).toUpperCase().trim() : null,
        vehicleYear: vehicleForChat?.year ? String(vehicleForChat.year) : null,
        vehicleMake: vehicleForChat?.make ? String(vehicleForChat.make) : null,
        vehicleModel: vehicleForChat?.model ? String(vehicleForChat.model) : null,
      });

      setThreadVehicleKey(vKey || null);

      await AsyncStorage.setItem(LAST_CHAT_ID_KEY, id);

      if (vKey) {
        const map = await readLastChatByVehicleMap();
        map[vKey] = id;
        await writeLastChatByVehicleMap(map);
      }

      setAttachmentLocked(false);
      refreshEnergy();
    } catch (e) {
      if (String(e?.code) === 'NOT_LOGGED_IN' || String(e?.code) === 'UNAUTHORIZED') {
        Alert.alert('Session expired', 'Please sign in again.');
        await clearAllTokens();
        setIsLoggedIn(false);
        setLoading(false);
        setAttachmentLocked(false);
        return;
      }

      if (imgSnap) setAttachedImage(imgSnap);
      if (audioSnap) setAttachedAudio(audioSnap);

      setMessages((prev) => [...prev, { sender: 'api', text: `⚠️ ${e?.message || 'Error sending message.'}` }]);
      setAttachmentLocked(false);
    } finally {
      setLoading(false);
    }
  };

  const handleChatFocus = () => {
    setFocusTick((x) => x + 1);
  };

  const handleExitChat = () => {
    if (loading) return;
    Keyboard.dismiss();
    setIsChatting(false);
    setShowSavedChats(false);
    setMessages([]);

    setActiveChatVehicle(null);
    setAttachedImage(null);
    setAttachedAudio(null);
    setAttachmentLocked(false);

    // ✅ FIX A: restore the user’s selected vehicle if we temporarily switched it to match a saved chat
    if (chatVehicleRestoreRef.current?.shouldRestore && chatVehicleRestoreRef.current?.vehicleObj) {
      setVehicle(chatVehicleRestoreRef.current.vehicleObj);
    }
    chatVehicleRestoreRef.current = { shouldRestore: false, vehicleObj: null, vehicleKey: null };
  };

  // ✅ UPDATED: don’t overwrite a newer object (ex: selector updated photoUri)
  const handleSelectVehicle = async (v) => {
    const normalized = normalizeVehicle(v || {});
    await saveVehicle(normalized);
    setVehicle(normalized);
    setActiveChatVehicle(null);

    // ✅ If user manually selects a vehicle, do NOT restore later on exit
    chatVehicleRestoreRef.current = { shouldRestore: false, vehicleObj: null, vehicleKey: null };
  };

  // ✅ NEW: wrapper so ServiceBox can call backend safely (with auth + energy refresh)
  const handleGenerateServiceRecs = async ({ vehicle: vIn, currentMileage } = {}) => {
    const v = vIn || vehicle;
    if (!v) throw new Error('No vehicle selected.');

    // Mileage hint:
    // - prefer explicit currentMileage
    // - else use v.mileage if present
    const mileageHint =
      currentMileage != null
        ? currentMileage
        : v?.mileage != null
          ? v.mileage
          : null;

    const res = await generateServiceRecommendations({
      vehicle: v,
      currentMileage: mileageHint,
    });

    // Keep energy pill accurate after spend
    refreshEnergy();

    return res; // {compact,result,flags,usage,mileage_used}
  };

  // ===================== VIN decode flow =====================
  const decodeVinWithAd = async (primaryBase64, fullBase64) => {
    if (decodeVinInFlightRef.current) return;
    decodeVinInFlightRef.current = true;

    setShowDecodingModal(true);

    try {
      const earned = await runRewardedAd(adUnitId, { timeoutMs: 10000 });
      if (!earned) {
        Alert.alert('⚠️ Ad not ready', 'Try again in a few seconds.');
        return;
      }

      const resp1 = await authedFetch(API_DECODE_VIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64Image: stripDataUrl(primaryBase64),
          fullBase64: fullBase64 ? stripDataUrl(fullBase64) : null,
        }),
      });

      const data1 = await resp1.json().catch(() => null);
      if (!resp1.ok) throw new Error(data1?.error || `VIN decode failed (HTTP ${resp1.status})`);

      const vin = data1?.vin || data1?.vin_extracted;

      if (!vin) {
        Alert.alert('⚠️ No VIN found', 'Could not read a VIN from that image. Retake with better focus/light.');
        setVinPhoto(null);
        return;
      }

      const resp2 = await authedFetch(API_DECODE_VIN_TEXT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vin }),
      });

      const data2 = await resp2.json().catch(() => null);
      if (!resp2.ok) throw new Error(data2?.error || `VIN text decode failed (HTTP ${resp2.status})`);

      const decoded =
        (data2?.vehicle && typeof data2.vehicle === 'object' && data2.vehicle) ||
        (data2?.decoded && typeof data2.decoded === 'object' && data2.decoded) ||
        null;

      if (!decoded?.make || !decoded?.model) {
        Alert.alert('⚠️ VIN decoded but incomplete', 'Got a VIN, but could not decode vehicle details.');
        setVinPhoto(null);
        return;
      }

      const vehicleFromPhoto = normalizeVehicle({ ...decoded, vin });
      await saveVehicle(vehicleFromPhoto);
      setVehicle(vehicleFromPhoto);
      setActiveChatVehicle(null);
      setVinPhoto(null);

      const name = `${vehicleFromPhoto.year || ''} ${vehicleFromPhoto.make || ''} ${vehicleFromPhoto.model || ''}`.trim();
      Alert.alert(`✅ ${name} added to garage`, vehicleFromPhoto.engine || '');

      refreshEnergy();
    } catch (err) {
      if (String(err?.code) === 'NOT_LOGGED_IN' || String(err?.code) === 'UNAUTHORIZED') {
        Alert.alert('Session expired', 'Please sign in again.');
        await clearAllTokens();
        setIsLoggedIn(false);
        return;
      }
      Alert.alert('❌ Error', err?.message || 'Could not decode VIN.');
      setVinPhoto(null);
    } finally {
      setShowDecodingModal(false);
      decodeVinInFlightRef.current = false;
    }
  };

  const devResetLogin = async () => {
    await clearAllTokens();
    setIsLoggedIn(false);
  };

  const renderContent = () => {
    if (isLoggedIn === null) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
        </View>
      );
    }

    if (!isLoggedIn) {
      return (
        <LoginScreen
          onLogin={async () => {
            try {
              const r = await authedFetch(API_ME_URL, { method: 'GET' });
              if (!r.ok) {
                const t = await r.text().catch(() => '');
                throw new Error(`ME_FAILED: HTTP ${r.status} ${t}`);
              }
              setIsLoggedIn(true);
              refreshEnergy({ force: true });
            } catch (e) {
              console.warn('Login success but /me failed:', e?.message || e);
              Alert.alert(
                'Signed in, but server setup failed',
                `Your token was issued, but /me failed.\n\n${e?.message || 'Unknown error'}`
              );
              await clearAllTokens();
              setIsLoggedIn(false);
            }
          }}
        />
      );
    }

    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <View style={styles.pageContent}>
          <HomeHeader garageName={garageName} setGarageName={setGarageName} onSettingsPress={() => setShowSettings(true)} />
          <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />

          {!isChatting && (
            <>
              <VehicleSelector
                selectedVehicle={vehicle}
                onSelectVehicle={handleSelectVehicle}
                onShowRewardedAd={showRewardedAd}
                gateCameraWithAd={false}
                triggerVinCamera={() => setShowCamera(true)}
                onOpenVehiclePhoto={openVehiclePhoto}
                onDecodeVinTyped={async (vin) => {
                  const resp = await authedFetch(API_DECODE_VIN_TEXT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ vin }),
                  });

                  const data = await resp.json().catch(() => null);
                  if (!resp.ok) throw new Error(data?.error || `VIN text decode failed (HTTP ${resp.status})`);

                  const decoded =
                    (data?.vehicle && typeof data.vehicle === 'object' && data.vehicle) ||
                    (data?.decoded && typeof data.decoded === 'object' && data.decoded) ||
                    null;

                  if (!decoded?.make || !decoded?.model) {
                    throw new Error('VIN decoded but missing key fields.');
                  }

                  const vehicleFromVin = normalizeVehicle({ ...decoded, vin });
                  await saveVehicle(vehicleFromVin);
                  setVehicle(vehicleFromVin);
                  setActiveChatVehicle(null);

                  refreshEnergy?.();

                  const name = `${vehicleFromVin.year || ''} ${vehicleFromVin.make || ''} ${vehicleFromVin.model || ''}`.trim();
                  Alert.alert(`✅ ${name} added to garage`, vehicleFromVin.engine || '');
                }}
              />

              {/* ✅ UPDATED: ServiceBox gets backend hook + energy refresh */}
              <ServiceBox
                selectedVehicle={vehicle}
                onGenerateServiceRecs={handleGenerateServiceRecs}
                onRefreshEnergy={() => refreshEnergy({ force: true })}
              />
            </>
          )}

          {__DEV__ && (
            <TouchableOpacity onPress={devResetLogin} style={{ marginTop: 12 }}>
              <Text style={{ color: '#ff6666', fontWeight: '700' }}>DEV: Reset Login</Text>
            </TouchableOpacity>
          )}

          {!isChatting && (
            <Animated.View
              style={[
                styles.robotWrapper,
                { marginTop: 20, transform: [{ translateY: robotTranslateY }, { scale: robotScale }] },
              ]}
            >
              <RobotAssistant isChatting={isChatting} />
            </Animated.View>
          )}

          {isChatting && (
            <View style={styles.chatTopBar}>
              <TouchableOpacity style={styles.exitButton} onPress={handleExitChat} disabled={loading}>
                <Text style={[styles.exitButtonText, loading && { opacity: 0.6 }]}>Exit Chat</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.topBarBtn, showSavedChats && styles.topBarBtnActive]}
                onPress={() => {
                  if (loading) return;
                  Keyboard.dismiss();
                  setShowSavedChats((prev) => !prev);
                }}
                disabled={loading}
              >
                <Text style={[styles.topBarBtnText, loading && { opacity: 0.6 }]}>  Saved   </Text>
              </TouchableOpacity>
            </View>
          )}

          {isChatting && (
            <View style={styles.chatMessagesArea}>
              <ChatMessages messages={messages} loading={loading} focusTick={focusTick} bottomInset={120} threadKey={threadKey} />
            </View>
          )}

          <SavedChatsPanel
            visible={isChatting && showSavedChats}
            onClose={() => setShowSavedChats(false)}
            onSelect={async (chat) => {
              if (loading) return;

              if (!chat) {
                setChatID(null);
                setThreadKey('new');
                const vKey = getVehicleKey(vehicle) || null;
                setThreadVehicleKey(vKey);

                setChatHistory([]);
                setMessages([]);
                setShowSavedChats(false);

                setActiveChatVehicle(null);

                setAttachedImage(null);
                setAttachedAudio(null);
                setAttachmentLocked(false);

                await AsyncStorage.removeItem(LAST_CHAT_ID_KEY);
                setFocusTick((x) => x + 1);
                return;
              }

              const id = chat.id || Date.now().toString();
              const history = Array.isArray(chat.messages) ? chat.messages : [];

              setChatID(id);
              setThreadKey(id);
              setThreadVehicleKey(chat.vehicleKey || null);
              setChatHistory(history);

              setMessages(
                history.map((m) => ({
                  sender: m.role === 'user' ? 'user' : 'api',
                  text: normalizeMsgContent(m.content),
                }))
              );

              await AsyncStorage.setItem(LAST_CHAT_ID_KEY, id);

              if (chat.vehicleKey) {
                const map = await readLastChatByVehicleMap();
                map[chat.vehicleKey] = id;
                await writeLastChatByVehicleMap(map);
              }

              const selectedKey = getVehicleKey(vehicle);
              const chatKey = chat.vehicleKey || null;

              if (chatKey && chatKey !== selectedKey) {
                const matched = await findVehicleByKey(chatKey);

                if (matched) {
                  chatVehicleRestoreRef.current = {
                    shouldRestore: true,
                    vehicleObj: vehicle ? normalizeVehicle(vehicle) : null,
                    vehicleKey: selectedKey || null,
                  };

                  setVehicle(matched);
                  setActiveChatVehicle(null);
                } else {
                  chatVehicleRestoreRef.current = { shouldRestore: false, vehicleObj: null, vehicleKey: null };

                  setActiveChatVehicle({
                    source: 'overridden',
                    vin: chat.vehicleVin || (String(chatKey).length === 17 ? chatKey : null),
                    id: chat.vehicleVin ? String(chat.vehicleVin) : String(chatKey),
                    year: chat.vehicleYear || null,
                    make: chat.vehicleMake || null,
                    model: chat.vehicleModel || null,
                  });
                }
              } else {
                chatVehicleRestoreRef.current = { shouldRestore: false, vehicleObj: null, vehicleKey: null };
                setActiveChatVehicle(null);
              }

              setShowSavedChats(false);
              setIsChatting(true);
              setFocusTick((x) => x + 1);
            }}
          />
        </View>

        <View style={{ marginTop: 10 }}>
          <EnergyPill energy={energyBalance} loading={energyLoading} />
        </View>

        <View style={styles.chatDock}>
          <ChatBoxFixed
            onSend={handleSend}
            onFocus={handleChatFocus}
            onMicPress={handleMicPress}
            onCameraPress={handleCameraPress}
            onClearAudio={clearAttachedAudio}
            onClearImage={clearAttachedImage}
            attachedAudio={attachedAudio ? { uri: attachedAudio.uri, durationMs: attachedAudio.durationMs } : null}
            attachedImage={attachedImage ? { uri: attachedImage.uri } : null}
            isSending={loading || attachmentLocked}
          />

          {!isChatting && (
            <TouchableOpacity
              style={styles.dockTapCatcher}
              onPress={() => {
                openChat();
              }}
              activeOpacity={1}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    );
  };

  return (
    <>
      {showCamera ? (
        <VinCamera
          onCapture={(photo) => {
            setShowCamera(false);
            setVinPhoto(photo);
          }}
          onCancel={() => setShowCamera(false)}
        />
      ) : vinPhoto ? (
        <VinPreview
          photo={vinPhoto}
          onRetake={() => {
            setVinPhoto(null);
            setShowCamera(true);
          }}
          onConfirm={async (b64FromPreview) => {
            try {
              let primary = b64FromPreview;

              if (!primary && vinPhoto?.base64) primary = vinPhoto.base64;
              if (!primary && vinPhoto?.original?.base64) primary = vinPhoto.original.base64;

              let full = vinPhoto?.fullBase64 || vinPhoto?.original?.base64 || null;

              if (!primary && vinPhoto?.uri) {
                const fileB64 = await FileSystem.readAsStringAsync(vinPhoto.uri, {
                  encoding: FileSystem.EncodingType.Base64,
                });
                primary = fileB64;
              }

              if (!full && vinPhoto?.original?.uri) {
                try {
                  const fullFileB64 = await FileSystem.readAsStringAsync(vinPhoto.original.uri, {
                    encoding: FileSystem.EncodingType.Base64,
                  });
                  full = fullFileB64;
                } catch {}
              }

              if (!primary) {
                Alert.alert('Image error', 'No image data found. Please retake the photo.');
                return;
              }

              await decodeVinWithAd(primary, full);
            } catch (e) {
              Alert.alert('Image error', e?.message || 'Could not process image.');
            }
          }}
        />
      ) : (
        renderContent()
      )}

      {/* ✅ Vehicle Photo Modal hosted at App root */}
      <VehiclePhotoModal
        visible={photoModalVisible}
        onClose={() => setPhotoModalVisible(false)}
        onSave={handleSaveVehiclePhoto}
        onPickFromLibrary={pickVehiclePhotoFromLibrary}
      />

      <AudioRecorderModal
        visible={showAudioRecorder}
        onClose={() => setShowAudioRecorder(false)}
        onDone={(payload) => {
          setShowAudioRecorder(false);

          const cleanUri = normalizeFileUri(payload);
          if (!cleanUri) {
            Alert.alert('Audio error', 'Could not read the recorded audio file URI.');
            return;
          }

          const meta = inferAudioMeta(cleanUri);
          setAttachedAudio({
            uri: cleanUri,
            durationMs: payload?.durationMs ?? null,
            mimeType: meta.mimeType,
            filename: meta.filename,
          });

          setFocusTick((x) => x + 1);
        }}
      />

      {showDecodingModal && (
        <Modal transparent animationType="fade" visible>
          <View style={styles.decodeOverlay}>
            <View style={styles.decodeCard}>
              <MaterialCommunityIcons name="cog" size={40} color="#4CAF50" style={{ marginBottom: 10 }} />
              <Text style={styles.decodeTitle}>Torque is decoding...</Text>
              <ActivityIndicator color="#4CAF50" size="large" />
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  pageContent: {
    flex: 1,
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 33,
  },

  chatMessagesArea: { flex: 1 },
  robotWrapper: { alignItems: 'center' },

  chatTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 10,
    width: '52%',
  },
  exitButton: {
    flex: 1,
    backgroundColor: '#444',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    alignItems: 'center',
  },
  exitButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  topBarBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#444',
    borderWidth: 1,
    borderColor: '#444',
  },
  topBarBtnActive: { backgroundColor: '#2f6fed', borderColor: '#2f6fed' },
  topBarBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  decodeOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  decodeCard: {
    backgroundColor: '#222',
    padding: 30,
    borderRadius: 20,
    alignItems: 'center',
  },
  decodeTitle: { color: '#fff', fontSize: 18, marginBottom: 5 },

  chatDock: {
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: 'rgba(18,18,18,0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },

  dockTapCatcher: { ...StyleSheet.absoluteFillObject },
});