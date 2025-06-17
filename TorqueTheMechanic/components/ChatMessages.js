import React, { useRef, useEffect } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';

export default function ChatMessages({ messages }) {
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
        <View
          key={index}
          style={[
            styles.messageBubble,
            msg.sender === 'user' ? styles.userBubble : styles.responseBubble,
          ]}
        >
          <Text style={styles.messageText}>{msg.text}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  messagesContainer: {
    padding: 12,
    paddingBottom: 20,
  },
  messageBubble: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    maxWidth: '90%',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#4CAF50',
  },
  responseBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#1f1f1f',
    borderColor: '#333',
    borderWidth: 1,
  },
  messageText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
  },
});
