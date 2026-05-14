// components/ChatMessages.js
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
  TouchableOpacity,
  Linking,
  Image,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import Icon from 'react-native-vector-icons/FontAwesome';
import ZoomableSvg from './SvgWrapper';

function extractBlocks(text = '', tag) {
  const blocks = [];
  const regex = new RegExp('```' + tag + '\\s*([\\s\\S]*?)```', 'g');
  let m;
  while ((m = regex.exec(text)) !== null) {
    blocks.push({ raw: m[1].trim(), start: m.index, end: regex.lastIndex });
  }
  return blocks;
}

function splitIntoSegments(text = '') {
  const dj = extractBlocks(text, 'diagram-json');
  const sv = extractBlocks(text, 'svg');

  if (dj.length === 0 && sv.length === 0) return [{ type: 'md', content: text }];

  const all = [
    ...dj.map((b) => ({ ...b, type: 'diagram-json' })),
    ...sv.map((b) => ({ ...b, type: 'svg' })),
  ].sort((a, b) => a.start - b.start);

  const parts = [];
  let cursor = 0;
  for (const b of all) {
    const before = text.slice(cursor, b.start);
    if (before.trim()) parts.push({ type: 'md', content: before });

    if (b.type === 'diagram-json') {
      parts.push({ type: 'md', content: '```json\n' + b.raw + '\n```' });
    } else if (b.type === 'svg') {
      const safe = b.raw.length <= 20000 ? b.raw : b.raw.slice(0, 20000);
      parts.push({ type: 'svg', content: safe });
    }
    cursor = b.end;
  }
  const tail = text.slice(cursor);
  if (tail.trim()) parts.push({ type: 'md', content: tail });
  return parts;
}

