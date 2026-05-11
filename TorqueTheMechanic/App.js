// App.js (FULL FILE) — App owns /me + all authed backend calls (minimal cost)
//
// ✅ THIS REVISION (minimal deltas, big wins)
// - App.js is the single source of truth for:
//   • JWT retrieval + authedFetch
//   • /me caching + in-flight lock + TTL (kills duplicate /me spam)
//   • centralized API wrappers: /chat, /audio-diagnose, /image-diagnose, /decode-vin, /decode-vin-text, /generate-service-recommendations
// - Safer payload handling:
//   • base64 size guards (audio + images) to avoid giant uploads + 413s
//   • consistent JSON parse helpers (no double body reads)
//   • attachment flow prevents “double-send” + locks while sending
//
// NOTE: Keeps your UI flow intact. No new screens, no removed features.

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
import Purchases, { LOG_LEVEL } from 'react-native-purchases';

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
import TorqueStoreModal from './components/TorqueStoreModal';

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
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// ===================== BACKEND =====================
const BACKEND_BASE = 'https://rd9gvjuco8.execute-api.us-east-2.amazonaws.com';

const API_CHAT_URL = `${BACKEND_BASE}/chat`;
const API_AUDIO_URL = `${BACKEND_BASE}/audio-diagnose`;
const API_IMAGE_URL = `${BACKEND_BASE}/image-diagnose`;
const API_DECODE_VIN_URL = `${BACKEND_BASE}/decode-vin`;
const API_DECODE_VIN_TEXT_URL = `${BACKEND_BASE}/decode-vin-text`;
const API_ME_URL = `${BACKEND_BASE}/me`;
const API_GENERATE_SERVICE_URL = `${BACKEND_BASE}/generate-service-recommendations`;
const API_IAP_GRANT_URL = `${BACKEND_BASE}/iap/revenuecat/grant`;

// ===================== REVENUECAT =====================
// Replace these with the public SDK keys from RevenueCat → API keys → SDK API keys.
// Do NOT put your secret sk_ key here. That stays in AWS Secrets Manager only.
const RC_IOS_API_KEY = 'appl_zonSPBcyfNPeLvqMyaAcxrCEhch';
const RC_ANDROID_API_KEY = 'PASTE_REVENUECAT_TORQUE_ANDROID_PUBLIC_SDK_KEY_HERE';

let revenueCatConfiguredFor = null;
async function configureRevenueCatForUser(appUserId) {
  const cleanUserId = String(appUserId || '').trim();
  if (!cleanUserId) return;
  if (revenueCatConfiguredFor === cleanUserId) return;

  const apiKey = Platform.OS === 'ios' ? RC_IOS_API_KEY : RC_ANDROID_API_KEY;
  if (!apiKey || apiKey.includes('PASTE_REVENUECAT')) {
    console.warn('RevenueCat SDK key is missing. Paste your public SDK key into App.js.');
    return;
  }

  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.VERBOSE : LOG_LEVEL.WARN);

  try {
    await Purchases.configure({ apiKey, appUserID: cleanUserId });
  } catch (e) {
    // If the SDK was already configured earlier in the same JS session, logIn keeps the customer aligned.
    try {
      await Purchases.logIn(cleanUserId);
    } catch (inner) {
      console.warn('RevenueCat configure/logIn failed:', inner?.message || e?.message || e);
      return;
    }
  }

  revenueCatConfiguredFor = cleanUserId;
}

// ===================== TOKENS =====================
// Legacy single-JSON key (older LoginScreen)
const LEGACY_TOKEN_KEY = 'cognito_tokens_v1';

// New split keys (current LoginScreen)
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

// These align with your SAM defaults (string env vars).
const MAX_AUDIO_BASE64_CHARS = 12_000_000;
const MAX_IMAGE_BASE64_CHARS = 6_000_000; // keep conservative; backend may allow more

// Expo ImagePicker: avoid deprecated ImagePicker.MediaTypeOptions warning.
const IMAGE_MEDIA_TYPES = ImagePicker.MediaType?.Images ? [ImagePicker.MediaType.Images] : ['images'];

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

