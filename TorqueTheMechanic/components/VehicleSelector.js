// components/VehicleSelector.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  withRepeat,
} from 'react-native-reanimated';
import mobileAds, { RewardedAd, RewardedAdEventType, AdEventType } from 'react-native-google-mobile-ads';

import { getAllVehicles, deleteVehicleByVin, saveVehicle } from '../utils/VehicleStorage';
import VehiclePhotoModal from './VehiclePhotoModal';
import * as ImagePicker from 'expo-image-picker';

// ---------- ADS ----------
const adUnitId = __DEV__
  ? Platform.OS === 'ios'
    ? 'ca-app-pub-3940256099942544/1712485313'
    : 'ca-app-pub-3940256099942544/5224354917'
  : 'your-real-admob-id-here';

// ---------- VIN HELPERS (MATCH BACKEND) ----------
// Backend logic:
//   - uppercase
//   - strip non-alnum
//   - I -> 1
//   - O/Q -> 0
const normalizeVin = (str = '') => {
  const up = String(str).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return up.replace(/I/g, '1').replace(/[OQ]/g, '0');
};

// same regex as backend "isValidVinBasic"
const isValidVinBasic = (vin = '') => /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);

// Optional: validate check-digit (same algorithm as backend)
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const VIN_MAP = (() => {
  const map = {};
  '0123456789'.split('').forEach((d, i) => (map[d] = i));
  Object.assign(map, {
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  });
  return map;
})();

const computeVinCheckDigit = (vin) => {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const val = VIN_MAP[vin[i]];
    if (val == null) return null;
    sum += val * VIN_WEIGHTS[i];
  }
  const rem = sum % 11;
  return rem === 10 ? 'X' : String(rem);
};

const isValidVin = (vin = '') => {
  if (!isValidVinBasic(vin)) return false;
  const check = computeVinCheckDigit(vin);
  return check === vin[8];
};

// ✅ Ensure vehicle has a stable id
const ensureId = (v = {}) => {
  const id =
    v.id?.toString?.() ||
    (v.vin ? String(v.vin) : undefined) ||
    [v.year, v.make, v.model].filter(Boolean).join('-') ||
    undefined;
  return id ? { ...v, id } : { ...v, id: Math.random().toString(36).slice(2) };
};

// ---------- "NEW BACKEND KEYS" COMPAT ----------
const safeNum = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const getHp = (v) => safeNum(v?.hp) ?? safeNum(v?.horsepower_hp) ?? null;
const getGvw = (v) => safeNum(v?.gvw) ?? safeNum(v?.gvw_lbs) ?? null;

const getMpgCity = (v) => {
  // legacy string "## city / ## highway"
  if (typeof v?.mpg === 'string') {
    const m = v.mpg.match(/(\d+)\s*city\s*\/\s*(\d+)\s*highway/i);
    if (m) return safeNum(m[1]);
  }
  return safeNum(v?.mpg_city) ?? null;
};

const getMpgHighway = (v) => {
  if (typeof v?.mpg === 'string') {
    const m = v.mpg.match(/(\d+)\s*city\s*\/\s*(\d+)\s*highway/i);
    if (m) return safeNum(m[2]);
  }
  return safeNum(v?.mpg_highway) ?? null;
};

const renderMpgCompact = (v) => {
  const c = getMpgCity(v);
  const h = getMpgHighway(v);
  if (c == null || h == null) return '--/--';
  return `${c}/${h}`;
};

// ---------- STATIC IMAGES ----------
const vinLocations = [
  { id: '1', label: 'Registration Card', image: require('../assets/vin_registration_card.png') },
  { id: '2', label: 'Insurance Document', image: require('../assets/vin_insurance.png') },
  { id: '3', label: 'Driver-Side Door Sticker', image: require('../assets/vin_door_sticker.png') },
  { id: '4', label: 'Windshield Corner', image: require('../assets/vin_windshield.png') },
];

// Tiny helper to animate "..." without extra libs
function AnimatedEllipsis({ style, base = 'Generating' }) {
  const [dots, setDots] = React.useState('');
  React.useEffect(() => {
    const id = setInterval(() => setDots((p) => (p.length >= 3 ? '' : p + '.')), 450);
    return () => clearInterval(id);
  }, []);
  return (
    <Text style={style}>
      {base}
      {dots}
    </Text>
  );
}

