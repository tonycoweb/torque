// components/VehicleSelector.js
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, Alert, TextInput,
  SafeAreaView, Image, ScrollView, ActivityIndicator, Platform,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring } from 'react-native-reanimated';
import { RewardedAd, RewardedAdEventType } from 'react-native-google-mobile-ads';
import { getAllVehicles, deleteVehicleByVin, saveVehicle } from '../utils/VehicleStorage';

// ---------- CONFIG ----------
const API_BASE = 'http://192.168.1.246:3001';

const adUnitId = __DEV__
  ? (Platform.OS === 'ios'
      ? 'ca-app-pub-3940256099942544/1712485313'
      : 'ca-app-pub-3940256099942544/5224354917')
  : 'your-real-admob-id-here';

// ---------- VIN HELPERS ----------
const normalizeVin = (str = '') =>
  String(str).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[IOQ]/g, '');
const isValidVin = (vin = '') => /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);

// ✅ Ensure vehicle has a stable id
const ensureId = (v = {}) => {
  const id =
    v.id?.toString?.() ||
    (v.vin ? String(v.vin) : undefined) ||
    [v.year, v.make, v.model].filter(Boolean).join('-') ||
    undefined;
  return id ? { ...v, id } : { ...v, id: Math.random().toString(36).slice(2) };
};

// ---------- STATIC IMAGES ----------
const vinLocations = [
  { id: '1', label: 'Registration Card', image: require('../assets/vin_registration_card.png') },
  { id: '2', label: 'Insurance Document', image: require('../assets/vin_insurance.png') },
  { id: '3', label: 'Driver-Side Door Sticker', image: require('../assets/vin_door_sticker.png') },
  { id: '4', label: 'Windshield Corner', image: require('../assets/vin_windshield.png') },
];

// Tiny helper to animate "..." without extra libs (matches ServiceBox)
function AnimatedEllipsis({ style, base = 'Generating' }) {
  const [dots, setDots] = React.useState('');
  React.useEffect(() => {
    const id = setInterval(() => setDots(p => (p.length >= 3 ? '' : p + '.')), 450);
    return () => clearInterval(id);
  }, []);
  return <Text style={style}>{base}{dots}</Text>;
}

