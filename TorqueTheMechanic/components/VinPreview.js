// components/VinPreview.js
import React, { useState, useRef, useMemo } from 'react';
import {
  View,
  Image,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { compressForUpload } from '../utils/imageUpload';

export default function VinPreview({ photo, onConfirm, onRetake }) {
  const [busy, setBusy] = useState(false);

  // ✅ HARD LOCK: prevents spam taps before React state updates
  const useThisLockRef = useRef(false);

  const uri = photo?.uri || null;

  // Small “guide” overlay (preview only) to hint the user what area to capture next time
  const guide = useMemo(() => ({ w: 0.68, h: 0.12 }), []);

  const handleUseThis = async () => {
    if (!uri) return;

    // ✅ block double-taps in same tick / before re-render
    if (useThisLockRef.current) return;
    useThisLockRef.current = true;

    setBusy(true);
    try {
      // ✅ Slightly smaller than before to reduce vision input + improve OCR consistency
      const { dataUrl, bytesApprox } = await compressForUpload(uri, {
        targetWidth: 820,
        compress: 0.5,
      });

      // Keep payload safely under your Lambda/API limit.
      if (bytesApprox > 2_500_000) {
        Alert.alert('Image too large', 'Try retaking closer to the VIN with better lighting.');
        return;
      }

      // ✅ await so we don't unlock early if parent does async work
      await onConfirm?.(dataUrl); // send data URL (Lambda accepts it)
    } catch (e) {
      Alert.alert('Compression failed', e?.message || 'Please retake the photo.');
    } finally {
      setBusy(false);
      useThisLockRef.current = false; // ✅ ALWAYS unlock
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.previewWrap}>
        <Image source={{ uri }} style={styles.image} resizeMode="contain" />

        {/* Preview guide overlay (does not affect the actual captured image) */}
        <View pointerEvents="none" style={styles.guideOverlay}>
    
     
        </View>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity onPress={onRetake} style={styles.retakeButton} disabled={busy}>
          <Text style={styles.buttonText}>🔁 Retake</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleUseThis} style={styles.confirmButton} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>✅ Use This</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },

  previewWrap: { flex: 1, width: '100%' },
  image: { flex: 1, width: '100%' },

  guideOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideBox: {
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  guideText: {
    marginTop: 12,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '700',
  },

  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 20,
    backgroundColor: '#111',
  },
  retakeButton: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#333', borderRadius: 12 },
  confirmButton: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#4CAF50', borderRadius: 12 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
