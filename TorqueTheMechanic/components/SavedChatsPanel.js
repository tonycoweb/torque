// components/SavedChatsPanel.js
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
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

  try { return JSON.stringify(content); } catch { return String(content); }
}

export default function SavedChatsPanel(
  { onSelect, onClose, chats: chatsProp } = {} // ✅ CRITICAL: default {} prevents destructure crash
) {
  const [chats, setChats] = useState([]);

  const usingExternalChats = Array.isArray(chatsProp);

  const loadChats = async () => {
    try {
      const all = await getAllChats();
      setChats(Array.isArray(all) ? all : []);
    } catch (e) {
      console.error('Load chats error:', e);
      setChats([]);
    }
  };

  // ✅ If parent passes chats, use them. Otherwise, load from storage.
  useEffect(() => {
    if (usingExternalChats) setChats(chatsProp);
    else loadChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingExternalChats, chatsProp?.length]);

  const handleDelete = async (id) => {
    try {
      await deleteChat(id);
      if (usingExternalChats) {
        // parent-owned list; just tell parent to refresh by closing/reopening
        // (or pass a refresh prop if you want)
      } else {
        await loadChats();
      }
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
        }
      }
    ]);
  };

  const previewFor = (chat) => {
    const msgs = Array.isArray(chat?.messages) ? chat.messages : [];
    const last = msgs[msgs.length - 1];
    if (!last) return 'No messages';
    const txt = normalizeContent(last.content || last.text || '');
    return txt.length > 70 ? txt.slice(0, 70) + '…' : txt;
  };

  const sortedChats = useMemo(() => {
    const arr = Array.isArray(chats) ? [...chats] : [];
    // If your objects have updatedAt, sort by it; otherwise keep order.
    arr.sort((a, b) => (b?.updatedAt || 0) - (a?.updatedAt || 0));
    return arr;
  }, [chats]);

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>Saved Chats</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity onPress={() => onSelect?.(null)} style={[styles.actionBtn, styles.newBtn]}>
          <Text style={styles.actionText}>New</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleClearAll} style={[styles.actionBtn, styles.clearBtn]}>
          <Text style={styles.actionText}>Clear All</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ marginTop: 10 }}>
        {sortedChats.map((c) => (
          <View key={c.id} style={styles.chatRow}>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => onSelect?.(c)}>
              <Text style={styles.chatTitle}>{c.title || `Chat ${c.id}`}</Text>
              <Text style={styles.preview}>{c.preview || previewFor(c)}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => handleDelete(c.id)} style={styles.deleteBtn}>
              <Text style={styles.deleteText}>🗑️</Text>
            </TouchableOpacity>
          </View>
        ))}

        {(!sortedChats || sortedChats.length === 0) && (
          <Text style={styles.empty}>No saved chats yet.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    right: 14,
    bottom: 180,
    width: '92%',
    maxHeight: '55%',
    backgroundColor: '#1c1c1c',
    borderRadius: 18,
    padding: 14,
    zIndex: 200,
    borderWidth: 1,
    borderColor: '#333',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  closeBtn: { padding: 8, borderRadius: 12, backgroundColor: '#333' },
  closeText: { color: '#fff', fontSize: 14 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: { flex: 1, paddingVertical: 10, borderRadius: 14, alignItems: 'center' },
  newBtn: { backgroundColor: '#2f6fed' },
  clearBtn: { backgroundColor: '#444' },
  actionText: { color: '#fff', fontWeight: '700' },
  chatRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2b2b2b' },
  chatTitle: { color: '#fff', fontWeight: '700' },
  preview: { color: '#aaa', marginTop: 4 },
  deleteBtn: { padding: 10, marginLeft: 10, backgroundColor: '#333', borderRadius: 12 },
  deleteText: { fontSize: 16 },
  empty: { color: '#888', textAlign: 'center', paddingVertical: 18 },
});
