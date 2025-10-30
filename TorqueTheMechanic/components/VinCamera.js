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
  }, [permission]);

  const takePicture = async () => {
    if (!cameraRef.current) return;

    // Take a full-frame photo with base64 for cropping
    const photo = await cameraRef.current.takePictureAsync({
      quality: 0.75,
      base64: true,
      skipProcessing: Platform.OS === 'android', // faster
    });

    // Map overlay rect (screen coords) to image pixels
    // Assumes the camera fills the screen (StyleSheet.absoluteFillObject).
    // If letterboxing occurs, you can adjust with aspect calculations.
    const imgW = photo.width;
    const imgH = photo.height;

    const scaleX = imgW / SCREEN_W;
    const scaleY = imgH / SCREEN_H;

    const crop = {
      originX: Math.max(0, Math.round(BOX.left * scaleX)),
      originY: Math.max(0, Math.round(BOX.top * scaleY)),
      width: Math.min(imgW, Math.round(BOX.width * scaleX)),
      height: Math.min(imgH, Math.round(BOX.height * scaleY)),
    };

    let cropped = null;
    try {
      cropped = await ImageManipulator.manipulateAsync(
        photo.uri,
        [
          { crop },
          { resize: { width: Math.min(1200, Math.max(700, Math.round(crop.width))) } }, // light resize to help OCR
        ],
        { compress: 0.8, base64: true, format: ImageManipulator.SaveFormat.JPEG }
      );
    } catch (e) {
      // Fallback to original if cropping fails
      cropped = { uri: photo.uri, base64: photo.base64, width: imgW, height: imgH };
    }

    // Return both cropped (primary) and original (fallback)
    onCapture?.({
      uri: cropped.uri,
      base64: cropped.base64,
      width: cropped.width,
      height: cropped.height,
      original: { uri: photo.uri, base64: photo.base64, width: photo.width, height: photo.height },
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
      <TouchableOpacity onPress={takePicture} style={styles.snapButton}>
        <Text style={styles.snapText}>📸 Capture VIN</Text>
      </TouchableOpacity>

      {/* Cancel */}
      <TouchableOpacity onPress={onCancel} style={styles.cancelButton}>
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
  snapText: { color: '#fff', fontSize: 16 },
  cancelButton: { position: 'absolute', top: 40, right: 20, padding: 10, zIndex: 20 },
  cancelText: { color: '#ccc', fontSize: 16 },
  permissionContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  permissionText: { color: '#fff', fontSize: 16 },
});
