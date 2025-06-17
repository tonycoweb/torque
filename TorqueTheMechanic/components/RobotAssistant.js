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

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const loopAnimRef = useRef(null);
  const phraseIntervalRef = useRef(null);

  useEffect(() => {
    if (!isChatting) {
      // Start pulsing
      loopAnimRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.05,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );

      loopAnimRef.current.start();

      // Start phrase rotation
      phraseIntervalRef.current = setInterval(() => {
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(rotateAnim, {
              toValue: 1,
              duration: 400,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(rotateAnim, {
              toValue: 0,
              duration: 400,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ]).start(() => {
          setCurrentPhraseIndex((prevIndex) => (prevIndex + 1) % phrases.length);

          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }).start();
        });
      }, 7000);
    } else {
      // Chatting → pause animations
      if (loopAnimRef.current) {
        loopAnimRef.current.stop();
        loopAnimRef.current = null;
      }

      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
    }

    return () => {
      // Cleanup when component unmounts or isChatting changes
      if (loopAnimRef.current) {
        loopAnimRef.current.stop();
        loopAnimRef.current = null;
      }

      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
    };
  }, [isChatting]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={{
          transform: [
            { scale: scaleAnim },
            {
              rotate: rotateAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0deg', '5deg'],
              }),
            },
          ],
        }}
      >
        <LottieView
          source={require('../assets/lottie/robotResting.json')}
          autoPlay
          loop={!isChatting} // Only loop in resting mode
          style={styles.robot}
        />
      </Animated.View>

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
