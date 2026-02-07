// components/ChatBoxFixed.js
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Keyboard,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';

export default function ChatBoxFixed({
  onSend,
  onFocus,
  onMicPress,
  onCameraPress,
  onClearAudio,
  onClearImage,
  attachedAudio, // { uri, durationMs } | null
  attachedImage, // { uri } | null
  isSending = false,
}) {
  const [inputText, setInputText] = useState('');
  const inputRef = useRef(null);

 

  const hasImage = !!attachedImage?.uri;
  const hasAudio = !!attachedAudio?.uri;

  const handleSendPress = () => {
    if (isSending) return;
    const txt = (inputText || '').trim();

    // allow send even if only attachment (parent handles)
    onSend?.(txt);
    setInputText('');
  };

  return (
    <View style={styles.wrap}>
      {/* Attachment chips */}
      {(hasImage || hasAudio) && (
        <View style={styles.chipsRow}>
          {hasImage && (
            <View style={styles.chip}>
              <Ionicons name="image-outline" size={16} color="#d8d8d8" />
              <Text style={styles.chipText}>Photo</Text>
              <TouchableOpacity
                onPress={onClearImage}
                disabled={isSending}
                style={styles.chipX}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={16} color={isSending ? '#666' : '#d8d8d8'} />
              </TouchableOpacity>
            </View>
          )}

          {hasAudio && (
            <View style={styles.chip}>
              <Ionicons name="mic-outline" size={16} color="#d8d8d8" />
              <Text style={styles.chipText}>Audio</Text>
              <TouchableOpacity
                onPress={onClearAudio}
                disabled={isSending}
                style={styles.chipX}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={16} color={isSending ? '#666' : '#d8d8d8'} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* Input row */}
      <View style={styles.row}>
        <TouchableOpacity
          onPress={onCameraPress}
          disabled={isSending}
          style={[styles.iconBtn, isSending && styles.disabledBtn]}
        >
          <Ionicons name="camera-outline" size={20} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onMicPress}
          disabled={isSending}
          style={[styles.iconBtn, isSending && styles.disabledBtn]}
        >
          <Ionicons name="mic-outline" size={20} color="#fff" />
        </TouchableOpacity>

        <View style={styles.inputWrap}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Message Torque…"
            placeholderTextColor="#8a8a8a"
            value={inputText}
            onChangeText={setInputText}
            onFocus={onFocus}
            editable={!isSending}
            multiline
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={() => {
              if (Platform.OS !== 'ios') handleSendPress();
            }}
          />
        </View>

        <TouchableOpacity
          onPress={handleSendPress}
          disabled={isSending}
          style={[styles.sendBtn, isSending && styles.disabledBtn]}
        >
          <MaterialIcons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: Platform.OS === 'ios' ? 12 : 10,
    paddingTop: 8,
  },

  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 6,
    paddingBottom: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1f1f1f',
    borderWidth: 1,
    borderColor: '#2e2e2e',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  chipText: {
    color: '#eaeaea',
    fontSize: 13,
    fontWeight: '700',
  },
  chipX: {
    marginLeft: 2,
    paddingLeft: 4,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingBottom: 24,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  inputWrap: {
    flex: 1,
    minHeight: 42,
    maxHeight: 140,
    borderRadius: 18,
    backgroundColor: '#1c1c1c',
    borderWidth: 1,
    borderColor: '#2e2e2e',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 20,
    padding: 0,
    margin: 0,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2f6fed',
    borderWidth: 1,
    borderColor: '#2f6fed',
  },
  disabledBtn: {
    opacity: 0.45,
  },
});
