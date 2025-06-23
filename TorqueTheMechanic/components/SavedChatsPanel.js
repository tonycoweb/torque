// components/SavedChatsPanel.js
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Platform,
  LayoutAnimation,
} from 'react-native';
import { getAllChats, deleteChat, clearAllChats } from '../utils/storage';

export default function SavedChatsPanel({ onSelect, onClose }) {
  const [chats, setChats] = useState([]);

  useEffect(() => {
    loadChats();
  }, []);

  const loadChats = async () => {
    const saved = await getAllChats();
    const array = Object.entries(saved).map(([id, messages]) => {
      const date = new Date(Number(id));
      const userMsg = messages.find((m) => m.role === 'user');
      return {
        id,
        title: userMsg?.content?.slice(0, 60) || 'Untitled Chat',
        date: date.toLocaleString(),
        messages,
      };
    });
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setChats(array.reverse());
  };

  const handleDelete = (id) => {
    Alert.alert('Delete Chat', 'Are you sure you want to delete this chat?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        onPress: async () => {
          await deleteChat(id);
          loadChats();
        },
        style: 'destructive',
      },
    ]);
  };

  const handleClearAll = () => {
    Alert.alert('Delete All Chats', 'This will remove every saved chat. Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete All',
        onPress: async () => {
          await clearAllChats();
          loadChats();
        },
        style: 'destructive',
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>💾 Saved Chats</Text>

      <FlatList
        data={chats}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <Text style={styles.empty}>No saved chats yet. Start a new one! ✨</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.chatRow}>
          <TouchableOpacity
            style={styles.chatButton}
            onPress={() => onSelect(item)}
          >
            <Text style={styles.chatText}>{item.title}</Text>
            <Text style={styles.chatDate}>{item.date}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.deleteIcon}>
            <Text style={{ color: '#f66', fontSize: 18 }}>🗑️</Text>
          </TouchableOpacity>
        </View>
        
        )}
      />

      <View style={styles.footerButtons}>
        <TouchableOpacity onPress={handleClearAll} style={styles.footerBtn}>
          <Text style={styles.footerText}>🗑️ Clear All</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onSelect(null)} style={styles.footerBtn}>
          <Text style={styles.footerText}>✨ New Chat</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={styles.footerBtn}>
          <Text style={styles.footerText}>❌ Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 160 : 140,
    left: 20,
    right: 20,
    backgroundColor: '#222',
    padding: 20,
    borderRadius: 20,
    maxHeight: 420,
    zIndex: 999,
    elevation: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  chatButton: {
    paddingVertical: 10,
    borderBottomColor: '#444',
    borderBottomWidth: 1,
  },
  chatText: {
    color: '#ccc',
    fontSize: 16,
  },
  chatDate: {
    color: '#888',
    fontSize: 12,
  },
  empty: {
    color: '#aaa',
    textAlign: 'center',
    marginVertical: 20,
  },
  footerButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
  },
  footerBtn: {
    backgroundColor: '#444',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  footerText: {
    color: '#fff',
    fontSize: 14,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomColor: '#444',
    borderBottomWidth: 1,
    paddingVertical: 12,
  },
  deleteIcon: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  
});
