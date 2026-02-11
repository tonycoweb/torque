// components/SavedChatsPanel.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAllChats, deleteChat, clearAllChats } from '../utils/storage';

function normalizeContent(content) {
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
}

function buildPreview(messages = []) {
  const last = messages[messages.length - 1];
  if (!last) return 'No messages';
  const txt = normalizeContent(last.content || last.text || '');
  const clean = String(txt).replace(/\s+/g, ' ').trim();
  return clean.length > 92 ? clean.slice(0, 92) + '…' : clean;
}

function buildTitle(messages = []) {
  const firstUser = messages.find((m) => m?.role === 'user');
  const txt = normalizeContent(firstUser?.content || firstUser?.text || '');
  const clean = String(txt).replace(/\s+/g, ' ').trim();
  if (!clean) return 'Chat';
  return clean.length > 28 ? clean.slice(0, 28) + '…' : clean;
}

function formatVehicleBadge(val) {
  const year = val?.vehicleYear;
  const make = val?.vehicleMake;
  const model = val?.vehicleModel;

  const label = [year, make, model].filter(Boolean).join(' ').trim();
  return label || 'General Chat';
}

// ✅ Convert storage object -> array of chat objects (supports old + new formats)
function toChatArray(allChatsObj) {
  const obj = allChatsObj && typeof allChatsObj === 'object' ? allChatsObj : {};
  const out = [];

  for (const id of Object.keys(obj)) {
    const val = obj[id];

    // Old format: chats[id] = messagesArray
    if (Array.isArray(val)) {
      const messages = val;
      out.push({
        id,
        messages,
        title: buildTitle(messages),
        preview: buildPreview(messages),
        updatedAt: Number(id) || 0, // old best-effort
        vehicleBadge: 'General Chat', // ✅ clean placeholder for old chats
        vehicleKey: null,
        vehicleVin: null,
        vehicleYear: null,
        vehicleMake: null,
        vehicleModel: null,
      });
      continue;
    }

    // New format: chats[id] = { messages, updatedAt, vehicleKey, vehicleVin, vehicleYear, vehicleMake, vehicleModel, ... }
    if (val && typeof val === 'object') {
      const messages = Array.isArray(val.messages) ? val.messages : [];
      out.push({
        id,
        messages,
        title: val.title || buildTitle(messages),
        preview: val.preview || buildPreview(messages),
        updatedAt: Number(val.updatedAt) || Number(id) || 0,
        vehicleBadge: formatVehicleBadge(val), // ✅ year make model or fallback
        vehicleKey: val.vehicleKey || null,
        vehicleVin: val.vehicleVin || null,
        vehicleYear: val.vehicleYear || null,
        vehicleMake: val.vehicleMake || null,
        vehicleModel: val.vehicleModel || null,
      });
      continue;
    }

    out.push({
      id,
      messages: [],
      title: 'Chat',
      preview: 'No messages',
      updatedAt: Number(id) || 0,
      vehicleBadge: 'General Chat',
      vehicleKey: null,
      vehicleVin: null,
      vehicleYear: null,
      vehicleMake: null,
      vehicleModel: null,
    });
  }

  return out;
}

