// components/EnergyPill.js
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function EnergyPill({ energy, loading }) {
  const value = typeof energy === 'number' ? energy : null;

  return (
    <View style={[styles.wrap, value === 0 && styles.zero]}>
      <Text style={styles.label}>Energy</Text>
      <Text style={styles.value}>
        {loading ? '…' : value === null ? '--' : value.toLocaleString()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#1f1f1f',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  zero: {
    borderColor: 'rgba(255,102,102,0.55)',
    backgroundColor: 'rgba(255,102,102,0.10)',
  },
  label: {
    color: '#cfcfcf',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  value: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
});
