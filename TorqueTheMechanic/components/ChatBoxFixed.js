import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { Ionicons, MaterialIcons, Entypo } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

export default function ChatBoxFixed({ onSend, onAttachImage, onAttachDocument }) {
  const [inputText, setInputText] = useState('');

  const handleSend = () => {
    if (inputText.trim()) {
      onSend(inputText.trim());
      setInputText('');
    }
  };

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled) {
      onAttachImage && onAttachImage(result.assets[0].uri);
    }
  };

  const handleAttachDocument = () => {
    console.log('Attach button pressed (implement document picker here)');
    onAttachDocument && onAttachDocument({ name: 'sample_document.pdf' });
  };

  const handleMicrophone = () => {
    console.log('Microphone button pressed (implement voice-to-text here)');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={60}
      style={styles.chatBoxContainer}
    >
      {/* TEXT INPUT */}
      <View style={styles.textInputArea}>
        <TextInput
          placeholder="Message Torque..."
          placeholderTextColor="#aaa"
          multiline
          value={inputText}
          onChangeText={setInputText}
          style={styles.textInput}
          underlineColorAndroid="transparent"
        />
      </View>

      {/* ICONS ROW */}
      <View style={styles.iconsRow}>
        <TouchableOpacity onPress={handleMicrophone} style={styles.iconButton}>
          <Ionicons name="mic-outline" size={24} color="#aaa" />
        </TouchableOpacity>

        <TouchableOpacity onPress={handleAttachDocument} style={styles.iconButton}>
          <Entypo name="attachment" size={24} color="#aaa" />
        </TouchableOpacity>

        <TouchableOpacity onPress={handlePickImage} style={styles.iconButton}>
          <Ionicons name="image-outline" size={24} color="#aaa" />
        </TouchableOpacity>

        <TouchableOpacity onPress={handleSend} style={styles.sendButton}>
          <MaterialIcons name="send" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  chatBoxContainer: {
    width: '100%',
    height: Dimensions.get('window').height * 0.20,
    backgroundColor: '#121212',
    paddingHorizontal: 12,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    borderColor: '#333',
    borderTopWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
    paddingVertical: 8,
    marginBottom: 33,
  },
  textInputArea: {
    flex: 1,
    backgroundColor: '#1f1f1f',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  textInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    textAlignVertical: 'top', // this forces text to stay at top like GPT
  },
  iconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    padding: 6,
    marginRight: 4,
  },
  sendButton: {
    backgroundColor: '#4CAF50',
    padding: 10,
    borderRadius: 20,
    marginLeft: 8,
  },
});
