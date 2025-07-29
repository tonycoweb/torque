import React, { useState, useEffect, useRef } from 'react';
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
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
} from 'react-native-reanimated';

export default function ManualVehicleEntry({ onClose, onSave }) {
  const [inputs, setInputs] = useState({
    year: '',
    make: '',
    model: '',
    engine: '',
    transmission: 'Automatic',
    drive_type: '',
    body_style: '',
    fuel_type: '',
    mpg: '',
    horsepower: '',
    gvw: '',
    trim: '',
    vin: '',
  });
  const [dropdowns, setDropdowns] = useState({});
  const [dropdownOpen, setDropdownOpen] = useState({});
  const [loading, setLoading] = useState(false);
  const [baseVehicle, setBaseVehicle] = useState(null);
  const [variants, setVariants] = useState([]);
  const scrollViewRef = useRef(null);
  const inputRefs = useRef({});

  const modalOpacity = useSharedValue(0);
  const modalTranslateY = useSharedValue(100);

  useEffect(() => {
    modalOpacity.value = withTiming(1, { duration: 250 });
    modalTranslateY.value = withSpring(0, { damping: 18, stiffness: 120 });
  }, []);

  const animatedModalStyle = useAnimatedStyle(() => ({
    opacity: modalOpacity.value,
    transform: [{ translateY: modalTranslateY.value }],
  }));

  const handleChange = (key, value) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
    setDropdowns((prev) => ({ ...prev, [key]: undefined }));
    setDropdownOpen((prev) => ({ ...prev, [key]: false }));
  };

  const handleSubmit = async () => {
    // Validate required fields
    const requiredFields = ['year', 'make', 'model'];
    const missingFields = requiredFields.filter((key) => !inputs[key]?.trim());
    if (missingFields.length > 0) {
      Alert.alert('Error', `Please fill in: ${missingFields.join(', ')}`);
      return;
    }

    setLoading(true);
    try {
      console.log('Sending validation request with:', inputs);
      const response = await fetch('http://192.168.1.246:3001/validate-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Validation failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData.error || 'Unknown error',
        });
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Validation response:', data);

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
          Alert.alert('Success', 'Vehicle validated and saved!');
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
        Alert.alert('Error', 'No valid result returned from server.');
      }
    } catch (err) {
      console.error('Network request error:', {
        message: err.message,
        name: err.name,
        stack: err.stack,
      });
      Alert.alert('Error', `Failed to validate vehicle: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleVariantSelect = async (variant) => {
    const finalVehicle = { ...baseVehicle, ...variant };
    delete finalVehicle.variants;
    console.log('Saving vehicle:', finalVehicle);
    onSave(finalVehicle);
  };

  const handleInputFocus = (key) => {
    if (inputRefs.current[key]) {
      inputRefs.current[key].measureLayout(
        scrollViewRef.current.getScrollableNode(),
        (x, y) => {
          scrollViewRef.current.scrollTo({ y, animated: true });
        },
        () => {
          console.warn(`Failed to measure layout for ${key}`);
        }
      );
    }
  };

  const renderInputOrDropdown = (key) => {
    if (dropdowns[key]) {
      return (
        <View key={key} style={styles.dropdownContainer}>
          <Text style={styles.inputLabel}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
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

    if (key === 'transmission') {
      return (
        <View key={key} style={styles.dropdownContainer}>
          <Text style={styles.inputLabel}>Transmission</Text>
          <View style={styles.transmissionSelector}>
            <TouchableOpacity
              style={[
                styles.transmissionButton,
                inputs.transmission === 'Automatic' && styles.transmissionButtonSelected,
              ]}
              onPress={() => handleChange('transmission', 'Automatic')}
            >
              <Text
                style={[
                  styles.transmissionButtonText,
                  inputs.transmission === 'Automatic' && styles.transmissionButtonTextSelected,
                ]}
              >
                Automatic
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.transmissionButton,
                inputs.transmission === 'Manual' && styles.transmissionButtonSelected,
              ]}
              onPress={() => handleChange('transmission', 'Manual')}
            >
              <Text
                style={[
                  styles.transmissionButtonText,
                  inputs.transmission === 'Manual' && styles.transmissionButtonTextSelected,
                ]}
              >
                Manual
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <View key={key} style={styles.dropdownContainer}>
        <Text style={styles.inputLabel}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
        <TextInput
          style={styles.input}
          placeholder={key.charAt(0).toUpperCase() + key.slice(1)}
          placeholderTextColor="#aaa"
          value={inputs[key]}
          onChangeText={(text) => handleChange(key, text)}
          ref={(ref) => (inputRefs.current[key] = ref)}
          onFocus={() => handleInputFocus(key)}
        />
      </View>
    );
  };

  return (
    <Animated.View style={[styles.container, animatedModalStyle]}>
      <SafeAreaView style={styles.modalContent}>
        <TouchableOpacity onPress={onClose} style={styles.closeIcon}>
          <Text style={styles.closeIconText}>✖</Text>
        </TouchableOpacity>
        <Text style={styles.modalTitle}>Add Vehicle Manually</Text>
        {!variants.length ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            <ScrollView
              ref={scrollViewRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 100 }}
            >
              {Object.keys(inputs).map((key) => renderInputOrDropdown(key))}
              <TouchableOpacity
                style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                onPress={handleSubmit}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>Validate</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        ) : (
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
        )}
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 30,
    paddingTop: 50,
  },
  modalContent: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
    alignSelf: 'center',
  },
  closeIcon: {
    position: 'absolute',
    right: 16,
    top: 50,
    zIndex: 10,
    backgroundColor: '#fff',
    borderRadius: 20,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIconText: {
    fontSize: 22,
    color: '#000',
    fontWeight: 'bold',
  },
  input: {
    backgroundColor: '#222',
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    borderColor: '#444',
    borderWidth: 1,
  },
  inputLabel: {
    color: '#ccc',
    marginBottom: 4,
    fontSize: 14,
  },
  dropdownContainer: {
    marginBottom: 14,
  },
  dropdown: {
    backgroundColor: '#222',
    padding: 12,
    borderRadius: 8,
    borderColor: '#444',
    borderWidth: 1,
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
  transmissionSelector: {
    flexDirection: 'row',
    backgroundColor: '#222',
    borderRadius: 8,
    borderColor: '#444',
    borderWidth: 1,
    height: 44,
    overflow: 'hidden',
  },
  transmissionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222',
  },
  transmissionButtonSelected: {
    backgroundColor: '#4CAF50',
  },
  transmissionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  transmissionButtonTextSelected: {
    color: '#fff',
    fontWeight: 'bold',
  },
  submitButton: {
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  submitButtonDisabled: {
    backgroundColor: '#777',
    opacity: 0.7,
  },
  submitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  variantCard: {
    backgroundColor: '#222',
    padding: 16,
    marginBottom: 14,
    borderRadius: 10,
  },
  variantText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  variantSub: {
    color: '#ccc',
    fontSize: 13,
    marginTop: 6,
  },
});