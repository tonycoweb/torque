import React, { useState, useRef, useEffect } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View, StyleSheet, Animated, TouchableOpacity, Text, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Modal } from 'react-native';
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
import { saveChat, getAllChats } from './utils/storage';
import { LogBox, LayoutAnimation, UIManager } from 'react-native';
import VinCamera from './components/VinCamera';
import VinPreview from './components/VinPreview';
import { getVehicleByVin, saveVehicle, getAllVehicles } from './utils/VehicleStorage';
import SettingsModal from './components/SettingsModal';
import mobileAds, { RewardedAd, RewardedAdEventType } from 'react-native-google-mobile-ads';

const adUnitId = __DEV__
  ? Platform.OS === 'ios'
    ? 'ca-app-pub-3940256099942544/1712485313' // iOS test rewarded ad unit ID
    : 'ca-app-pub-3940256099942544/5224354917' // Android test rewarded ad unit ID
  : 'your-real-admob-id-here'; // Replace with your real AdMob ID for production

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

  const rewardedRef = useRef(null);

  useEffect(() => {
    const initAdMob = async () => {
      try {
        await mobileAds().initialize();
        console.log('✅ AdMob initialized');
      } catch (error) {
        console.error('❌ AdMob initialization failed:', error);
      }
    };

    initAdMob();
  }, []);

      const showRewardedAd = async () => {
    console.log('🎬 Attempting to show test ad...');

    return new Promise((resolve) => {
      const rewarded = RewardedAd.createForAdRequest(adUnitId, {
        requestNonPersonalizedAdsOnly: true,
      });

      const cleanup = () => {
        console.log('🧹 Cleaning up ad listeners...');
        rewarded.removeAllListeners();
      };

      // Log available event types for debugging
      console.log('🔍 RewardedAdEventType:', Object.keys(RewardedAdEventType));

      let timeoutId = setTimeout(() => {
        console.warn('⏱️ Test ad load timeout');
        cleanup();
        resolve(false);
      }, 10000);

      rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        console.log('🚀 Test ad loaded!');
        clearTimeout(timeoutId); // Clear timeout on load
        try {
          rewarded.show();
        } catch (error) {
          console.error('❌ Test ad show error:', error);
          cleanup();
          resolve(false);
        }
      });

      rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        console.log('✅ Test ad reward earned!');
        clearTimeout(timeoutId); // Clear timeout on reward
        cleanup();
        resolve(true);
      });

      console.log('🔄 Loading test ad...');
      try {
        rewarded.load();
        rewardedRef.current = rewarded;
      } catch (error) {
        console.error('❌ Test ad load error:', error);
        clearTimeout(timeoutId); // Clear timeout on error
        cleanup();
        resolve(false);
      }
    });
  };

  const parseVinReply = (text) => {
    const data = {};
    console.log('🔍 parseVinReply input:', text);

    const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/);
    const cleaned = jsonMatch ? jsonMatch[1] : text;
    console.log('🔍 parseVinReply cleaned:', cleaned);

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
      console.log('🔍 parseVinReply parsed JSON:', parsed);

      Object.entries(parsed).forEach(([key, value]) => {
        const k = key.toLowerCase();
        switch (k) {
          case 'vin':
            data.vin = value;
            break;
          case 'year':
            data.year = value;
            break;
          case 'make':
            data.make = value;
            break;
          case 'model':
            data.model = value;
            break;
          case 'trim':
            data.trim = value;
            break;
          case 'engine':
            data.engine = value;
            break;
          case 'transmission':
            data.transmission = value;
            break;
          case 'drive_type':
            data.drive_type = value;
            break;
          case 'body_style':
            data.body_style = value;
            break;
          case 'fuel_type':
            data.fuel_type = value;
            break;
          case 'country':
            data.country = value;
            break;
          case 'mpg':
            if (typeof value === 'string') {
              data.mpg = value;
            } else if (typeof value === 'object' && value.city && value.highway) {
              data.mpg = `${value.city}/${value.highway}`;
            } else {
              data.mpg = String(value);
            }
            break;
          case 'horsepower':
            data.hp = value;
            break;
          case 'gross_vehicle_weight_rating':
          case 'gvw':
            data.gvw = value;
            break;
          case 'exterior_color':
          case 'color':
          case 'paint color':
            data.color = value;
            break;
        }
      });
    } catch (err) {
      console.warn('Failed to parse VIN JSON, falling back to line parsing:', err);

      const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
      for (let line of lines) {
        const [keyRaw, ...rest] = line.split(/[:—-]/);
        if (!keyRaw || rest.length === 0) continue;
        const key = keyRaw.trim().toLowerCase();
        const value = rest.join(':').trim();
        if (value.length === 0) continue;

        switch (key) {
          case 'vin':
            data.vin = value;
            break;
          case 'year':
            data.year = value;
            break;
          case 'make':
            data.make = value;
            break;
          case 'model':
            data.model = value;
            break;
          case 'trim':
            data.trim = value;
            break;
          case 'engine':
            data.engine = value;
            break;
          case 'transmission':
            data.transmission = value;
            break;
          case 'drive_type':
            data.drive_type = value;
            break;
          case 'body_style':
            data.body_style = value;
            break;
          case 'fuel_type':
            data.fuel_type = value;
            break;
          case 'country':
            data.country = value;
            break;
          case 'mpg':
            if (typeof value === 'string') {
              data.mpg = value;
            } else if (typeof value === 'object' && value.city && value.highway) {
              data.mpg = `${value.city}/${value.highway}`;
            } else {
              data.mpg = String(value);
            }
            break;
          case 'horsepower':
            data.hp = value;
            break;
          case 'gross_vehicle_weight_rating':
          case 'gvw':
            data.gvw = value;
            break;
          case 'exterior_color':
          case 'color':
          case 'paint color':
            data.color = value;
            break;
        }
      }
    }

    console.log('🔍 parseVinReply output:', data);
    // Relax condition to return data if VIN is present
    return data.vin ? data : null;
  };


    const decodeVinWithAd = async (base64Image) => {
    console.log('📸 decodeVinWithAd STARTED');
    setShowDecodingModal(true);

    return new Promise((resolve) => {
      const rewarded = RewardedAd.createForAdRequest(adUnitId, {
        requestNonPersonalizedAdsOnly: true,
      });
      console.log('🎬 RewardedAd instance created, loading...');

      const cleanup = () => {
        console.log('🧹 Cleaning up ad listeners...');
        rewarded.removeAllListeners();
        setShowDecodingModal(false);
      };

      // Use a Promise to store VIN decode result
      let decodePromise = new Promise((resolveDecode) => {
        const decodeVin = async () => {
          try {
            const response = await fetch('http://192.168.1.***:3001/decode-vin', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ base64Image }),
            });

            const { result } = await response.json();
            console.log('📦 Full VIN GPT reply:\n' + result);
            const parsedResult = parseVinReply(result);
            console.log('🔍 decodeVin result:', parsedResult);
            resolveDecode(parsedResult);
          } catch (err) {
            console.error('Decode error:', err);
            resolveDecode({ error: 'Could not decode VIN.' });
          }
        };
        decodeVin();
      });

      // Log available event types for debugging
      console.log('🔍 RewardedAdEventType:', Object.keys(RewardedAdEventType));

      let timeoutId = setTimeout(() => {
        console.warn('⏱️ Ad load timeout — no fill or blocked');
        Alert.alert('⚠️ Ad not ready', 'Try again in a few seconds.');
        cleanup();
        resolve();
      }, 10000);

      rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        console.log('🚀 Ad loaded!');
        clearTimeout(timeoutId); // Clear timeout on load
        try {
          rewarded.show();
        } catch (err) {
          console.error('❌ Ad show error:', err);
          cleanup();
          resolve();
        }
      });

      rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async () => {
        console.log('✅ Reward earned. Proceeding with VIN decode.');
        clearTimeout(timeoutId); // Clear timeout on reward

        // Wait for decode result
        const decodeResult = await decodePromise;
        console.log('🔍 Processing decodeResult:', decodeResult);

        // Process the decode result
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
          console.warn('⚠️ No valid vehicle data:', decodeResult);
          Alert.alert('⚠️ Failed to parse VIN result.', 'No valid vehicle data received.');
          setVinPhoto(null);
        }

        cleanup();
        resolve();
      });

      console.log('🔄 Loading ad...');
      try {
        rewarded.load();
        rewardedRef.current = rewarded;
      } catch (err) {
        console.error('❌ Ad load error:', err);
        Alert.alert('❌ Ad error', err.message || 'Unknown error');
        clearTimeout(timeoutId); // Clear timeout on error
        cleanup();
        resolve();
      }
    });
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
        setVehicle(saved[0]);
      }
    };
    loadLastSelectedVehicle();
  }, []);

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
        <HomeHeader garageName={garageName} setGarageName={setGarageName} onSettingsPress={() => setShowSettings(true)} />
        <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />

        {!isChatting && (
          <>
            <VehicleSelector
              selectedVehicle={vehicle}
              onSelectVehicle={setVehicle}
              triggerVinCamera={() => setShowCamera(true)}
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
            setVinPhoto(photo);
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

      {showDecodingModal && (
        <Modal transparent animationType="fade" visible>
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(0,0,0,0.7)',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <View
              style={{
                backgroundColor: '#222',
                padding: 30,
                borderRadius: 20,
                alignItems: 'center',
              }}
            >
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