import React, { useRef, useEffect } from 'react';
import { ScrollView, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import Markdown from 'react-native-markdown-display';
import Icon from 'react-native-vector-icons/FontAwesome';

export default function ChatMessages({ messages, loading }) {
  const scrollViewRef = useRef();
  const prevMessageCount = useRef(0);

  useEffect(() => {
    if (scrollViewRef.current && messages.length > prevMessageCount.current) {
      scrollViewRef.current.scrollToEnd({ animated: true });
      prevMessageCount.current = messages.length;
    }
  }, [messages]);

  return (
    <ScrollView
      ref={scrollViewRef}
      contentContainerStyle={styles.messagesContainer}
      removeClippedSubviews={true}
    >
      {messages.map((msg, index) => (
        <View key={index} style={msg.sender === 'user' ? styles.userBubble : styles.assistantContainer}>
          {msg.sender === 'user' ? (
            <Text style={styles.userText}>{msg.text}</Text>
          ) : (
            <Markdown style={markdownStyle}>{msg.text}</Markdown>
          )}
        </View>
      ))}

      {loading && (
        <View style={styles.loadingContainer}>
          <Icon name="gear" size={24} color="#ccc" style={{ transform: [{ rotate: '45deg' }] }} />
          <Text style={styles.loadingText}>Torque’s thinking...</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  messagesContainer: {
    padding: 12,
    paddingBottom: 30,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#4CAF50',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    maxWidth: '90%',
  },
  userText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
  },
  assistantContainer: {
    alignSelf: 'stretch',
    backgroundColor: '#1c1c1c',
    padding: 14,
    marginBottom: 12,
    borderRadius: 12,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 8,
  },
  loadingText: {
    color: '#aaa',
    fontStyle: 'italic',
  },
});

const markdownStyle = {
  body: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 24,
  },
  heading1: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  heading2: { fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
  list_item: { marginBottom: 6 },
  code_block: {
    backgroundColor: '#333',
    padding: 8,
    borderRadius: 6,
    fontFamily: 'Courier',
  },
};
