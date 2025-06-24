// components/VinCamera.js
import React, { useRef, useEffect } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Dimensions } from 'react-native';
import {
  CameraView,
  useCameraPermissions,
} from 'expo-camera';

export default function VinCamera({ onCapture, onCancel }) {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission]);

  const takePicture = async () => {
    if (cameraRef.current) {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: true,
      });
      onCapture(photo);
    }
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
      
      {/* Overlay rectangle */}
      <View style={styles.rectangle} />

      {/* Capture button */}
      <TouchableOpacity onPress={takePicture} style={styles.snapButton}>
        <Text style={styles.snapText}>📸 Capture VIN</Text>
      </TouchableOpacity>

      {/* Cancel button */}
      <TouchableOpacity onPress={onCancel} style={styles.cancelButton}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const { width, height } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    backgroundColor: 'black',
  },
  rectangle: {
    position: 'absolute',
    top: height / 2 - 80,
    left: width * 0.1,
    width: width * 0.8,
    height: 100,
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
  snapText: {
    color: '#fff',
    fontSize: 16,
  },
  cancelButton: {
    position: 'absolute',
    top: 40,
    right: 20,
    padding: 10,
    zIndex: 20,
  },
  cancelText: {
    color: '#ccc',
    fontSize: 16,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  permissionText: {
    color: '#fff',
    fontSize: 16,
  },
});
