import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import LottieView from 'lottie-react-native';

export default function RobotAssistant({ isChatting }) {
  const phrases = [
    "I'm a master mechanic! You can ask me anything.",
    "If you send me a pic of your part, I can tell you what it is.",
    "Need help understanding a repair? Just ask.",
    "Tap a service above to add proof or mark it complete.",
    "Torque is always ready to assist you!",
  ];

  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isChatting) return;
  
    let timeoutId;
    let isCancelled = false;
  
    const animateAndSwitch = () => {
      if (isCancelled) return;
  
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
  
      setCurrentPhraseIndex((prev) => (prev + 1) % phrases.length);
  
      timeoutId = setTimeout(animateAndSwitch, 6000); // ⏱️ repeat
    };
  
    timeoutId = setTimeout(animateAndSwitch, 6000); // ⏱️ start delay
  
    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
      fadeAnim.stopAnimation();
    };
  }, [isChatting]);
  

  return (
    <View style={styles.container}>
{!isChatting && (
  <LottieView
    source={require('../assets/lottie/robotResting.json')}
    autoPlay
    loop
    style={styles.robot}
  />
)}



      {!isChatting && (
        <View style={styles.chatWrapper}>
          <View style={styles.chatBubble}>
            <Animated.Text style={[styles.chatText, { opacity: fadeAnim }]}>
              {phrases[currentPhraseIndex]}
            </Animated.Text>
            <View style={styles.chatTail} />
          </View>
        </View>
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    marginTop: 10,
    marginLeft: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  robot: {
    width: 150,
    height: 150,
  },
  chatWrapper: {
    marginLeft: 12,
    maxWidth: '70%',
    position: 'relative',
  },
  chatBubble: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    borderColor: '#ddd',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    position: 'relative',
    marginRight: 50,
  },
  chatText: {
    color: '#333',
    fontSize: 14,
  },
  chatTail: {
    position: 'absolute',
    top: 10,
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
