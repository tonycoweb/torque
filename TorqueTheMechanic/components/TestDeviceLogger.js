import { useEffect } from 'react';
import { View, Text } from 'react-native';
import mobileAds from 'react-native-google-mobile-ads';

export default function TestDeviceLogger() {
  useEffect(() => {
    mobileAds()
      .setRequestConfiguration({
        maxAdContentRating: 'PG',
        tagForChildDirectedTreatment: false,
        tagForUnderAgeOfConsent: false,
        testDeviceIdentifiers: ['EMULATOR'], // this makes sure SDK logs your real ID
      })
      .then(() => mobileAds().initialize());
  }, []);

  return (
    <View>
      <Text>📡 Logging AdMob device ID to console…</Text>
    </View>
  );
}
