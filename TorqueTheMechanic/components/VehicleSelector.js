// VehicleSelector.js
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  Alert,
  TextInput,
  SafeAreaView,
  Image,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import {
  RewardedAd,
  RewardedAdEventType,
} from 'react-native-google-mobile-ads';

import { getAllVehicles, deleteVehicleByVin, saveVehicle } from '../utils/VehicleStorage';

// ---------- CONFIG ----------
const API_BASE = 'http://192.168.1.246:3001';

const adUnitId = __DEV__
  ? Platform.OS === 'ios'
    ? 'ca-app-pub-3940256099942544/1712485313' // iOS test rewarded ad unit ID
    : 'ca-app-pub-3940256099942544/5224354917' // Android test rewarded ad unit ID
  : 'your-real-admob-id-here'; // <- replace for production

// ---------- VIN HELPERS ----------
const normalizeVin = (str = '') =>
  String(str)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[IOQ]/g, '');

const isValidVin = (vin = '') => /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);

// ---------- STATIC IMAGES ----------
const vinLocations = [
  { id: '1', label: 'Registration Card', image: require('../assets/vin_registration_card.png') },
  { id: '2', label: 'Insurance Document', image: require('../assets/vin_insurance.png') },
  { id: '3', label: 'Driver-Side Door Sticker', image: require('../assets/vin_door_sticker.png') },
  { id: '4', label: 'Windshield Corner', image: require('../assets/vin_windshield.png') },
];

