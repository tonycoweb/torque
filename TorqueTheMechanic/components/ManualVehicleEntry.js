import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
} from 'react-native';

export default function ManualVehicleEntry({ onClose, onSave }) {
  const [inputs, setInputs] = useState({
    year: '',
    make: '',
    model: '',
    engine: '',
    transmission: '',
    drive_type: '',
    body_style: '',
    fuel_type: '',
    mpg: '',
    horsepower: '',
    gvw: '',
    trim: '',
  });

  const [dropdowns, setDropdowns] = useState({});
  const [dropdownOpen, setDropdownOpen] = useState({});
  const [loading, setLoading] = useState(false);
  const [baseVehicle, setBaseVehicle] = useState(null);
  const [variants, setVariants] = useState([]);

  const handleChange = (key, value) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
    setDropdowns((prev) => ({ ...prev, [key]: undefined }));
    setDropdownOpen((prev) => ({ ...prev, [key]: false }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/validate-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs),
      });

      const data = await response.json();
      if (data.result) {
        let raw = data.result.trim();
        if (raw.startsWith('```json')) raw = raw.replace(/^```json\s*/, '').replace(/```$/, '').trim();
        else if (raw.startsWith('`') || raw.startsWith('```')) raw = raw.replace(/^`+/, '').replace(/`+$/, '').trim();

        const result = JSON.parse(raw);

        const allFilled = Object.entries(result).every(
          ([k, v]) =>
            k === 'variants' ||
            (typeof v === 'string' && v.trim()) ||
            typeof v === 'number'
        );

        if (allFilled) {
          onSave(result);
        } else {
          const newInputs = { ...inputs };
          const newDropdowns = {};
          Object.entries(result).forEach(([key, val]) => {
            if (Array.isArray(val)) {
              newDropdowns[key] = val;
            } else {
              newInputs[key] = val;
            }
          });
          setInputs(newInputs);
          setDropdowns(newDropdowns);
          setBaseVehicle(result);
          if (result.variants) setVariants(result.variants);
        }
      } else {
        Alert.alert('Error', 'No valid result returned.');
      }
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to validate vehicle.');
    } finally {
      setLoading(false);
    }
  };

  const handleVariantSelect = async (variant) => {
    const finalVehicle = { ...baseVehicle, ...variant };
    delete finalVehicle.variants;
    onSave(finalVehicle);
  };

  const renderInputOrDropdown = (key) => {
    if (dropdowns[key]) {
      return (
        <View key={key} style={styles.dropdownContainer}>
          <TouchableOpacity
            style={styles.dropdown}
            onPress={() => setDropdownOpen((prev) => ({ ...prev, [key]: !prev[key] }))}
          >
            <Text style={styles.dropdownLabel}>{inputs[key] || `Select ${key}`}</Text>
          </TouchableOpacity>
          {dropdownOpen[key] && (
            <View style={styles.dropdownOptions}>
              {dropdowns[key].map((option) => (
                <TouchableOpacity key={option} onPress={() => handleChange(key, option)}>
                  <Text style={styles.option}>{option}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      );
    }

    return (
      <TextInput
        key={key}
        style={styles.input}
        placeholder={key.charAt(0).toUpperCase() + key.slice(1)}
        placeholderTextColor="#aaa"
        value={inputs[key]}
        onChangeText={(text) => handleChange(key, text)}
      />
    );
  };

  return (
    <View style={styles.container}>
      {!variants.length ? (
        <>
          <Text style={styles.title}>Manual Vehicle Entry</Text>
          <ScrollView style={{ flex: 1 }}>
            {Object.keys(inputs).map((key) => renderInputOrDropdown(key))}
            <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Validate</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ color: '#aaa', marginTop: 20 }}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </>
      ) : (
        <>
          <Text style={styles.title}>Select Variant</Text>
          <FlatList
            data={variants}
            keyExtractor={(_, index) => index.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.variantCard} onPress={() => handleVariantSelect(item)}>
                <Text style={styles.variantText}>
                  {inputs.year} {inputs.make} {inputs.model} — {item.trim || ''} • {item.drive_type || ''} • {item.transmission}
                </Text>
                <Text style={styles.variantSub}>
                  {item.body_style} • {item.engine} • {item.horsepower || item.hp} HP • {item.mpg?.city || '--'}/{item.mpg?.highway || '--'} MPG
                </Text>
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: '#aaa', marginTop: 20, alignSelf: 'center' }}>Cancel</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111', padding: 30 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  input: { backgroundColor: '#222', color: '#fff', padding: 12, marginBottom: 14, borderRadius: 8 },
  submitButton: { backgroundColor: '#4CAF50', padding: 16, borderRadius: 12, alignItems: 'center' },
  submitText: { color: '#fff', fontSize: 16 },

  dropdownContainer: { marginBottom: 14 },
  dropdown: {
    backgroundColor: '#222',
    padding: 12,
    borderRadius: 8,
  },
  dropdownLabel: {
    color: '#fff',
  },
  dropdownOptions: {
    backgroundColor: '#333',
    borderRadius: 6,
    marginTop: 6,
    padding: 8,
  },
  option: {
    color: '#fff',
    paddingVertical: 8,
  },

  variantCard: { backgroundColor: '#222', padding: 16, marginBottom: 14, borderRadius: 10 },
  variantText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  variantSub: { color: '#ccc', fontSize: 13, marginTop: 6 },
});
