// ChatBoxFixed.js
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { Ionicons, MaterialIcons, Entypo } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

export default function ChatBoxFixed({
  onSend,
  onAttachImage,
  onAttachDocument,
  onFocus,
  onOpenSavedNotes,
  onMeasuredHeight,
}) {
  const [inputText, setInputText] = useState('');
  const [selfHeight, setSelfHeight] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (selfHeight && onMeasuredHeight) onMeasuredHeight(selfHeight);
  }, [selfHeight, onMeasuredHeight]);

  const handleLayout = (e) => {
    const h = e.nativeEvent.layout.height;
    if (Math.abs(h - selfHeight) > 1) setSelfHeight(h);
  };

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    onSend && onSend(text);
    setInputText('');
    inputRef.current?.blur();
    Keyboard.dismiss();
  };

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled) onAttachImage && onAttachImage(result.assets?.[0]?.uri);
  };

  const handleAttachDocument = () =>
    onAttachDocument && onAttachDocument({ name: 'sample_document.pdf' });

  const handleMicrophone = () => {
    // hook up voice-to-text here
  };

  return (
    <KeyboardAvoidingView
      onLayout={handleLayout}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // Set this to your fixed header height if you have one; 0 is safest otherwise.
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      style={styles.container}
    >
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={handleMicrophone} style={styles.toolBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name="mic-outline" size={21} color="#aaa" />
        </TouchableOpacity>

        <TouchableOpacity onPress={handleAttachDocument} style={styles.toolBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Entypo name="attachment" size={21} color="#aaa" />
        </TouchableOpacity>

        <TouchableOpacity onPress={handlePickImage} style={styles.toolBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name="image-outline" size={21} color="#aaa" />
        </TouchableOpacity>

        <View style={{ flex: 1 }} />
      </View>

      <View style={styles.inputWrap}>
        <TextInput
          ref={inputRef}
          placeholder="Message Torque…"
          placeholderTextColor="#aaa"
          multiline
          value={inputText}
          onChangeText={setInputText}
          style={styles.textInput}
          underlineColorAndroid="transparent"
          onFocus={onFocus}
          blurOnSubmit={false}
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity style={styles.sendFab} onPress={handleSend} activeOpacity={0.9}>
          <MaterialIcons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#121212',
    paddingHorizontal: 10,
    paddingTop: 16,
    paddingBottom: 16, // no platform branch needed
    borderTopWidth: 1,
    borderTopColor: '#2b2b2b',
    // Avoid extra spacing that would double up with list padding
    marginBottom: 0,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 6,
  },
  toolBtn: {
    padding: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
  },
  notesBtn: { backgroundColor: 'rgba(76,175,80,0.15)' },
  inputWrap: {
    position: 'relative',
    minHeight: 46,
    maxHeight: 150,
    backgroundColor: '#1f1f1f',
    borderRadius: 18,
    paddingRight: 44,
    paddingLeft: 12,
    paddingTop: 8,
    paddingBottom: 8,
    marginBottom: 33,
  },
  textInput: { color: '#fff', fontSize: 16, textAlignVertical: 'top', marginBottom: 33 },
  sendFab: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
});
