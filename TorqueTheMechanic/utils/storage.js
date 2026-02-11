// utils/storage.js
import AsyncStorage from '@react-native-async-storage/async-storage';

const CHATS_KEY = 'saved_chats_v2'; // keep stable key

// -------------------- helpers --------------------
const safeJsonParse = (raw, fallback) => {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const buildTitle = (messages = []) => {
  const firstUser = messages.find((m) => m?.role === 'user');
  const txt = firstUser?.content || firstUser?.text || '';
  const clean = String(txt).replace(/\s+/g, ' ').trim();
  if (!clean) return 'Chat';
  return clean.length > 28 ? clean.slice(0, 28) + '…' : clean;
};

const buildPreview = (messages = []) => {
  const last = messages[messages.length - 1];
  if (!last) return 'No messages';
  const txt = last?.content || last?.text || '';
  const clean = String(txt).replace(/\s+/g, ' ').trim();
  return clean.length > 92 ? clean.slice(0, 92) + '…' : clean;
};

// -------------------- core API --------------------
export async function getAllChats() {
  const raw = await AsyncStorage.getItem(CHATS_KEY);
  const obj = safeJsonParse(raw, {});
  return obj && typeof obj === 'object' ? obj : {};
}

// ✅ supports old + new format
export async function getChat(id) {
  if (!id) return null;
  const all = await getAllChats();
  const val = all?.[id];

  // old format: messages array
  if (Array.isArray(val)) return val;

  // new format: { messages, ...meta }
  if (val && typeof val === 'object') {
    return Array.isArray(val.messages) ? val.messages : [];
  }

  return null;
}

// ✅ This is the key fix: persist ALL meta (year/make/model/etc)
export async function saveChat(id, messages = [], meta = {}) {
  if (!id) return;

  const all = await getAllChats();
  const now = Date.now();

  const prev = all?.[id];
  const prevObj =
    prev && typeof prev === 'object' && !Array.isArray(prev) ? prev : null;

  const normalizedMessages = Array.isArray(messages) ? messages : [];

  // Preserve any existing fields, then overwrite with newest
  const next = {
    ...(prevObj || {}),
    messages: normalizedMessages,
    updatedAt: now,

    // nice-to-have; panel will use these if you ever choose
    title: prevObj?.title || buildTitle(normalizedMessages),
    preview: prevObj?.preview || buildPreview(normalizedMessages),

    // ✅ IMPORTANT: store ALL meta keys (vehicleYear, vehicleMake, vehicleModel, etc.)
    ...(meta && typeof meta === 'object' ? meta : {}),
  };

  all[id] = next;
  await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(all));
}

export async function deleteChat(id) {
  if (!id) return;
  const all = await getAllChats();
  if (all?.[id] == null) return;
  delete all[id];
  await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(all));
}

export async function clearAllChats() {
  await AsyncStorage.removeItem(CHATS_KEY);
}
