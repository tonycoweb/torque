import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function HomeHeader({ garageName, setGarageName }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [inputName, setInputName] = useState('');

  useEffect(() => {
    const loadName = async () => {
      try {
        const savedName = await AsyncStorage.getItem('garageName');
        if (savedName) {
          setGarageName(savedName);
        }
      } catch (err) {
        console.error('Failed to load garage name:', err);
      }
    };
    loadName();
  }, []);

  const handleSave = async () => {
    const trimmedName = inputName.trim();
    if (trimmedName) {
      setGarageName(trimmedName);
      await AsyncStorage.setItem('garageName', trimmedName);
    }
    setModalVisible(false);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => setModalVisible(true)}>
        <Text style={styles.dots}>⋯</Text>
      </TouchableOpacity>

      <Text style={styles.title}>
        {garageName ? `${garageName}'s Garage` : 'Garage'}
      </Text>

      <TouchableOpacity>
        <Ionicons name="settings-outline" size={24} color="#fff" />
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalWrapper}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Enter Your Name</Text>
            <TextInput
              value={inputName}
              onChangeText={setInputName}
              placeholder="e.g. Tony"
              style={styles.input}
              placeholderTextColor="#aaa"
            />
            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 20,
  },
  dots: {
    fontSize: 26,
    color: '#fff',
  },
  title: {
    fontSize: 20,
    color: '#fff',
    fontWeight: '600',
  },
  modalWrapper: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalBox: {
    margin: 30,
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 12,
  },
  input: {
    width: '100%',
    borderBottomWidth: 1,
    borderBottomColor: '#555',
    color: '#fff',
    paddingVertical: 8,
    fontSize: 16,
    marginBottom: 20,
  },
  saveButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  saveText: {
    color: '#fff',
    fontWeight: '600',
  },
});