// ✅ Proper custom hook (no Rules of Hooks warnings)
function useHeroDrift() {
  const drift = useSharedValue(0);

  useEffect(() => {
    drift.value = withRepeat(withTiming(1, { duration: 9000 }), -1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useAnimatedStyle(() => ({
    transform: [
      { translateX: drift.value * 8 - 4 },
      { translateY: drift.value * 6 - 3 },
      { scale: 1.06 },
    ],
  }));
}

// ---------- Rewarded fallback (only if App.js doesn’t pass onShowRewardedAd) ----------
const showRewardedAdSafe = async () => {
  try {
    // don’t crash if ads not initialized
    try {
      await mobileAds().initialize();
    } catch {}

    return await new Promise((resolve) => {
      const rewarded = RewardedAd.createForAdRequest(adUnitId, { requestNonPersonalizedAdsOnly: true });

      const unsubs = [];
      const cleanup = () => {
        while (unsubs.length) {
          try {
            const u = unsubs.pop();
            typeof u === 'function' ? u() : u?.remove?.();
          } catch {}
        }
      };

      let settled = false;
      const resolveOnce = (val) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(val);
      };

      const timeoutId = setTimeout(() => resolveOnce(false), 20000);

      // Rewarded-specific events (these exist for sure)
      unsubs.push(
        rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
          try {
            rewarded.show();
          } catch {
            clearTimeout(timeoutId);
            resolveOnce(false);
          }
        })
      );

      unsubs.push(
        rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
          clearTimeout(timeoutId);
          resolveOnce(true);
        })
      );

      // Optional lifecycle events (some versions)
      if (AdEventType?.CLOSED) {
        unsubs.push(
          rewarded.addAdEventListener(AdEventType.CLOSED, () => {
            clearTimeout(timeoutId);
            resolveOnce(false);
          })
        );
      }
      if (AdEventType?.ERROR) {
        unsubs.push(
          rewarded.addAdEventListener(AdEventType.ERROR, () => {
            clearTimeout(timeoutId);
            resolveOnce(false);
          })
        );
      }

      try {
        rewarded.load();
      } catch {
        clearTimeout(timeoutId);
        resolveOnce(false);
      }
    });
  } catch {
    return false;
  }
};

