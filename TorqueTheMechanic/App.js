// App.js
import React, { useState, useRef, useEffect } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
  Modal,
  Keyboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import HomeHeader from './components/HomeHeader';
import ServiceBox from './components/ServiceBox';
import RobotAssistant from './components/RobotAssistant';
import ChatMessages from './components/ChatMessages';
import ChatBoxFixed from './components/ChatBoxFixed';
import SavedChatsPanel from './components/SavedChatsPanel';
import VehicleSelector from './components/VehicleSelector';
import LoginScreen from './components/LoginScreen';
import { saveChat, getAllChats } from './utils/storage';
import { LogBox, LayoutAnimation, UIManager } from 'react-native';
import VinCamera from './components/VinCamera';
import VinPreview from './components/VinPreview';
import { getVehicleByVin, saveVehicle, getAllVehicles } from './utils/VehicleStorage';
import SettingsModal from './components/SettingsModal';
import mobileAds, { RewardedAd, RewardedAdEventType } from 'react-native-google-mobile-ads';

const API_URL = 'http://192.168.1.246:3001/chat';

const adUnitId = __DEV__
  ? Platform.OS === 'ios'
    ? 'ca-app-pub-3940256099942544/1712485313'
    : 'ca-app-pub-3940256099942544/5224354917'
  : 'your-real-admob-id-here';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
LayoutAnimation.configureNext = () => {};
LogBox.ignoreLogs(['Excessive number of pending callbacks']);

// ---- Local helper: trim turns (kept from before)
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

// ---- Local helper: call backend (replaces GptService.js)
async function chatWithBackend(tier, messages, vehicle) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier, messages, vehicle }), // vehicle context sent to backend
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json(); // { reply, usage, vehicle_used }
}

