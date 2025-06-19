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
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GarageFrontEnd from './components/GarageFrontEnd';
import HomeHeader from './components/HomeHeader';
import ServiceBox from './components/ServiceBox';
import RobotAssistant from './components/RobotAssistant';
import ChatMessages from './components/ChatMessages';
import ChatBoxFixed from './components/ChatBoxFixed';
import SavedChatsPanel from './components/SavedChatsPanel';
import { sendToGPT } from './components/GptService';
import LoginScreen from './components/LoginScreen';
import { LogBox, LayoutAnimation, UIManager } from 'react-native';

// Enable LayoutAnimation on Android (required)
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
LayoutAnimation.configureNext = () => {};
LogBox.ignoreLogs(['Excessive number of pending callbacks']);

export default function App() {
  const [vehicle, setVehicle] = useState(null);
  const [garageName, setGarageName] = useState('');
  const [messages, setMessages] = useState([]);
  const [isChatting, setIsChatting] = useState(false);
  const [showSavedChats, setShowSavedChats] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(null);

  const robotTranslateY = useRef(new Animated.Value(0)).current;
  const robotScale = useRef(new Animated.Value(1)).current;

  // 🔐 Check if user is logged in
  useEffect(() => {
    const checkLogin = async () => {
      const user = await AsyncStorage.getItem('user');
      setIsLoggedIn(!!user);
    };
    checkLogin();
  }, []);

  const handleLogin = () => setIsLoggedIn(true);

  // 🎯 Only show LoginScreen if not logged in
  if (isLoggedIn === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!isLoggedIn) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // 🎬 Animations
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

  const handleSend = async (text) => {
    if (!text.trim()) return;
    setMessages((prev) => [...prev, { sender: 'user', text }]);
    const reply = await sendToGPT(text, 'free');
    setMessages((prev) => [...prev, { sender: 'api', text: reply }]);
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
    paddingVertical: 50,
    paddingHorizontal: 20,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatMessagesArea: {
    flex: 1,
    marginBottom: 10,
  },
  robotWrapper: {
    alignItems: 'center',
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
    bottom: Platform.OS === 'ios' ? 140 : 120,
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