// ---------- COMPONENT ----------
export default function VehicleSelector({
  selectedVehicle = null,
  onSelectVehicle,
  triggerVinCamera,
  onShowRewardedAd,     // optional: provide parent ad helper; must resolve true ONLY on earned reward
  gateCameraWithAd = false, // set true if you also want to gate camera with ad
}) {
  // UI state
  const [modalVisible, setModalVisible] = useState(false);
  const [showVinModal, setShowVinModal] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // Garage state
  const [vehicles, setVehicles] = useState([]);

  // Edit state
  const [editableVehicle, setEditableVehicle] = useState(null);

  // Typed VIN
  const [typedVin, setTypedVin] = useState('');
  const [adLoading, setAdLoading] = useState(false);
  const [decoding, setDecoding] = useState(false);

  // Animations
  const scrollRef = useRef(null);
  const modalOpacity = useSharedValue(0);
  const modalTranslateY = useSharedValue(100);

  useEffect(() => {
    if (modalVisible) loadGarage();
  }, [modalVisible]);

  useEffect(() => {
    const isOpen = modalVisible || showVinModal || editMode;
    modalOpacity.value = withTiming(isOpen ? 1 : 0, { duration: 250 });
    modalTranslateY.value = withSpring(isOpen ? 0 : 100, { damping: 18, stiffness: 120 });
  }, [modalVisible, showVinModal, editMode]);

  useEffect(() => {
    if (showVinModal && scrollRef.current) {
      scrollRef.current.scrollTo({ y: 0, animated: false });
    }
  }, [showVinModal]);

  const animatedModalStyle = useAnimatedStyle(() => ({
    opacity: modalOpacity.value,
    transform: [{ translateY: modalTranslateY.value }],
  }));

  const loadGarage = async () => {
    const saved = await getAllVehicles();
    setVehicles(saved.reverse());
  };

  // ---------- Ad fallback (used if parent doesn't provide onShowRewardedAd) ----------
  const showRewardedAdFallback = () =>
    new Promise((resolve) => {
      try {
        const rewarded = RewardedAd.createForAdRequest(adUnitId, {
          requestNonPersonalizedAdsOnly: true,
        });

        const cleanup = () => rewarded.removeAllListeners();

        // Timeout safety
        const timeoutId = setTimeout(() => {
          cleanup();
          resolve(false);
        }, 15000);

        rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
          try {
            rewarded.show();
          } catch {
            clearTimeout(timeoutId);
            cleanup();
            resolve(false);
          }
        });

        rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
          clearTimeout(timeoutId);
          cleanup();
          resolve(true);
        });

        // If the SDK exposes CLOSED, treat it as no reward
        if (RewardedAdEventType.CLOSED) {
          rewarded.addAdEventListener(RewardedAdEventType.CLOSED, () => {
            clearTimeout(timeoutId);
            cleanup();
            resolve(false);
          });
        }

        // Error path
        if (RewardedAdEventType.ERROR) {
          rewarded.addAdEventListener(RewardedAdEventType.ERROR, () => {
            clearTimeout(timeoutId);
            cleanup();
            resolve(false);
          });
        }

        rewarded.load();
      } catch {
        resolve(false);
      }
    });

  // ---------- Camera VIN flow (optionally gated) ----------
  const handleAddNew = () => {
    setModalVisible(false);
    setShowVinModal(true);
  };

  const handleCaptureVin = async () => {
    if (gateCameraWithAd) {
      setAdLoading(true);
      const rewarded = onShowRewardedAd
        ? await onShowRewardedAd()
        : await showRewardedAdFallback();
      setAdLoading(false);
      if (!rewarded) {
        Alert.alert('Ad Required', 'Please watch the full ad to use the VIN camera.');
        return;
      }
    }
    setShowVinModal(false);
    triggerVinCamera();
  };

  // ---------- Typed VIN flow (always gated) ----------
  const handleDecodeTypedVin = async () => {
    const vin = normalizeVin(typedVin);
    if (!isValidVin(vin)) {
      Alert.alert('Invalid VIN', 'VIN must be 17 characters (letters & numbers, no I/O/Q).');
      return;
    }

    // 1) Ad must reward first
    setAdLoading(true);
    try {
      const rewarded = onShowRewardedAd
        ? await onShowRewardedAd()
        : await showRewardedAdFallback();

      if (!rewarded) {
        setAdLoading(false);
        Alert.alert('Ad Required', 'Please watch the full ad to unlock VIN decoding.');
        return;
      }
    } catch {
      setAdLoading(false);
      Alert.alert('Ad Error', 'Could not show the rewarded ad.');
      return;
    }
    setAdLoading(false);

    // 2) Decode after reward
    setDecoding(true);
    try {
      const resp = await fetch(`${API_BASE}/decode-vin-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vin }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${resp.status}`);
      }
      const { vehicle } = await resp.json();
      if (!vehicle || !vehicle.vin || !vehicle.make || !vehicle.model) {
        throw new Error('VIN decoded but missing key fields.');
      }

      await saveVehicle(vehicle);
      setVehicles(prev => [vehicle, ...prev]);
      onSelectVehicle(vehicle);

      const name = `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim();
      Alert.alert(`✅ ${name} added to garage`, vehicle.engine || '');
      setShowVinModal(false);
      setTypedVin('');
    } catch (e) {
      Alert.alert('❌ VIN Decode Failed', e.message || 'Please check the VIN and try again.');
    } finally {
      setDecoding(false);
    }
  };

  // ---------- Edit ----------
  const handleDelete = async (vin) => {
    Alert.alert('Delete Vehicle?', 'This will remove it from your garage.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteVehicleByVin(vin);
          const updatedList = vehicles.filter(v => v.vin !== vin);
          setVehicles(updatedList);
          if (selectedVehicle?.vin === vin) onSelectVehicle(null);
        },
      },
    ]);
  };

  const handleEdit = (vehicle) => {
    setModalVisible(false);
    setTimeout(() => {
      let city = '';
      let highway = '';
      if (vehicle.mpg && typeof vehicle.mpg === 'string') {
        const match = vehicle.mpg.match(/(\d+)\s*city\s*\/\s*(\d+)\s*highway/);
        if (match) {
          city = match[1];
          highway = match[2];
        }
      }
      setEditableVehicle({
        ...vehicle,
        mpgCity: city,
        mpgHighway: highway,
        transmission: vehicle.transmission || 'Automatic',
      });
      setEditMode(true);
    }, 300);
  };

  const handleSaveEdit = async () => {
    const updatedVehicle = {
      ...editableVehicle,
      mpg:
        editableVehicle.mpgCity && editableVehicle.mpgHighway
          ? `${editableVehicle.mpgCity} city / ${editableVehicle.mpgHighway} highway`
          : editableVehicle.mpg || '',
    };
    delete updatedVehicle.mpgCity;
    delete updatedVehicle.mpgHighway;

    await saveVehicle(updatedVehicle);
    const updatedList = vehicles.map(v => (v.vin === updatedVehicle.vin ? updatedVehicle : v));
    setVehicles(updatedList);
    if (selectedVehicle?.vin === updatedVehicle.vin) {
      onSelectVehicle(updatedVehicle);
    }
    setEditMode(false);
    setEditableVehicle(null);
  };

  // ---------- Render helpers ----------
  const renderMpg = (mpg) => {
    if (!mpg || typeof mpg !== 'string') return '--/--';
    const match = mpg.match(/(\d+)\s*city\s*\/\s*(\d+)\s*highway/);
    return match ? `${match[1]}/${match[2]}` : '--/--';
  };

  const renderVehicle = ({ item }) => (
    <TouchableOpacity
      style={styles.vehicleCard}
      onPress={() => {
        onSelectVehicle(item);
        setModalVisible(false);
      }}
    >
      <Text style={styles.title}>{item.year} {item.make} {item.model}</Text>
      <Text style={styles.details}>
        {item.engine || '—'} • {item.transmission || '—'} • {item.hp || '--'} HP • {renderMpg(item.mpg)} MPG • GVW {item.gvw || '--'}
      </Text>
      <View style={styles.inlineBtns}>
        <TouchableOpacity onPress={() => handleEdit(item)} style={styles.actionBtn}>
          <Text style={styles.smallText}>✏️ Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDelete(item.vin)} style={styles.actionBtn}>
          <Text style={styles.smallText}>🗑️ Delete</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  // ---------- UI ----------
  return (
    <View style={styles.container}>
      {selectedVehicle ? (
        <TouchableOpacity style={styles.selectedCard} onPress={() => setModalVisible(true)}>
          <Text style={styles.title}>{selectedVehicle.year} {selectedVehicle.make}</Text>
          <Text style={styles.details}>{selectedVehicle.model} ({selectedVehicle.engine})</Text>
          <Text style={styles.stats}>
            • MPG: {renderMpg(selectedVehicle.mpg)} • HP: {selectedVehicle.hp || '--'} • GVW: {selectedVehicle.gvw || '--'}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.placeholder} onPress={() => setShowVinModal(true)}>
          <Text style={styles.plus}>+</Text>
          <Text style={styles.label}>Add Your Vehicle</Text>
        </TouchableOpacity>
      )}

      {/* Garage modal */}
      <Modal visible={modalVisible} animationType="slide">
        <Animated.View style={[styles.EditModalContainer, animatedModalStyle]}>
          <SafeAreaView style={styles.modalContainer}>
            <TouchableOpacity style={styles.closeIconMod} onPress={() => setModalVisible(false)}>
              <Text style={styles.closeIconTextMod}>✖</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Your Garage</Text>
            <FlatList
              data={vehicles}
              keyExtractor={(item) => item.vin || Math.random().toString()}
              renderItem={renderVehicle}
              contentContainerStyle={{ paddingBottom: 40 }}
            />
            <TouchableOpacity style={styles.addNewButton} onPress={handleAddNew}>
              <Text style={styles.addNewText}>+ Add Vehicle +</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </Animated.View>
      </Modal>

      {/* Add Vehicle modal */}
      <Modal visible={showVinModal} animationType="none" transparent>
        <Animated.View style={[styles.vinModalContainer, animatedModalStyle]}>
          <SafeAreaView style={styles.vinModalContent}>
            <ScrollView ref={scrollRef} contentContainerStyle={styles.vinScrollContent} keyboardShouldPersistTaps="handled">
              <TouchableOpacity onPress={() => setShowVinModal(false)} style={styles.closeIcon}>
                <Text style={styles.closeIconText}>✖</Text>
              </TouchableOpacity>

              <Text style={styles.modalTitle}>Add Your Vehicle</Text>

              {/* Camera option (optionally gated) */}
              <TouchableOpacity
                style={[styles.optionButton, (adLoading) && { opacity: 0.7 }]}
                onPress={handleCaptureVin}
                disabled={adLoading}
                activeOpacity={0.9}
              >
                {adLoading ? (
                  <ActivityIndicator color="#0f172a" />
                ) : (
                  <>
                    <Text style={styles.optionButtonText}>📷 Snap VIN Photo</Text>
                    <Text style={styles.optionSubText}>
                      {gateCameraWithAd ? 'Watch an ad, then use the VIN camera.' : 'Fastest way to add your car.'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Typed VIN entry (always gated by ad) */}
              <View style={{ width: '100%', marginTop: 10 }}>
                <Text style={styles.sectionTitle}>Or Type Your VIN</Text>
                <Text style={styles.helperText}>Enter the full 17-character VIN (no I/O/Q). We’ll verify it after an ad.</Text>
                <TextInput
                  value={typedVin}
                  onChangeText={setTypedVin}
                  placeholder="e.g., 1HGCM82633A004352"
                  placeholderTextColor="#7b8794"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={[styles.input, { letterSpacing: 1.2, textAlign: 'center', fontSize: 16 }]}
                  maxLength={25}
                />
                <TouchableOpacity
                  style={[
                    styles.decodeBtn,
                    (!isValidVin(normalizeVin(typedVin)) || decoding || adLoading) && styles.decodeBtnDisabled,
                  ]}
                  onPress={handleDecodeTypedVin}
                  disabled={!isValidVin(normalizeVin(typedVin)) || decoding || adLoading}
                  activeOpacity={0.9}
                >
                  {adLoading ? (
                    <ActivityIndicator color="#0f172a" />
                  ) : decoding ? (
                    <Text style={styles.decodeBtnText}>Decoding…</Text>
                  ) : (
                    <Text style={styles.decodeBtnText}>🎟️ Watch Ad & Decode</Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* VIN help & locations */}
              <Text style={styles.modalSubtitle}>What’s a VIN?</Text>
              <Text style={styles.helperText}>
                A VIN (Vehicle Identification Number) is a unique 17-digit code that identifies your car.
              </Text>

              <Text style={styles.sectionTitle}>Where to Find Your VIN</Text>
              {vinLocations.map((item) => (
                <View key={item.id} style={styles.vinCardWrapper}>
                  <View style={styles.vinCardStacked}>
                    <Text style={styles.vinLabelLarge}>{item.label}</Text>
                    <Image source={item.image} style={styles.vinImageLarge} />
                  </View>
                </View>
              ))}
              <Text style={[styles.helperText, { marginTop: 12 }]}>
                Snap a clear photo of any of these VIN locations, and we’ll do the rest. 🚗
              </Text>
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </Modal>

      {/* Edit modal */}
      {editMode && editableVehicle && (
        <Modal visible={editMode} animationType="slide">
          <Animated.View style={[styles.EditModalContainer, animatedModalStyle]}>
            <TouchableOpacity onPress={() => setEditMode(false)} style={styles.closeIconMod}>
              <Text style={styles.closeIconTextMod}>✖</Text>
            </TouchableOpacity>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>Edit Vehicle</Text>
              {[
                { key: 'year', label: 'Year' },
                { key: 'make', label: 'Make' },
                { key: 'model', label: 'Model' },
                { key: 'engine', label: 'Engine' },
                { key: 'transmission', label: 'Transmission' },
                { key: 'mpgCity', label: 'MPG (City)' },
                { key: 'mpgHighway', label: 'MPG (Highway)' },
                { key: 'hp', label: 'Horsepower (HP)' },
                { key: 'gvw', label: 'GVW (Gross Vehicle Weight)' },
              ].map(({ key, label }) => (
                <View key={key} style={{ marginBottom: 12 }}>
                  <Text style={styles.inputLabel}>{label}</Text>
                  {key === 'transmission' ? (
                    <View style={styles.transmissionSelector}>
                      <TouchableOpacity
                        style={[
                          styles.transmissionButton,
                          editableVehicle.transmission === 'Automatic' && styles.transmissionButtonSelected,
                        ]}
                        onPress={() => setEditableVehicle({ ...editableVehicle, transmission: 'Automatic' })}
                      >
                        <Text
                          style={[
                            styles.transmissionButtonText,
                            editableVehicle.transmission === 'Automatic' && styles.transmissionButtonTextSelected,
                          ]}
                        >
                          Automatic
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.transmissionButton,
                          editableVehicle.transmission === 'Manual' && styles.transmissionButtonSelected,
                        ]}
                        onPress={() => setEditableVehicle({ ...editableVehicle, transmission: 'Manual' })}
                      >
                        <Text
                          style={[
                            styles.transmissionButtonText,
                            editableVehicle.transmission === 'Manual' && styles.transmissionButtonTextSelected,
                          ]}
                        >
                          Manual
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TextInput
                      style={styles.input}
                      placeholder={label}
                      placeholderTextColor="#777"
                      value={editableVehicle[key]?.toString() || ''}
                      onChangeText={(text) => setEditableVehicle({ ...editableVehicle, [key]: text })}
                    />
                  )}
                </View>
              ))}
              <TouchableOpacity onPress={handleSaveEdit} style={styles.addNewButton}>
                <Text style={styles.addNewText}>💾 Save Changes</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Modal>
      )}
    </View>
  );
}

// ---------- STYLES ----------
const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: 20,
    alignSelf: 'center',
  },
  placeholder: {
    backgroundColor: '#444',
    padding: 32,
    borderRadius: 15,
    alignItems: 'center',
    borderColor: '#888',
    borderWidth: 1,
  },
  plus: { fontSize: 40, color: '#ccc' },
  label: { fontSize: 16, color: '#aaa', marginTop: 8 },
  selectedCard: {
    backgroundColor: '#333',
    padding: 28,
    borderRadius: 15,
    alignItems: 'center',
  },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  details: { fontSize: 14, color: '#ccc', marginVertical: 4 },
  stats: { fontSize: 12, color: '#aaa' },

  // Modals
  modalContainer: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 30,
    paddingTop: 50,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
    alignSelf: 'center',
  },
  modalSubtitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#eee',
    marginTop: 10,
    marginBottom: 6,
    textAlign: 'center',
  },

  vehicleCard: {
    backgroundColor: '#222',
    padding: 20,
    marginBottom: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  inlineBtns: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 10,
  },
  actionBtn: {
    padding: 10,
    backgroundColor: '#333',
    borderRadius: 10,
  },
  smallText: { fontSize: 16, color: '#fff' },

  addNewButton: {
    marginTop: 30,
    padding: 16,
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    alignItems: 'center',
    width: '80%',
    alignSelf: 'center',
  },
  addNewText: { color: '#fff', fontSize: 17 },

  vinModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 50,
  },
  vinModalContent: {
    backgroundColor: 'rgba(0,0,0,0.9)',
    borderRadius: 20,
    width: '92%',
    maxHeight: '94%',
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  vinScrollContent: {
    paddingBottom: 60,
    alignItems: 'center',
  },
  closeIcon: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    backgroundColor: '#fff',
    borderRadius: 20,
  },
  closeIconText: {
    fontSize: 22,
    color: '#000',
    fontWeight: 'bold',
  },
  optionButton: {
    backgroundColor: '#22c55e',
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderRadius: 14,
    marginBottom: 18,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 3,
  },
  optionButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '600',
  },
  optionSubText: {
    color: '#14532d',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  helperText: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    marginVertical: 10,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 18,
    color: '#eee',
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 8,
    textAlign: 'center',
  },
  vinCardWrapper: { width: '100%' },
  vinCardStacked: {
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 20,
    borderRadius: 16,
    marginBottom: 20,
    width: '100%',
  },
  vinImageLarge: {
    width: '100%',
    height: 180,
    resizeMode: 'contain',
    marginTop: 12,
    borderRadius: 8,
  },
  vinLabelLarge: {
    fontSize: 16,
    fontWeight: '500',
    color: '#e2e8f0',
    textAlign: 'center',
  },

  inputLabel: {
    color: '#ccc',
    marginBottom: 4,
    fontSize: 14,
  },
  input: {
    backgroundColor: '#222',
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    borderColor: '#444',
    borderWidth: 1,
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

  EditModalContainer: {
    width: '100%',
    height: '100%',
  },
  closeIconMod: {
    position: 'absolute',
    right: 16,
    top: 50,
    zIndex: 10,
    backgroundColor: '#fff',
    borderRadius: 20,
  },
  closeIconTextMod: {
    fontSize: 22,
    color: '#000',
    fontWeight: 'bold',
  },

  decodeBtn: {
    marginTop: 10,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#22c55e',
  },
  decodeBtnDisabled: {
    opacity: 0.6,
  },
  decodeBtnText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '700',
  },
});