export default function App() {
  const [vehicle, setVehicle] = useState(null);
  const [garageName, setGarageName] = useState('');
  const [messages, setMessages] = useState([]);
  const [isChatting, setIsChatting] = useState(false);
  const [showSavedChats, setShowSavedChats] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatID, setChatID] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [vinPhoto, setVinPhoto] = useState(null);
  const [showDecodingModal, setShowDecodingModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Which vehicle the model actually used (from backend [[META]])
  const [activeChatVehicle, setActiveChatVehicle] = useState(null);

  const rewardedRef = useRef(null);

  // AdMob init
  useEffect(() => {
    const initAdMob = async () => {
      try { await mobileAds().initialize(); }
      catch (error) { console.error('❌ AdMob initialization failed:', error); }
    };
    initAdMob();
  }, []);

  const showRewardedAd = async () => {
    return new Promise((resolve) => {
      const rewarded = RewardedAd.createForAdRequest(adUnitId, { requestNonPersonalizedAdsOnly: true });
      const cleanup = () => { rewarded.removeAllListeners(); };
      let timeoutId = setTimeout(() => { cleanup(); resolve(false); }, 10000);

      rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        clearTimeout(timeoutId);
        try { rewarded.show(); } catch (error) { cleanup(); resolve(false); }
      });
      rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        clearTimeout(timeoutId);
        cleanup();
        resolve(true);
      });

      try { rewarded.load(); rewardedRef.current = rewarded; }
      catch (error) { clearTimeout(timeoutId); cleanup(); resolve(false); }
    });
  };

  // VIN decode helpers
  const parseVinReply = (text) => {
    const data = {};
    const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/);
    const cleaned = jsonMatch ? jsonMatch[1] : text;
    try {
      const parsed = JSON.parse(cleaned);
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
          case 'mpg':
            if (typeof value === 'string') data.mpg = value;
            else if (typeof value === 'object' && value.city && value.highway) data.mpg = `${value.city}/${value.highway}`;
            else data.mpg = String(value);
            break;
          case 'horsepower': data.hp = value; break;
          case 'gross_vehicle_weight_rating':
          case 'gvw': data.gvw = value; break;
          case 'exterior_color':
          case 'color':
          case 'paint color': data.color = value; break;
        }
      });
    } catch (err) {
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      for (let line of lines) {
        const [keyRaw, ...rest] = line.split(/[:—-]/);
        if (!keyRaw || rest.length === 0) continue;
        const key = keyRaw.trim().toLowerCase();
        const value = rest.join(':').trim();
        if (!value) continue;
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
    return data.vin ? data : null;
  };

  const decodeVinWithAd = async (base64Image) => {
    setShowDecodingModal(true);

    return new Promise((resolve) => {
      const rewarded = RewardedAd.createForAdRequest(adUnitId, { requestNonPersonalizedAdsOnly: true });

      const cleanup = () => {
        rewarded.removeAllListeners();
        setShowDecodingModal(false);
      };

      let decodePromise = new Promise((resolveDecode) => {
        const decodeVin = async () => {
          try {
            const response = await fetch('http://192.168.1.246:3001/decode-vin', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ base64Image }),
            });
            const { result } = await response.json();
            const parsedResult = parseVinReply(result);
            resolveDecode(parsedResult);
          } catch (err) {
            resolveDecode({ error: 'Could not decode VIN.' });
          }
        };
        decodeVin();
      });

      let timeoutId = setTimeout(() => {
        Alert.alert('⚠️ Ad not ready', 'Try again in a few seconds.');
        cleanup();
        resolve();
      }, 10000);

      rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        clearTimeout(timeoutId);
        try { rewarded.show(); }
        catch (err) { cleanup(); resolve(); }
      });

      rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async () => {
        clearTimeout(timeoutId);

        const decodeResult = await decodePromise;

        if (decodeResult && decodeResult.vin && decodeResult.make && decodeResult.model) {
          const cached = await getVehicleByVin(decodeResult.vin);
          const newVehicle = cached || { id: Date.now().toString(), ...decodeResult };

          setVehicle(newVehicle);
          setVinPhoto(null);
          await saveVehicle(newVehicle);

          const name = `${newVehicle.year || ''} ${newVehicle.make || ''} ${newVehicle.model || ''}`.trim();
          Alert.alert(`✅ ${name} added to garage`, newVehicle.engine || '');
        } else if (decodeResult && decodeResult.error) {
          Alert.alert('❌ Error', decodeResult.error);
          setVinPhoto(null);
        } else {
          Alert.alert('⚠️ Failed to parse VIN result.', 'No valid vehicle data received.');
          setVinPhoto(null);
        }

        cleanup();
        resolve();
      });

      try { rewarded.load(); rewardedRef.current = rewarded; }
      catch (error) {
        Alert.alert('❌ Ad error', error.message || 'Unknown error');
        clearTimeout(timeoutId);
        cleanup();
        resolve();
      }
    });
  };

  // login + vehicle bootstrap
  useEffect(() => { (async () => {
    const user = await AsyncStorage.getItem('user');
    setIsLoggedIn(!!user);
  })(); }, []);
  useEffect(() => { (async () => {
    const saved = await getAllVehicles();
    if (saved.length > 0) setVehicle(saved[0]);
  })(); }, []);
  useEffect(() => {
    if (vehicle) {
      AsyncStorage.setItem('selectedVehicle', JSON.stringify(vehicle))
        .catch(e => console.error('Failed to save vehicle:', e));
    }
  }, [vehicle]);

  const robotTranslateY = useRef(new Animated.Value(0)).current;
  const robotScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(robotTranslateY, { toValue: isChatting ? -80 : 0, duration: 500, useNativeDriver: true }).start();
    Animated.timing(robotScale, { toValue: isChatting ? 0.6 : 1, duration: 500, useNativeDriver: true }).start();
  }, [isChatting]);

  // ---- SEND message (calls backend & passes vehicle context)
  const handleSend = async (text) => {
    if (!text.trim()) return;
    if (/new issue|start over|reset/i.test(text)) {
      setChatHistory([]);
      setMessages([]);
      setChatID(null);
      setActiveChatVehicle(null);
      return;
    }

    const newHistory = [...chatHistory, { role: 'user', content: text }];
    setChatHistory(newHistory);
    setMessages((prev) => [...prev, { sender: 'user', text }]);
    setLoading(true);

    const trimmedHistory = trimTurns(newHistory);

    // Prefer overridden vehicle if the model switched earlier in the chat
    const vehicleForChat =
      activeChatVehicle?.source === 'overridden' ? activeChatVehicle : vehicle;

    let replyPayload;
    try {
      replyPayload = await chatWithBackend('free', trimmedHistory, vehicleForChat);
    } catch (e) {
      setLoading(false);
      setMessages((prev) => [...prev, { sender: 'api', text: '⚠️ There was an error processing your request.' }]);
      return;
    }

    const reply = replyPayload.reply || '';
    const used = replyPayload.vehicle_used || null;
    if (used) setActiveChatVehicle(used); // remember which vehicle the model actually used

    const updatedHistory = [...newHistory, { role: 'assistant', content: reply }];
    setChatHistory(updatedHistory);
    setMessages((prev) => [...prev, { sender: 'api', text: reply }]);
    setLoading(false);

    const id = chatID || Date.now().toString();
    setChatID(id);
    await saveChat(id, updatedHistory);
  };

  const handleExitChat = () => {
    Keyboard.dismiss();
    setIsChatting(false);
    setMessages([]);
    setChatHistory([]);
    setChatID(null);
    setShowSavedChats(false);
    setActiveChatVehicle(null);
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

    if (!isLoggedIn) return <LoginScreen onLogin={() => setIsLoggedIn(true)} />;

    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <HomeHeader garageName={garageName} setGarageName={setGarageName} onSettingsPress={() => setShowSettings(true)} />
        <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />

        {!isChatting && (
          <>
            <VehicleSelector
              selectedVehicle={vehicle}
              onSelectVehicle={setVehicle}
              triggerVinCamera={() => setShowCamera(true)}
            />
            <ServiceBox selectedVehicle={vehicle} />
          </>
        )}

        {!isChatting && (
          <Animated.View
            style={[
              styles.robotWrapper,
              { marginTop: isChatting ? 60 : 20, transform: [{ translateY: robotTranslateY }, { scale: robotScale }] },
            ]}
          >
            <RobotAssistant isChatting={isChatting} />
          </Animated.View>
        )}

        {isChatting && (
          <TouchableOpacity style={styles.exitButton} onPress={handleExitChat}>
            <Text style={styles.exitButtonText}>Exit Chat</Text>
          </TouchableOpacity>
        )}

        <View style={styles.chatMessagesArea}>
          <ChatMessages messages={messages} loading={loading} />
        </View>

        {isChatting && showSavedChats && (
          <SavedChatsPanel
            onClose={() => setShowSavedChats(false)}
            onSelect={(chat) => {
              if (!chat) {
                setChatID(null);
                setChatHistory([]);
                setMessages([]);
                setShowSavedChats(false);
                setActiveChatVehicle(null);
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
              setActiveChatVehicle(null);
            }}
          />
        )}

        {isChatting && (
          <TouchableOpacity
            style={styles.savedChatsButton}
            onPress={() => { Keyboard.dismiss(); setShowSavedChats((prev) => !prev); }}
          >
            <Text style={styles.savedChatsIcon}>📝</Text>
          </TouchableOpacity>
        )}

        <ChatBoxFixed
          onSend={handleSend}
          onAttachImage={(uri) => setMessages((prev) => [...prev, { sender: 'user', text: `📷 ${uri}` }])}
          onAttachDocument={(file) => setMessages((prev) => [...prev, { sender: 'user', text: `📄 ${file.name}` }])}
          onFocus={handleChatFocus}
        />
      </KeyboardAvoidingView>
    );
  };

  return (
    <>
      {showCamera ? (
        <VinCamera
          onCapture={(photo) => { setShowCamera(false); setVinPhoto(photo); }}
          onCancel={() => setShowCamera(false)}
        />
      ) : vinPhoto ? (
        <VinPreview
          photo={vinPhoto}
          onRetake={() => { setVinPhoto(null); setShowCamera(true); }}
          onConfirm={() => { decodeVinWithAd(vinPhoto.base64); }}
        />
      ) : (
        renderContent()
      )}

      {showDecodingModal && (
        <Modal transparent animationType="fade" visible>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ backgroundColor: '#222', padding: 30, borderRadius: 20, alignItems: 'center' }}>
              <MaterialCommunityIcons name="cog" size={40} color="#4CAF50" style={{ marginBottom: 10 }} />
              <Text style={{ color: '#fff', fontSize: 18, marginBottom: 5 }}>Torque is decoding...</Text>
              <ActivityIndicator color="#4CAF50" size="large" />
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', paddingVertical: 50, paddingHorizontal: 20 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  chatMessagesArea: { flex: 1, marginBottom: 10 },
  robotWrapper: { alignItems: 'center' },
  exitButton: { marginBottom: 8, backgroundColor: '#444', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12, alignSelf: 'center' },
  exitButtonText: { color: '#fff', fontSize: 14 },
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
  savedChatsIcon: { fontSize: 20, color: '#fff' },
});
