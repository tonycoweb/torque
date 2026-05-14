// components/SettingsModal.js
import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Linking, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function SettingsModal({ visible, onClose, onOpenShop, onOpenAccount }) {
  const handlePress = (label) => {
    switch (label) {
      case 'Account':
        onOpenAccount?.();
        break;
      case 'Shop':
        onOpenShop?.();
        break;
      case 'Questions / Feedback':
        Linking.openURL('mailto:support@yourapp.com');
        break;
      case 'Credits & Attributions':
        Alert.alert('Credits', 'Icons by MaterialCommunityIcons\nImages from your app assets\nTorque responses powered by your backend.');
        break;
      default:
        console.log(`Tapped: ${label}`);
    }
  };

  const settings = [
    {
      label: 'Account',
      icon: 'account-circle',
      sub: 'Expertise level, local account, and response style',
      color: '#22c55e',
    },
    {
      label: 'Shop',
      icon: 'cart',
      sub: 'Energy packs and extra vehicle slots',
      color: '#FFD700',
      badge: 'Energy & Slots',
    },
    {
      label: 'Questions / Feedback',
      icon: 'comment-question',
      sub: 'Send support a message',
      color: '#22c55e',
    },
    {
      label: 'Credits & Attributions',
      icon: 'information',
      sub: 'Libraries, assets, and app credits',
      color: '#22c55e',
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <View style={styles.headerIcon}>
              <MaterialCommunityIcons name="cog" size={24} color="#22c55e" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Settings</Text>
              <Text style={styles.subtitle}>Tune the app, account, and Torque experience.</Text>
            </View>
          </View>

          {settings.map(({ label, icon, sub, color, badge }) => (
            <TouchableOpacity key={label} style={styles.option} onPress={() => handlePress(label)} activeOpacity={0.86}>
              <View style={[styles.optionIcon, { borderColor: `${color}55`, backgroundColor: `${color}18` }]}>
                <MaterialCommunityIcons name={icon} size={24} color={color} />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{label}</Text>
                <Text style={styles.optionSub}>{sub}</Text>
              </View>

              {badge ? <Text style={styles.badge}>{badge}</Text> : null}
              <MaterialCommunityIcons name="chevron-right" size={22} color="rgba(255,255,255,0.42)" />
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.86}>
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
    backgroundColor: 'rgba(0,0,0,0.76)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  container: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#161616',
    padding: 18,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.28)',
  },
  title: { fontSize: 24, color: '#fff', fontWeight: '900' },
  subtitle: { color: '#aeb7c4', fontSize: 13, marginTop: 2, fontWeight: '700' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 18,
    backgroundColor: '#242424',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 10,
    gap: 10,
  },
  optionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  label: { color: '#fff', fontSize: 16, fontWeight: '900' },
  optionSub: { color: '#9aa5b1', fontSize: 12.5, fontWeight: '700', marginTop: 2 },
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
    marginTop: 6,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingVertical: 13,
    borderRadius: 16,
    alignItems: 'center',
  },
  closeText: { color: '#fff', fontSize: 16, fontWeight: '900' },
});
