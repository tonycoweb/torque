import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Linking, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function SettingsModal({ visible, onClose, onOpenShop }) {
  const handlePress = (label) => {
    switch (label) {
      case 'Shop':
        onOpenShop?.();
        break;
      case 'Delete Account':
        Alert.alert('Confirm Delete', 'Are you sure you want to delete your account?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => console.log('🗑️ Delete account logic here') },
        ]);
        break;
      case 'Questions / Feedback':
        Linking.openURL('mailto:support@yourapp.com');
        break;
      case 'Credits & Attributions':
        Alert.alert('Credits', 'Icons by MaterialCommunityIcons\nImages from Unsplash\nTorque responses powered by your backend.');
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <Text style={styles.title}>⚙️ Settings</Text>

          {settings.map(({ label, icon }) => (
            <TouchableOpacity key={label} style={styles.option} onPress={() => handlePress(label)} activeOpacity={0.8}>
              <MaterialCommunityIcons name={icon} size={24} color={label === 'Shop' ? '#FFD700' : '#4CAF50'} />
              <Text style={styles.label}>{label}</Text>
              {label === 'Shop' ? <Text style={styles.badge}>Energy & Slots</Text> : null}
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
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
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    fontSize: 22,
    color: '#fff',
    marginBottom: 20,
    fontWeight: '800',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  label: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 10,
    flex: 1,
    fontWeight: '700',
  },
  badge: {
    color: '#111',
    backgroundColor: '#FFD700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
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
    fontWeight: '700',
  },
});
