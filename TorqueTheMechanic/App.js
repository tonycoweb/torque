import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Text,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import GarageFrontEnd from './components/GarageFrontEnd';
import HomeHeader from './components/HomeHeader';
import ServiceBox from './components/ServiceBox';
import RobotAssistant from './components/RobotAssistant';
import ChatMessages from './components/ChatMessages';
import ChatBoxFixed from './components/ChatBoxFixed';
import SavedChatsPanel from './components/SavedChatsPanel';

export default function App() {
  const [vehicle, setVehicle] = useState(null);
  const [garageName, setGarageName] = useState('');
  const [messages, setMessages] = useState([]);
  const [isChatting, setIsChatting] = useState(false);
  const [showSavedChats, setShowSavedChats] = useState(false);

  const robotTranslateY = useRef(new Animated.Value(0)).current;
  const robotScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(robotTranslateY, {
      toValue: isChatting ? -80 : 0,
      duration: 500,
      useNativeDriver: true,
    }).start();

    Animated.timing(robotScale, {
      toValue: isChatting ? 0.6 : 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [isChatting]);

  const handleSend = (text) => {
    if (!isChatting) setIsChatting(true);

    setMessages((prev) => [...prev, { sender: 'user', text }]);

    setTimeout(() => {
      setMessages((prev) => [...prev, { sender: 'api', text: `Response to: ${text}` }]);
    }, 1000);
  };

  const handleAttachImage = (uri) => {
    setMessages((prev) => [
      ...prev,
      { sender: 'user', text: `📷 Image attached: ${uri}` },
    ]);

    if (!isChatting) setIsChatting(true);
  };

  const handleAttachDocument = (file) => {
    setMessages((prev) => [
      ...prev,
      { sender: 'user', text: `📄 Document attached: ${file.name}` },
    ]);

    if (!isChatting) setIsChatting(true);
  };

  const handleAddVehicle = () => {
    setVehicle({
      year: 2004,
      make: 'Infiniti',
      model: 'G35',
      engine: 'V6 3.5L',
      mpg: '19 city / 26 hwy',
      hp: '280',
      gvw: '4,000 lbs',
    });
  };

  const handleExitChat = () => {
    setIsChatting(false);
    setMessages([]);
    setShowSavedChats(false);
  };

  const handleChatFocus = () => {
    if (!isChatting) setIsChatting(true);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <HomeHeader garageName={garageName} setGarageName={setGarageName} />

      {!isChatting && (
        <>
          <GarageFrontEnd vehicle={vehicle} onAddPress={handleAddVehicle} />
          <ServiceBox />
        </>
      )}

      {!isChatting && (
        <Animated.View
          style={[
            styles.robotWrapper,
            {
              marginTop: isChatting ? 60 : 20,
              transform: [
                { translateY: robotTranslateY },
                { scale: robotScale },
              ],
            },
          ]}
        >
          <RobotAssistant isChatting={isChatting} />
        </Animated.View>
      )}

      {isChatting && (
        <TouchableOpacity
          style={styles.exitButton}
          onPress={handleExitChat}
        >
          <Text style={styles.exitButtonText}>Exit Chat</Text>
        </TouchableOpacity>
      )}

      <View style={styles.chatMessagesArea}>
        <ChatMessages messages={messages} />
      </View>

      {isChatting && showSavedChats && (
        <SavedChatsPanel onClose={() => setShowSavedChats(false)} />
      )}

      {isChatting && (
        <TouchableOpacity
          style={styles.savedChatsButton}
          onPress={() => setShowSavedChats((prev) => !prev)}
        >
          <Text style={styles.savedChatsIcon}>📝</Text>
        </TouchableOpacity>
      )}

      <ChatBoxFixed
        onSend={handleSend}
        onAttachImage={handleAttachImage}
        onAttachDocument={handleAttachDocument}
        onFocus={handleChatFocus}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  chatMessagesArea: {
    flex: 1,
    marginBottom: 10,
  },
  robotWrapper: {
    alignItems: 'center',
    marginBottom: 10,
  },
  exitButton: {
    marginBottom: 8,
    backgroundColor: '#444',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'center',
  },
  exitButtonText: {
    color: '#fff',
    fontSize: 14,
  },
  savedChatsButton: {
    position: 'absolute',
    right: 24,
    bottom: Platform.OS === 'ios' ? 140 : 120, // above ChatBoxFixed
    backgroundColor: '#333',
    padding: 12,
    borderRadius: 30,
    zIndex: 99,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  savedChatsIcon: {
    fontSize: 20,
    color: '#fff',
  },
});
