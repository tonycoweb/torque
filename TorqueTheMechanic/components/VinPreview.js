// components/VinPreview.js
import React from 'react';
import { View, Image, TouchableOpacity, Text, StyleSheet } from 'react-native';

export default function VinPreview({ photo, onConfirm, onRetake }) {
  return (
    <View style={styles.container}>
      <Image source={{ uri: photo.uri }} style={styles.image} resizeMode="contain" />

      <View style={styles.buttonRow}>
        <TouchableOpacity onPress={onRetake} style={styles.retakeButton}>
          <Text style={styles.buttonText}>🔁 Retake</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onConfirm} style={styles.confirmButton}>
          <Text style={styles.buttonText}>✅ Use This</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  image: { flex: 1, width: '100%' },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 20,
    backgroundColor: '#111',
  },
  retakeButton: {
    padding: 12,
    backgroundColor: '#333',
    borderRadius: 10,
  },
  confirmButton: {
    padding: 12,
    backgroundColor: '#4CAF50',
    borderRadius: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
  },
});
