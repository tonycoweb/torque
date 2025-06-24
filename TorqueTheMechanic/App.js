// Updated App.js integration with autosave
import React, { useState, useRef, useEffect } from 'react';
import { AdMobRewarded, setTestDeviceIDAsync } from 'react-native-google-mobile-ads';
import {
  View,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Text,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GarageFrontEnd from './components/GarageFrontEnd';
import HomeHeader from './components/HomeHeader';
import ServiceBox from './components/ServiceBox';
import RobotAssistant from './components/RobotAssistant';
import ChatMessages from './components/ChatMessages';
import ChatBoxFixed from './components/ChatBoxFixed';
import SavedChatsPanel from './components/SavedChatsPanel';
import VehicleSelector from './components/VehicleSelector';
import { sendToGPT } from './components/GptService';
import LoginScreen from './components/LoginScreen';
import { saveChat, getAllChats } from './utils/storage';
import { LogBox, LayoutAnimation, UIManager } from 'react-native';
import VinCamera from './components/VinCamera';
import VinPreview from './components/VinPreview';
import { getVehicleByVin, saveVehicle, getAllVehicles } from './utils/VehicleStorage';





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
  const [showCamera, setShowCamera] = useState(false);
const [vinPhoto, setVinPhoto] = useState(null);




  const robotTranslateY = useRef(new Animated.Value(0)).current;
  const robotScale = useRef(new Animated.Value(1)).current;

  function parseVinReply(text) {
    const data = {};
  
    // 1. Attempt to extract and parse JSON block from GPT
    const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/);
    const cleaned = jsonMatch ? jsonMatch[1] : text;
  
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
  
      // Copy keys from parsed into data (case-insensitive support)
      Object.entries(parsed).forEach(([key, value]) => {
        const k = key.toLowerCase();
        switch (k) {
          case 'vin': data.vin = value; break;
          case 'year': data.year = value; break;
          case 'make': data.make = value; break;
          case 'model': data.model = value; break;
          case 'trim': data.trim = value; break;
          case 'engine': data.engine = value; break;
          case 'transmission': data.transmission = value; break;
          case 'drive_type': data.drive_type = value; break;
          case 'body_style': data.body_style = value; break;
          case 'fuel_type': data.fuel_type = value; break;
          case 'country': data.country = value; break;
          case 'mpg': data.mpg = value; break;
          case 'horsepower': data.hp = value; break;
          case 'gross_vehicle_weight_rating':
          case 'gvw': data.gvw = value; break;
          case 'exterior_color':
          case 'color':
          case 'paint color': data.color = value; break;
        }
      });
    } catch (err) {
      console.warn('Failed to parse VIN JSON, falling back to line parsing:', err);
  
      // 2. Fallback: attempt line-by-line parsing
      const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
      for (let line of lines) {
        const [keyRaw, ...rest] = line.split(/[:—-]/); // handles :, -, —
        if (!keyRaw || rest.length === 0) continue;
        const key = keyRaw.trim().toLowerCase();
        const value = rest.join(':').trim();
        if (value.length === 0) continue;
  
        switch (key) {
          case 'vin': data.vin = value; break;
          case 'year': data.year = value; break;
          case 'make': data.make = value; break;
          case 'model': data.model = value; break;
          case 'trim': data.trim = value; break;
          case 'engine': data.engine = value; break;
          case 'transmission': data.transmission = value; break;
          case 'drive_type': data.drive_type = value; break;
          case 'body_style': data.body_style = value; break;
          case 'fuel_type': data.fuel_type = value; break;
          case 'country': data.country = value; break;
          case 'mpg': data.mpg = value; break;
          case 'horsepower': data.hp = value; break;
          case 'gross_vehicle_weight_rating':
          case 'gvw': data.gvw = value; break;
          case 'exterior_color':
          case 'color':
          case 'paint color': data.color = value; break;
        }
      }
    }
  
    return data.make && data.model ? data : null;
  }
  
  
  
  const decodeVinWithAd = async (base64Image) => {
    try {
      // Show ad
      await AdMobRewarded.setAdUnitID('ca-app-pub-3940256099942544/5224354917'); // ✅ test rewarded ad

      await AdMobRewarded.requestAdAsync();
      await AdMobRewarded.showAdAsync();
    } catch (e) {
      console.warn('Ad skipped or failed:', e);
    }
  
    try {
      const response = await fetch('http://192.168.1.246:3001/decode-vin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Image }),
      });
  
      const { result } = await response.json();
      if (!result) throw new Error('No result');
      console.log('📦 Full VIN GPT reply:\n' + result);
  
      // Try parsing response into structured object
      const parsed = parseVinReply(result);
      if (parsed && parsed.vin) {
        const cached = await getVehicleByVin(parsed.vin);
        const newVehicle = cached || {
          id: Date.now().toString(),
          ...parsed,
        };

        setVehicle(newVehicle);
        setVinPhoto(null);
        await saveVehicle(newVehicle); // ✅ Save or update in AsyncStorage

        const name = `${newVehicle.year || ''} ${newVehicle.make || ''} ${newVehicle.model || ''}`.trim();
        Alert.alert(`✅ ${name} added to garage`, newVehicle.engine ? `${newVehicle.engine}, ${newVehicle.transmission || ''}`.trim() : '');

      } else {
        setVinPhoto(null); // 👈 force exit preview anyway
        console.warn('⚠️ VIN parse failed. Raw result:', result);
        Alert.alert('⚠️ Failed to parse VIN result.', result.slice(0, 100) + '...');
      }
      
    } catch (err) {
      console.error('Decode error:', err);
      Alert.alert('❌ Error', 'Could not decode VIN.');
    }
  };
  

  useEffect(() => {
    const checkLogin = async () => {
      const user = await AsyncStorage.getItem('user');
      setIsLoggedIn(!!user);
    };
    checkLogin();
  }, []);

  useEffect(() => {
    const loadLastSelectedVehicle = async () => {
      const saved = await getAllVehicles();
      if (saved.length > 0) {
        setVehicle(saved[0]); // Or use logic to pick most recent, or preferred one
      }
    };
    loadLastSelectedVehicle();
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
           <VehicleSelector
  selectedVehicle={vehicle}
  onSelectVehicle={setVehicle}
  triggerVinCamera={() => setShowCamera(true)} // 🔥 pass prop
/>



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

  return (
    <>
      {showCamera ? (
        <VinCamera
          onCapture={(photo) => {
            setShowCamera(false);
            setVinPhoto(photo); // show preview after capture
          }}
          onCancel={() => setShowCamera(false)}
        />
      ) : vinPhoto ? (
        <VinPreview
          photo={vinPhoto}
          onRetake={() => {
            setVinPhoto(null);
            setShowCamera(true);
          }}
          onConfirm={() => {
            decodeVinWithAd(vinPhoto.base64);
          }}
        />
      ) : (
        renderContent()
      )}
    </>
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