export default function VehicleSelector({
  selectedVehicle = null,
  onSelectVehicle,
  triggerVinCamera,        // ✅ passed from App to open camera
  onShowRewardedAd,
  gateCameraWithAd = false,
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

  // Busy/overlay
  const [adLoading, setAdLoading] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [overlay, setOverlay] = useState(null); // 'thinking' | null

  // Animations
  const scrollRef = useRef(null);
  const modalOpacity = useSharedValue(0);
  const modalTranslateY = useSharedValue(100);

  // mounted guard
  const isMountedRef = useRef(true);
  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  useEffect(() => { if (modalVisible) loadGarage(); }, [modalVisible]);

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
    const withIds = (saved || []).map(ensureId).reverse();
    if (isMountedRef.current) setVehicles(withIds);
  };

  // ---------- Rewarded Ad (safe, single-settle) ----------
  const showRewardedAdSafe = () =>
    new Promise((resolve) => {
      const resolveOnce = (val) => { if (!settled) { settled = true; cleanup(); resolve(val); } };
      let settled = false;
      let rewarded;
      try {
        rewarded = RewardedAd.createForAdRequest(adUnitId, { requestNonPersonalizedAdsOnly: true });
      } catch {
        return resolve(false);
      }

      const cleanup = () => {
        try { rewarded?.removeAllListeners?.(); } catch {}
      };

      const timeoutId = setTimeout(() => resolveOnce(false), 20000); // hard stop in 20s

      rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        try { rewarded.show(); } catch { /* show may throw if already closed */ }
      });
      rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        clearTimeout(timeoutId);
        resolveOnce(true);
      });
      rewarded.addAdEventListener(RewardedAdEventType.CLOSED, () => {
        clearTimeout(timeoutId);
        // If CLOSED happens without EARNED_REWARD first, consider not rewarded.
        resolveOnce(false);
      });
      rewarded.addAdEventListener(RewardedAdEventType.ERROR, () => {
        clearTimeout(timeoutId);
        resolveOnce(false);
      });

      try { rewarded.load(); } catch { clearTimeout(timeoutId); resolveOnce(false); }
    });

  const showRewarded = async () => {
    // Wrap the external handler with our guard, and show overlay to unify UX
    setOverlay('thinking');
    setAdLoading(true);
    try {
      const ok = onShowRewardedAd ? await onShowRewardedAd() : await showRewardedAdSafe();
      return ok;
    } finally {
      setAdLoading(false);
      setOverlay(null);
    }
  };

  // ---------- Camera VIN flow ----------
  const handleAddNew = () => {
    setModalVisible(false);
    setShowVinModal(true);
  };

  const handleCaptureVin = async () => {
    if (gateCameraWithAd) {
      const rewarded = await showRewarded();
      if (!rewarded) {
        if (isMountedRef.current) {
          Alert.alert('Ad Required', 'Please watch the full ad to use the VIN camera.');
        }
        return;
      }
    }
    setShowVinModal(false);
    triggerVinCamera?.(); // ✅ open VinCamera (App mounts it)
  };

  // ---------- Typed VIN flow ----------
  const handleDecodeTypedVin = async () => {
    const vin = normalizeVin(typedVin);
    if (!isValidVin(vin)) {
      Alert.alert('Invalid VIN', 'VIN must be 17 characters (letters & numbers, no I/O/Q).');
      return;
    }

    // Show ad first
    const rewarded = await showRewarded();
    if (!rewarded) {
      if (isMountedRef.current) {
        Alert.alert('Ad Required', 'Please watch the full ad to unlock VIN decoding.');
      }
      return;
    }

    // Decode VIN (with unified overlay while working)
    if (isMountedRef.current) {
      setDecoding(true);
      setOverlay('thinking');
    }
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

      const withId = ensureId(vehicle);
      await saveVehicle(withId);

      if (!isMountedRef.current) return;
      setVehicles(prev => [withId, ...prev]);
      onSelectVehicle(withId);

      const name = `${withId.year || ''} ${withId.make || ''} ${withId.model || ''}`.trim();
      Alert.alert(`✅ ${name} added to garage`, withId.engine || '');
      setShowVinModal(false);
      setTypedVin('');
    } catch (e) {
      if (isMountedRef.current) {
        Alert.alert('❌ VIN Decode Failed', e?.message || 'Please check the VIN and try again.');
      }
    } finally {
      if (isMountedRef.current) {
        setDecoding(false);
        setOverlay(null); // always clear thinking overlay
      }
    }
  };

  // ---------- Edit ----------
  const handleDelete = async (vin) => {
    Alert.alert('Delete Vehicle?', 'This will remove it from your garage.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteVehicleByVin(vin);
          if (!isMountedRef.current) return;
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
        if (match) { city = match[1]; highway = match[2]; }
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
    const updatedVehicle = ensureId({
      ...editableVehicle,
      mpg:
        editableVehicle.mpgCity && editableVehicle.mpgHighway
          ? `${editableVehicle.mpgCity} city / ${editableVehicle.mpgHighway} highway`
          : editableVehicle.mpg || '',
    });
    delete updatedVehicle.mpgCity;
    delete updatedVehicle.mpgHighway;

    await saveVehicle(updatedVehicle);
    if (!isMountedRef.current) return;
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

  const VehicleRow = ({ item }) => {
    const withId = ensureId(item);
    return (
      <TouchableOpacity
        style={styles.vehicleCard}
        onPress={() => { onSelectVehicle(withId); setModalVisible(false); }}
        activeOpacity={0.9}
      >
        <View style={styles.vehicleHeaderRow}>
          <Text style={styles.vehicleTitle} numberOfLines={1}>
            {withId.year} {withId.make} {withId.model}
          </Text>
          {!!withId.vin && <Text style={styles.vinBadge}>{withId.vin.slice(0, 8)}…</Text>}
        </View>

        <Text style={styles.vehicleDetails} numberOfLines={2}>
          {withId.engine || '—'} • {withId.transmission || '—'} • {withId.hp || '--'} HP • {renderMpg(withId.mpg)} MPG • GVW {withId.gvw || '--'}
        </Text>

        <View style={styles.rowDivider} />

        <View style={styles.inlineBtns}>
          <TouchableOpacity onPress={() => handleEdit(withId)} style={[styles.rowBtn, styles.rowBtnNeutral]} activeOpacity={0.9}>
            <Text style={styles.rowBtnText}>✏️ Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(withId.vin)} style={[styles.rowBtn, styles.rowBtnDanger]} activeOpacity={0.9}>
            <Text style={styles.rowBtnText}>🗑️ Delete</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  // ---------- UI ----------
  return (
    <View style={styles.container}>
      {selectedVehicle ? (
        <TouchableOpacity style={styles.selectedCard} onPress={() => setModalVisible(true)} activeOpacity={0.9}>
          <Text style={styles.selectedTitle} numberOfLines={1}>{selectedVehicle.year} {selectedVehicle.make}</Text>
          <Text style={styles.selectedSub} numberOfLines={1}>{selectedVehicle.model} {selectedVehicle.engine ? `(${selectedVehicle.engine})` : ''}</Text>
          <Text style={styles.stats}>
            MPG: {renderMpg(selectedVehicle.mpg)} • HP: {selectedVehicle.hp || '--'} • GVW: {selectedVehicle.gvw || '--'}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.placeholder} onPress={() => setShowVinModal(true)} activeOpacity={0.95}>
          <Text style={styles.plus}>+</Text>
          <Text style={styles.label}>Add Your Vehicle</Text>
        </TouchableOpacity>
      )}

      {/* Garage modal */}
      <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <Animated.View style={[styles.EditModalContainer, animatedModalStyle]}>
          <SafeAreaView style={styles.modalContainer}>
            <TouchableOpacity style={styles.closeIconMod} onPress={() => setModalVisible(false)}>
              <Text style={styles.closeIconTextMod}>✖</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Your Garage</Text>

            <FlatList
              data={vehicles}
              keyExtractor={(item) => ensureId(item).id}
              renderItem={({ item }) => <VehicleRow item={item} />}
              contentContainerStyle={{ paddingBottom: 40 }}
            />

            <TouchableOpacity style={styles.addNewButton} onPress={handleAddNew} activeOpacity={0.95}>
              <Text style={styles.addNewText}>+ Add Vehicle +</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </Animated.View>
      </Modal>

      {/* Add Vehicle modal */}
      <Modal visible={showVinModal} animationType="none" transparent onRequestClose={() => setShowVinModal(false)}>
        <Animated.View style={[styles.vinModalContainer, animatedModalStyle]}>
          <SafeAreaView style={styles.vinModalContent}>
            <ScrollView ref={scrollRef} contentContainerStyle={styles.vinScrollContent} keyboardShouldPersistTaps="handled">
              <TouchableOpacity onPress={() => setShowVinModal(false)} style={styles.closeIcon}>
                <Text style={styles.closeIconText}>✖</Text>
              </TouchableOpacity>

              <Text style={styles.modalTitle}>Add Your Vehicle</Text>

              {/* Camera option */}
              <TouchableOpacity
                style={[styles.optionButton, (adLoading || overlay === 'thinking') && { opacity: 0.7 }]}
                onPress={handleCaptureVin}
                disabled={adLoading || overlay === 'thinking'}
                activeOpacity={0.9}
              >
                {adLoading || overlay === 'thinking' ? (
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

              {/* Typed VIN entry */}
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
                    (!isValidVin(normalizeVin(typedVin)) || decoding || overlay === 'thinking') && styles.decodeBtnDisabled,
                  ]}
                  onPress={handleDecodeTypedVin}
                  disabled={!isValidVin(normalizeVin(typedVin)) || decoding || overlay === 'thinking'}
                  activeOpacity={0.9}
                >
                  {decoding || overlay === 'thinking' ? (
                    <Text style={styles.decodeBtnText}>Decoding…</Text>
                  ) : (
                    <Text style={styles.decodeBtnText}>🎟️ Watch Ad & Decode</Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* VIN help & locations */}
              <Text style={styles.modalSubtitle}>What’s a VIN?</Text>
              <Text style={styles.helperText}>A VIN (Vehicle Identification Number) is a unique 17-digit code that identifies your car.</Text>

              <Text style={styles.sectionTitle}>Where to Find Your VIN</Text>
              {vinLocations.map((item) => (
                <View key={item.id} style={styles.vinCardWrapper}>
                  <View style={styles.vinCardStacked}>
                    <Text style={styles.vinLabelLarge}>{item.label}</Text>
                    <Image source={item.image} style={styles.vinImageLarge} />
                  </View>
                </View>
              ))}
              <Text style={[styles.helperText, { marginTop: 12 }]}>Snap a clear photo of any of these VIN locations, and we’ll do the rest. 🚗</Text>
            </ScrollView>
          </SafeAreaView>

          {/* THINKING OVERLAY (consistent with ServiceBox) */}
          {overlay === 'thinking' && (
            <View style={styles.overlay} pointerEvents="auto">
              <View style={styles.thinkingCard}>
                <View style={styles.spinnerRow}><ActivityIndicator size="large" /></View>
                <Text style={styles.thinkingTitle}>Torque is thinking</Text>
                <AnimatedEllipsis style={styles.thinkingSub} base="Generating your decode" />
              </View>
            </View>
          )}
        </Animated.View>
      </Modal>

      {/* Edit modal */}
      {editMode && editableVehicle && (
        <Modal visible={editMode} animationType="slide" onRequestClose={() => setEditMode(false)}>
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
                        style={[styles.transmissionButton, editableVehicle.transmission === 'Automatic' && styles.transmissionButtonSelected]}
                        onPress={() => setEditableVehicle({ ...editableVehicle, transmission: 'Automatic' })}
                        activeOpacity={0.9}
                      >
                        <Text style={[styles.transmissionButtonText, editableVehicle.transmission === 'Automatic' && styles.transmissionButtonTextSelected]}>
                          Automatic
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.transmissionButton, editableVehicle.transmission === 'Manual' && styles.transmissionButtonSelected]}
                        onPress={() => setEditableVehicle({ ...editableVehicle, transmission: 'Manual' })}
                        activeOpacity={0.9}
                      >
                        <Text style={[styles.transmissionButtonText, editableVehicle.transmission === 'Manual' && styles.transmissionButtonTextSelected]}>
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
              <TouchableOpacity onPress={handleSaveEdit} style={styles.addNewButton} activeOpacity={0.95}>
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
const BLUE = '#3b82f6';
const GREEN = '#22c55e';

const styles = StyleSheet.create({
  container: { width: '100%', paddingVertical: 20, alignSelf: 'center' },

  placeholder: {
    backgroundColor: '#444', padding: 32, borderRadius: 16, alignItems: 'center',
    borderColor: '#666', borderWidth: 1,
  },
  plus: { fontSize: 40, color: '#ccc' },
  label: { fontSize: 16, color: '#aaa', marginTop: 8 },

  selectedCard: {
    backgroundColor: '#333', padding: 24, borderRadius: 16, alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  selectedTitle: { fontSize: 20, fontWeight: '900', color: '#fff' },
  selectedSub: { fontSize: 14, color: '#ddd', marginVertical: 4, fontWeight: '700' },
  stats: { fontSize: 12.5, color: '#bbb' },

  // Modals
  modalContainer: { flex: 1, backgroundColor: '#121212', padding: 24, paddingTop: 50 },
  modalTitle: { fontSize: 22, fontWeight: '900', color: '#fff', marginBottom: 12, alignSelf: 'center' },
  modalSubtitle: { fontSize: 18, fontWeight: '900', color: '#eee', marginTop: 12, marginBottom: 6, textAlign: 'center' },

  // Garage rows (restyled)
  vehicleCard: {
    backgroundColor: '#1b1b1b',
    padding: 16,
    marginBottom: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  vehicleHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  vehicleTitle: { flex: 1, fontSize: 18, fontWeight: '900', color: '#fff' },
  vinBadge: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    color: '#fff', fontSize: 12, fontWeight: '800',
  },
  vehicleDetails: { marginTop: 8, fontSize: 13.5, color: '#ddd' },
  rowDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 12 },

  inlineBtns: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  rowBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  rowBtnNeutral: { backgroundColor: 'rgba(255,255,255,0.10)', borderColor: 'rgba(255,255,255,0.15)' },
  rowBtnDanger: { backgroundColor: '#8b1d1d', borderColor: '#8b1d1d' },
  rowBtnText: { color: '#fff', fontWeight: '800' },

  addNewButton: {
    marginTop: 20, padding: 16, backgroundColor: GREEN, borderRadius: 14, alignItems: 'center',
    width: '80%', alignSelf: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 5,
  },
  addNewText: { color: '#0b1220', fontSize: 17, fontWeight: '900' },

  vinModalContainer: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center', paddingTop: 50,
  },
  vinModalContent: {
    backgroundColor: '#121212', borderRadius: 20, width: '92%', maxHeight: '94%',
    paddingVertical: 24, paddingHorizontal: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  vinScrollContent: { paddingBottom: 60, alignItems: 'center' },
  closeIcon: { position: 'absolute', right: 16, zIndex: 10, backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  closeIconText: { fontSize: 22, color: '#000', fontWeight: 'bold' },

  optionButton: {
    backgroundColor: GREEN, paddingVertical: 20, paddingHorizontal: 24, borderRadius: 14, marginBottom: 18,
    width: '100%', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4, elevation: 3,
  },
  optionButtonText: { color: '#0f172a', fontSize: 16, fontWeight: '900' },
  optionSubText: { color: '#14532d', fontSize: 13, marginTop: 4, textAlign: 'center', fontWeight: '700' },

  helperText: { color: '#94a3b8', fontSize: 14, textAlign: 'center', marginVertical: 10, lineHeight: 20 },
  sectionTitle: { fontSize: 18, color: '#eee', fontWeight: '900', marginTop: 6, marginBottom: 8, textAlign: 'center' },
  vinCardWrapper: { width: '100%' },
  vinCardStacked: { alignItems: 'center', backgroundColor: '#1e293b', padding: 20, borderRadius: 16, marginBottom: 20, width: '100%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  vinImageLarge: { width: '100%', height: 180, resizeMode: 'contain', marginTop: 12, borderRadius: 8 },
  vinLabelLarge: { fontSize: 16, fontWeight: '800', color: '#e2e8f0', textAlign: 'center' },

  inputLabel: { color: '#ccc', marginBottom: 4, fontSize: 14, fontWeight: '800' },
  input: { backgroundColor: '#1b1b1b', color: '#fff', padding: 12, borderRadius: 10, borderColor: '#333', borderWidth: 1 },

  transmissionSelector: { flexDirection: 'row', backgroundColor: '#1b1b1b', borderRadius: 10, borderColor: '#333', borderWidth: 1, height: 44, overflow: 'hidden' },
  transmissionButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  transmissionButtonSelected: { backgroundColor: '#22c55e' },
  transmissionButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  transmissionButtonTextSelected: { color: '#0b1220', fontWeight: '900' },

  EditModalContainer: { width: '100%', height: '100%' },
  closeIconMod: { position: 'absolute', right: 16, top: 50, zIndex: 10, backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  closeIconTextMod: { fontSize: 22, color: '#000', fontWeight: 'bold' },

  decodeBtn: { marginTop: 10, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: GREEN },
  decodeBtnDisabled: { opacity: 0.6 },
  decodeBtnText: { color: '#0f172a', fontSize: 16, fontWeight: '900' },

  // Overlay (shared look with ServiceBox)
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  thinkingCard: {
    width: '86%',
    maxWidth: 420,
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 22,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  spinnerRow: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 12,
  },
  thinkingTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  thinkingSub: { color: '#9aa5b1', fontSize: 13, textAlign: 'center', marginTop: 6 },
});
