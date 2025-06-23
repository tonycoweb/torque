// Updated App.js integration with autosave
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Text,
  KeyboardAvoidingView,
  Platform,
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
import { saveChat, getAllChats } from './utils/storage';
import { LogBox, LayoutAnimation, UIManager } from 'react-native';



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
  const [chatHistory, setChatHistory] = useState([]);
  const [chatID, setChatID] = useState(null);
  const [loading, setLoading] = useState(false); // ✅ loading state

  const robotTranslateY = useRef(new Animated.Value(0)).current;
  const robotScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const checkLogin = async () => {
      const user = await AsyncStorage.getItem('user');
      setIsLoggedIn(!!user);
    };
    checkLogin();
  }, []);

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


  const trimTurns = (history, maxTurns = 6) => {
    const turns = [];
    for (let i = history.length - 1; i >= 0 && turns.length < maxTurns * 2; i--) {
      const msg = history[i];
      if (msg.role === 'user' || msg.role === 'assistant') {
        turns.unshift(msg);
      }
    }
    return turns;
  };
  

  const handleSend = async (text) => {
    if (!text.trim()) return;
  
    if (/new issue|start over|reset/i.test(text)) {
      setChatHistory([]);
      setMessages([]);
      setChatID(null);
      return;
    }
  
    let newHistory = [...chatHistory];
  
    newHistory.push({ role: 'user', content: text });

    
  
    setChatHistory(newHistory);
    setMessages((prev) => [...prev, { sender: 'user', text }]);
    setLoading(true); // ⏳ show loader
  
  
    const trimmedHistory = trimTurns(newHistory);
const reply = await sendToGPT('free', trimmedHistory);

    const updatedHistory = [...newHistory, { role: 'assistant', content: reply }];
  
    setChatHistory(updatedHistory);
    setMessages((prev) => [...prev, { sender: 'api', text: reply }]);
    setLoading(false);
  
    const id = chatID || Date.now().toString();
    setChatID(id);
    await saveChat(id, updatedHistory);
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
    setChatHistory([]);
    setChatID(null);
    setShowSavedChats(false);
  };

  const handleChatFocus = () => {
    if (!isChatting) setIsChatting(true);
  };

  const renderContent = () => {
    if (isLoggedIn === null) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
        </View>
      );
    }

    if (!isLoggedIn) {
      return <LoginScreen onLogin={() => setIsLoggedIn(true)} />;
    }

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
          <ChatMessages messages={messages} loading={loading}  />
        </View>

        {isChatting && showSavedChats && (
          <SavedChatsPanel
  onClose={() => setShowSavedChats(false)}
  onSelect={(chat) => {
    if (!chat) {
      // Handle "New Chat"
      setChatID(null);
      setChatHistory([]);
      setMessages([]);
      setShowSavedChats(false);
      return;
    }

    setChatID(chat.id);
    setChatHistory(chat.messages);
    setMessages(
      chat.messages.map((m) => ({
        sender: m.role === 'user' ? 'user' : 'api',
        text: m.content,
      }))
    );
    setShowSavedChats(false);
  }}
/>


 
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
          onAttachImage={(uri) =>
            setMessages((prev) => [...prev, { sender: 'user', text: `📷 ${uri}` }])
          }
          onAttachDocument={(file) =>
            setMessages((prev) => [...prev, { sender: 'user', text: `📄 ${file.name}` }])
          }
          onFocus={handleChatFocus}
        />
      </KeyboardAvoidingView>
    );
  };

  return renderContent();
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