export default function SavedChatsPanel({ visible = false, onSelect, onClose } = {}) {
  const [chats, setChats] = useState([]);

  const loadChats = async () => {
    try {
      const all = await getAllChats();
      const arr = toChatArray(all);
      setChats(arr);
    } catch (e) {
      console.error('Load chats error:', e);
      setChats([]);
    }
  };

  // ✅ Reload on open so it always shows newest
  useEffect(() => {
    if (visible) loadChats();
  }, [visible]);

  const sortedChats = useMemo(() => {
    const arr = Array.isArray(chats) ? [...chats] : [];
    arr.sort((a, b) => (b?.updatedAt || 0) - (a?.updatedAt || 0));
    return arr;
  }, [chats]);

  const handleDelete = async (id) => {
    try {
      await deleteChat(id);
      await loadChats();
    } catch {
      Alert.alert('Error', 'Could not delete chat.');
    }
  };

  const handleClearAll = async () => {
    Alert.alert('Clear all chats?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          try {
            await clearAllChats();
            setChats([]);
          } catch {
            Alert.alert('Error', 'Could not clear chats.');
          }
        },
      },
    ]);
  };

  const fmt = (ts) => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />

      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.iconBubble}>
              <Ionicons name="bookmark-outline" size={18} color="#fff" />
            </View>
            <Text style={styles.title}>Saved Chats</Text>
          </View>

          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={10}>
            <Ionicons name="close" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            onPress={() => onSelect?.(null)}
            style={[styles.actionBtn, styles.newBtn]}
            activeOpacity={0.9}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.actionText}>New</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleClearAll}
            style={[styles.actionBtn, styles.clearBtn]}
            activeOpacity={0.9}
          >
            <Ionicons name="trash-outline" size={16} color="#fff" />
            <Text style={styles.actionText}>Clear</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 22 }}>
          {sortedChats.map((c) => {
            const isGeneral = (c.vehicleBadge || '') === 'General Chat';

            return (
              <TouchableOpacity
                key={c.id}
                style={styles.card}
                onPress={() => onSelect?.(c)}
                activeOpacity={0.9}
              >
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.chatTitle} numberOfLines={1}>
                      {c.title || `Chat ${c.id}`}
                    </Text>

                    {/* ✅ Always show badge: year/make/model or clean fallback */}
                    <View style={styles.badgeRow}>
                      <View style={[styles.vehicleBadge, isGeneral && styles.generalBadge]}>
                        <Ionicons name="car-outline" size={12} color="#cfcfcf" />
                        <Text style={styles.vehicleBadgeText} numberOfLines={1}>
                          {c.vehicleBadge || 'General Chat'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <Text style={styles.time} numberOfLines={1}>
                    {fmt(c.updatedAt)}
                  </Text>
                </View>

                <Text style={styles.preview} numberOfLines={2}>
                  {c.preview || buildPreview(c.messages)}
                </Text>

                <View style={styles.cardActions}>
                  <View style={styles.pill}>
                    <Ionicons name="chatbubble-ellipses-outline" size={14} color="#cfcfcf" />
                    <Text style={styles.pillText}>
                      {Array.isArray(c.messages) ? c.messages.length : 0} msgs
                    </Text>
                  </View>

                  <TouchableOpacity
                    onPress={() => handleDelete(c.id)}
                    style={styles.deleteBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="trash" size={16} color="#ffb4b4" />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })}

          {sortedChats.length === 0 && (
            <View style={styles.emptyWrap}>
              <Ionicons name="bookmark-outline" size={26} color="#777" />
              <Text style={styles.emptyTitle}>No saved chats yet</Text>
              <Text style={styles.emptySub}>Start a conversation — it’ll show up here automatically.</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '78%',
    backgroundColor: '#141414',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: '#262626',
    paddingHorizontal: 14,
    paddingTop: 10,
  },

  handle: {
    alignSelf: 'center',
    width: 52,
    height: 5,
    borderRadius: 99,
    backgroundColor: '#2a2a2a',
    marginBottom: 10,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
  },

  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  iconBubble: {
    width: 30,
    height: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  title: { color: '#fff', fontSize: 18, fontWeight: '800' },

  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 14,
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#2b2b2b',
    alignItems: 'center',
    justifyContent: 'center',
  },

  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },

  actionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
  },

  newBtn: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  clearBtn: { backgroundColor: '#222', borderColor: '#2b2b2b' },

  actionText: { color: '#fff', fontWeight: '800' },

  list: { paddingBottom: 12 },

  card: {
    backgroundColor: '#1c1c1c',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
  },

  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },

  chatTitle: { color: '#fff', fontWeight: '800', fontSize: 15 },

  badgeRow: { marginTop: 6 },

  vehicleBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    maxWidth: 260,
  },

  generalBadge: {
    opacity: 0.6,
  },

  vehicleBadgeText: { color: '#cfcfcf', fontSize: 12, fontWeight: '700' },

  time: { color: '#8a8a8a', fontSize: 12 },

  preview: { color: '#bdbdbd', marginTop: 8, lineHeight: 18 },

  cardActions: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },

  pillText: { color: '#cfcfcf', fontSize: 12, fontWeight: '700' },

  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 14,
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#2b2b2b',
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyWrap: { alignItems: 'center', paddingVertical: 26, gap: 8 },
  emptyTitle: { color: '#ddd', fontSize: 15, fontWeight: '800' },
  emptySub: { color: '#888', textAlign: 'center', paddingHorizontal: 24, lineHeight: 18 },
});
