// App.js
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
import VehiclePhotoModal from './components/VehiclePhotoModal'; // ✅ hosted at App root
import LoginScreen from './components/LoginScreen';
import SettingsModal from './components/SettingsModal';

import VinCamera from './components/VinCamera';
import VinPreview from './components/VinPreview';
import AudioRecorderModal from './components/AudioRecorderModal';

import { saveChat, getAllChats, getChat } from './utils/storage';
import { getAllVehicles, saveVehicle } from './utils/VehicleStorage';

import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';

import mobileAds, { RewardedAd, RewardedAdEventType } from 'react-native-google-mobile-ads';

// ===================== BACKEND =====================
const BACKEND_BASE = 'http://192.168.1.246:3001';
const API_CHAT_URL = `${BACKEND_BASE}/chat`;
const API_AUDIO_URL = `${BACKEND_BASE}/audio-diagnose`;
const API_IMAGE_URL = `${BACKEND_BASE}/image-diagnose`;
const API_DECODE_VIN_URL = `${BACKEND_BASE}/decode-vin`;

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

// ===================== API CALLS =====================
async function chatWithBackend({ messages, vehicle }) {
  const resp = await fetch(API_CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, vehicle: vehicle || null }),
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

  const resp = await fetch(API_AUDIO_URL, {
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
  const resp = await fetch(API_IMAGE_URL, {
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

export default function App() {
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

  const rewardedRef = useRef(null);

  const [threadVehicleKey, setThreadVehicleKey] = useState(null);

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
      allowsEditing: false,  // ✅ let VehiclePhotoModal handle the crop/adjust
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
      const user = await AsyncStorage.getItem('user');
      setIsLoggedIn(!!user);
    })();
  }, []);

  // ===================== Load vehicles (improved: restore selectedVehicle first) =====================
  useEffect(() => {
    (async () => {
      try {
        const saved = await getAllVehicles();
        const list = (saved || []).map(normalizeVehicle);
        if (list.length === 0) return;

        // ✅ prefer persisted selectedVehicle if present
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

        // fallback
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

  const showRewardedAd = async () => {
    return new Promise((resolve) => {
      const rewarded = RewardedAd.createForAdRequest(adUnitId, { requestNonPersonalizedAdsOnly: true });
      const cleanup = () => rewarded.removeAllListeners();

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve(false);
      }, 10000);

      rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        clearTimeout(timeoutId);
        try {
          rewarded.show();
        } catch {
          cleanup();
          resolve(false);
        }
      });

      rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        clearTimeout(timeoutId);
        cleanup();
        resolve(true);
      });

      try {
        rewarded.load();
        rewardedRef.current = rewarded;
      } catch {
        clearTimeout(timeoutId);
        cleanup();
        resolve(false);
      }
    });
  };

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
    } catch (e) {
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
  };

  // ✅ UPDATED: don’t overwrite a newer object (ex: selector updated photoUri)
  const handleSelectVehicle = async (v) => {
    const normalized = normalizeVehicle(v || {});
    await saveVehicle(normalized);
    setVehicle(normalized);
    setActiveChatVehicle(null);
  };

  // ===================== VIN decode flow (kept) =====================
  const decodeVinWithAd = async (base64Image) => {
    return new Promise((resolve) => {
      const rewarded = RewardedAd.createForAdRequest(adUnitId, { requestNonPersonalizedAdsOnly: true });
      const cleanup = () => rewarded.removeAllListeners();

      const timeoutId = setTimeout(() => {
        Alert.alert('⚠️ Ad not ready', 'Try again in a few seconds.');
        cleanup();
        resolve();
      }, 10000);

      rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        clearTimeout(timeoutId);
        try {
          rewarded.show();
        } catch {
          cleanup();
          resolve();
        }
      });

      rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async () => {
        setShowDecodingModal(true);
        try {
          const resp = await fetch(API_DECODE_VIN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64Image }),
          });
          const data = await resp.json();

          if (!resp.ok) {
            Alert.alert('❌ VIN Decode Failed', data?.error || `HTTP ${resp.status}`);
            setVinPhoto(null);
            setShowDecodingModal(false);
            cleanup();
            return resolve();
          }

          const vehicleFromPhoto = data?.vehicle;
          if (vehicleFromPhoto && vehicleFromPhoto.vin && vehicleFromPhoto.make && vehicleFromPhoto.model) {
            const normalized = normalizeVehicle(vehicleFromPhoto);
            await saveVehicle(normalized);
            setVehicle(normalized);
            setActiveChatVehicle(null);
            setVinPhoto(null);

            const name = `${normalized.year || ''} ${normalized.make || ''} ${normalized.model || ''}`.trim();
            Alert.alert(`✅ ${name} added to garage`, normalized.engine || '');
          } else {
            Alert.alert('⚠️ No valid vehicle data', 'Could not parse a VIN from that image.');
            setVinPhoto(null);
          }
        } catch (err) {
          Alert.alert('❌ Error', err?.message || 'Could not decode VIN.');
          setVinPhoto(null);
        } finally {
          setShowDecodingModal(false);
          cleanup();
          resolve();
        }
      });

      try {
        rewarded.load();
        rewardedRef.current = rewarded;
      } catch (e) {
        clearTimeout(timeoutId);
        cleanup();
        Alert.alert('❌ Ad error', e?.message || 'Unknown error');
        resolve();
      }
    });
  };

  const renderContent = () => {
    if (isLoggedIn === null) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
        </View>
      );
    }

    if (!isLoggedIn) return <LoginScreen onLogin={() => setIsLoggedIn(true)} />;

    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <View style={styles.pageContent}>
          <HomeHeader
            garageName={garageName}
            setGarageName={setGarageName}
            onSettingsPress={() => setShowSettings(true)}
          />
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
              />
              <ServiceBox selectedVehicle={vehicle} />
            </>
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
                  setVehicle(matched);
                  setActiveChatVehicle(null);
                } else {
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
                setActiveChatVehicle(null);
              }

              setShowSavedChats(false);
              setIsChatting(true);
              setFocusTick((x) => x + 1);
            }}
          />
        </View>

        <View style={styles.chatDock}>
          <ChatBoxFixed
            onSend={handleSend}
            onFocus={handleChatFocus}
            onMicPress={() => {
              if (loading || attachmentLocked) return;
              if (attachedImage || attachedAudio) {
                Alert.alert('One attachment at a time', 'Remove the current attachment before adding another.');
                return;
              }
              openChat();
              setShowAudioRecorder(true);
            }}
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
              let payload = b64FromPreview;

              if (!payload && vinPhoto?.base64) payload = vinPhoto.base64;
              if (!payload && vinPhoto?.original?.base64) payload = vinPhoto.original.base64;

              if (!payload && vinPhoto?.uri) {
                const fileB64 = await FileSystem.readAsStringAsync(vinPhoto.uri, {
                  encoding: FileSystem.EncodingType.Base64,
                });
                payload = fileB64;
              }

              if (!payload) {
                Alert.alert('Image error', 'No image data found. Please retake the photo.');
                return;
              }

              await decodeVinWithAd(payload);
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
        // ✅ Optional hook so App can enforce cropping UX
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
