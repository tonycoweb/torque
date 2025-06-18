import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';

export default function GarageFrontEnd({ vehicle, onAddPress }) {
  const isEmpty = !vehicle;

  return (
    <View style={styles.container}>
      {isEmpty ? (
        <TouchableOpacity style={styles.placeholder} onPress={onAddPress}>
          <Text style={styles.plus}>+</Text>
          <Text style={styles.label}>Add Your Vehicle</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.card}>
          <Text style={styles.yearMake}>{vehicle.year} {vehicle.make}</Text>
          <Text style={styles.model}>{vehicle.model} ({vehicle.engine})</Text>
          <View style={styles.statsRow}>
            <Text style={styles.stat}>MPG: {vehicle.mpg}</Text>
            <Text style={styles.stat}>HP: {vehicle.hp}</Text>
            <Text style={styles.stat}>GVW: {vehicle.gvw}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: 20,
  },
  placeholder: {
    backgroundColor: '#444',
    padding: 32,
    borderRadius: 15,
    alignItems: 'center',
    borderColor: '#888',
    borderWidth: 1,
  },
  plus: {
    fontSize: 40,
    color: '#ccc',
  },
  label: {
    fontSize: 16,
    color: '#aaa',
    marginTop: 8,
  },
  card: {
    backgroundColor: '#333',
    padding: 32,
    borderRadius: 15,
    alignItems: 'center',
  },
  yearMake: {
    fontSize: 22,
    color: '#fff',
    fontWeight: 'bold',
  },
  model: {
    fontSize: 18,
    color: '#ccc',
    marginBottom: 10,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  stat: {
    fontSize: 14,
    color: '#ddd',
  },
});
