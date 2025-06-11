import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, Animated, TouchableOpacity, Text, Alert } from 'react-native';
import GarageFrontEnd from './components/GarageFrontEnd';
import HomeHeader from './components/HomeHeader';
import ServiceBox from './components/ServiceBox';
import RobotAssistant from './components/RobotAssistant';
import ChatMessages from './components/ChatMessages';
import ChatBoxFixed from './components/ChatBoxFixed';
import ChatHistoryPanel from './components/ChatHistoryPanel';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';

export default function App() {
  const [vehicle, setVehicle] = useState(null);
  const [garageName, setGarageName] = useState('');
  const [messages, setMessages] = useState([]);
  const [isChatting, setIsChatting] = useState(false);
  const [showChatHistoryPanel, setShowChatHistoryPanel] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const userIsSubscribed = true; // Replace with real subscription check

  const robotTranslateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(robotTranslateY, {
      toValue: 0,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, []);

  // Load chat history on app start
  useEffect(() => {
    const loadChatHistory = async () => {
      try {
        const storedHistory = await AsyncStorage.getItem('chatHistory');
        if (storedHistory) {
          setChatHistory(JSON.parse(storedHistory));
        }
      } catch (err) {
        console.log('Failed to load chat history:', err);
      }
    };

    loadChatHistory();
  }, []);

  // Save chat history when it changes
  useEffect(() => {
    const saveChatHistory = async () => {
      try {
        await AsyncStorage.setItem('chatHistory', JSON.stringify(chatHistory));
      } catch (err) {
        console.log('Failed to save chat history:', err);
      }
    };

    saveChatHistory();
  }, [chatHistory]);

  const handleSend = (text) => {
    if (!isChatting) setIsChatting(true);

    setMessages((prev) => [...prev, { sender: 'user', text, type: 'text' }]);

    // Simulate API response
    setTimeout(() => {
      setMessages((prev) => [...prev, { sender: 'api', text: `Response to: ${text}`, type: 'text' }]);
    }, 1000);
  };

  const handleAttachImage = (uri) => {
    console.log('Image attached:', uri);
    setMessages((prev) => [
      ...prev,
      { sender: 'user', uri: uri, type: 'image' },
    ]);

    if (!isChatting) setIsChatting(true);
  };

  const handleAttachDocument = (file) => {
    console.log('Document attached:', file);
    setMessages((prev) => [
      ...prev,
      { sender: 'user', text: `📄 Document attached: ${file.name}`, type: 'text' },
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
    if (userIsSubscribed && messages.length > 0) {
      const title = messages[0]?.text?.slice(0, 50) || 'Untitled Chat';
      setChatHistory((prev) => [
        ...prev,
        {
          id: `chat-${Date.now()}`,
          title,
          messages,
        },
      ]);
    }

    setIsChatting(false);
    setMessages([]);
  };

  const handleStartNewChat = () => {
    setMessages([]);
    setIsChatting(true);
    setShowChatHistoryPanel(false);
  };

  const handleClearChatHistoryConfirm = () => {
    Alert.alert(
      'Confirm Clear History',
      'Are you sure you want to delete all chat history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: handleClearChatHistory,
        },
      ]
    );
  };

  const handleClearChatHistory = () => {
    setChatHistory([]);
    AsyncStorage.removeItem('chatHistory').catch((err) =>
      console.log('Failed to clear chat history:', err)
    );
  };

  const handleDeleteChatConfirm = (chatId) => {
    Alert.alert(
      'Confirm Delete Chat',
      'Are you sure you want to delete this chat?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => handleDeleteChat(chatId),
        },
      ]
    );
  };

  const handleDeleteChat = (chatId) => {
    setChatHistory((prev) => prev.filter((chat) => chat.id !== chatId));
  };

  return (
    <View style={styles.container}>
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
              marginTop: 20,
              transform: [{ translateY: robotTranslateY }],
            },
          ]}
        >
          <RobotAssistant isChatting={isChatting} />
        </Animated.View>
      )}

      {isChatting && (
        <View style={styles.exitButtonWrapper}>
          <TouchableOpacity style={styles.exitButton} onPress={handleExitChat}>
            <Text style={styles.exitButtonText}>Exit Chat</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ChatMessagesArea */}
      <View style={styles.chatMessagesArea}>
        <ChatMessages messages={messages} />
      </View>

      <ChatBoxFixed
        onSend={handleSend}
        onAttachImage={handleAttachImage}
        onAttachDocument={handleAttachDocument}
      />

      {/* Floating History Icon Button → outside messages box */}
      <TouchableOpacity
        style={styles.historyButton}
        onPress={() => setShowChatHistoryPanel(true)}
      >
        <MaterialIcons name="edit-note" size={28} color="#fff" />
      </TouchableOpacity>

      {/* History Panel */}
      <ChatHistoryPanel
        chatHistory={chatHistory}
        isVisible={showChatHistoryPanel}
        onClose={() => setShowChatHistoryPanel(false)}
        onSelectChat={(chat) => {
          setMessages(chat.messages);
          setIsChatting(true);
          setShowChatHistoryPanel(false);
        }}
        onStartNewChat={handleStartNewChat}
        onClearChatHistoryConfirm={handleClearChatHistoryConfirm}
        onDeleteChatConfirm={handleDeleteChatConfirm}
        userIsSubscribed={userIsSubscribed}
      />
    </View>
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
  exitButtonWrapper: {
    alignItems: 'center',
    marginBottom: 10,
  },
  exitButton: {
    backgroundColor: '#444',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
  },
  exitButtonText: {
    color: '#fff',
    fontSize: 14,
  },
  historyButton: {
    position: 'absolute',
    bottom: 180, // adjust based on ChatBox height
    right: 20,
    backgroundColor: '#333',
    padding: 10,
    borderRadius: 24,
    zIndex: 999,
  },
});