// ✅ What gets sent to Torque as the current/default vehicle context.
// Keep this small enough for token cost, but complete enough that Torque does not “forget”
// the vehicle selected in VehicleSelector.
const normalizeVehicleForApi = (v = null) => {
  if (!v || typeof v !== 'object') return null;

  const clean = {
    id: v.id ? String(v.id) : undefined,
    vin: v.vin ? String(v.vin).toUpperCase().trim() : undefined,
    year: v.year != null ? String(v.year) : undefined,
    make: v.make ? String(v.make) : undefined,
    model: v.model ? String(v.model) : undefined,
    trim: v.trim ? String(v.trim) : undefined,
    engine: v.engine ? String(v.engine) : undefined,
    transmission: v.transmission ? String(v.transmission) : undefined,
    drive_type: v.drive_type ? String(v.drive_type) : undefined,
    body_style: v.body_style ? String(v.body_style) : undefined,
    fuel_type: v.fuel_type ? String(v.fuel_type) : undefined,
    mileage: v.mileage != null ? String(v.mileage) : undefined,
    horsepower_hp: v.horsepower_hp != null ? String(v.horsepower_hp) : v.hp != null ? String(v.hp) : undefined,
    gvw_lbs: v.gvw_lbs != null ? String(v.gvw_lbs) : v.gvw != null ? String(v.gvw) : undefined,
    mpg_city: v.mpg_city != null ? String(v.mpg_city) : undefined,
    mpg_highway: v.mpg_highway != null ? String(v.mpg_highway) : undefined,
    mpg_combined: v.mpg_combined != null ? String(v.mpg_combined) : undefined,
  };

  Object.keys(clean).forEach((k) => {
    if (clean[k] == null || clean[k] === '') delete clean[k];
  });

  if (!clean.year && !clean.make && !clean.model && !clean.vin) return null;
  return clean;
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
    // OpenAI does not accept .caf. AudioRecorderModal now records real .m4a/AAC.
    // If an old .caf URI sneaks through, label it as m4a, but the real fix is the recorder.
    caf: { mimeType: 'audio/mp4', filename: 'audio.m4a' },
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

// -------- Robust fetch body parsing (prevents double-read bugs) --------
async function readJsonOrText(resp) {
  const contentType = resp?.headers?.get?.('content-type') || '';
  const rawText = await resp.text().catch(() => '');
  let json = null;

  if (rawText && (contentType.includes('application/json') || rawText.trim().startsWith('{'))) {
    try {
      json = JSON.parse(rawText);
    } catch {
      json = null;
    }
  }

  return { json, text: rawText };
}

function shortErr(msg) {
  return (msg || '').toString().slice(0, 300);
}

function enforceBase64Limit(base64, maxChars, label) {
  const s = stripDataUrl(base64) || '';
  if (!s) return;
  if (s.length > maxChars) {
    throw new Error(
      `${label} is too large to upload (${s.length.toLocaleString()} chars). Try a shorter clip / lower quality / retake closer.`
    );
  }
}

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
  const [idToken, accessToken] = await Promise.all([
    SecureStore.getItemAsync(KEY_ID).catch(() => null),
    SecureStore.getItemAsync(KEY_ACCESS).catch(() => null),
  ]);

  if (idToken || accessToken) {
    return idToken || accessToken || null;
  }

  const raw = await SecureStore.getItemAsync(LEGACY_TOKEN_KEY).catch(() => null);
  if (!raw) return null;

  try {
    const tokens = JSON.parse(raw);
    return tokens?.idToken || tokens?.accessToken || null;
  } catch {
    return null;
  }
}

// ✅ App-owned authed fetch with centralized 401 behavior
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

  if (resp.status === 401) {
    const { text } = await readJsonOrText(resp);
    const err = new Error(`UNAUTHORIZED: ${shortErr(text || 'Token rejected/expired')}`);
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
    body: JSON.stringify({ messages, vehicle: normalizeVehicleForApi(vehicle), convoId: 'default' }),
  });

  const { json, text } = await readJsonOrText(resp);
  if (!resp.ok) {
    const err = new Error(json?.error || shortErr(text) || `HTTP ${resp.status}`);
    err.status = resp.status;
    err.code = json?.error === 'Insufficient energy' ? 'INSUFFICIENT_ENERGY' : 'CHAT_FAILED';
    err.data = json || { raw: text };
    throw err;
  }
  return json || {};
}

