import React, { useRef, useEffect } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Keyboard,
  Platform,
  SafeAreaView,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import Icon from 'react-native-vector-icons/FontAwesome';

export default function ChatMessages({ messages, loading, onExitChat, focusTick = 0, bottomInset = 84 }) {
  const scrollViewRef = useRef(null);
  const prevMessageCount = useRef(0);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (!scrollViewRef.current) return;
    if (messages.length >= prevMessageCount.current) {
      requestAnimationFrame(() => scrollViewRef.current.scrollToEnd({ animated: true }));
      prevMessageCount.current = messages.length;
    }
  }, [messages]);

  // Auto-scroll when input focuses / keyboard appears
  useEffect(() => {
    if (!scrollViewRef.current) return;
    requestAnimationFrame(() => scrollViewRef.current.scrollToEnd({ animated: true }));
  }, [focusTick]);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroller}
        contentContainerStyle={[styles.messagesContainer, { paddingBottom: bottomInset }]}
        removeClippedSubviews={Platform.OS === 'android'}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          // always keep newest visible after layout changes
          requestAnimationFrame(() => scrollViewRef.current?.scrollToEnd({ animated: true }));
        }}
        scrollEnabled
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
    </SafeAreaView>
  );
}

function AnimatedReply({ text }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
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
    Animated.loop(Animated.timing(spinValue, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: true })).start();
  }, []);
  const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <Icon name="gear" size={24} color="#ccc" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#121212' },
  scroller: { flex: 1 },
  messagesContainer: { paddingHorizontal: 12, paddingTop: 8 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#4CAF50', borderRadius: 16, padding: 12, marginBottom: 12, maxWidth: '90%' },
  userText: { color: '#fff', fontSize: 16, lineHeight: 22 },
  assistantContainer: { alignSelf: 'stretch', backgroundColor: '#1c1c1c', padding: 14, marginBottom: 12, borderRadius: 12 },
  loadingContainer: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 8 },
  loadingText: { color: '#aaa', fontStyle: 'italic', marginLeft: 8 },
});

const markdownStyle = {
  body: { color: '#fff', fontSize: 16, lineHeight: 24 },
  heading1: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  heading2: { fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
  list_item: { marginBottom: 6 },
  code_block: { backgroundColor: '#333', padding: 8, borderRadius: 6, fontFamily: 'Courier' },
};
