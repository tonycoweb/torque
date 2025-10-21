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
import { sendToGPT } from './components/GptService';
import LoginScreen from './components/LoginScreen';
import { saveChat } from './utils/storage';
import { LogBox, LayoutAnimation, UIManager } from 'react-native';
import VinCamera from './components/VinCamera';
import VinPreview from './components/VinPreview';
import { getVehicleByVin, saveVehicle, getAllVehicles } from './utils/VehicleStorage';
import SettingsModal from './components/SettingsModal';
import mobileAds, { RewardedAd, RewardedAdEventType } from 'react-native-google-mobile-ads';

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

  // NEW: drive auto-scroll & bottom inset
  const [focusTick, setFocusTick] = useState(0);
  const [kbVisible, setKbVisible] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);

  const rewardedRef = useRef(null);

  useEffect(() => {
    const initAdMob = async () => {
      try { await mobileAds().initialize(); } catch {}
    };
    initAdMob();
  }, []);

  // Keyboard listeners → ensure we always see newest message
  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const subShow = Keyboard.addListener(show, (e) => {
      setKbVisible(true);
      setKbHeight(e?.endCoordinates?.height ?? 0);
      // tell ChatMessages to jump to bottom when keyboard appears
      setFocusTick((x) => x + 1);
    });
    const subHide = Keyboard.addListener(hide, () => {
      setKbVisible(false);
      setKbHeight(0);
    });

    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  const showRewardedAd = async () =>
    new Promise((resolve) => {
      const rewarded = RewardedAd.createForAdRequest(adUnitId, { requestNonPersonalizedAdsOnly: true });
      const cleanup = () => rewarded.removeAllListeners();
      let timeoutId = setTimeout(() => { cleanup(); resolve(false); }, 10000);

      rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        clearTimeout(timeoutId);
        try { rewarded.show(); } catch { cleanup(); resolve(false); }
      });
      rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { clearTimeout(timeoutId); cleanup(); resolve(true); });
      try { rewarded.load(); rewardedRef.current = rewarded; } catch { clearTimeout(timeoutId); cleanup(); resolve(false); }
    });

  const parseVinReply = (text) => {
    const data = {};
    const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/);
    const cleaned = jsonMatch ? jsonMatch[1] : text;
    try {
      const parsed = JSON.parse(cleaned);
      Object.entries(parsed).forEach(([k, v]) => {
        const key = k.toLowerCase();
        if (key === 'vin') data.vin = v;
        else if (key === 'year') data.year = v;
        else if (key === 'make') data.make = v;
        else if (key === 'model') data.model = v;
        else if (key === 'trim') data.trim = v;
        else if (key === 'engine') data.engine = v;
        else if (key === 'transmission') data.transmission = v;
        else if (key === 'drive_type') data.drive_type = v;
        else if (key === 'body_style') data.body_style = v;
        else if (key === 'fuel_type') data.fuel_type = v;
        else if (key === 'country') data.country = v;
        else if (key === 'mpg') data.mpg = typeof v === 'object' && v?.city && v?.highway ? `${v.city}/${v.highway}` : String(v);
        else if (key === 'horsepower') data.hp = v;
        else if (key === 'gross_vehicle_weight_rating' || key === 'gvw') data.gvw = v;
        else if (['exterior_color', 'color', 'paint color'].includes(key)) data.color = v;
      });
    } catch {
      text.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
        const [raw, ...rest] = line.split(/[:—-]/);
        if (!raw || rest.length === 0) return;
        const key = raw.trim().toLowerCase();
        const v = rest.join(':').trim();
        if (!v) return;
        if (key === 'vin') data.vin = v;
        else if (key === 'year') data.year = v;
        else if (key === 'make') data.make = v;
        else if (key === 'model') data.model = v;
        else if (key === 'trim') data.trim = v;
        else if (key === 'engine') data.engine = v;
        else if (key === 'transmission') data.transmission = v;
        else if (key === 'drive_type') data.drive_type = v;
        else if (key === 'body_style') data.body_style = v;
        else if (key === 'fuel_type') data.fuel_type = v;
        else if (key === 'country') data.country = v;
        else if (key === 'mpg') data.mpg = v;
        else if (key === 'horsepower') data.hp = v;
        else if (['gross_vehicle_weight_rating', 'gvw'].includes(key)) data.gvw = v;
        else if (['exterior_color', 'color', 'paint color'].includes(key)) data.color = v;
      });
    }
    return data.vin ? data : null;
  };

  const decodeVinWithAd = async (base64Image) => {
    setShowDecodingModal(true);
    return new Promise((resolve) => {
      const rewarded = RewardedAd.createForAdRequest(adUnitId, { requestNonPersonalizedAdsOnly: true });
      const cleanup = () => { rewarded.removeAllListeners(); setShowDecodingModal(false); };

      let decodePromise = new Promise((resolveDecode) => {
        (async () => {
          try {
            const response = await fetch('http://192.168.1.246:3001/decode-vin', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64Image }),
            });
            const { result } = await response.json();
            resolveDecode(parseVinReply(result));
          } catch { resolveDecode({ error: 'Could not decode VIN.' }); }
        })();
      });

      let timeoutId = setTimeout(() => { cleanup(); resolve(); }, 10000);

      rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        clearTimeout(timeoutId);
        try { rewarded.show(); } catch { cleanup(); resolve(); }
      });

      rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async () => {
        clearTimeout(timeoutId);
        const decodeResult = await decodePromise;
        if (decodeResult?.vin && decodeResult?.make && decodeResult?.model) {
          const cached = await getVehicleByVin(decodeResult.vin);
          const newVehicle = cached || { id: Date.now().toString(), ...decodeResult };
          setVehicle(newVehicle);
          setVinPhoto(null);
          await saveVehicle(newVehicle);
          const name = `${newVehicle.year || ''} ${newVehicle.make || ''} ${newVehicle.model || ''}`.trim();
          Alert.alert(`✅ ${name} added to garage`, newVehicle.engine || '');
        } else if (decodeResult?.error) {
          Alert.alert('❌ Error', decodeResult.error);
          setVinPhoto(null);
        } else {
          Alert.alert('⚠️ Failed to parse VIN result.', 'No valid vehicle data received.');
          setVinPhoto(null);
        }
        cleanup(); resolve();
      });

      try { rewarded.load(); rewardedRef.current = rewarded; }
      catch (error) { Alert.alert('❌ Ad error', error.message || 'Unknown error'); clearTimeout(timeoutId); cleanup(); resolve(); }
    });
  };

  useEffect(() => {
    (async () => {
      const user = await AsyncStorage.getItem('user');
      setIsLoggedIn(!!user);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const saved = await getAllVehicles();
      if (saved.length > 0) setVehicle(saved[0]);
    })();
  }, []);

  useEffect(() => {
    if (vehicle) AsyncStorage.setItem('selectedVehicle', JSON.stringify(vehicle)).catch(() => {});
  }, [vehicle]);

  const robotTranslateY = useRef(new Animated.Value(0)).current;
  const robotScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(robotTranslateY, { toValue: isChatting ? -80 : 0, duration: 500, useNativeDriver: true }).start();
    Animated.timing(robotScale, { toValue: isChatting ? 0.6 : 1, duration: 500, useNativeDriver: true }).start();
  }, [isChatting]);

  const trimTurns = (history, maxTurns = 6) => {
    const turns = [];
    for (let i = history.length - 1; i >= 0 && turns.length < maxTurns * 2; i--) {
      const msg = history[i];
      if (msg.role === 'user' || msg.role === 'assistant') turns.unshift(msg);
    }
    return turns;
  };

  const handleSend = async (text) => {
    if (!text.trim()) return;

    if (/new issue|start over|reset/i.test(text)) {
      setChatHistory([]); setMessages([]); setChatID(null); return;
    }

    const newHistory = [...chatHistory, { role: 'user', content: text }];
    setChatHistory(newHistory);
    setMessages((prev) => [...prev, { sender: 'user', text }]);
    setLoading(true);

    const trimmedHistory = trimTurns(newHistory);
    const reply = await sendToGPT('free', trimmedHistory);

    const updatedHistory = [...newHistory, { role: 'assistant', content: reply }];
    setChatHistory(updatedHistory);
    setMessages((prev) => [...prev, { sender: 'api', text: reply }]);
    setLoading(false);

    const id = chatID || Date.now().toString();
    setChatID(id);
    await saveChat(id, updatedHistory);

    // after a reply, nudge scroll down
    setFocusTick((x) => x + 1);
  };

  const handleExitChat = () => {
    Keyboard.dismiss();
    setIsChatting(false);
    setMessages([]);
    setChatHistory([]);
    setChatID(null);
    setShowSavedChats(false);
  };

  const handleChatFocus = () => {
    if (!isChatting) setIsChatting(true);
    setFocusTick((x) => x + 1);
  };

  const toggleSavedChats = () => {
    Keyboard.dismiss();
    setShowSavedChats((prev) => !prev);
  };

  // how much padding the list should keep at the bottom so newest message isn't under the input
  const BASE_INPUT_BLOCK = isChatting ? 84 : 76; // input height when collapsed
  const bottomInset = BASE_INPUT_BLOCK + (kbVisible ? 4 : 0);

  const renderContent = () => {
    if (isLoggedIn === null) return <View style={styles.loading}><ActivityIndicator size="large" /></View>;
    if (!isLoggedIn) return <LoginScreen onLogin={() => setIsLoggedIn(true)} />;

    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
        <HomeHeader garageName={garageName} setGarageName={setGarageName} onSettingsPress={() => setShowSettings(true)} />
        <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />

        {!isChatting && (
          <>
            <VehicleSelector selectedVehicle={vehicle} onSelectVehicle={setVehicle} triggerVinCamera={() => setShowCamera(true)} />
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
          <ChatMessages
            messages={messages}
            loading={loading}
            focusTick={focusTick}
            bottomInset={bottomInset}
          />
        </View>

        {isChatting && showSavedChats && (
          <SavedChatsPanel
            onClose={() => setShowSavedChats(false)}
            onSelect={(chat) => {
              if (!chat) {
                setChatID(null); setChatHistory([]); setMessages([]); setShowSavedChats(false); return;
              }
              setChatID(chat.id);
              setChatHistory(chat.messages);
              setMessages(chat.messages.map((m) => ({ sender: m.role === 'user' ? 'user' : 'api', text: m.content })));
              setShowSavedChats(false);
              setFocusTick((x) => x + 1);
            }}
          />
        )}

        <ChatBoxFixed
          onSend={handleSend}
          onAttachImage={(uri) => setMessages((prev) => [...prev, { sender: 'user', text: `📷 ${uri}` }])}
          onAttachDocument={(file) => setMessages((prev) => [...prev, { sender: 'user', text: `📄 ${file.name}` }])}
          onFocus={handleChatFocus}
          onOpenSavedNotes={toggleSavedChats}
        />
      </KeyboardAvoidingView>
    );
  };

  return (
    <>
      {showCamera ? (
        <VinCamera onCapture={(photo) => { setShowCamera(false); setVinPhoto(photo); }} onCancel={() => setShowCamera(false)} />
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
});