async function sendAudioToBackend({ uri, prompt, vehicle, mimeType, filename }) {
  const cleanUri = normalizeFileUri(uri);
  if (!cleanUri) throw new Error('Audio URI is missing/invalid (could not normalize).');

  const info = await FileSystem.getInfoAsync(cleanUri);
  if (!info?.exists) throw new Error(`Audio file not found: ${cleanUri}`);

  const base64 = await FileSystem.readAsStringAsync(cleanUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // ✅ safety guard to match backend MAX_AUDIO_BASE64_CHARS
  enforceBase64Limit(base64, MAX_AUDIO_BASE64_CHARS, 'Audio clip');

  const inferredAudioMeta = inferAudioMeta(cleanUri);
  const chosenFilename = filename || inferredAudioMeta.filename || 'audio.m4a';
  const chosenMimeType = mimeType || inferredAudioMeta.mimeType || 'audio/mp4';

  // OpenAI transcription does not accept .caf. The recorder now returns real .m4a/AAC.
  // This guard prevents accidentally sending an unsupported .caf filename/mime.
  const safeFilename = String(chosenFilename).toLowerCase().endsWith('.caf') ? 'audio.m4a' : chosenFilename;
  const safeMimeType = String(chosenMimeType).toLowerCase().includes('caf') ? 'audio/mp4' : chosenMimeType;

  // backend expects raw base64 (not data URL)
  const resp = await authedFetch(API_AUDIO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioBase64: stripDataUrl(base64),
      prompt: prompt || 'Diagnose this sound.',
      vehicle: normalizeVehicleForApi(vehicle),
      mimeType: safeMimeType,
      filename: safeFilename,
    }),
  });

  const { json, text } = await readJsonOrText(resp);
  if (!resp.ok) throw new Error(json?.error || shortErr(text) || `HTTP ${resp.status}`);
  return json || {};
}

async function sendImageToBackend({ base64, text, vehicle }) {
  const raw = stripDataUrl(base64);
  if (!raw) throw new Error('Image data missing.');

  // ✅ safety guard to prevent huge payloads
  enforceBase64Limit(raw, MAX_IMAGE_BASE64_CHARS, 'Image');

  const resp = await authedFetch(API_IMAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: asDataUrlJpeg(raw), // backend accepts data-url too
      text: (text || '').trim(),
      vehicle: normalizeVehicleForApi(vehicle),
    }),
  });

  const { json, text: t } = await readJsonOrText(resp);
  if (!resp.ok) throw new Error(json?.error || shortErr(t) || `HTTP ${resp.status}`);
  return json || {};
}

async function generateServiceRecommendations({ vehicle, currentMileage }) {
  const resp = await authedFetch(API_GENERATE_SERVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehicle: normalizeVehicleForApi(vehicle),
      currentMileage: currentMileage ?? null,
    }),
  });

  const { json, text } = await readJsonOrText(resp);

  if (!resp.ok) {
    const msg = json?.error || shortErr(text) || `Service recs failed (HTTP ${resp.status})`;
    const err = new Error(msg);
    err.code = json?.error === 'Insufficient energy' ? 'INSUFFICIENT_ENERGY' : 'SERVICE_RECS_FAILED';
    err.data = json || { raw: text };
    throw err;
  }

  return json || {};
}


