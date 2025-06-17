import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';

export default function SavedChatsPanel({ onClose }) {
  // Placeholder data for now:
  const savedChats = [
    { id: '1', title: 'Engine troubleshooting' },
    { id: '2', title: 'AC diagnosis' },
    { id: '3', title: 'Oil Change Notes' },
  ];

  return (
    <View style={styles.overlay}>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Saved Chats</Text>

        <FlatList
          data={savedChats}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.chatItem}>
              <Text style={styles.chatTitle}>{item.title}</Text>
            </View>
          )}
        />

        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    bottom: 160, // leaves space for ChatBoxFixed
    backgroundColor: '#1c1c1c',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 999,
  },
  panel: {
    flex: 1,
  },
  panelTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  chatItem: {
    paddingVertical: 10,
    borderBottomColor: '#333',
    borderBottomWidth: 1,
  },
  chatTitle: {
    color: '#ddd',
    fontSize: 16,
  },
  closeButton: {
    marginTop: 12,
    backgroundColor: '#555',
    padding: 10,
    borderRadius: 8,
    alignSelf: 'center',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 14,
  },
});