function inferSvgHeight(xml, defaultHeight = 240) {
  try {
    const m = xml.match(/viewBox\s*=\s*["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
    if (!m) return defaultHeight;
    const w = parseFloat(m[3]);
    const h = parseFloat(m[4]);
    if (w > 0 && h > 0) {
      const ratio = h / w;
      return Math.max(160, Math.min(480, Math.round(360 * ratio)));
    }
  } catch {}
  return defaultHeight;
}

export default function ChatMessages({
  messages,
  loading,
  focusTick = 0,
  bottomInset = 84,
  threadKey = 'default', // ✅ NEW
}) {
  const scrollViewRef = useRef(null);
  const prevMessageCount = useRef(0);
  const atBottomRef = useRef(true);
  const lastFocusTickRef = useRef(0);
  const lastThreadKeyRef = useRef(threadKey);

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

  // ✅ On thread change (loading saved chat), always snap to bottom
  useEffect(() => {
    if (!scrollViewRef.current) return;
    if (lastThreadKeyRef.current !== threadKey) {
      lastThreadKeyRef.current = threadKey;
      atBottomRef.current = true;
      const t1 = setTimeout(() => scrollToEnd(false), 10);
      const t2 = setTimeout(() => scrollToEnd(true), Platform.OS === 'ios' ? 220 : 120);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [threadKey]);

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
    const subChange = changeEvt
      ? Keyboard.addListener(changeEvt, handleKeyboardAdjust)
      : { remove: () => {} };

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
            <AssistantReply key={index} text={msg.text} sources={msg.sources || []} searchMeta={msg.searchMeta || null} />
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

function AssistantReply({ text, sources = [], searchMeta = null }) {
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
          <Markdown key={`m-${i}`} style={markdownStyle}>
            {seg.content}
          </Markdown>
        )
      )}

      {Array.isArray(sources) && sources.length > 0 ? <SourceCarousel sources={sources} /> : null}
    </Animated.View>
  );
}

function domainFromUrl(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function getSourceImageUri(src = {}) {
  const candidates = [
    src.imageUrl,
    src.image_url,
    src.thumbnailUrl,
    src.thumbnail_url,
    src.thumbnail,
    src.image,
    src.faviconUrl,
    src.favicon_url,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && /^https:\/\//i.test(c)) return c;
    if (c && typeof c === 'object') {
      const u = c.url || c.src || c.imageUrl || c.thumbnailUrl;
      if (typeof u === 'string' && /^https:\/\//i.test(u)) return u;
    }
  }

  const domain = src.domain || domainFromUrl(src.url || '');
  if (domain) return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  return null;
}

function getDomainLabel(src = {}) {
  return src.domain || domainFromUrl(src.url || '') || 'source';
}

function SourceCarousel({ sources = [] }) {
  const visibleSources = sources.filter((s) => s?.url).slice(0, 10);
  if (!visibleSources.length) return null;

  const openUrl = async (url) => {
    try {
      const ok = await Linking.canOpenURL(url);
      if (ok) await Linking.openURL(url);
    } catch {}
  };

  return (
    <View style={styles.sourcesWrap}>
      <View style={styles.sourcesHeaderRow}>
        <View>
          <Text style={styles.sourcesTitle}>Sources Torque found</Text>
          <Text style={styles.sourcesSub}>Swipe sideways • tap a card to open</Text>
        </View>
        <Text style={styles.sourcesHint}>{visibleSources.length}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sourcesScroll}>
        {visibleSources.map((src, idx) => {
          const img = getSourceImageUri(src);
          const domain = getDomainLabel(src);
          return (
            <TouchableOpacity
              key={`${src.url}-${idx}`}
              style={styles.sourceCard}
              activeOpacity={0.88}
              onPress={() => openUrl(src.url)}
            >
              <View style={styles.sourceImageShell}>
                {img ? (
                  <Image source={{ uri: img }} style={styles.sourceImage} resizeMode="cover" />
                ) : (
                  <View style={styles.sourceImageFallback}>
                    <Text style={styles.sourceImageFallbackText}>{String(domain).slice(0, 1).toUpperCase()}</Text>
                  </View>
                )}
                <View style={styles.sourceImageOverlay} />
                <View style={styles.sourceTypePill}>
                  <Text style={styles.sourceTypePillText}>{src.type || 'Source'}</Text>
                </View>
              </View>

              <View style={styles.sourceTopRow}>
                <Text style={styles.sourceBadge}>{src.id || `S${idx + 1}`}</Text>
                <Text style={styles.sourceDomain} numberOfLines={1}>{domain}</Text>
              </View>

              <Text style={styles.sourceTitle} numberOfLines={2}>{src.title || domain || 'Source'}</Text>
              {!!src.snippet && <Text style={styles.sourceSnippet} numberOfLines={3}>{src.snippet}</Text>}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
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
  messagesContainer: { paddingHorizontal: 0, paddingTop: 8 },

  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#3a76f0',
    borderRadius: 16,
    padding: 12,
    marginRight: 14,
    marginLeft: 54,
    marginBottom: 12,
    maxWidth: '88%',
  },
  userText: { color: '#fff', fontSize: 16, lineHeight: 22 },

  assistantContainer: {
    alignSelf: 'stretch',
    width: '100%',
    backgroundColor: 'transparent',
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginBottom: 12,
    borderRadius: 0,
    borderWidth: 0,
  },

  loadingContainer: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 8 },
  loadingText: { color: '#aaa', fontStyle: 'italic', marginLeft: 8 },
  sourcesWrap: {
    marginTop: 12,
    marginBottom: 4,
  },
  sourcesHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 8,
    marginBottom: 8,
  },
  sourcesTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  sourcesSub: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  sourcesHint: {
    overflow: 'hidden',
    color: '#06120a',
    backgroundColor: '#22c55e',
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  sourcesScroll: {
    paddingRight: 18,
    gap: 12,
  },
  sourceCard: {
    width: 272,
    minHeight: 238,
    backgroundColor: '#202020',
    borderRadius: 20,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  sourceImageShell: {
    width: '100%',
    height: 96,
    borderRadius: 15,
    backgroundColor: '#111',
    marginBottom: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  sourceImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#111',
  },
  sourceImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.16)',
  },
  sourceTypePill: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  sourceTypePillText: {
    color: '#e5e7eb',
    fontSize: 10.5,
    fontWeight: '900',
  },
  sourceImageFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 15,
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceImageFallbackText: {
    color: '#86efac',
    fontSize: 28,
    fontWeight: '900',
  },
  sourceTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sourceBadge: {
    overflow: 'hidden',
    backgroundColor: '#22c55e',
    color: '#06120a',
    fontWeight: '900',
    fontSize: 11,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    marginRight: 8,
  },
  sourceTitle: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  sourceDomain: {
    color: '#60a5fa',
    fontSize: 11.5,
    fontWeight: '800',
    flex: 1,
  },
  sourceSnippet: {
    color: '#aeb7c4',
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 7,
  },

});

const markdownStyle = {
  body: { color: '#fff', fontSize: 16, lineHeight: 24 },
  heading1: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  heading2: { fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
  list_item: { marginBottom: 6 },
  code_block: {
    backgroundColor: '#333',
    padding: 8,
    borderRadius: 10,
    fontFamily: 'Courier',
  },
};