// components/TorqueModeToggle.js
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function TorqueModeToggle({ mode = 'lite', onToggle, disabled = false }) {
  const isSearch = mode === 'torque_search';

  return (
    <TouchableOpacity
      style={[styles.pill, isSearch && styles.pillSearch, disabled && { opacity: 0.55 }]}
      onPress={onToggle}
      disabled={disabled}
      activeOpacity={0.9}
    >
      <View style={[styles.iconWrap, isSearch && styles.iconWrapSearch]}>
        <MaterialCommunityIcons
          name={isSearch ? 'web' : 'flash-outline'}
          size={15}
          color={isSearch ? '#07110a' : '#f8fafc'}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>Mode</Text>
        <Text style={[styles.value, isSearch && styles.valueSearch]} numberOfLines={1}>
          {isSearch ? 'Torque Search' : 'Regular Lite'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    minWidth: 150,
    height: 48,
    borderRadius: 999,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f1f1f',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  pillSearch: {
    backgroundColor: 'rgba(34,197,94,0.16)',
    borderColor: 'rgba(34,197,94,0.50)',
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  iconWrapSearch: {
    backgroundColor: '#22c55e',
  },
  label: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    marginTop: 1,
  },
  valueSearch: {
    color: '#dcfce7',
  },
});
