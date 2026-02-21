// components/VinCamera.js
import React, { useRef, useEffect } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Dimensions, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Green box sizing — keep in sync with the overlay view below
const BOX = {
  top: SCREEN_H / 2 - 80,
  left: SCREEN_W * 0.1,
  width: SCREEN_W * 0.8,
  height: 100,
};

export default function VinCamera({ onCapture, onCancel }) {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission, requestPermission]);

  const takePicture = async () => {
    if (!cameraRef.current) return;

    // ✅ Take full-frame photo WITHOUT base64 first (faster + smaller memory spike)
    const photo = await cameraRef.current.takePictureAsync({
      quality: 1,
      base64: false,
      skipProcessing: Platform.OS === 'android',
    });

    const imgW = photo.width;
    const imgH = photo.height;

    // Map overlay rect (screen coords) to image pixels (best-effort)
    const scaleX = imgW / SCREEN_W;
    const scaleY = imgH / SCREEN_H;

    const PAD_Y = 36; // a little more vertical forgiveness
    const crop = {
      originX: Math.max(0, Math.round(BOX.left * scaleX)),
      originY: Math.max(0, Math.round((BOX.top - PAD_Y) * scaleY)),
      width: Math.min(imgW, Math.round(BOX.width * scaleX)),
      height: Math.min(imgH, Math.round((BOX.height + PAD_Y * 2) * scaleY)),
    };

    // 1) Cropped strip (best OCR): bigger + higher quality
    let cropped = null;
    try {
      cropped = await ImageManipulator.manipulateAsync(
        photo.uri,
        [
          { crop },
          // ✅ sharper characters without exploding payload
          { resize: { width: 1400 } },
        ],
        {
          compress: 0.88,
          base64: true,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );
    } catch (e) {
      cropped = null;
    }

    // 2) Full-frame fallback (downscaled): used only if server can't read the crop
    // Keep this modest so it doesn’t blow payload/tokens.
    const full = await ImageManipulator.manipulateAsync(
      photo.uri,
      [{ resize: { width: 1600 } }],
      {
        compress: 0.75,
        base64: true,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );

    onCapture?.({
      uri: (cropped && cropped.uri) || photo.uri,
      base64: (cropped && cropped.base64) || full.base64,
      fullBase64: full.base64, // ✅ NEW: send this to backend as fallback
      width: (cropped && cropped.width) || imgW,
      height: (cropped && cropped.height) || imgH,
      // Keep some originals handy if you were using them elsewhere
      original: { uri: photo.uri, width: photo.width, height: photo.height },
    });
  };

  if (!permission?.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Camera permission is required.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFillObject}
        facing="back"
        enableTorch={false}
      />

      {/* Overlay rectangle (the crop target) */}
      <View style={styles.rectangle} />

      {/* Capture */}
      <TouchableOpacity onPress={takePicture} style={styles.snapButton} activeOpacity={0.9}>
        <Text style={styles.snapText}>📸 Capture VIN</Text>
      </TouchableOpacity>

      {/* Cancel */}
      <TouchableOpacity onPress={onCancel} style={styles.cancelButton} activeOpacity={0.9}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative', backgroundColor: 'black' },
  rectangle: {
    position: 'absolute',
    top: BOX.top,
    left: BOX.left,
    width: BOX.width,
    height: BOX.height,
    borderColor: 'lime',
    borderWidth: 2,
    borderRadius: 8,
    zIndex: 10,
  },
  snapButton: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    backgroundColor: '#222',
    padding: 14,
    borderRadius: 10,
    zIndex: 20,
  },
  snapText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelButton: { position: 'absolute', top: 40, right: 20, padding: 10, zIndex: 20 },
  cancelText: { color: '#ccc', fontSize: 16, fontWeight: '700' },
  permissionContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  permissionText: { color: '#fff', fontSize: 16 },
});