import React, { useRef, useEffect } from 'react';
import { ScrollView, View, Text, Image, StyleSheet, ActivityIndicator } from 'react-native';

export default function ChatMessages({ messages, isTyping }) {
  const scrollViewRef = useRef();

  useEffect(() => {
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollToEnd({ animated: true });
    }
  }, [messages, isTyping]);

  return (
    <ScrollView
      ref={scrollViewRef}
      contentContainerStyle={styles.messagesContainer}
    >
      {messages.map((msg, index) => (
        <View
          key={index}
          style={[
            styles.messageBlock,
            msg.sender === 'user' ? styles.userBlock : styles.apiBlock,
          ]}
        >
          {msg.type === 'image' ? (
            <Image
              source={{ uri: msg.uri }}
              style={styles.messageImage}
              resizeMode="contain"
            />
          ) : (
            <Text style={styles.messageText}>{msg.text}</Text>
          )}
        </View>
      ))}

      {/* Optional typing indicator */}
      {isTyping && (
        <View style={styles.typingBlock}>
          <ActivityIndicator size="small" color="#aaa" />
          <Text style={styles.typingText}>Torque is typing...</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  messagesContainer: {
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  messageBlock: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginVertical: 6,
    maxWidth: '100%',
  },
  userBlock: {
    alignSelf: 'flex-end',
    backgroundColor: 'transparent', // GPT style: user text is plain text
  },
  apiBlock: {
    alignSelf: 'flex-start',
    backgroundColor: '#1e1e1e', // subtle GPT AI block
  },
  messageText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
  },
  messageImage: {
    width: 250,
    height: 250,
    borderRadius: 8,
    backgroundColor: '#000', // subtle background behind image
  },
  typingBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginLeft: 4,
  },
  typingText: {
    color: '#aaa',
    marginLeft: 8,
    fontSize: 14,
  },
});
