// components/ChatBoxFixed.js
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

export default function ChatBoxFixed({
  onSend,
  onFocus,

  // NEW
  onMicPress,
  onCameraPress,
  onClearAudio,
  onClearImage,
  attachedAudio, // { uri, durationMs } | null
  attachedImage, // { uri } | null
}) {
  const [inputText, setInputText] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {}, []);

  const canSend = inputText.trim().length > 0 || !!attachedAudio || !!attachedImage;

  return (
    <View style={styles.wrapper}>
      {/* --- Attachment preview area --- */}
      {(attachedAudio || attachedImage) ? (
        <View style={styles.attachRow}>
          {attachedAudio ? (
            <View style={styles.pill}>
              <MaterialCommunityIcons name="waveform" size={16} color="#fff" />
              <Text style={styles.pillText}>
                Audio attached{attachedAudio?.durationMs ? ` • ${Math.round(attachedAudio.durationMs / 1000)}s` : ''}
              </Text>
              <TouchableOpacity onPress={onClearAudio} style={styles.pillX}>
                <Ionicons name="close" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : null}

          {attachedImage ? (
            <View style={[styles.pill, { backgroundColor: '#2a2a2a' }]}>
              <Ionicons name="camera" size={16} color="#fff" />
              <Text style={styles.pillText}>Photo attached</Text>
              <TouchableOpacity onPress={onClearImage} style={styles.pillX}>
                <Ionicons name="close" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* --- Input row --- */}
      <View style={styles.row}>
        <TouchableOpacity style={styles.iconBtn} onPress={onCameraPress}>
          <Ionicons name="camera" size={20} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.iconBtn} onPress={onMicPress}>
          <Ionicons name="mic" size={20} color="#fff" />
        </TouchableOpacity>

        <View style={styles.inputWrap}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder=""
            placeholderTextColor="#888"
            value={inputText}
            onChangeText={setInputText}
            onFocus={onFocus}
            multiline
          />
        </View>

        <TouchableOpacity
          style={[styles.sendBtn, !canSend && styles.sendDisabled]}
          disabled={!canSend}
          onPress={() => {
            onSend?.(inputText);
            setInputText('');
          }}
        >
          <Ionicons name="send" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingBottom: Platform.OS === 'ios' ? 18 : 12,
  },

  attachRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#333',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  pillX: {
    marginLeft: 6,
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#2d2d2d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrap: {
    flex: 1,
    backgroundColor: '#1f1f1f',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  input: {
    color: '#fff',
    fontSize: 14,
    maxHeight: 110,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    opacity: 0.45,
  },
});
