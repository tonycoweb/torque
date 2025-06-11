import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export default function ChatHistoryPanel({
  chatHistory,
  isVisible,
  onClose,
  onSelectChat,
  onStartNewChat,
  onClearChatHistoryConfirm,
  onDeleteChatConfirm,
  userIsSubscribed,
}) {
  return (
    <Modal visible={isVisible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Chat History</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeButton}>Close</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                !userIsSubscribed && styles.actionButtonDisabled,
              ]}
              onPress={userIsSubscribed ? onStartNewChat : null}
            >
              <Text style={styles.actionButtonText}>Start New Chat</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionButton,
                !userIsSubscribed && styles.actionButtonDisabled,
              ]}
              onPress={userIsSubscribed ? onClearChatHistoryConfirm : null}
            >
              <Text style={styles.actionButtonText}>Clear History</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            {userIsSubscribed ? (
              chatHistory.length > 0 ? (
                <ScrollView>
                  {chatHistory.map((chat) => (
                    <View key={chat.id} style={styles.chatItemRow}>
                      <TouchableOpacity
                        style={styles.chatItem}
                        onPress={() => {
                          onSelectChat(chat);
                          onClose();
                        }}
                      >
                        <Text style={styles.chatTitle}>{chat.title}</Text>
                        <Text style={styles.chatSubtitle}>{chat.messages.length} messages</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={() => onDeleteChatConfirm(chat.id)}
                      >
                        <MaterialIcons name="delete-outline" size={20} color="#ff6666" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <Text style={styles.emptyText}>No previous chats yet.</Text>
              )
            ) : (
              <Text style={styles.subscribeText}>Subscribe to unlock chat history and saving.</Text>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  panel: {
    backgroundColor: '#1f1f1f',
    width: '85%',
    height: '80%',
    borderRadius: 12,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    color: '#4CAF50',
    fontSize: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  actionButton: {
    backgroundColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 4,
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  chatItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  chatItem: {
    backgroundColor: '#2b2b2b',
    padding: 10,
    borderRadius: 8,
    flex: 1,
  },
  chatTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  chatSubtitle: {
    color: '#aaa',
    fontSize: 12,
    marginTop: 4,
  },
  deleteButton: {
    marginLeft: 8,
    padding: 6,
  },
  emptyText: {
    color: '#aaa',
    fontSize: 14,
    padding: 12,
  },
  subscribeText: {
    color: '#aaa',
    fontSize: 14,
    padding: 12,
    textAlign: 'center',
  },
});
