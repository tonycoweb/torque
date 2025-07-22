import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Linking, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function SettingsModal({ visible, onClose }) {
  const handlePress = (label) => {
    switch (label) {
      case 'Delete Account':
        Alert.alert('Confirm Delete', 'Are you sure you want to delete your account?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', onPress: () => console.log('🗑️ Delete account logic here') },
        ]);
        break;
      case 'Questions / Feedback':
        Linking.openURL('mailto:support@yourapp.com');
        break;
      case 'Credits & Attributions':
        Alert.alert('Credits', 'Icons by MaterialCommunityIcons\nImages from Unsplash\nGPT powered by OpenAI');
        break;
      default:
        console.log(`Tapped: ${label}`);
    }
  };

  const settings = [
    { label: 'Account', icon: 'account-circle' },
    { label: 'Shop', icon: 'cart' },
    { label: 'Delete Account', icon: 'delete' },
    { label: 'Questions / Feedback', icon: 'comment-question' },
    { label: 'Credits & Attributions', icon: 'information' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <Text style={styles.title}>⚙️ Settings</Text>
          {settings.map(({ label, icon }) => (
            <TouchableOpacity
              key={label}
              style={styles.option}
              onPress={() => handlePress(label)}
            >
              <MaterialCommunityIcons name={icon} size={24} color="#4CAF50" />
              <Text style={styles.label}>{label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '85%',
    backgroundColor: '#222',
    padding: 24,
    borderRadius: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    color: '#fff',
    marginBottom: 20,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 12,
  },
  label: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 10,
  },
  closeBtn: {
    marginTop: 24,
    backgroundColor: '#444',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  closeText: {
    color: '#fff',
    fontSize: 16,
  },
});
