// ChatMessages.js
import React, { useRef, useEffect, useMemo } from 'react';
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
import ZoomableSvg from './SvgWrapper';

// ---- helpers to parse reply content ----
function extractBlocks(text = '', tag) {
  // Finds ```<tag>\n...\n```
  const blocks = [];
  const regex = new RegExp('```' + tag + '\\s*([\\s\\S]*?)```', 'g');
  let m;
  while ((m = regex.exec(text)) !== null) {
    blocks.push({ raw: m[1].trim(), start: m.index, end: regex.lastIndex });
  }
  return blocks;
}

function splitIntoSegments(text = '') {
  // Support: diagram-json (debug as code), svg (render)
  const dj = extractBlocks(text, 'diagram-json');
  const sv = extractBlocks(text, 'svg');

  if (dj.length === 0 && sv.length === 0) return [{ type: 'md', content: text }];

  const all = [
    ...dj.map(b => ({ ...b, type: 'diagram-json' })),
    ...sv.map(b => ({ ...b, type: 'svg' })),
  ].sort((a, b) => a.start - b.start);

  const parts = [];
  let cursor = 0;
  for (const b of all) {
    const before = text.slice(cursor, b.start);
    if (before.trim()) parts.push({ type: 'md', content: before });

    if (b.type === 'diagram-json') {
      // Show the JSON as fenced code for now (keeps things generic)
      parts.push({ type: 'md', content: '```json\n' + b.raw + '\n```' });
    } else if (b.type === 'svg') {
      // small safety limit (front-end guard; your backend already sanitizes)
      const safe = b.raw.length <= 20000 ? b.raw : b.raw.slice(0, 20000);
      parts.push({ type: 'svg', content: safe });
    }
    cursor = b.end;
  }
  const tail = text.slice(cursor);
  if (tail.trim()) parts.push({ type: 'md', content: tail });
  return parts;
}

// Infer a good render height from the SVG viewBox to preserve aspect ratio
function inferSvgHeight(xml, defaultHeight = 240) {
  try {
    const m = xml.match(/viewBox\s*=\s*["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
    if (!m) return defaultHeight;
    const w = parseFloat(m[3]), h = parseFloat(m[4]);
    if (w > 0 && h > 0) {
      // Aim for ~100% width; pick height that keeps ratio but clamp
      const ratio = h / w;
      const est = Math.max(160, Math.min(480, Math.round(360 * ratio))); // clamp between 160–480
      return est;
    }
  } catch {}
  return defaultHeight;
}

export default function ChatMessages({
  messages,
  loading,
  onExitChat,
  focusTick = 0,
  bottomInset = 84,
}) {
  const scrollViewRef = useRef(null);
  const prevMessageCount = useRef(0);
  const atBottomRef = useRef(true);
  const lastFocusTickRef = useRef(0);

  const scrollToEnd = (animated = true) => {
    requestAnimationFrame(() => scrollViewRef.current?.scrollToEnd({ animated }));
  };

  const handleScroll = (e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const paddingToBottom = 40;
    atBottomRef.current =
      contentOffset.y + layoutMeasurement.height + paddingToBottom >= contentSize.height;
  };

  useEffect(() => {
    if (!scrollViewRef.current) return;
    if (messages.length >= prevMessageCount.current && atBottomRef.current) {
      scrollToEnd(true);
    }
    prevMessageCount.current = messages.length;
  }, [messages]);

  useEffect(() => {
    if (!scrollViewRef.current) return;
    lastFocusTickRef.current = focusTick;
    scrollToEnd(true);
    const delay = Platform.OS === 'ios' ? 250 : 80;
    const t = setTimeout(() => scrollToEnd(true), delay);
    return () => clearTimeout(t);
  }, [focusTick]);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const changeEvt = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : null;
    const pendingTimers = { current: [] };

    const handleKeyboardAdjust = (e) => {
      scrollToEnd(false);
      const dur =
        (Platform.OS === 'ios' && typeof e?.duration === 'number' ? e.duration : null) ??
        (Platform.OS === 'ios' ? 250 : 80);
      const t = setTimeout(() => scrollToEnd(true), dur);
      pendingTimers.current.push(t);
    };

    const subShow = Keyboard.addListener(showEvt, handleKeyboardAdjust);
    const subChange = changeEvt ? Keyboard.addListener(changeEvt, handleKeyboardAdjust) : { remove: () => {} };

    return () => {
      subShow.remove();
      subChange.remove();
      pendingTimers.current.forEach(clearTimeout);
    };
  }, []);

  const effectiveBottom = Math.max(0, bottomInset) + 6;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroller}
        contentContainerStyle={[styles.messagesContainer, { paddingBottom: effectiveBottom }]}
        scrollIndicatorInsets={{ bottom: effectiveBottom }}
        removeClippedSubviews={Platform.OS === 'android'}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
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
            <AssistantReply key={index} text={msg.text} />
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

function AssistantReply({ text }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, []);

  const segments = useMemo(() => splitIntoSegments(text), [text]);

  return (
    <Animated.View style={[styles.assistantContainer, { opacity: fadeAnim }]}>
      {segments.map((seg, i) =>
        seg.type === 'svg' ? (
          <View key={`s-${i}`} style={{ marginVertical: 8 }}>
            <ZoomableSvg xml={seg.content} height={inferSvgHeight(seg.content, 240)} />
          </View>
        ) : (
          <Markdown key={`m-${i}`} style={markdownStyle}>{seg.content}</Markdown>
        )
      )}
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