async function grantRevenueCatPurchaseToBackend(payload = {}) {
  const resp = await authedFetch(API_IAP_GRANT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const { json, text } = await readJsonOrText(resp);
  if (!resp.ok) {
    const err = new Error(json?.error || shortErr(text) || `Purchase grant failed (HTTP ${resp.status})`);
    err.status = resp.status;
    err.code = 'IAP_GRANT_FAILED';
    err.data = json || { raw: text };
    throw err;
  }
  return json || {};
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
  const [carSlotBonus, setCarSlotBonus] = useState(0);

  const [vehicle, setVehicle] = useState(null);
  const [garageName, setGarageName] = useState('');

  const [messages, setMessages] = useState([]); // UI
  const [chatHistory, setChatHistory] = useState([]); // backend history

  const [isChatting, setIsChatting] = useState(false);
  const [showSavedChats, setShowSavedChats] = useState(false);

  const [isLoggedIn, setIsLoggedIn] = useState(null);

  const [loading, setLoading] = useState(false);
  const [chatID, setChatID] = useState(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showTorqueStore, setShowTorqueStore] = useState(false);

  const [attachedImage, setAttachedImage] = useState(null);
  const [attachedAudio, setAttachedAudio] = useState(null);
  const [attachmentLocked, setAttachmentLocked] = useState(false);

  const [showAudioRecorder, setShowAudioRecorder] = useState(false);

  const [showCamera, setShowCamera] = useState(false);
  const [vinPhoto, setVinPhoto] = useState(null);
  const [showDecodingModal, setShowDecodingModal] = useState(false);

  const [activeChatVehicle, setActiveChatVehicle] = useState(null);

  const [focusTick, setFocusTick] = useState(0);
  const [threadKey, setThreadKey] = useState('new');
  const [threadVehicleKey, setThreadVehicleKey] = useState(null);

  // ✅ /me anti-spam: TTL cache + in-flight lock (prevents double calls from multiple places)
  const meCacheRef = useRef({
    ts: 0,
    data: null,
    inFlight: null,
  });

  // ✅ prevent multiple simultaneous VIN decodes
  const decodeVinInFlightRef = useRef(false);

  const chatVehicleRestoreRef = useRef({
    shouldRestore: false,
    vehicleObj: null,
    vehicleKey: null,
  });

  // ✅ App-owned /me fetcher
  const getMe = async ({ force = false } = {}) => {
    const TTL_MS = 60_000; // 60s cache (cheap + avoids spam)
    const now = Date.now();

    if (!force && meCacheRef.current.data && now - meCacheRef.current.ts < TTL_MS) {
      return meCacheRef.current.data;
    }

    if (meCacheRef.current.inFlight) {
      return meCacheRef.current.inFlight;
    }

    meCacheRef.current.inFlight = (async () => {
      const r = await authedFetch(API_ME_URL, { method: 'GET' });
      const { json, text } = await readJsonOrText(r);

      if (!r.ok) {
        const err = new Error(`ME_FAILED: HTTP ${r.status} ${shortErr(json?.error || text)}`.trim());
        err.code = 'ME_FAILED';
        throw err;
      }

      meCacheRef.current.ts = Date.now();
      meCacheRef.current.data = json || {};
      return meCacheRef.current.data;
    })();

    try {
      return await meCacheRef.current.inFlight;
    } finally {
      meCacheRef.current.inFlight = null;
    }
  };

  // ✅ Energy refresh uses /me cache; only forces when explicitly needed.
  // Most app actions now use the live energy_balance returned by Lambda, so /me
  // stays cached and cheap. force:true is only a fallback when a route does not
  // return a fresh balance.
  const refreshEnergy = async ({ force = false } = {}) => {
    try {
      setEnergyLoading(true);
      const me = await getMe({ force });
      if (me && typeof me.energy_balance === 'number') {
        setEnergyBalance(me.energy_balance);
      }
      if (me && typeof me.car_slot_bonus === 'number') {
        setCarSlotBonus(me.car_slot_bonus);
      }
    } catch {
      // ignore; auth failures handled in callers
    } finally {
      setEnergyLoading(false);
    }
  };

  // ✅ Updates the EnergyPill immediately from route responses without doing
  // extra /me calls. Falls back to a forced /me only if needed.
  const applyEnergyFromResponse = async (data, { forceFallback = false } = {}) => {
    const nextBalance = Number(data?.energy_balance);
    const nextCarSlotBonus = Number(data?.car_slot_bonus);

    if (Number.isFinite(nextCarSlotBonus)) {
      setCarSlotBonus(nextCarSlotBonus);
    }

    if (Number.isFinite(nextBalance)) {
      setEnergyBalance(nextBalance);
      meCacheRef.current.ts = Date.now();
      meCacheRef.current.data = {
        ...(meCacheRef.current.data || {}),
        energy_balance: nextBalance,
        ...(Number.isFinite(nextCarSlotBonus) ? { car_slot_bonus: nextCarSlotBonus } : {}),
      };
      return;
    }

    if (forceFallback) {
      await refreshEnergy({ force: true });
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
        mediaTypes: IMAGE_MEDIA_TYPES,
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

        if (!jwt) {
          setIsLoggedIn(false);
          return;
        }

        try {
          // single call: /me verifies the token AND hydrates energy/tier
          const me = await getMe({ force: true });
          setIsLoggedIn(true);
          if (me && typeof me.energy_balance === 'number') setEnergyBalance(me.energy_balance);
          if (me && typeof me.car_slot_bonus === 'number') setCarSlotBonus(me.car_slot_bonus);
          await configureRevenueCatForUser(me?.userId);
        } catch {
          await clearAllTokens();
          setIsLoggedIn(false);
        }
      } catch {
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

      // keep UX fast: guard early
      try {
        enforceBase64Limit(b64, MAX_IMAGE_BASE64_CHARS, 'Image');
      } catch (e) {
        Alert.alert('Photo too large', e?.message || 'Try taking a closer shot (less background).');
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

    // ✅ VehicleSelector is the source of truth. Torque should default to the currently
    // selected garage vehicle every time unless the user explicitly asks about another car.
    // Only use an overridden vehicle when loading an old saved chat whose vehicle is not
    // currently in the garage.
    const selectedVehicleForApi = normalizeVehicleForApi(vehicle);
    const overrideVehicleForApi =
      activeChatVehicle?.source === 'overridden' ? normalizeVehicleForApi(activeChatVehicle) : null;
    const vehicleForChat = overrideVehicleForApi || selectedVehicleForApi;

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
        await applyEnergyFromResponse(data, { forceFallback: true });
      } else if (hasImg) {
        const data = await sendImageToBackend({
          base64: imgSnap?.base64,
          text: hasText ? text.trim() : '',
          vehicle: vehicleForChat,
        });
        replyText = data?.reply || '⚠️ No response from image endpoint.';
        await applyEnergyFromResponse(data, { forceFallback: true });
      } else {
        const data = await chatWithBackend({
          messages: trimmedHistory,
          vehicle: vehicleForChat,
        });
        replyText = data?.reply || '';
        // Do not switch the app's active vehicle based on model metadata.
        // VehicleSelector remains the source of truth for the default car.
        await applyEnergyFromResponse(data, { forceFallback: true });
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
    } catch (e) {
      if (String(e?.code) === 'NOT_LOGGED_IN' || String(e?.code) === 'UNAUTHORIZED') {
        Alert.alert('Session expired', 'Please sign in again.');
        await clearAllTokens();
        setIsLoggedIn(false);
        setLoading(false);
        setAttachmentLocked(false);
        return;
      }

      if (e?.status === 402 || String(e?.code) === 'INSUFFICIENT_ENERGY' || e?.data?.error === 'Insufficient energy') {
        const bal = e?.data?.energy_balance;
        const required = e?.data?.required || 3000;

        setMessages((prev) => [
          ...prev,
          {
            sender: 'api',
            text:
              `⚠️ Not enough Torque energy. You need at least ${required.toLocaleString()} energy to start a chat request` +
              `${typeof bal === 'number' ? `, but you only have ${bal.toLocaleString()}.` : '.'}`,
          },
        ]);

        setAttachmentLocked(false);
        return;
      }

      // Restore photo retry, but do NOT restore audio.
      // Audio files can get stuck in the chip area after a failed transcription because the chip is driven by attachedAudio.
      // The user can re-record a fresh clip, which is safer than retrying a possibly unsupported/expired local file URI.
      if (imgSnap) setAttachedImage(imgSnap);

      setMessages((prev) => [
        ...prev,
        { sender: 'api', text: `⚠️ ${e?.message || 'Error sending message.'}` },
      ]);
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

    if (chatVehicleRestoreRef.current?.shouldRestore && chatVehicleRestoreRef.current?.vehicleObj) {
      setVehicle(chatVehicleRestoreRef.current.vehicleObj);
    }
    chatVehicleRestoreRef.current = { shouldRestore: false, vehicleObj: null, vehicleKey: null };
  };

  const handleSelectVehicle = async (v) => {
    const normalized = normalizeVehicle(v || {});
    await saveVehicle(normalized);
    setVehicle(normalized);
    setActiveChatVehicle(null);
    chatVehicleRestoreRef.current = { shouldRestore: false, vehicleObj: null, vehicleKey: null };
  };

  // ✅ ServiceBox backend wrapper (auth + energy update)
  const handleGenerateServiceRecs = async ({ vehicle: vIn, currentMileage } = {}) => {
    const v = vIn || vehicle;
    if (!v) throw new Error('No vehicle selected.');

    const mileageHint = currentMileage != null ? currentMileage : v?.mileage != null ? v.mileage : null;

    const res = await generateServiceRecommendations({
      vehicle: v,
      currentMileage: mileageHint,
    });

    await applyEnergyFromResponse(res, { forceFallback: true });
    return res;
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

      const p = stripDataUrl(primaryBase64);
      const f = fullBase64 ? stripDataUrl(fullBase64) : null;

      if (!p) throw new Error('VIN image missing.');
      // conservative guard to avoid giant uploads
      enforceBase64Limit(p, MAX_IMAGE_BASE64_CHARS, 'VIN photo');

      const resp1 = await authedFetch(API_DECODE_VIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64Image: p,
          fullBase64: f,
        }),
      });

      const { json: data1, text: t1 } = await readJsonOrText(resp1);
      if (!resp1.ok) throw new Error(data1?.error || shortErr(t1) || `VIN decode failed (HTTP ${resp1.status})`);

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

      const { json: data2, text: t2 } = await readJsonOrText(resp2);
      if (!resp2.ok) {
        throw new Error(data2?.error || shortErr(t2) || `VIN text decode failed (HTTP ${resp2.status})`);
      }

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

      const name = `${vehicleFromPhoto.year || ''} ${vehicleFromPhoto.make || ''} ${
        vehicleFromPhoto.model || ''
      }`.trim();
      Alert.alert(`✅ ${name} added to garage`, vehicleFromPhoto.engine || '');

      await applyEnergyFromResponse(data2, { forceFallback: true });
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
    meCacheRef.current = { ts: 0, data: null, inFlight: null };
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
          onLogin={async (meFromLogin) => {
            try {
              // LoginScreen already called /me — so we just hydrate cache + state.
              // If it passed me, trust it; else force one /me call.
              if (meFromLogin && typeof meFromLogin === 'object') {
                meCacheRef.current.ts = Date.now();
                meCacheRef.current.data = meFromLogin;
                if (typeof meFromLogin.energy_balance === 'number') setEnergyBalance(meFromLogin.energy_balance);
                if (typeof meFromLogin.car_slot_bonus === 'number') setCarSlotBonus(meFromLogin.car_slot_bonus);
                await configureRevenueCatForUser(meFromLogin.userId);
              } else {
                const me = await getMe({ force: true });
                if (typeof me?.energy_balance === 'number') setEnergyBalance(me.energy_balance);
                if (typeof me?.car_slot_bonus === 'number') setCarSlotBonus(me.car_slot_bonus);
                await configureRevenueCatForUser(me?.userId);
              }

              setIsLoggedIn(true);
            } catch (e) {
              console.warn('Login success but /me hydrate failed:', e?.message || e);
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
          <HomeHeader
            garageName={garageName}
            setGarageName={setGarageName}
            onSettingsPress={() => setShowSettings(true)}
          />
          <SettingsModal
            visible={showSettings}
            onClose={() => setShowSettings(false)}
            onOpenShop={() => {
              setShowSettings(false);
              setShowTorqueStore(true);
            }}
          />

          {!isChatting && (
            <>
              <VehicleSelector
                selectedVehicle={vehicle}
                onSelectVehicle={handleSelectVehicle}
                onShowRewardedAd={showRewardedAd}
                gateCameraWithAd={false}
                triggerVinCamera={() => setShowCamera(true)}
                onOpenVehiclePhoto={openVehiclePhoto}
                vehicleSlotLimit={1 + Number(carSlotBonus || 0)}
                onOpenShop={() => setShowTorqueStore(true)}
                onDecodeVinTyped={async (vin) => {
                  const resp = await authedFetch(API_DECODE_VIN_TEXT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ vin }),
                  });

                  const { json: data, text: t } = await readJsonOrText(resp);
                  if (!resp.ok) throw new Error(data?.error || shortErr(t) || `VIN text decode failed (HTTP ${resp.status})`);

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

                  await applyEnergyFromResponse(data, { forceFallback: true });

                  const name = `${vehicleFromVin.year || ''} ${vehicleFromVin.make || ''} ${
                    vehicleFromVin.model || ''
                  }`.trim();
                  Alert.alert(`✅ ${name} added to garage`, vehicleFromVin.engine || '');
                }}
              />

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
              <ChatMessages
                messages={messages}
                loading={loading}
                focusTick={focusTick}
                bottomInset={120}
                threadKey={threadKey}
              />
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
    <GestureHandlerRootView style={styles.gestureRoot}>
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
            // Prefer the recorder's explicit metadata. This keeps the backend on the
            // intended audio.m4a / audio/mp4 path instead of guessing from the URI.
            mimeType: payload?.mimeType || meta.mimeType,
            filename: payload?.filename || meta.filename,
          });

          setFocusTick((x) => x + 1);
        }}
      />

      <TorqueStoreModal
        visible={showTorqueStore}
        onClose={() => setShowTorqueStore(false)}
        currentEnergy={energyBalance}
        carSlotBonus={carSlotBonus}
        onGrantPurchase={async (payload) => {
          const data = await grantRevenueCatPurchaseToBackend(payload);
          await applyEnergyFromResponse(data, { forceFallback: true });
          return data;
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
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },
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