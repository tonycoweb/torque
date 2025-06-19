import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LottieView from 'lottie-react-native';

export default function LoginScreen({ onLogin }) {
  const [loading, setLoading] = useState(false);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const fullTextRef = useRef('');
  const typingTimeout = useRef(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const torqueSlideIn = useRef(new Animated.Value(-200)).current;
  const bubblePulse = useRef(new Animated.Value(1)).current;

  const phrases = [
    "👋 Hey, I’m Torque — your pocket mechanic. \n >>>",
    "🛠 I can track your maintenance, service records, upcoming repairs and help remind you when it’s time.",
    "📸 Snap a pic of a part — I’ll help identify and explain it.",
    "🧰 I can walk you through car repairs step by step.",
    "🚗 Save all your vehicles and build a full repair history.",
    "🔍 Ask me about a sound or symptom — I’ll help diagnose it.",
    "🎤 Let me hear that weird noise — I can help diagnose issues from sound too.",
    "📘 I can pull your car’s oil type, fluid specs, or torque settings fast.*",
    "🔧 Need a part number? I’ll look it up for you — fast.",
    "💸 Think a mechanic is ripping you off? Ask me! I'll always stay truthful.",
    "🧰 Having trouble finding car info online? Ask me! I'm like the internet, but better!",
  ];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        easing: Easing.out(Easing.exp),
        useNativeDriver: true,
      }),
      Animated.timing(torqueSlideIn, {
        toValue: 0,
        duration: 2000,
        easing: Easing.out(Easing.back(1)),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useEffect(() => {
    // Start typing animation when phrase changes
    fullTextRef.current = phrases[phraseIndex];
    setDisplayedText('');
    clearTimeout(typingTimeout.current);
    typeText(0);
  }, [phraseIndex]);

  const typeText = (i) => {
    if (i === 1) {
      // Start bubble pulse animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(bubblePulse, {
            toValue: 1.02,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(bubblePulse, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }

    if (i <= fullTextRef.current.length) {
      setDisplayedText(fullTextRef.current.slice(0, i));
      typingTimeout.current = setTimeout(() => typeText(i + 1), 24);
    } else {
      bubblePulse.stopAnimation(); // stop after typing finishes
    }
  };

  const nextPhrase = () => {
    setPhraseIndex((prev) => (prev + 1) % phrases.length);
  };

  const handleAppleLogin = async () => {
    try {
      setLoading(true);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      await AsyncStorage.setItem('user', JSON.stringify({
        userId: credential.user,
        email: credential.email || '',
        name: credential.fullName?.givenName || '',
      }));

      onLogin();
    } catch (e) {
      if (e.code !== 'ERR_CANCELED') {
        console.error('Apple Login Error:', e);
        Alert.alert('Login Failed', 'Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>Pocket Mechanic</Text>

      {loading ? (
        <ActivityIndicator size="large" color="#4CAF50" style={{ marginTop: 40 }} />
      ) : (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={10}
          style={styles.appleButton}
          onPress={handleAppleLogin}
        />
      )}
      

      {/* Torque + intro section */}
      <View style={styles.torqueIntroSection}>
        <Animated.View style={{ transform: [{ translateX: torqueSlideIn }] }}>
          <LottieView
            source={require('../assets/lottie/robotResting.json')}
            autoPlay
            loop
            style={styles.robot}
          />
        </Animated.View>

        <TouchableOpacity onPress={nextPhrase} activeOpacity={0.8}>
          <Animated.View style={[styles.chatBubble, { transform: [{ scale: bubblePulse }] }]}>
            <Animated.Text style={[styles.chatText, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              {displayedText}
            </Animated.Text>
            <View style={styles.chatTail} />
          </Animated.View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  brand: {
    fontSize: 36,
    color: '#4CAF50',
    fontWeight: 'bold',
    marginBottom: 40,
  },
  appleButton: {
    width: 260,
    height: 50,
    marginBottom: 60,
  },
  torqueIntroSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 10,
    marginTop: 20,
  },
  robot: {
    width: 90,
    height: 90,
  },
  chatBubble: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginLeft: 10,
    width: 240,
    minHeight: 70,
    borderColor: '#ddd',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    position: 'relative',
    justifyContent: 'center',
  },
  chatText: {
    color: '#333',
    fontSize: 14,
    lineHeight: 20,
  },
  chatTail: {
    position: 'absolute',
    top: 12,
    left: -8,
    width: 0,
    height: 0,
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderRightWidth: 12,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: '#fff',
  },
});
