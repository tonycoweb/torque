// ChatMessages.js
import React, { useRef, useEffect } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Platform,
  SafeAreaView,
  Keyboard,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import Icon from 'react-native-vector-icons/FontAwesome';

export default function ChatMessages({
  messages,
  loading,
  onExitChat,
  focusTick = 0,
  bottomInset = 84, // measured composer height from ChatBoxFixed via onMeasuredHeight
}) {
  const scrollViewRef = useRef(null);
  const prevMessageCount = useRef(0);
  const atBottomRef = useRef(true);
  const lastFocusTickRef = useRef(0);

  const scrollToEnd = (animated = true) => {
    requestAnimationFrame(() => scrollViewRef.current?.scrollToEnd({ animated }));
  };

  // Keep "near-bottom" detection so we don't yank history while reading
  const handleScroll = (e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const paddingToBottom = 40;
    atBottomRef.current =
      contentOffset.y + layoutMeasurement.height + paddingToBottom >= contentSize.height;
  };

  // New messages → autoscroll only if user is near bottom
  useEffect(() => {
    if (!scrollViewRef.current) return;
    if (messages.length >= prevMessageCount.current && atBottomRef.current) {
      scrollToEnd(true);
    }
    prevMessageCount.current = messages.length;
  }, [messages]);

  // Input focus → immediate scroll and a delayed scroll to catch KAV/keyboard animation
  useEffect(() => {
    if (!scrollViewRef.current) return;
    lastFocusTickRef.current = focusTick;
    // 1) Immediate nudge (in case content already fits)
    scrollToEnd(true);
    // 2) After keyboard animation finishes (iOS has a willShow duration, Android settles fast)
    const delay = Platform.OS === 'ios' ? 250 : 80;
    const t = setTimeout(() => scrollToEnd(true), delay);
    return () => clearTimeout(t);
  }, [focusTick]);

  // Keyboard events → do not change padding, just ensure we re-scroll after the lift/resize
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const changeEvt = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : null;

    const handleKeyboardAdjust = (e) => {
      // Immediate + after the reported duration (fallbacks included)
      scrollToEnd(false);
      const dur =
        (Platform.OS === 'ios' && typeof e?.duration === 'number' ? e.duration : null) ??
        (Platform.OS === 'ios' ? 250 : 80);
      const t = setTimeout(() => scrollToEnd(true), dur);
      pendingTimers.current.push(t);
    };

    const pendingTimers = { current: [] };
    const subShow = Keyboard.addListener(showEvt, handleKeyboardAdjust);
    const subChange = changeEvt ? Keyboard.addListener(changeEvt, handleKeyboardAdjust) : { remove: () => {} };

    return () => {
      subShow.remove();
      subChange.remove();
      pendingTimers.current.forEach(clearTimeout);
    };
  }, []);

  // Only pad by the composer height (plus a tiny breathing room). No keyboard height here.
  const effectiveBottom = Math.max(0, bottomInset) + 6;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroller}
        contentContainerStyle={[styles.messagesContainer, { paddingBottom: effectiveBottom }]}
        // Let padding do the work; avoid doubling with contentInset on iOS
        scrollIndicatorInsets={{ bottom: effectiveBottom }}
        removeClippedSubviews={Platform.OS === 'android'}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          // If user is at bottom OR this was triggered by a recent focus, keep end in view
          if (atBottomRef.current || lastFocusTickRef.current === focusTick) {
            scrollToEnd(true);
          }
        }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
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
    Animated.loop(
      Animated.timing(spinValue, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: true })
    ).start();
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
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#4CAF50',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    maxWidth: '90%',
  },
  userText: { color: '#fff', fontSize: 16, lineHeight: 22 },
  assistantContainer: {
    alignSelf: 'stretch',
    backgroundColor: '#1c1c1c',
    padding: 14,
    marginBottom: 12,
    borderRadius: 12,
  },
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