export default function VehicleSelector({
  selectedVehicle = null,
  onSelectVehicle,
  triggerVinCamera,
  onShowRewardedAd, // ✅ prefer App.js runner
  gateCameraWithAd = false,
  onDecodeVinTyped, // (vin) => Promise<void>  (App.js does /decode-vin-text)
  onOpenVehiclePhoto, // optional if you still want App-root modal
}) {
  // UI state
  const [modalVisible, setModalVisible] = useState(false);
  const [showVinModal, setShowVinModal] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // Vehicle photo modals
  const [photoModalVisible, setPhotoModalVisible] = useState(false); // snap+adjust (VehiclePhotoModal)
  const [photoTargetKey, setPhotoTargetKey] = useState(null); // vin or id

  // ✅ chooser modal (choose vs snap)
  const [photoChooserVisible, setPhotoChooserVisible] = useState(false);

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

  // VIN decode lock to prevent double taps
  const vinDecodeLockRef = useRef(false);

  // mounted guard
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (modalVisible) loadGarage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalVisible]);

  useEffect(() => {
    const isOpen = modalVisible || showVinModal || editMode || photoModalVisible || photoChooserVisible;
    modalOpacity.value = withTiming(isOpen ? 1 : 0, { duration: 220 });
    modalTranslateY.value = withSpring(isOpen ? 0 : 100, { damping: 18, stiffness: 130 });
  }, [modalVisible, showVinModal, editMode, photoModalVisible, photoChooserVisible, modalOpacity, modalTranslateY]);

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

  const showRewarded = useCallback(async () => {
    setOverlay('thinking');
    setAdLoading(true);
    try {
      // ✅ prefer App.js implementation (consistent + avoids event mismatches)
      if (onShowRewardedAd) return await onShowRewardedAd();
      return await showRewardedAdSafe();
    } finally {
      setAdLoading(false);
      setOverlay(null);
    }
  }, [onShowRewardedAd]);

  // ---------- ✅ Vehicle Photo helpers ----------
  const findVehicleByKey = (key) => {
    if (!key) return null;
    return (
      vehicles.find((v) => (v?.vin ? String(v.vin) === String(key) : false)) ||
      vehicles.find((v) => String(ensureId(v).id) === String(key)) ||
      null
    );
  };

  const persistVehiclePhoto = async (key, uri) => {
    if (!key || !uri) return;

    const target = findVehicleByKey(key);
    if (!target) return;

    const updated = ensureId({ ...target, photoUri: uri });
    await saveVehicle(updated);

    if (!isMountedRef.current) return;

    setVehicles((prev) =>
      prev.map((v) => {
        const vv = ensureId(v);
        const match =
          (vv.vin && updated.vin && String(vv.vin) === String(updated.vin)) ||
          (vv.id && updated.id && String(vv.id) === String(updated.id));
        return match ? updated : v;
      })
    );

    // ✅ update selected vehicle instantly
    const sel = selectedVehicle ? ensureId(selectedVehicle) : null;
    if (sel) {
      const selMatch =
        (sel.vin && updated.vin && String(sel.vin) === String(updated.vin)) ||
        (sel.id && updated.id && String(sel.id) === String(updated.id));
      if (selMatch) onSelectVehicle?.(updated);
    }
  };

  // open chooser for a specific vehicle
  const openPhotoForVehicle = (vehicle) => {
    if (onOpenVehiclePhoto) {
      // if you prefer the App-root modal flow, use it
      onOpenVehiclePhoto(vehicle);
      return;
    }
    const v = ensureId(vehicle);
    const key = v?.vin || v?.id;
    setPhotoTargetKey(key);
    setPhotoChooserVisible(true);
  };

  // Called by VehiclePhotoModal (snap + adjust)
  const handleSaveVehiclePhoto = async (uri) => {
    const key = photoTargetKey;
    setPhotoModalVisible(false);
    setPhotoChooserVisible(false);
    await persistVehiclePhoto(key, uri);
  };

  // ---------- ✅ pick/snap via ImagePicker ----------
  const requestMediaPerms = async () => {
    const media = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!media?.granted) {
      Alert.alert('Permission needed', 'Please allow Photos access to choose a vehicle photo.');
      return false;
    }
    return true;
  };

  const requestCameraPerms = async () => {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam?.granted) {
      Alert.alert('Permission needed', 'Please allow Camera access to snap a vehicle photo.');
      return false;
    }
    return true;
  };

  const chooseFromLibrary = async () => {
    const ok = await requestMediaPerms();
    if (!ok) return;

    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.9,
      });

      if (res.canceled) return;
      const uri = res.assets?.[0]?.uri;
      if (!uri) return;

      const key = photoTargetKey;
      setPhotoChooserVisible(false);
      await persistVehiclePhoto(key, uri);
    } catch (e) {
      Alert.alert('Photo error', e?.message || 'Could not open your Photos.');
    }
  };

  const snapWithCameraQuick = async () => {
    const ok = await requestCameraPerms();
    if (!ok) return;

    try {
      const res = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.9,
      });

      if (res.canceled) return;
      const uri = res.assets?.[0]?.uri;
      if (!uri) return;

      const key = photoTargetKey;
      setPhotoChooserVisible(false);
      await persistVehiclePhoto(key, uri);
    } catch (e) {
      Alert.alert('Camera error', e?.message || 'Could not open camera.');
    }
  };

  // open snap+adjust modal
  const snapAndAdjust = async () => {
    const ok = await requestCameraPerms();
    if (!ok) return;
    setPhotoChooserVisible(false);
    setPhotoModalVisible(true);
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
        if (isMountedRef.current) Alert.alert('Ad Required', 'Please watch the full ad to use the VIN camera.');
        return;
      }
    }
    setShowVinModal(false);
    triggerVinCamera?.();
  };

  // ---------- Typed VIN flow ----------
  const handleDecodeTypedVin = async () => {
    if (vinDecodeLockRef.current) return;

    // ✅ normalize like backend (I->1, O/Q->0) BEFORE validating
    const vin = normalizeVin(typedVin);

    // ✅ UX: distinguish "length/characters" vs "check digit" problems
    if (!isValidVinBasic(vin)) {
      Alert.alert('Invalid VIN', 'VIN must be 17 characters (letters & numbers, no I/O/Q).');
      return;
    }
    if (!isValidVin(vin)) {
      Alert.alert('Invalid VIN', 'VIN check digit does not match. Double-check the 9th character and try again.');
      return;
    }

    // ✅ hard fail if App.js didn't pass the handler (prevents “ad watched, nothing happened”)
    if (!onDecodeVinTyped) {
      Alert.alert('Setup Missing', 'onDecodeVinTyped was not provided to VehicleSelector.');
      return;
    }

    vinDecodeLockRef.current = true;

    const rewarded = await showRewarded();
    if (!rewarded) {
      vinDecodeLockRef.current = false;
      Alert.alert('Ad Required', 'Please watch the full ad to unlock VIN decoding.');
      return;
    }

    setDecoding(true);
    setOverlay('thinking');
    try {
      // ✅ App.js should call /decode-vin-text and saveVehicle + setVehicle
      await onDecodeVinTyped(vin);
      setShowVinModal(false);
      setTypedVin('');
    } catch (e) {
      Alert.alert('❌ VIN Decode Failed', e?.message || 'Please check the VIN and try again.');
    } finally {
      vinDecodeLockRef.current = false;
      setDecoding(false);
      setOverlay(null);
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
          if (!isMountedRef.current) return;
          const updatedList = vehicles.filter((v) => String(v.vin) !== String(vin));
          setVehicles(updatedList);
          if (selectedVehicle?.vin === vin) onSelectVehicle?.(null);
        },
      },
    ]);
  };

  const handleEdit = (vehicle) => {
    setModalVisible(false);
    setTimeout(() => {
      const v = ensureId(vehicle);

      // prefer numeric backend fields if present
      const city = getMpgCity(v);
      const highway = getMpgHighway(v);

      setEditableVehicle({
        ...v,
        mpgCity: city != null ? String(city) : '',
        mpgHighway: highway != null ? String(highway) : '',
        transmission: v.transmission || 'Automatic',
        hp: getHp(v) != null ? String(getHp(v)) : (v.hp ? String(v.hp) : ''),
        gvw: getGvw(v) != null ? String(getGvw(v)) : (v.gvw ? String(v.gvw) : ''),
      });

      setEditMode(true);
    }, 250);
  };

  const handleSaveEdit = async () => {
    const v = ensureId({ ...editableVehicle });

    // store legacy display fields (your UI expects these)
    const mpgCity = String(v.mpgCity || '').trim();
    const mpgHighway = String(v.mpgHighway || '').trim();

    const updatedVehicle = ensureId({
      ...v,
      mpg: mpgCity && mpgHighway ? `${mpgCity} city / ${mpgHighway} highway` : v.mpg || '',
      hp: String(v.hp || '').trim() || null,
      gvw: String(v.gvw || '').trim() || null,
      transmission: v.transmission || 'Automatic',
    });

    // cleanup edit-only keys
    delete updatedVehicle.mpgCity;
    delete updatedVehicle.mpgHighway;

    await saveVehicle(updatedVehicle);
    if (!isMountedRef.current) return;

    const updatedList = vehicles.map((x) => (String(x.vin) === String(updatedVehicle.vin) ? updatedVehicle : x));
    setVehicles(updatedList);

    const sel = selectedVehicle ? ensureId(selectedVehicle) : null;
    if (sel?.vin && updatedVehicle?.vin && String(sel.vin) === String(updatedVehicle.vin)) {
      onSelectVehicle?.(updatedVehicle);
    }

    setEditMode(false);
    setEditableVehicle(null);
  };

  // ---------- Row ----------
  const VehicleRow = ({ item }) => {
    const withId = ensureId(item);
    const heroStyle = useHeroDrift();

    const hp = getHp(withId);
    const gvw = getGvw(withId);

    return (
      <TouchableOpacity
        style={styles.vehicleCard}
        onPress={() => {
          onSelectVehicle?.(withId);
          setModalVisible(false);
        }}
        activeOpacity={0.92}
      >
        {!!withId.photoUri && (
          <View style={styles.vehicleBgWrap} pointerEvents="none">
            <Animated.Image source={{ uri: withId.photoUri }} style={[styles.vehicleBg, heroStyle]} resizeMode="cover" />
            <View style={styles.vehicleBgOverlay} />
          </View>
        )}

        <View style={styles.vehicleHeaderRow}>
          <Text style={styles.vehicleTitle} numberOfLines={1}>
            {withId.year} {withId.make} {withId.model}
          </Text>

          <TouchableOpacity onPress={() => openPhotoForVehicle(withId)} style={styles.photoIconBtn} activeOpacity={0.9}>
            <Text style={styles.photoIconText}>📷</Text>
          </TouchableOpacity>

          {!!withId.vin && (
            <View style={styles.vinPill}>
              <Text style={styles.vinPillText}>{String(withId.vin).slice(0, 8)}…</Text>
            </View>
          )}
        </View>

        <Text style={styles.vehicleDetails} numberOfLines={2}>
          {withId.engine || '—'} • {withId.transmission || '—'} • {hp ?? '--'} HP • {renderMpgCompact(withId)} MPG • GVW{' '}
          {gvw ?? '--'}
        </Text>

        <View style={styles.rowDivider} />

        <View style={styles.inlineBtns}>
          <TouchableOpacity onPress={() => handleEdit(withId)} style={[styles.rowBtn, styles.rowBtnNeutral]} activeOpacity={0.9}>
            <Text style={styles.rowBtnText}>Edit</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => handleDelete(withId.vin)}
            style={[styles.rowBtn, styles.rowBtnDanger]}
            activeOpacity={0.9}
          >
            <Text style={[styles.rowBtnText, styles.rowBtnTextDanger]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  // ✅ HOME drift style
  const homeHeroStyle = useHeroDrift();

  // ---------- UI ----------
  const sel = selectedVehicle ? ensureId(selectedVehicle) : null;
  const hpSel = sel ? getHp(sel) : null;
  const gvwSel = sel ? getGvw(sel) : null;

  // ✅ use the same validation for the button as the handler uses
  const normalizedTypedVin = normalizeVin(typedVin);
  const typedVinReady = isValidVinBasic(normalizedTypedVin) && isValidVin(normalizedTypedVin);

  return (
    <View style={styles.container}>
      {sel ? (
        <TouchableOpacity style={styles.selectedCard} onPress={() => setModalVisible(true)} activeOpacity={0.9}>
          {!!sel.photoUri && (
            <View style={styles.homeBgWrap} pointerEvents="none">
              <Animated.Image source={{ uri: sel.photoUri }} style={[styles.homeBg, homeHeroStyle]} resizeMode="cover" />
              <View style={styles.homeBgOverlay} />
            </View>
          )}

          <TouchableOpacity onPress={() => openPhotoForVehicle(sel)} style={styles.homePhotoBtn} activeOpacity={0.9}>
            <Text style={{ fontSize: 16 }}>📷</Text>
          </TouchableOpacity>

          <Text style={styles.selectedTitle} numberOfLines={1}>
            {sel.year} {sel.make}
          </Text>
          <Text style={styles.selectedSub} numberOfLines={1}>
            {sel.model} {sel.engine ? `(${sel.engine})` : ''}
          </Text>
          <Text style={styles.stats}>
            MPG: {renderMpgCompact(sel)} • HP: {hpSel ?? '--'} • GVW: {gvwSel ?? '--'}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.placeholder} onPress={() => setShowVinModal(true)} activeOpacity={0.95}>
          <Text style={styles.plus}>+</Text>
          <Text style={styles.label}>Add Your Vehicle</Text>
        </TouchableOpacity>
      )}

      {/* Garage modal */}
      <Modal visible={modalVisible} animationType="none" onRequestClose={() => setModalVisible(false)}>
        <Animated.View style={[styles.EditModalContainer, animatedModalStyle]}>
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeaderRow}>
              <View style={{ width: 44 }} />
              <Text style={styles.modalTitle}>Your Garage</Text>
              <TouchableOpacity style={styles.closePill} onPress={() => setModalVisible(false)} activeOpacity={0.9}>
                <Text style={styles.closePillText}>✕</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={vehicles}
              keyExtractor={(item) => ensureId(item).id}
              renderItem={({ item }) => <VehicleRow item={item} />}
              contentContainerStyle={styles.garageListContent}
              showsVerticalScrollIndicator={false}
            />

            <TouchableOpacity style={styles.addNewButton} onPress={handleAddNew} activeOpacity={0.95}>
              <Text style={styles.addNewText}>+ Add Vehicle +</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </Animated.View>
      </Modal>

      {/* Photo chooser modal */}
      <Modal
        visible={photoChooserVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoChooserVisible(false)}
      >
        <View style={styles.chooserBackdrop}>
          <View style={styles.chooserSheet}>
            <View style={styles.chooserHeaderRow}>
              <Text style={styles.chooserTitle}>Showcase your ride</Text>
              <TouchableOpacity style={styles.chooserClose} onPress={() => setPhotoChooserVisible(false)} activeOpacity={0.9}>
                <Text style={styles.chooserCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.chooserSub}>
              Choose a photo or snap one now. This becomes the background on your vehicle card.
            </Text>

            <TouchableOpacity style={styles.chooserBtnPrimary} onPress={chooseFromLibrary} activeOpacity={0.92}>
              <Text style={styles.chooserBtnPrimaryText}>🖼️ Choose from Photos</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.chooserBtnPrimary} onPress={snapWithCameraQuick} activeOpacity={0.92}>
              <Text style={styles.chooserBtnPrimaryText}>📷 Snap a Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.chooserBtnSecondary} onPress={snapAndAdjust} activeOpacity={0.92}>
              <Text style={styles.chooserBtnSecondaryText}>✨ Snap & Adjust (pro look)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.chooserBtnSecondary} onPress={() => setPhotoChooserVisible(false)} activeOpacity={0.92}>
              <Text style={styles.chooserBtnSecondaryText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Snap & Adjust Modal */}
      <VehiclePhotoModal
        visible={photoModalVisible}
        onClose={() => setPhotoModalVisible(false)}
        onSave={handleSaveVehiclePhoto}
      />

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
                    (!typedVinReady || decoding || overlay === 'thinking') && styles.decodeBtnDisabled,
                  ]}
                  onPress={handleDecodeTypedVin}
                  disabled={!typedVinReady || decoding || overlay === 'thinking'}
                  activeOpacity={0.9}
                >
                  {decoding || overlay === 'thinking' ? (
                    <Text style={styles.decodeBtnText}>Decoding…</Text>
                  ) : (
                    <Text style={styles.decodeBtnText}>🎟️ Watch Ad & Decode</Text>
                  )}
                </TouchableOpacity>

                {/* tiny helper for debugging/UX clarity */}
                {!typedVinReady && normalizeVin(typedVin).length > 0 && (
                  <Text style={[styles.helperText, { marginTop: 8 }]}>
                    Normalized: <Text style={{ fontWeight: '900', color: '#cbd5e1' }}>{normalizeVin(typedVin)}</Text>
                  </Text>
                )}
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

          {/* THINKING OVERLAY */}
          {overlay === 'thinking' && (
            <View style={styles.overlay} pointerEvents="auto">
              <View style={styles.thinkingCard}>
                <View style={styles.spinnerRow}>
                  <ActivityIndicator size="large" />
                </View>
                <Text style={styles.thinkingTitle}>Torque is thinking</Text>
                <AnimatedEllipsis style={styles.thinkingSub} base="Generating your decode" />
              </View>
            </View>
          )}
        </Animated.View>
      </Modal>

      {/* Edit modal */}
      {editMode && editableVehicle && (
        <Modal visible={editMode} animationType="none" onRequestClose={() => setEditMode(false)}>
          <Animated.View style={[styles.EditModalContainer, animatedModalStyle]}>
            <SafeAreaView style={styles.modalContainer}>
              <View style={styles.modalHeaderRow}>
                <View style={{ width: 44 }} />
                <Text style={styles.modalTitle}>Edit Vehicle</Text>
                <TouchableOpacity style={styles.closePill} onPress={() => setEditMode(false)} activeOpacity={0.9}>
                  <Text style={styles.closePillText}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                contentContainerStyle={{ paddingBottom: 24, paddingHorizontal: 2 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
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
                  <View key={key} style={styles.editField}>
                    <Text style={styles.inputLabel}>{label}</Text>

                    {key === 'transmission' ? (
                      <View style={styles.transmissionSelector}>
                        <TouchableOpacity
                          style={[
                            styles.transmissionButton,
                            editableVehicle.transmission === 'Automatic' && styles.transmissionButtonSelected,
                          ]}
                          onPress={() => setEditableVehicle({ ...editableVehicle, transmission: 'Automatic' })}
                          activeOpacity={0.9}
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
                          activeOpacity={0.9}
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
                        value={editableVehicle[key]?.toString?.() || ''}
                        onChangeText={(text) => setEditableVehicle({ ...editableVehicle, [key]: text })}
                      />
                    )}
                  </View>
                ))}

                <TouchableOpacity onPress={handleSaveEdit} style={styles.saveButton} activeOpacity={0.95}>
                  <Text style={styles.saveButtonText}>Save Changes</Text>
                </TouchableOpacity>
              </ScrollView>
            </SafeAreaView>
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
  container: { width: '100%', paddingVertical: 10, alignSelf: 'center' },

  placeholder: {
    backgroundColor: '#2a2a2a',
    paddingVertical: 40,
    paddingHorizontal: 18,
    borderRadius: 16,
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
  },
  plus: { fontSize: 40, color: '#d1d5db' },
  label: { fontSize: 16, color: '#cbd5e1', marginTop: 8, fontWeight: '700' },

  selectedCard: {
    backgroundColor: '#3a3a3a',
    paddingVertical: 40,
    paddingHorizontal: 18,
    borderRadius: 16,
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 6,
    overflow: 'hidden',
  },

  homeBgWrap: { ...StyleSheet.absoluteFillObject, borderRadius: 16, overflow: 'hidden' },
  homeBg: { width: '110%', height: '110%', position: 'absolute', top: '-5%', left: '-5%' },
  homeBgOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },

  homePhotoBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.30)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    zIndex: 10,
  },

  selectedTitle: { fontSize: 20, fontWeight: '900', color: '#fff' },
  selectedSub: { fontSize: 14, color: '#e5e7eb', marginVertical: 4, fontWeight: '700' },
  stats: { fontSize: 12.5, color: '#cbd5e1', opacity: 0.9 },

  modalContainer: { flex: 1, backgroundColor: '#0b0b0b', paddingHorizontal: 16, paddingTop: 10 },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 10,
  },
  modalTitle: { fontSize: 22, fontWeight: '900', color: '#fff', textAlign: 'center' },
  modalSubtitle: { fontSize: 18, fontWeight: '900', color: '#eee', marginTop: 12, marginBottom: 6, textAlign: 'center' },

  closePill: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  closePillText: { color: '#fff', fontSize: 20, fontWeight: '900' },

  garageListContent: { paddingTop: 10, paddingBottom: 18, paddingHorizontal: 10 },

  vehicleCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    overflow: 'hidden',
  },

  vehicleBgWrap: { ...StyleSheet.absoluteFillObject, borderRadius: 22, overflow: 'hidden' },
  vehicleBg: { width: '110%', height: '110%', position: 'absolute', top: '-5%', left: '-5%' },
  vehicleBgOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },

  vehicleHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  vehicleTitle: { flex: 1, fontSize: 18, fontWeight: '900', color: '#fff', letterSpacing: 0.2 },

  photoIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.30)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    marginLeft: 10,
    marginRight: 8,
  },
  photoIconText: { fontSize: 16 },

  vinPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  vinPillText: { color: '#e5e7eb', fontSize: 12, fontWeight: '800' },

  vehicleDetails: { marginTop: 8, fontSize: 13.5, color: 'rgba(255,255,255,0.78)', lineHeight: 18 },
  rowDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 12 },

  inlineBtns: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  rowBtn: { height: 40, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1, minWidth: 96 },
  rowBtnNeutral: { backgroundColor: 'rgba(0,0,0,0.22)', borderColor: 'rgba(255,255,255,0.12)' },
  rowBtnDanger: { backgroundColor: 'rgba(255,102,102,0.10)', borderColor: 'rgba(255,102,102,0.45)' },
  rowBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  rowBtnTextDanger: { color: '#ffe4e6' },

  addNewButton: {
    marginTop: 12,
    marginBottom: 10,
    height: 56,
    backgroundColor: GREEN,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    width: '92%',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  addNewText: { color: '#07110a', fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },

  vinModalContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center', paddingTop: 50 },
  vinModalContent: {
    backgroundColor: '#121212',
    borderRadius: 20,
    width: '92%',
    maxHeight: '94%',
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  vinScrollContent: { paddingBottom: 60, alignItems: 'center' },
  closeIcon: { position: 'absolute', right: 16, zIndex: 10, backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  closeIconText: { fontSize: 22, color: '#000', fontWeight: 'bold' },

  optionButton: {
    backgroundColor: GREEN,
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
  optionButtonText: { color: '#0f172a', fontSize: 16, fontWeight: '900' },
  optionSubText: { color: '#14532d', fontSize: 13, marginTop: 4, textAlign: 'center', fontWeight: '700' },

  helperText: { color: '#94a3b8', fontSize: 14, textAlign: 'center', marginVertical: 10, lineHeight: 20 },
  sectionTitle: { fontSize: 18, color: '#eee', fontWeight: '900', marginTop: 6, marginBottom: 8, textAlign: 'center' },
  vinCardWrapper: { width: '100%' },
  vinCardStacked: {
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 20,
    borderRadius: 16,
    marginBottom: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  vinImageLarge: { width: '100%', height: 180, resizeMode: 'contain', marginTop: 12, borderRadius: 8 },
  vinLabelLarge: { fontSize: 16, fontWeight: '800', color: '#e2e8f0', textAlign: 'center' },

  editField: {
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 12,
  },
  inputLabel: { color: '#e5e7eb', marginBottom: 6, fontSize: 13, fontWeight: '900' },
  input: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    color: '#fff',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
  },

  transmissionSelector: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 12,
    borderColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    height: 44,
    overflow: 'hidden',
  },
  transmissionButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  transmissionButtonSelected: { backgroundColor: GREEN },
  transmissionButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  transmissionButtonTextSelected: { color: '#07110a', fontWeight: '900' },

  saveButton: { marginTop: 10, height: 56, borderRadius: 18, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center', width: '92%', alignSelf: 'center' },
  saveButtonText: { color: '#fff', fontSize: 17, fontWeight: '900' },

  EditModalContainer: { width: '100%', height: '100%' },

  decodeBtn: { marginTop: 10, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: GREEN },
  decodeBtnDisabled: { opacity: 0.6 },
  decodeBtnText: { color: '#0f172a', fontSize: 16, fontWeight: '900' },

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
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 12,
  },
  thinkingTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  thinkingSub: { color: '#9aa5b1', fontSize: 13, textAlign: 'center', marginTop: 6 },

  chooserBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.80)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  chooserSheet: { width: '100%', maxWidth: 520, backgroundColor: '#121212', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 16 },
  chooserHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chooserTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  chooserClose: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  chooserCloseText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  chooserSub: { color: '#94a3b8', fontSize: 13, marginTop: 10, textAlign: 'center', lineHeight: 18 },

  chooserBtnPrimary: { marginTop: 12, backgroundColor: GREEN, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  chooserBtnPrimaryText: { color: '#0f172a', fontWeight: '900', fontSize: 14 },

  chooserBtnSecondary: { marginTop: 10, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  chooserBtnSecondaryText: { color: '#fff', fontWeight: '900', fontSize: 14 },
});