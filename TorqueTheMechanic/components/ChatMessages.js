import React, { useRef, useEffect } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  TouchableWithoutFeedback,
  Keyboard, // Import Keyboard
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import Icon from 'react-native-vector-icons/FontAwesome';

export default function ChatMessages({ messages, loading, onExitChat }) {
  const scrollViewRef = useRef();
  const prevMessageCount = useRef(0);

  useEffect(() => {
    if (scrollViewRef.current && messages.length > prevMessageCount.current) {
      scrollViewRef.current.scrollToEnd({ animated: true });
      prevMessageCount.current = messages.length;
    }
  }, [messages]);

  // Function to handle keyboard dismissal
  const dismissKeyboard = () => {
    Keyboard.dismiss();
  };

  // Handle Exit Chat action
  const handleExitChat = () => {
    dismissKeyboard(); // Dismiss keyboard when exiting chat
    if (onExitChat) onExitChat(); // Call the passed onExitChat handler
  };

  return (
    <TouchableWithoutFeedback onPress={dismissKeyboard}>
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.messagesContainer}
        removeClippedSubviews={true}
        keyboardShouldPersistTaps="handled" // Ensure taps handle keyboard dismissal
      >
        {messages.map((msg, index) =>
          msg.sender === 'user' ? (
            <View key={index} style={styles.userBubble}>
              <Text style={styles.userText}>{msg.text}</Text>
            </View>
          ) : (
            <AnimatedReply key={index} text={msg.text} />
          )
        )}

        {loading && (
          <View style={styles.loadingContainer}>
            <AnimatedGear />
            <Text style={styles.loadingText}>Torque’s thinking...</Text>
          </View>
        )}
      </ScrollView>
    </TouchableWithoutFeedback>
  );
}

function AnimatedReply({ text }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View style={[styles.assistantContainer, { opacity: fadeAnim }]}>
      <Markdown style={markdownStyle}>{text}</Markdown>
    </Animated.View>
  );
}

function AnimatedGear() {
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <Icon name="gear" size={24} color="#ccc" />
    </Animated.View>
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
    marginLeft: 8,
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