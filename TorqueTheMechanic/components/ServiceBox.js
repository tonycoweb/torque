// ServiceBox.js — modern crisp UI (25–45), smart sorting, inverted progress, refined overlays
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Alert,
  Image,
  TextInput,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import DatePicker from 'react-native-date-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showRewardedAd, preloadRewardedAd } from '../components/RewardedAdManager';
import { exportServicesToPdf } from '../utils/servicePdfExporter';

// Tiny helper to animate "..." without extra libs
function AnimatedEllipsis({ style }) {
  const [dots, setDots] = React.useState('');
  React.useEffect(() => {
    const id = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 450);
    return () => clearInterval(id);
  }, []);
  return <Text style={style}>Generating your service list{dots}</Text>;
}

export default function ServiceBox({
  selectedVehicle,
  onUpdateVehicleCurrentMileage,
  onRequestAddVehicle,
}) {
  const [modalVisible, setModalVisible] = useState(false);

  // data
  const [services, setServices] = useState([]);
  const [hasGeneratedServices, setHasGeneratedServices] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // vehicle mileage
  const [vehicleMiles, setVehicleMiles] = useState('');
  const [vehicleMilesInput, setVehicleMilesInput] = useState('');

  // interval inline edit (miles)
  const [editingHeaderId, setEditingHeaderId] = useState(null);
  const [tempHeaderMiles, setTempHeaderMiles] = useState('');
  const headerMilesRef = useRef(null);

  // overlays
  const [overlay, setOverlay] = useState(null); // 'prompt' | 'thinking' | 'edit' | 'image' | 'custom' | 'editMonths' | null
  const [isGenerating, setIsGenerating] = useState(false);

  // export state
  const [isExporting, setIsExporting] = useState(false);

  // prompt overlay
  const [promptMileage, setPromptMileage] = useState('');

  // edit overlay state
  const [editService, setEditService] = useState(null);
  const [tempNotes, setTempNotes] = useState('');
  const [tempCompletedMileage, setTempCompletedMileage] = useState('');
  const [tempDate, setTempDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [date, setDate] = useState(new Date());
  const [pendingCompleteServiceId, setPendingCompleteServiceId] = useState(null);
  const [focusLockServiceId, setFocusLockServiceId] = useState(null);

  // image overlay state
  const [imageForServiceId, setImageForServiceId] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  // custom service overlay
  const [customTitle, setCustomTitle] = useState('');
  const [customInterval, setCustomInterval] = useState('');
  const [customMonths, setCustomMonths] = useState('');
  const [customPriority, setCustomPriority] = useState('low'); // kept for compatibility
  const [customNotes, setCustomNotes] = useState('');

  // edit months overlay
  const [monthsEditServiceId, setMonthsEditServiceId] = useState(null);
  const [monthsInput, setMonthsInput] = useState('');

  const [cameraPermission, requestCameraPermission] = ImagePicker.useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = ImagePicker.useMediaLibraryPermissions();

  const scrollViewRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  const { width } = useWindowDimensions();
  const sheetWidth = Math.min(width - 24, 720);

  // ---------- helpers ----------
  const digitsOnly = (s) => String(s ?? '').replace(/[^\d]/g, '');
  const formatThousands = (numStr) => digitsOnly(numStr).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const normalizeNumber = (input) => {
    const clean = digitsOnly(input);
    return { display: formatThousands(clean), value: clean ? parseInt(clean, 10) : undefined };
  };
  const formatDateDisplay = (d) => {
    try {
      const dateObj = typeof d === 'string' ? new Date(d) : d;
      if (!dateObj || isNaN(dateObj.getTime())) return 'N/A';
      const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
      const dd = String(dateObj.getDate()).padStart(2, '0');
      const yyyy = dateObj.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    } catch {
      return 'N/A';
    }
  };

  const getPrefillMileage = async () => {
    const v = selectedVehicle || {};
    if (v?.id) {
      const overridden = await AsyncStorage.getItem(`vehicleMileage_${v.id}`);
      if (overridden != null) return overridden;
    }
    const m = v.currentMileage ?? v.odometer ?? v.mileage ?? '';
    return String(m || '');
  };

  const computeDueMiles = (svc) => {
    if (!svc.intervalMiles) return undefined;
    const completed =
      svc.completedMileageNumber ??
      (svc.completedMileage ? parseInt(digitsOnly(svc.completedMileage), 10) : undefined);
    if (!Number.isFinite(completed)) return undefined;
    return completed + svc.intervalMiles;
  };

  const computeDueDateIso = (svc) => {
    if (!svc.intervalMonths) return undefined;
    const baseDateIso = svc.lastCompletedDate || null;
    if (!baseDateIso) return undefined;
    const base = new Date(baseDateIso);
    if (isNaN(base.getTime())) return undefined;
    const next = new Date(base);
    next.setMonth(next.getMonth() + svc.intervalMonths);
    return next.toISOString();
  };

  const daysUntil = (iso) => {
    if (!iso) return undefined;
    const now = new Date();
    const due = new Date(iso);
    if (isNaN(due.getTime())) return undefined;
    const diff = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  const recalcAllDues = (arr) =>
    arr.map((svc) => {
      const due = computeDueMiles(svc);
      const dueDate = computeDueDateIso(svc);
      return {
        ...svc,
        dueMilesNumber: due,
        dueDisplay: due ? `${formatThousands(String(due))} mi` : '—',
        dueDateIso: dueDate,
      };
    });

  const getRemainingMiles = (svc, currentMilesNumber) => {
    if (!currentMilesNumber) return undefined;
    const due = svc.dueMilesNumber ?? computeDueMiles(svc);
    if (!due) return undefined;
    return due - currentMilesNumber;
  };

  const getSeverityForService = (svc, currentMilesNumber) => {
    const hasFirstCompletion = !!(svc.completedMileageNumber || svc.completedMileage || svc.lastCompletedDate);
    if (!hasFirstCompletion) return 'red';

    let mileSeverity = 'neutral';
    if (svc.intervalMiles && currentMilesNumber) {
      const remaining = getRemainingMiles(svc, currentMilesNumber);
      if (remaining != null) {
        if (remaining <= 0) mileSeverity = 'red';
        else if (remaining <= Math.max(500, Math.round(svc.intervalMiles * 0.2))) mileSeverity = 'yellow';
        else mileSeverity = 'green';
      }
    }

    let timeSeverity = 'neutral';
    if (svc.intervalMonths && svc.dueDateIso) {
      const d = daysUntil(svc.dueDateIso);
      if (d != null) {
        if (d <= 0) timeSeverity = 'red';
        else if (d <= Math.max(15, Math.round(svc.intervalMonths * 30 * 0.2))) timeSeverity = 'yellow';
        else timeSeverity = 'green';
      }
    }

    const order = { red: 3, yellow: 2, green: 1, neutral: 0 };
    const worst = (a, b) => (order[b] > order[a] ? b : a);
    return worst(mileSeverity, timeSeverity) === 'neutral' ? 'green' : worst(mileSeverity, timeSeverity);
  };

  const autoUnmarkIfOverdue = (arr, currentMilesNumber) => {
    let changed = false;
    const now = new Date();
    const next = arr.map((svc) => {
      const overdueByMiles =
        svc.completed && svc.dueMilesNumber && currentMilesNumber && currentMilesNumber >= svc.dueMilesNumber;
      const overdueByTime = svc.completed && svc.dueDateIso && now >= new Date(svc.dueDateIso);
      if (overdueByMiles || overdueByTime) {
        changed = true;
        return { ...svc, completed: false };
      }
      return svc;
    });
    if (changed) {
      // optional toast
    }
    return next;
  };

  const persistVehicleMiles = async (value) => {
    if (!selectedVehicle?.id) return;
    try {
      await AsyncStorage.setItem(`vehicleMileage_${selectedVehicle.id}`, String(value ?? ''));
    } catch {}
  };

  // ---------- progress helper (INVERTED) ----------
  const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
  const getOriginalProgress = (svc, currentMilesNumber) => {
    if (
      svc.intervalMiles &&
      Number.isFinite(svc.intervalMiles) &&
      Number.isFinite(svc.completedMileageNumber) &&
      Number.isFinite(currentMilesNumber)
    ) {
      const start = svc.completedMileageNumber;
      const end = svc.completedMileageNumber + svc.intervalMiles;
      if (end > start) return clamp((currentMilesNumber - start) / (end - start));
    }
    if (svc.intervalMonths && svc.lastCompletedDate) {
      const start = new Date(svc.lastCompletedDate).getTime();
      const end = new Date(new Date(svc.lastCompletedDate)).setMonth(
        new Date(svc.lastCompletedDate).getMonth() + svc.intervalMonths
      );
      const now = Date.now();
      if (end > start) return clamp((now - start) / (end - start));
    }
    return 0;
  };
  const getInvertedProgress = (svc, currentMilesNumber) => {
    const p = getOriginalProgress(svc, currentMilesNumber);
    return clamp(1 - p, 0, 1);
  };
  const getProgressColor = (p) => {
    if (p <= 0.2) return '#ef4444';
    if (p <= 0.4) return '#f59e0b';
    return '#22c55e';
  };

  // ---- sorting & filtering helpers ----
  const severityRank = { red: 3, yellow: 2, green: 1, neutral: 0 };
  const priorityRank = { high: 2, medium: 1, low: 0 };
  const safeTitle = (svc) => String(svc?.text || '').toLowerCase();

  const compareServicesFactory = (currentMilesNumber, searchLower) => (a, b) => {
    const bucket = (s) => (!s.applies ? 3 : s.completed ? 2 : 1);
    const ba = bucket(a),
      bb = bucket(b);
    if (ba !== bb) return ba - bb;

    if (ba === 1 && bb === 1) {
      const sa = severityRank[getSeverityForService(a, currentMilesNumber)] ?? 0;
      const sb = severityRank[getSeverityForService(b, currentMilesNumber)] ?? 0;
      if (sa !== sb) return sb - sa;

      const remA = getRemainingMiles(a, currentMilesNumber);
      const remB = getRemainingMiles(b, currentMilesNumber);
      const daysA = daysUntil(a.dueDateIso);
      const daysB = daysUntil(b.dueDateIso);

      const overMilesA = remA != null && remA <= 0 ? Math.abs(remA) : 0;
      const overMilesB = remB != null && remB <= 0 ? Math.abs(remB) : 0;
      if (overMilesA !== overMilesB) return overMilesB - overMilesA;

      const overDaysA = daysA != null && daysA <= 0 ? Math.abs(daysA) : 0;
      const overDaysB = daysB != null && daysB <= 0 ? Math.abs(daysB) : 0;
      if (overDaysA !== overDaysB) return overDaysB - overDaysA;

      const soonMilesA = remA != null && remA > 0 ? remA : Number.POSITIVE_INFINITY;
      const soonMilesB = remB != null && remB > 0 ? remB : Number.POSITIVE_INFINITY;
      if (soonMilesA !== soonMilesB) return soonMilesA - soonMilesB;

      const soonDaysA = daysA != null && daysA > 0 ? daysA : Number.POSITIVE_INFINITY;
      const soonDaysB = daysB != null && daysB > 0 ? daysB : Number.POSITIVE_INFINITY;
      if (soonDaysA !== soonDaysB) return soonDaysA - soonDaysB;

      const pa = priorityRank[a.priority] ?? 0;
      const pb = priorityRank[b.priority] ?? 0;
      if (pa !== pb) return pb - pa;

      if (searchLower) {
        const ia = safeTitle(a).indexOf(searchLower);
        const ib = safeTitle(b).indexOf(searchLower);
        if (ia !== ib) return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
      }
    }

    if (ba === 2 && bb === 2) {
      const da = a.lastCompletedDate ? new Date(a.lastCompletedDate).getTime() : 0;
      const db = b.lastCompletedDate ? new Date(b.lastCompletedDate).getTime() : 0;
      if (da !== db) return da - db;
    }

    return safeTitle(a).localeCompare(safeTitle(b));
  };

  const getSortedServices = (arr, currentMilesNumber, search) => {
    const searchLower = String(search || '').trim().toLowerCase();
    const filtered = !searchLower ? arr : arr.filter((s) => safeTitle(s).includes(searchLower));
    return filtered.slice().sort(compareServicesFactory(currentMilesNumber, searchLower));
  };

  // ---------- load/save ----------
  useEffect(() => {
    const loadData = async () => {
      if (!selectedVehicle?.id) {
        setServices([]);
        setHasGeneratedServices(false);
        setVehicleMiles('');
        setVehicleMilesInput('');
        setModalVisible(false);
        setOverlay(null);
        return;
      }
      try {
        const [storedServicesStr, generatedFlag, vm] = await Promise.all([
          AsyncStorage.getItem(`servicesData_${selectedVehicle.id}`),
          AsyncStorage.getItem(`generatedServices_${selectedVehicle.id}`),
          getPrefillMileage(),
        ]);
        const parsed = storedServicesStr ? JSON.parse(storedServicesStr) : [];
        const withDues = recalcAllDues(parsed);
        setServices(withDues);
        setHasGeneratedServices(!!generatedFlag);
        setVehicleMiles(vm || '');
        setVehicleMilesInput(formatThousands(vm || ''));
      } catch {
        setServices([]);
        setHasGeneratedServices(false);
      }
    };
    loadData();
  }, [selectedVehicle]);

  useEffect(() => {
    if (modalVisible) {
      try {
        preloadRewardedAd();
      } catch {}
    }
  }, [modalVisible]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const saveServicesToStorage = async (updated) => {
    if (!selectedVehicle?.id) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await AsyncStorage.setItem(`servicesData_${selectedVehicle.id}`, JSON.stringify(updated));
      } catch {}
    }, 120);
  };

  // ---------- generate flow ----------
  const handleGeneratePress = async () => {
    if (!selectedVehicle?.id) {
      if (onRequestAddVehicle) onRequestAddVehicle();
      else Alert.alert('Add Vehicle', 'Add your vehicle first to generate a service report.');
      return;
    }
    const pm = await getPrefillMileage();
    setPromptMileage(pm ? String(pm) : '');
    setOverlay('prompt');
  };

  const startGenerationAfterMileage = async () => {
    if (!selectedVehicle?.id) {
      setOverlay(null);
      return;
    }
    if (isGenerating) return;

    setOverlay('thinking');
    setIsGenerating(true);

    try {
      let adOK = false;
      try {
        adOK = await showRewardedAd();
      } catch {}
      if (!adOK) {
        Alert.alert('Ad Required', 'Please watch the ad to generate service recommendations.');
        setOverlay(null);
        return;
      }

      await handleConfirmGenerate();
      setTimeout(() => scrollViewRef.current?.scrollToEnd?.({ animated: true }), 350);
    } catch (e) {
      Alert.alert('Error', String(e?.message || e));
    } finally {
      setIsGenerating(false);
      setOverlay(null);
    }
  };

  const handleConfirmGenerate = async () => {
    const mileageValue = parseInt(digitsOnly(promptMileage), 10) || undefined;
    const payload = { vehicle: selectedVehicle, currentMileage: mileageValue };
    const url = 'http://192.168.1.246:3001/generate-service-recommendations';

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    const sanitized = Array.isArray(data.result)
      ? data.result.map((item) => ({
          text: String(item.text || ''),
          priority: ['high', 'medium', 'low'].includes(String(item.priority || '').toLowerCase())
            ? String(item.priority).toLowerCase()
            : 'low',
          intervalMiles: Number.isFinite(Number(item.mileage)) ? Number(item.mileage) : undefined,
          intervalMonths: Number.isFinite(Number(item.time_months)) ? Number(item.time_months) : undefined,
          applies: Boolean(item.applies),
        }))
      : [];

    const newServices = sanitized.map((s, i) => ({
      id: Date.now().toString() + i,
      text: s.text,
      priority: s.priority,
      intervalMiles: s.intervalMiles,
      intervalMonths: s.intervalMonths,
      applies: s.applies,
      completed: false,
      proofUris: [],
      notes: '',
      completedMileage: '',
      completedMileageNumber: undefined,
      date: 'N/A',
      lastCompletedDate: undefined,
      dueDisplay: '—',
      dueMilesNumber: undefined,
      dueDateIso: undefined,
    }));

    setServices(newServices);
    await saveServicesToStorage(newServices);

    if (selectedVehicle?.id) {
      await AsyncStorage.setItem(`generatedServices_${selectedVehicle.id}`, 'true');
      await persistVehicleMiles(mileageValue ?? '');
    }

    setVehicleMiles(mileageValue ? String(mileageValue) : '');
    setVehicleMilesInput(formatThousands(mileageValue ? String(mileageValue) : ''));
    setHasGeneratedServices(true);
  };

  // ---------- export flow ----------
  const vehicleLabel = (() => {
    const v = selectedVehicle || {};
    const year = v.year ? String(v.year) : '';
    const base = [year, v.make, v.model].filter(Boolean).join(' ');
    return base || 'vehicle';
  })();

  const handleExportServices = async () => {
    if (isExporting) return;
    if (!services || services.length === 0) {
      Alert.alert('No Services', 'There are no services to export yet.');
      return;
    }

    try {
      setIsExporting(true);
      await exportServicesToPdf({
        services,
        vehicleLabel,
      });
    } catch (err) {
      console.warn('Export error:', err);
      Alert.alert('Export Failed', String(err?.message || err));
    } finally {
      setIsExporting(false);
    }
  };

  // ---------- mark complete / unmark ----------
  const handleMarkCompleted = (id) => {
    const svc = services.find((s) => s.id === id);
    if (!svc) return;
    setPendingCompleteServiceId(id);
    setFocusLockServiceId(id);
    openEditDetails(svc);
  };

  const handleUnmarkCompleted = (id) => {
    Alert.alert('Unmark Completed', 'Are you sure you want to unmark this service?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes',
        onPress: () => {
          setServices((prev) => {
            const updated = prev.map((s) => (s.id === id ? { ...s, completed: false } : s));
            const withDues = recalcAllDues(updated);
            saveServicesToStorage(withDues);
            return withDues;
          });
        },
      },
    ]);
  };

  // ---------- proofs ----------
  const handleUploadProof = async (serviceId) => {
    Alert.alert('Attach Proof', 'Choose an option', [
      {
        text: 'Camera',
        onPress: async () => {
          const cam = await requestCameraPermission();
          if (!cam.granted) return Alert.alert('Camera permission required');
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
          });
          if (!result.canceled && result.assets?.[0]?.uri) {
            await addProof(serviceId, result.assets[0].uri);
          }
        },
      },
      {
        text: 'Photo Library',
        onPress: async () => {
          const lib = await requestMediaPermission();
          if (!lib.granted) return Alert.alert('Photo library permission required');
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
          });
          if (!result.canceled && result.assets?.[0]?.uri) {
            await addProof(serviceId, result.assets[0].uri);
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // copy proof into documentDirectory so it’s readable later for PDFs
  const addProof = async (serviceId, uri) => {
    try {
      const filename = uri.split('/').pop() || `proof-${Date.now()}.jpg`;
      const destPath =
        FileSystem.documentDirectory + `proofs-${selectedVehicle?.id || 'generic'}-${filename}`;

      await FileSystem.copyAsync({ from: uri, to: destPath });

      setServices((prev) => {
        const updated = prev.map((s) =>
          s.id === serviceId ? { ...s, proofUris: [...(s.proofUris || []), destPath] } : s
        );
        saveServicesToStorage(updated);
        return updated;
      });
    } catch (err) {
      console.warn('Failed to cache proof image:', err);
      Alert.alert('Image Error', 'Could not save this proof image for export.');
    }
  };

  const deleteImage = (serviceId, index) => {
    setServices((prev) => {
      const updated = prev.map((s) => {
        if (s.id === serviceId) {
          const copy = [...(s.proofUris || [])];
          copy.splice(index, 1);
          return { ...s, proofUris: copy };
        }
        return s;
      });
      saveServicesToStorage(updated);
      return updated;
    });
    setCurrentIndex((i) => Math.max(0, i - 1));
  };

  const downloadImage = async (uri) => {
    const filename = uri.split('/').pop();
    const newPath = FileSystem.documentDirectory + filename;
    try {
      await FileSystem.copyAsync({ from: uri, to: newPath });
      const asset = await MediaLibrary.createAssetAsync(newPath);
      await MediaLibrary.createAlbumAsync('Download', asset, false);
      Alert.alert('Saved', 'Image saved to Photos.');
    } catch {
      Alert.alert('Error', 'Failed to save image.');
    }
  };

  // ---------- edit details overlay ----------
  const openEditDetails = (service) => {
    setEditService(service);
    setTempNotes(service.notes || '');
    const initial =
      service.completedMileageNumber != null
        ? String(service.completedMileageNumber)
        : service.completedMileage || '';
    setTempCompletedMileage(formatThousands(initial));
    setTempDate(
      service.lastCompletedDate
        ? formatDateDisplay(service.lastCompletedDate)
        : service.date && service.date !== 'N/A'
        ? service.date
        : ''
    );
    setOverlay('edit');
  };

  const saveEditDetails = () => {
    if (!editService) return;

    const { display, value } = normalizeNumber(tempCompletedMileage);
    if (pendingCompleteServiceId === editService.id && !value) {
      Alert.alert('Completed Mileage Required', 'Please enter the mileage when you performed this service.');
      return;
    }

    let parsedDate;
    if (tempDate) {
      const [mm, dd, yyyy] = tempDate.split('/');
      if (mm && dd && yyyy) parsedDate = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    }

    setServices((prev) => {
      const updated = prev.map((svc) => {
        if (svc.id !== editService.id) return svc;

        let next = {
          ...svc,
          notes: tempNotes,
          completedMileage: display || '',
          completedMileageNumber: value,
          date:
            tempDate ||
            (pendingCompleteServiceId === svc.id ? formatDateDisplay(new Date()) : svc.date || 'N/A'),
          lastCompletedDate: parsedDate
            ? parsedDate.toISOString()
            : pendingCompleteServiceId === svc.id
            ? new Date().toISOString()
            : svc.lastCompletedDate,
        };

        if (pendingCompleteServiceId === svc.id) next.completed = true;

        const dueM = computeDueMiles(next);
        next.dueMilesNumber = dueM;
        next.dueDisplay = dueM ? `${formatThousands(String(dueM))} mi` : '—';
        next.dueDateIso = computeDueDateIso(next);

        return next;
      });

      const currentMilesNumber = parseInt(digitsOnly(vehicleMiles), 10) || undefined;
      const withAuto = autoUnmarkIfOverdue(recalcAllDues(updated), currentMilesNumber);

      saveServicesToStorage(withAuto);
      return withAuto;
    });

    setOverlay(null);
    setPendingCompleteServiceId(null);
    setEditService(null);
    setFocusLockServiceId(null);
  };

  // ---------- interval inline save (miles) ----------
  const saveIntervalInline = (serviceId) => {
    const { value } = normalizeNumber(tempHeaderMiles);
    setServices((prev) => {
      const updated = prev.map((s) => (s.id === serviceId ? { ...s, intervalMiles: value } : s));
      const idx = updated.findIndex((u) => u.id === serviceId);
      if (idx >= 0) {
        const due = computeDueMiles(updated[idx]);
        updated[idx].dueMilesNumber = due;
        updated[idx].dueDisplay = due ? `${formatThousands(String(due))} mi` : '—';
        updated[idx].dueDateIso = computeDueDateIso(updated[idx]);
      }
      saveServicesToStorage(updated);
      return updated;
    });
    setEditingHeaderId(null);
    setTempHeaderMiles('');
  };

  // ---------- months editor overlay ----------
  const openMonthsEditor = (service) => {
    setMonthsEditServiceId(service.id);
    setMonthsInput(service.intervalMonths ? String(service.intervalMonths) : '');
    setOverlay('editMonths');
  };

  const saveMonthsEdit = () => {
    const n = parseInt(digitsOnly(monthsInput), 10);
    setServices((prev) => {
      const updated = prev.map((s) => {
        if (s.id !== monthsEditServiceId) return s;
        const next = { ...s, intervalMonths: Number.isFinite(n) ? n : undefined };
        next.dueMilesNumber = computeDueMiles(next);
        next.dueDisplay = next.dueMilesNumber ? `${formatThousands(String(next.dueMilesNumber))} mi` : '—';
        next.dueDateIso = computeDueDateIso(next);
        return next;
      });
      saveServicesToStorage(updated);
      return updated;
    });
    setOverlay(null);
    setMonthsEditServiceId(null);
    setMonthsInput('');
  };

  // ---------- custom service ----------
  const openCustomOverlay = () => {
    if (!selectedVehicle?.id) {
      if (onRequestAddVehicle) onRequestAddVehicle();
      else Alert.alert('Add Vehicle', 'Add your vehicle first to add custom services.');
      return;
    }
    setCustomTitle('');
    setCustomInterval('');
    setCustomMonths('');
    setCustomPriority('low');
    setCustomNotes('');
    setOverlay('custom');
  };

  const saveCustomService = () => {
    if (!selectedVehicle?.id) {
      setOverlay(null);
      return;
    }
    if (!customTitle.trim()) {
      Alert.alert('Missing Title', 'Please enter a service title.');
      return;
    }

    const { value: intervalVal } = normalizeNumber(customInterval);
    const monthsVal = parseInt(digitsOnly(customMonths), 10);
    const intervalMonths = Number.isFinite(monthsVal) ? monthsVal : undefined;

    const newService = {
      id: Date.now().toString(),
      text: customTitle.trim(),
      priority: customPriority,
      intervalMiles: intervalVal,
      intervalMonths,
      applies: true,
      completed: false,
      proofUris: [],
      notes: customNotes.trim(),
      completedMileage: '',
      completedMileageNumber: undefined,
      date: 'N/A',
      lastCompletedDate: undefined,
      dueDisplay: '—',
      dueMilesNumber: undefined,
      dueDateIso: undefined,
    };

    const updated = [...services, newService];
    setServices(updated);
    saveServicesToStorage(updated);
    setOverlay(null);
    setTimeout(() => scrollViewRef.current?.scrollToEnd?.({ animated: true }), 200);
  };

  // ---------- vehicle mileage bar ----------
  const saveVehicleMilesAndRecalc = async () => {
    if (!selectedVehicle?.id) return;
    const { value } = normalizeNumber(vehicleMilesInput);
    const display = value ? String(value) : '';

    setVehicleMiles(display);
    setVehicleMilesInput(formatThousands(display));
    await persistVehicleMiles(display);
    onUpdateVehicleCurrentMileage?.(value);

    setServices((prev) => {
      const withDues = recalcAllDues(prev);
      const currentMilesNumber = value || undefined;
      const auto = autoUnmarkIfOverdue(withDues, currentMilesNumber);
      saveServicesToStorage(auto);
      return auto;
    });
  };

  // ---------- close ----------
  const closeAll = () => {
    setOverlay(null);
    setEditService(null);
    setImageForServiceId(null);
    setIsGenerating(false);
    setPendingCompleteServiceId(null);
    setFocusLockServiceId(null);
    setMonthsEditServiceId(null);
    setMonthsInput('');
    setModalVisible(false);
  };

  // ---------- applies toggle ----------
  const applyServiceToVehicle = (id) => {
    setServices((prev) => {
      const updated = prev.map((s) => (s.id === id ? { ...s, applies: true } : s));
      saveServicesToStorage(updated);
      return updated;
    });
  };
  const deactivateServiceForVehicle = (id) => {
    Alert.alert(
      'Make Inactive',
      'This hides it from “urgent” sorting for this vehicle. You can activate it again anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make Inactive',
          style: 'destructive',
          onPress: () => {
            setServices((prev) => {
              const updated = prev.map((s) => (s.id === id ? { ...s, applies: false } : s));
              saveServicesToStorage(updated);
              return updated;
            });
          },
        },
      ]
    );
  };

  // ---------- render ----------
  const currentMilesNumber = parseInt(digitsOnly(vehicleMiles), 10) || undefined;
  const listToRender = getSortedServices(services, currentMilesNumber, searchQuery);

  const hasVehicle = !!selectedVehicle?.id;

  // Validation helpers for overlays
  const customValid = Boolean(customTitle.trim());
  const editMileageRequired = pendingCompleteServiceId === editService?.id;
  const editValid = !editMileageRequired || digitsOnly(tempCompletedMileage).length > 0;

  // Static offsets + padding (your approach)
  const kvo = Platform.OS === 'ios' ? 12 : StatusBar.currentHeight || 0;
  const topPad = Platform.OS === 'ios' ? 48 : StatusBar.currentHeight || 24;

  const recommendedText =
    services.find((s) => !s.completed && s.priority === 'high' && s.applies)?.text ||
    services.find((s) => !s.completed && s.applies)?.text ||
    `No pending service for your ${vehicleLabel}`;

  return (
    <>
      {/* ENTRY CARD */}
      {hasVehicle ? (
        <TouchableOpacity
          style={styles.entryCard}
          onPress={() => setModalVisible(true)}
          disabled={isGenerating}
          activeOpacity={0.9}
        >
          <View style={styles.entryTopRow}>
            <View style={styles.entryPill}>
              <MaterialCommunityIcons name="wrench-outline" size={16} color="#cbd5e1" />
              <Text style={styles.entryPillText}>Service Tracker</Text>
               <MaterialCommunityIcons name="wrench-outline" size={16} color="#cbd5e1" />
          </View>
            </View>
            

          <Text style={styles.entryTitle} numberOfLines={2}>
            {recommendedText}
          </Text>

          <Text style={styles.entrySub} numberOfLines={1}>
            Tap to manage service records
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.entryCard, styles.entryCardDisabled]}
          onPress={() => {
            if (onRequestAddVehicle) onRequestAddVehicle();
            else
              Alert.alert(
                'Add Your Car',
                'Add your ride in the box above first to generate a service report for the added car.'
              );
          }}
          activeOpacity={0.92}
        >
          <View style={styles.entryTopRow}>
            <View style={[styles.entryPill, { opacity: 0.9 }]}>
              <MaterialCommunityIcons name="car-outline" size={16} color="#cbd5e1" />
              <Text style={styles.entryPillText}>Recommended Service</Text>
            </View>
            <MaterialIcons name="add-circle-outline" size={24} color="#cbd5e1" />
          </View>

          <Text style={styles.entryTitle}>Add your vehicle to generate a service report</Text>
          <Text style={styles.entrySub}>VIN scan or manual entry</Text>
        </TouchableOpacity>
      )}

      {/* MAIN MODAL */}
      <Modal
        visible={modalVisible && hasVehicle}
        transparent={false}
        animationType="slide"
        onRequestClose={() => {
          if (!isGenerating) closeAll();
        }}
        presentationStyle="fullScreen"
        statusBarTranslucent={false}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: UI.bg }}
          keyboardVerticalOffset={kvo}
        >
          <View style={[styles.modalWrapper, { paddingTop: topPad }]}>
            <View style={styles.modalBox}>
              {/* Header */}
              <View style={styles.headerRow}>
                <TouchableOpacity
                  onPress={() => Alert.alert('Info', `Managing services for your ${vehicleLabel}.`)}
                  style={styles.headerIconBtn}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="info-outline" size={22} color="#e5e7eb" />
                </TouchableOpacity>

                <View style={{ flex: 1, paddingHorizontal: 10 }}>
                  <Text style={styles.modalSubtitle} numberOfLines={1}>
                    {vehicleLabel}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => {
                    if (!isGenerating) closeAll();
                  }}
                  style={styles.headerIconBtn}
                  disabled={isGenerating}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.modalCloseText, isGenerating && { opacity: 0.4 }]}>×</Text>
                </TouchableOpacity>
              </View>

              {/* ======= CTAs / Mileage ======= */}
              {!hasGeneratedServices ? (
                <View style={styles.topPadBlock}>
                  <TouchableOpacity
                    style={styles.ctaBtnSecondary}
                    onPress={handleGeneratePress}
                    disabled={isGenerating}
                    activeOpacity={0.95}
                  >
                    <MaterialCommunityIcons name="sparkles" size={18} color={UI.textDark} />
                    <Text style={styles.ctaBtnText}>Generate Service Records</Text>
                  </TouchableOpacity>
                  <Text style={styles.ctaHint}>We’ll ask for current mileage first to prioritize what’s urgent.</Text>
                </View>
              ) : (
                <View style={styles.mileageCard}>
                  <Text style={styles.mileageBarLabel}>Current Mileage</Text>
                  <View style={styles.mileageInputRow}>
                    <TextInput
                      style={[styles.inlineInput, { flex: 1 }]}
                      value={vehicleMilesInput}
                      onChangeText={(t) => setVehicleMilesInput(formatThousands(t))}
                      placeholder="e.g., 181,000"
                      placeholderTextColor={UI.muted}
                      keyboardType="numeric"
                      inputMode="numeric"
                      maxLength={12}
                      returnKeyType="done"
                      onSubmitEditing={saveVehicleMilesAndRecalc}
                    />
                    <TouchableOpacity
                      style={styles.mileageSaveBtn}
                      onPress={saveVehicleMilesAndRecalc}
                      activeOpacity={0.9}
                    >
                      <Text style={styles.mileageSaveText}>Save</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.mileageBarHint}>
                    {vehicleMiles
                      ? `Using ${formatThousands(vehicleMiles)} mi to compute urgency.`
                      : 'Set mileage to enable urgency colors.'}
                  </Text>
                </View>
              )}

              {/* SEARCH */}
              <View style={styles.searchRow}>
                <MaterialIcons name="search" size={18} color="#94a3b8" />
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search services (oil, brakes, filter…)"
                  placeholderTextColor={UI.muted}
                  returnKeyType="search"
                />
                {Boolean(searchQuery) && (
                  <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.8} style={styles.searchClear}>
                    <MaterialIcons name="close" size={18} color="#94a3b8" />
                  </TouchableOpacity>
                )}
              </View>

              {/* TOP ACTION ROW: Add Custom + Export */}
              {hasGeneratedServices && (
                <View style={styles.topActionRow}>
                  <TouchableOpacity
                    style={[styles.ctaBtnSoft, { flex: 1 }]}
                    onPress={openCustomOverlay}
                    activeOpacity={0.92}
                    disabled={isExporting}
                  >
                    <MaterialCommunityIcons name="plus" size={18} color="#e5e7eb" />
                    <Text style={styles.ctaBtnSoftText}>Custom</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.ctaBtnPrimary, { flex: 1, opacity: isExporting ? 0.7 : 1 }]}
                    onPress={handleExportServices}
                    activeOpacity={0.92}
                    disabled={isExporting}
                  >
                    <MaterialCommunityIcons name="file-pdf-box" size={18} color={UI.textDark} />
                    <Text style={styles.ctaBtnText}>{isExporting ? 'Exporting…' : 'Export PDF'}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* LIST */}
              <ScrollView
                ref={scrollViewRef}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {listToRender.map((service) => {
                  const isEditing = editingHeaderId === service.id;
                  const severity = getSeverityForService(service, currentMilesNumber);
                  const remaining = getRemainingMiles(service, currentMilesNumber);

                  const severityStyle =
                    severity === 'red'
                      ? styles.serviceSevRed
                      : severity === 'yellow'
                      ? styles.serviceSevYellow
                      : severity === 'green'
                      ? styles.serviceSevGreen
                      : styles.serviceSevNeutral;

                  const dueMilesText = service.dueDisplay && service.dueDisplay !== '—' ? service.dueDisplay : '—';

                  const daysLeft = daysUntil(service.dueDateIso);
                  const dueDateText = service.dueDateIso ? formatDateDisplay(service.dueDateIso) : '—';
                  let timeRemainingText = '';
                  if (daysLeft != null) {
                    timeRemainingText = daysLeft <= 0 ? `OVERDUE by ${Math.abs(daysLeft)} days` : `${daysLeft} days left`;
                  }

                  const isInactive = !service.applies;

                  const progress = getInvertedProgress(service, currentMilesNumber);
                  const barColor = getProgressColor(progress);

                  const healthText =
                    remaining != null
                      ? remaining <= 0
                        ? `0% health • ${formatThousands(String(Math.abs(remaining)))} mi overdue${
                            timeRemainingText ? ` • ${timeRemainingText}` : ''
                          }`
                        : `${Math.max(1, Math.round(progress * 100))}% health • ${formatThousands(String(remaining))} mi left${
                            timeRemainingText ? ` • ${timeRemainingText}` : ''
                          }`
                      : `Updating starts after first completion${timeRemainingText ? ` • ${timeRemainingText}` : ''}`;

                  return (
                    <View key={service.id} style={[styles.serviceItem, styles.serviceCard, severityStyle]}>
                      <View style={styles.sevRail} />

                      {isInactive && (
                        <View style={styles.inactiveRibbon}>
                          <MaterialCommunityIcons name="pause-circle-outline" size={14} color="#e5e7eb" />
                          <Text style={styles.inactiveRibbonText}>Inactive</Text>
                        </View>
                      )}

                      <View style={styles.titleRow}>
                        <View style={{ flex: 1, paddingRight: 10, opacity: isInactive ? 0.58 : 1 }}>
                          <Text style={styles.titleText} numberOfLines={2}>
                            {service.text}
                          </Text>

                          <View style={styles.metaRow}>
                            <TouchableOpacity
                              onPress={() => {
                                setEditingHeaderId(service.id);
                                setTempHeaderMiles(formatThousands(service.intervalMiles ?? ''));
                                setTimeout(() => headerMilesRef.current?.focus?.(), 30);
                              }}
                              activeOpacity={0.85}
                              style={styles.pillPressWrap}
                            >
                              <Text style={styles.pillLink}>
                                {service.intervalMiles ? `${formatThousands(service.intervalMiles)} miles` : 'set miles'}
                              </Text>
                            </TouchableOpacity>

                            <Text style={styles.dot}>•</Text>

                            <View style={styles.pillStaticWrap}>
                              <Text style={styles.pillStaticText}>
                                {service.intervalMonths ? `${service.intervalMonths} months` : 'set time'}
                              </Text>
                              <TouchableOpacity onPress={() => openMonthsEditor(service)} activeOpacity={0.85}>
                                <Text style={styles.pillEdit}>Edit</Text>
                              </TouchableOpacity>
                            </View>

                            {isEditing && (
                              <View style={styles.inlineEditWrap}>
                                <TextInput
                                  ref={headerMilesRef}
                                  style={[styles.inlineInput, { minWidth: 120 }]}
                                  value={tempHeaderMiles}
                                  onChangeText={(t) => setTempHeaderMiles(formatThousands(t))}
                                  placeholder="miles"
                                  placeholderTextColor={UI.muted}
                                  keyboardType="numeric"
                                  inputMode="numeric"
                                  maxLength={12}
                                  returnKeyType="done"
                                  onSubmitEditing={() => saveIntervalInline(service.id)}
                                />
                                <TouchableOpacity style={[styles.smallBtn, styles.smallBtnGood]} onPress={() => saveIntervalInline(service.id)}>
                                  <Text style={styles.smallBtnText}>Save</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.smallBtn, styles.smallBtnBad]}
                                  onPress={() => {
                                    setEditingHeaderId(null);
                                    setTempHeaderMiles('');
                                  }}
                                >
                                  <Text style={styles.smallBtnText}>Cancel</Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        </View>

                        <TouchableOpacity
                          style={styles.deleteBtnBig}
                          onPress={() => {
                            Alert.alert('Delete Service', 'Are you sure?', [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Delete',
                                style: 'destructive',
                                onPress: () => {
                                  setServices((prev) => {
                                    const updated = prev.filter((s) => s.id !== service.id);
                                    saveServicesToStorage(updated);
                                    return updated;
                                  });
                                },
                              },
                            ]);
                          }}
                          activeOpacity={0.85}
                        >
                          <MaterialCommunityIcons name="trash-can-outline" size={18} color="#e5e7eb" />
                        </TouchableOpacity>
                      </View>

                      <View style={styles.badgeRow}>
                        <View style={styles.badge}>
                          <Text style={styles.badgeLabel}>Due Miles</Text>
                          <Text style={styles.badgeValue}>{dueMilesText}</Text>
                        </View>
                        <View style={styles.badge}>
                          <Text style={styles.badgeLabel}>Due Date</Text>
                          <Text style={styles.badgeValue}>{dueDateText}</Text>
                        </View>
                      </View>

                      <View style={styles.progressWrap} accessible accessibilityLabel="Service health">
                        <View
                          style={[
                            styles.progressFill,
                            {
                              width: `${Math.round(progress * 100)}%`,
                              backgroundColor: barColor,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.progressHint}>{healthText}</Text>

                      <View style={styles.detailsPanel}>
                        <View style={styles.detailRow}>
                          <MaterialCommunityIcons name="note-text-outline" size={16} color="#94a3b8" />
                          <Text style={styles.detailKey}>Notes</Text>
                          <Text style={styles.detailVal} numberOfLines={2}>
                            {service.notes || 'N/A'}
                          </Text>
                        </View>
                        <View style={styles.detailRow}>
                          <MaterialCommunityIcons name="counter" size={16} color="#94a3b8" />
                          <Text style={styles.detailKey}>Completed Mileage</Text>
                          <Text style={styles.detailVal}>
                            {service.completedMileage ||
                              (service.completedMileageNumber != null
                                ? formatThousands(service.completedMileageNumber)
                                : 'N/A')}
                          </Text>
                        </View>
                        <View style={styles.detailRow}>
                          <MaterialCommunityIcons name="calendar-month-outline" size={16} color="#94a3b8" />
                          <Text style={styles.detailKey}>Date</Text>
                          <Text style={styles.detailVal}>{service.date || 'N/A'}</Text>
                        </View>
                      </View>

                      {service.proofUris?.length > 0 && (
                        <ScrollView
                          horizontal
                          style={styles.proofRow}
                          contentContainerStyle={styles.proofRowContent}
                          showsHorizontalScrollIndicator={false}
                        >
                          {service.proofUris.map((uri, index) => (
                            <TouchableOpacity
                              key={index}
                              onPress={() => {
                                setImageForServiceId(service.id);
                                setCurrentIndex(index);
                                setOverlay('image');
                              }}
                              style={styles.thumbnailContainer}
                              activeOpacity={0.85}
                            >
                              <Image source={{ uri }} style={styles.thumbnail} />
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      )}

                      <View style={styles.buttonRow}>
                        {!service.applies ? (
                          <TouchableOpacity
                            style={[styles.actionBtn, styles.actionPrimary]}
                            onPress={() => applyServiceToVehicle(service.id)}
                            activeOpacity={0.9}
                          >
                            <MaterialCommunityIcons name="play-circle-outline" size={18} color={UI.textDark} />
                            <Text style={styles.actionTextPrimary}>Activate</Text>
                          </TouchableOpacity>
                        ) : (
                          <>
                            {!service.completed ? (
                              <>
                                <TouchableOpacity
                                  style={[styles.actionBtn, styles.actionPrimary]}
                                  onPress={() => handleMarkCompleted(service.id)}
                                  activeOpacity={0.9}
                                >
                                  <MaterialCommunityIcons name="check-circle-outline" size={18} color={UI.textDark} />
                                  <Text style={styles.actionTextPrimary}>Mark Completed</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                  style={[styles.actionBtn, styles.actionNeutral]}
                                  onPress={() => {
                                    setFocusLockServiceId(service.id);
                                    openEditDetails(service);
                                  }}
                                  activeOpacity={0.9}
                                >
                                  <MaterialIcons name="edit" size={18} color="#e5e7eb" />
                                  <Text style={styles.actionText}>Edit Details</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                  style={[styles.actionBtn, styles.actionOutline]}
                                  onPress={() => handleUploadProof(service.id)}
                                  activeOpacity={0.9}
                                >
                                  <MaterialCommunityIcons name="image-plus" size={18} color="#e5e7eb" />
                                  <Text style={styles.actionText}>Add Proof</Text>
                                </TouchableOpacity>
                              </>
                            ) : (
                              <>
                                <TouchableOpacity
                                  style={[styles.actionBtn, styles.actionNeutral]}
                                  onPress={() => {
                                    setFocusLockServiceId(service.id);
                                    openEditDetails(service);
                                  }}
                                  activeOpacity={0.9}
                                >
                                  <MaterialIcons name="edit" size={18} color="#e5e7eb" />
                                  <Text style={styles.actionText}>Edit Details</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                  style={[styles.actionBtn, styles.actionOutline]}
                                  onPress={() => handleUploadProof(service.id)}
                                  activeOpacity={0.9}
                                >
                                  <MaterialCommunityIcons name="plus-circle-outline" size={18} color="#e5e7eb" />
                                  <Text style={styles.actionText}>Add Proof</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                  style={[styles.actionBtn, styles.actionNeutral]}
                                  onPress={() => handleUnmarkCompleted(service.id)}
                                  activeOpacity={0.9}
                                >
                                  <MaterialCommunityIcons name="refresh" size={18} color="#e5e7eb" />
                                  <Text style={styles.actionText}>Unmark</Text>
                                </TouchableOpacity>
                              </>
                            )}

                            <TouchableOpacity
                              style={[styles.actionBtn, styles.actionPurple]}
                              onPress={() => deactivateServiceForVehicle(service.id)}
                              activeOpacity={0.9}
                            >
                              <MaterialCommunityIcons name="pause-circle-outline" size={18} color="#e5e7eb" />
                              <Text style={styles.actionText}>Make Inactive</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>
                  );
                })}

                {/* little spacer so last card clears bottom */}
                <View style={{ height: 44 }} />
              </ScrollView>

              {/* ===================== OVERLAYS ===================== */}

              {/* THINKING */}
              {overlay === 'thinking' && (
                <View style={styles.overlay} pointerEvents="auto" accessible accessibilityLabel="Generating services, please wait">
                  <View style={styles.thinkingCard}>
                    <View style={styles.spinnerRow}>
                      <ActivityIndicator size="large" />
                    </View>
                    <Text style={styles.thinkingTitle}>Torque is thinking</Text>
                    <AnimatedEllipsis style={styles.thinkingSub} />
                  </View>
                </View>
              )}

              {/* PROMPT */}
              {overlay === 'prompt' && (
                <View style={styles.overlay}>
                  <View style={[styles.sheet, { width: sheetWidth }]}>
                    <View style={styles.sheetHeader}>
                      <Text style={styles.sheetTitle}>Current Mileage</Text>
                      <TouchableOpacity onPress={() => setOverlay(null)} style={styles.sheetClose} activeOpacity={0.85}>
                        <Text style={styles.sheetCloseText}>×</Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.labelStrong}>Enter mileage for your {vehicleLabel}</Text>
                    <TextInput
                      style={styles.inputLg}
                      value={formatThousands(promptMileage)}
                      onChangeText={(t) => setPromptMileage(digitsOnly(t))}
                      placeholder="e.g., 181000"
                      placeholderTextColor={UI.muted}
                      keyboardType="numeric"
                      inputMode="numeric"
                      maxLength={12}
                      autoFocus
                      returnKeyType="done"
                      onSubmitEditing={startGenerationAfterMileage}
                    />
                    <Text style={styles.helperText}>This helps prioritize urgent services first.</Text>

                    <View style={styles.sheetFooterRow}>
                      <TouchableOpacity onPress={() => setOverlay(null)} style={styles.btnGrey} activeOpacity={0.9}>
                        <Text style={styles.btnText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={startGenerationAfterMileage} style={styles.btnGreen} disabled={isGenerating} activeOpacity={0.9}>
                        <Text style={[styles.btnText, { fontWeight: '800', color: UI.textDark }]}>Continue</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}

              {/* EDIT DETAILS */}
              {overlay === 'edit' && editService && (
                <View style={styles.overlay}>
                  <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    style={{ width: sheetWidth }}
                    keyboardVerticalOffset={kvo}
                  >
                    <View style={[styles.sheet, { width: '100%' }]}>
                      <View style={styles.sheetHeader}>
                        <Text style={styles.sheetTitle}>Edit Details</Text>
                        <TouchableOpacity
                          onPress={() => {
                            setOverlay(null);
                            setEditService(null);
                            setPendingCompleteServiceId(null);
                            setFocusLockServiceId(null);
                          }}
                          style={styles.sheetClose}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.sheetCloseText}>×</Text>
                        </TouchableOpacity>
                      </View>

                      {pendingCompleteServiceId === editService.id ? (
                        <Text style={[styles.banner, { backgroundColor: 'rgba(34,197,94,0.14)', borderColor: '#22c55e' }]}>
                          Marking as completed — completion mileage is required.
                        </Text>
                      ) : null}

                      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
                        <View style={styles.formRow}>
                          <View style={styles.formCol}>
                            <Text style={styles.labelStrong}>Completed Mileage {editMileageRequired ? '(required)' : ''}</Text>
                            <View style={styles.inputRow}>
                              <MaterialCommunityIcons name="counter" size={18} color="#94a3b8" />
                              <TextInput
                                style={[styles.input, { flex: 1 }]}
                                value={tempCompletedMileage}
                                onChangeText={(t) => setTempCompletedMileage(formatThousands(t))}
                                placeholder="e.g., 181,000"
                                placeholderTextColor={UI.muted}
                                keyboardType="numeric"
                                inputMode="numeric"
                                maxLength={12}
                              />
                            </View>
                            <Text style={[styles.helperText, !editValid && { color: '#fecaca' }]}>
                              {editMileageRequired
                                ? 'Enter the mileage when you performed this service.'
                                : 'Optional if you’re only updating notes or date.'}
                            </Text>
                          </View>

                          <View style={styles.formCol}>
                            <Text style={styles.labelStrong}>Date</Text>
                            <TouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.inputRowButton} activeOpacity={0.9}>
                              <MaterialCommunityIcons name="calendar-month-outline" size={18} color="#94a3b8" />
                              <Text style={styles.inputRowButtonText}>{tempDate || 'Select date'}</Text>
                              <MaterialIcons name="edit-calendar" size={18} color="#cbd5e1" style={{ marginLeft: 'auto' }} />
                            </TouchableOpacity>
                            <Text style={styles.helperText}>Tap to choose a completion date.</Text>
                          </View>
                        </View>

                        <View style={{ marginTop: 10 }}>
                          <Text style={styles.labelStrong}>Notes</Text>
                          <TextInput
                            style={styles.inputMultiline}
                            value={tempNotes}
                            onChangeText={setTempNotes}
                            placeholder="Part numbers, capacities, fluids, torque specs…"
                            placeholderTextColor={UI.muted}
                            multiline
                          />
                          <Text style={styles.helperText}>Example: 5W-30 • 4.5 qt • NGK 93175</Text>
                        </View>
                      </ScrollView>

                      <View style={styles.sheetFooterRow}>
                        <TouchableOpacity
                          onPress={() => {
                            setOverlay(null);
                            setEditService(null);
                            setPendingCompleteServiceId(null);
                            setFocusLockServiceId(null);
                          }}
                          style={styles.btnGrey}
                          activeOpacity={0.9}
                        >
                          <Text style={styles.btnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={saveEditDetails}
                          style={[styles.btnGreen, !editValid && { opacity: 0.6 }]}
                          disabled={!editValid}
                          activeOpacity={0.9}
                        >
                          <Text style={[styles.btnText, { fontWeight: '900', color: UI.textDark }]}>Save</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </KeyboardAvoidingView>

                  <DatePicker
                    modal
                    open={showDatePicker}
                    date={date}
                    mode="date"
                    onConfirm={(d) => {
                      setShowDatePicker(false);
                      setDate(d);
                      setTempDate(formatDateDisplay(d));
                    }}
                    onCancel={() => setShowDatePicker(false)}
                  />
                </View>
              )}

              {/* IMAGE VIEWER */}
              {overlay === 'image' && imageForServiceId && (
                <View style={styles.overlay}>
                  <View style={styles.viewerShell}>
                    <View style={styles.viewerTopBar}>
                      <TouchableOpacity onPress={() => { setOverlay(null); setImageForServiceId(null); }} activeOpacity={0.85}>
                        <Text style={styles.viewerTopBarText}>Close</Text>
                      </TouchableOpacity>

                      <View style={{ flexDirection: 'row' }}>
                        <TouchableOpacity
                          style={styles.viewerTopBtn}
                          onPress={() => {
                            const svc = services.find((s) => s.id === imageForServiceId);
                            const uri = svc?.proofUris?.[currentIndex];
                            if (uri) downloadImage(uri);
                          }}
                          activeOpacity={0.9}
                        >
                          <MaterialIcons name="file-download" size={20} color="#e5e7eb" />
                          <Text style={styles.viewerTopBarText}> Save</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.viewerTopBtn, { marginLeft: 12 }]}
                          onPress={() => {
                            const svc = services.find((s) => s.id === imageForServiceId);
                            if (!svc) return;
                            deleteImage(imageForServiceId, currentIndex);
                          }}
                          activeOpacity={0.9}
                        >
                          <MaterialCommunityIcons name="trash-can-outline" size={20} color="#e5e7eb" />
                          <Text style={styles.viewerTopBarText}> Delete</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View style={styles.viewerImageWrap}>
                      {(() => {
                        const svc = services.find((s) => s.id === imageForServiceId);
                        const uri = svc?.proofUris?.[currentIndex];
                        return uri ? (
                          <Image source={{ uri }} resizeMode="contain" style={styles.viewerImage} />
                        ) : (
                          <Text style={{ color: '#fff' }}>No image</Text>
                        );
                      })()}
                    </View>

                    {(() => {
                      const svc = services.find((s) => s.id === imageForServiceId);
                      const total = svc?.proofUris?.length || 0;
                      if (total <= 1) return null;
                      return (
                        <>
                          <TouchableOpacity
                            style={[styles.chevron, { left: 10 }]}
                            onPress={() => setCurrentIndex((i) => (i - 1 + total) % total)}
                            activeOpacity={0.85}
                          >
                            <MaterialIcons name="chevron-left" size={38} color="#e5e7eb" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.chevron, { right: 10 }]}
                            onPress={() => setCurrentIndex((i) => (i + 1) % total)}
                            activeOpacity={0.85}
                          >
                            <MaterialIcons name="chevron-right" size={38} color="#e5e7eb" />
                          </TouchableOpacity>
                          <View style={styles.pager}>
                            <Text style={styles.pagerText}>{currentIndex + 1}/{total}</Text>
                          </View>
                        </>
                      );
                    })()}
                  </View>
                </View>
              )}

              {/* ADD CUSTOM SERVICE */}
              {overlay === 'custom' && (
                <View style={styles.overlay}>
                  <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    style={{ width: sheetWidth }}
                    keyboardVerticalOffset={kvo}
                  >
                    <View style={[styles.sheet, { width: '100%' }]}>
                      <View style={styles.sheetHeader}>
                        <Text style={styles.sheetTitle}>Add Custom Service</Text>
                        <TouchableOpacity onPress={() => setOverlay(null)} style={styles.sheetClose} activeOpacity={0.85}>
                          <Text style={styles.sheetCloseText}>×</Text>
                        </TouchableOpacity>
                      </View>

                      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
                        <Text style={styles.labelStrong}>Title *</Text>
                        <View style={styles.inputRow}>
                          <MaterialCommunityIcons name="wrench-outline" size={18} color="#94a3b8" />
                          <TextInput
                            style={[styles.input, { flex: 1 }]}
                            value={customTitle}
                            onChangeText={setCustomTitle}
                            placeholder="e.g., Rear Differential Fluid Change"
                            placeholderTextColor={UI.muted}
                          />
                        </View>
                        <Text style={[styles.helperText, !customValid && { color: '#fecaca' }]}>
                          Short, clear action (e.g., “Engine Oil & Filter”, “Coolant Flush”)
                        </Text>

                        <View style={styles.formRow}>
                          <View style={styles.formCol}>
                            <Text style={styles.labelStrong}>Interval (miles)</Text>
                            <View style={styles.inputRow}>
                              <MaterialCommunityIcons name="counter" size={18} color="#94a3b8" />
                              <TextInput
                                style={[styles.input, { flex: 1 }]}
                                value={customInterval}
                                onChangeText={(t) => setCustomInterval(formatThousands(t))}
                                placeholder="e.g., 30,000"
                                placeholderTextColor={UI.muted}
                                keyboardType="numeric"
                                inputMode="numeric"
                                maxLength={12}
                              />
                            </View>
                            <Text style={styles.helperText}>Leave blank if time-based only.</Text>
                          </View>

                          <View style={styles.formCol}>
                            <Text style={styles.labelStrong}>Interval (months)</Text>
                            <View style={styles.inputRow}>
                              <MaterialCommunityIcons name="clock-outline" size={18} color="#94a3b8" />
                              <TextInput
                                style={[styles.input, { flex: 1 }]}
                                value={customMonths}
                                onChangeText={(t) => setCustomMonths(digitsOnly(t))}
                                placeholder="e.g., 24"
                                placeholderTextColor={UI.muted}
                                keyboardType="numeric"
                                inputMode="numeric"
                                maxLength={3}
                              />
                            </View>
                            <Text style={styles.helperText}>Leave blank if mileage-based only.</Text>
                          </View>
                        </View>

                        <Text style={styles.labelStrong}>Priority</Text>
                        <View style={styles.segmentRow}>
                          {['low', 'medium', 'high'].map((p) => {
                            const active = customPriority === p;
                            return (
                              <TouchableOpacity
                                key={p}
                                onPress={() => setCustomPriority(p)}
                                style={[styles.segment, active && styles.segmentActive]}
                                activeOpacity={0.9}
                              >
                                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                                  {p[0].toUpperCase() + p.slice(1)}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>

                        <Text style={styles.labelStrong}>Notes (optional)</Text>
                        <TextInput
                          style={styles.inputMultiline}
                          value={customNotes}
                          onChangeText={setCustomNotes}
                          placeholder="Part numbers, fluid specs, torque values, reminders…"
                          placeholderTextColor={UI.muted}
                          multiline
                        />
                        <Text style={styles.helperText}>Example: 0W-20 full synthetic • 4.4 qt • OEM 15208-65F0E</Text>
                      </ScrollView>

                      <View style={styles.sheetFooterRow}>
                        <TouchableOpacity onPress={() => setOverlay(null)} style={styles.btnGrey} activeOpacity={0.9}>
                          <Text style={styles.btnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={saveCustomService}
                          style={[styles.btnGreen, !customValid && { opacity: 0.6 }]}
                          disabled={!customValid}
                          activeOpacity={0.9}
                        >
                          <Text style={[styles.btnText, { fontWeight: '900', color: UI.textDark }]}>Save</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </KeyboardAvoidingView>
                </View>
              )}

              {/* MONTHS EDITOR */}
              {overlay === 'editMonths' && (
                <View style={styles.overlay}>
                  <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    style={{ width: sheetWidth }}
                    keyboardVerticalOffset={kvo}
                  >
                    <View style={[styles.sheet, { width: '100%' }]}>
                      <View style={styles.sheetHeader}>
                        <Text style={styles.sheetTitle}>Interval (Months)</Text>
                        <TouchableOpacity
                          onPress={() => {
                            setOverlay(null);
                            setMonthsEditServiceId(null);
                            setMonthsInput('');
                          }}
                          style={styles.sheetClose}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.sheetCloseText}>×</Text>
                        </TouchableOpacity>
                      </View>

                      <Text style={styles.labelStrong}>Months</Text>
                      <TextInput
                        style={styles.inputLg}
                        value={monthsInput}
                        onChangeText={(t) => setMonthsInput(digitsOnly(t))}
                        placeholder="e.g., 6"
                        placeholderTextColor={UI.muted}
                        keyboardType="numeric"
                        inputMode="numeric"
                        maxLength={3}
                        autoFocus
                      />
                      <Text style={styles.helperText}>Leave blank to remove the time-based interval.</Text>

                      <View style={styles.sheetFooterRow}>
                        <TouchableOpacity
                          onPress={() => {
                            setOverlay(null);
                            setMonthsEditServiceId(null);
                            setMonthsInput('');
                          }}
                          style={styles.btnGrey}
                          activeOpacity={0.9}
                        >
                          <Text style={styles.btnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={saveMonthsEdit} style={styles.btnGreen} activeOpacity={0.9}>
                          <Text style={[styles.btnText, { fontWeight: '900', color: UI.textDark }]}>Save</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </KeyboardAvoidingView>
                </View>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

/* ===================== THEME ===================== */
const UI = {
  bg: '#0b0f17',
  panel: '#0f1623',
  card: '#111a2a',
  card2: '#0e1626',
  border: 'rgba(255,255,255,0.08)',
  border2: 'rgba(255,255,255,0.12)',
  text: '#e5e7eb',
  text2: '#cbd5e1',
  muted: '#94a3b8',
  muted2: '#64748b',
  textDark: '#0b1220',
  blue: '#3b82f6',
  green: '#22c55e',
  purple: '#8b5cf6',
};

const styles = StyleSheet.create({
  /* ===== Entry Tile ===== */
  entryCard: {
  backgroundColor: '#2a2a2a',
    paddingVertical: 40,
    paddingHorizontal: 18,
    borderRadius: 16,
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    marginVertical: 10,
  },
  entryCardDisabled: {
    backgroundColor: '#0c1320',
    borderColor: 'rgba(255,255,255,0.06)',
    opacity: 0.95,
  },
  entryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  entryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,

  },
  entryPillText: { fontSize: 20, fontWeight: '900', color: '#fff' },
  entryTitle:  { fontSize: 14, color: '#e5e7eb', marginVertical: 4, fontWeight: '700' },
  entrySub: { fontSize: 12.5, color: '#cbd5e1', opacity: 0.9 },

  /* ===== Modal Shell ===== */
  modalWrapper: { flex: 1, backgroundColor: UI.bg },
  modalBox: {
    backgroundColor: UI.bg,
    borderRadius: 22,
    marginHorizontal: 14,
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  scrollContent: { flexGrow: 1, paddingBottom: 120, paddingTop: 10, paddingHorizontal: 2 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 10,
    gap: 8,
  },
  headerIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  modalTitle: {
    color: UI.text,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  modalSubtitle: {
    color: UI.muted2,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 2,
  },
  modalCloseText: { color: UI.text, fontSize: 24, fontWeight: '900', lineHeight: 24 },

  topPadBlock: { paddingHorizontal: 14, marginTop: 6, marginBottom: 6 },

  /* ===== CTAs ===== */
  ctaBtnPrimary: {
    backgroundColor: UI.blue,
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.55)',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  ctaBtnSecondary: {
    backgroundColor: UI.green,
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.55)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  ctaBtnText: { color: UI.textDark, fontSize: 14, fontWeight: '900', letterSpacing: 0.2 },
  ctaHint: { color: UI.muted, fontSize: 12, marginTop: 8, marginLeft: 4, fontWeight: '700' },

  ctaBtnSoft: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  ctaBtnSoftText: { color: UI.text, fontSize: 14, fontWeight: '900' },

  topActionRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, marginBottom: 10 },

  /* ===== Mileage Card ===== */
  mileageCard: {
    marginHorizontal: 14,
    marginTop: 6,
    marginBottom: 10,
    backgroundColor: UI.panel,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: UI.border,
  },
  mileageBarLabel: { color: UI.text, fontWeight: '900', marginBottom: 8, fontSize: 14.5 },
  mileageInputRow: { flexDirection: 'row', alignItems: 'center' },
  mileageSaveBtn: {
    backgroundColor: UI.green,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginLeft: 10,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.55)',
  },
  mileageSaveText: { color: UI.textDark, fontWeight: '900' },
  mileageBarHint: { color: UI.muted, marginTop: 8, fontSize: 12, fontWeight: '700' },

  /* ===== Search ===== */
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 10,
    backgroundColor: UI.panel,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: UI.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, color: UI.text, fontSize: 14.5, paddingVertical: 0, fontWeight: '700' },
  searchClear: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },

  /* ===== Service Cards ===== */
  serviceItem: { borderRadius: 18, padding: 16, marginBottom: 14 },
  serviceCard: {
    backgroundColor: UI.panel,
    borderWidth: 1,
    borderColor: UI.border,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    position: 'relative',
    overflow: 'hidden',
  },
  sevRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  serviceSevNeutral: { borderLeftWidth: 0 },
  serviceSevGreen: { borderLeftWidth: 5, borderLeftColor: 'rgba(34,197,94,0.90)' },
  serviceSevYellow: { borderLeftWidth: 5, borderLeftColor: 'rgba(245,158,11,0.95)' },
  serviceSevRed: { borderLeftWidth: 5, borderLeftColor: 'rgba(239,68,68,0.95)' },

  inactiveRibbon: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 2,
  },
  inactiveRibbonText: { color: UI.text, fontSize: 11, fontWeight: '900', letterSpacing: 0.35 },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start' },
  titleText: { color: UI.text, fontSize: 18, fontWeight: '900', lineHeight: 24 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  dot: { color: UI.muted, marginHorizontal: 6, fontSize: 14, opacity: 0.9 },

  pillPressWrap: {
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRadius: 10,
  },
  pillLink: { color: '#fde68a', fontSize: 13.5, fontWeight: '900', textDecorationLine: 'underline' },

  pillStaticWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  pillStaticText: { color: UI.text, fontSize: 12.5, fontWeight: '800' },
  pillEdit: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    color: UI.text,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '900',
  },

  inlineEditWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 6, marginTop: 6 },

  smallBtn: { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1 },
  smallBtnGood: { backgroundColor: 'rgba(34,197,94,0.18)', borderColor: 'rgba(34,197,94,0.35)' },
  smallBtnBad: { backgroundColor: 'rgba(239,68,68,0.16)', borderColor: 'rgba(239,68,68,0.35)' },
  smallBtnText: { color: UI.text, fontSize: 12, fontWeight: '900' },

  deleteBtnBig: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    marginLeft: 8,
    alignSelf: 'flex-start',
  },

  badgeRow: { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 12 },
  badge: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  badgeLabel: { color: UI.muted, fontSize: 12, fontWeight: '800' },
  badgeValue: { color: UI.text, fontSize: 15.5, fontWeight: '900', marginTop: 3 },

  progressWrap: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  progressFill: { height: '100%', borderRadius: 999 },
  progressHint: { color: UI.text2, marginTop: 9, fontSize: 12.5, fontWeight: '800', alignSelf: 'center' },

  detailsPanel: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  detailKey: { color: UI.text2, fontSize: 12.5, fontWeight: '900', width: 140 },
  detailVal: { color: UI.text, fontSize: 12.5, flexShrink: 1, fontWeight: '700' },

  inlineInput: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: UI.text,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 90,
  },

  proofRow: { marginTop: 10 },
  proofRowContent: { flexDirection: 'row', alignItems: 'center', paddingLeft: 2 },
  thumbnailContainer: {
    marginRight: 10,
    borderRadius: 12,
    width: 74,
    height: 74,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
    backgroundColor: '#0a0a0a',
  },
  thumbnail: { width: '100%', height: '100%' },
buttonRow: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  justifyContent: 'center',   // centers items horizontally
  alignItems: 'center',       // centers vertically within line
  alignContent: 'center',     // centers wrapped lines
  gap: 10,
  marginTop: 16,
},
actionBtn: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',   // centers text inside button
  gap: 8,
  paddingVertical: 11,
  paddingHorizontal: 14,
  borderRadius: 14,
  borderWidth: 1,
  minWidth: 120,              // makes them feel even
},

  actionPrimary: { backgroundColor: UI.green, borderColor: 'rgba(34,197,94,0.55)' },
  actionNeutral: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.12)' },
  actionOutline: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.18)' },
  actionPurple: { backgroundColor: UI.purple, borderColor: 'rgba(139,92,246,0.55)' },
  actionTextPrimary: { color: UI.textDark, fontSize: 13, fontWeight: '900' },
  actionText: { color: UI.text, fontSize: 13, fontWeight: '900' },

  /* ===== Overlay / Sheet ===== */
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  sheet: {
    backgroundColor: UI.panel,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: UI.border,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  sheetTitle: { color: UI.text, fontSize: 17, fontWeight: '900', flex: 1, textAlign: 'left', paddingRight: 16 },
  sheetClose: {
    width: 36,
    height: 36,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCloseText: { color: UI.text, fontSize: 22, lineHeight: 22, fontWeight: '900' },
  sheetFooterRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingTop: 10 },

  labelStrong: { color: UI.text, fontWeight: '900', marginTop: 8, marginBottom: 6, fontSize: 14 },
  helperText: { color: UI.muted, fontSize: 12, marginTop: 6, fontWeight: '700' },

  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: UI.text,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontWeight: '800',
  },
  inputLg: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: UI.text,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '900',
  },
  inputMultiline: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: UI.text,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    minHeight: 110,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    fontWeight: '800',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inputRowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inputRowButtonText: { color: UI.text, fontSize: 14.5, fontWeight: '900' },

  formRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  formCol: { flex: 1, minWidth: 140 },

  segmentRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
  },
  segmentActive: { backgroundColor: UI.green },
  segmentText: { color: UI.text2, fontWeight: '900' },
  segmentTextActive: { color: UI.textDark, fontWeight: '900' },

  btnGrey: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  btnGreen: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: UI.green,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.55)',
  },
  btnText: { color: UI.text, fontSize: 14, fontWeight: '800' },

  banner: {
    color: '#d6ffe4',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    marginBottom: 10,
    fontSize: 12.5,
    fontWeight: '800',
  },

  /* ===== Image Viewer ===== */
  viewerShell: {
    width: '100%',
    height: '62%',
    backgroundColor: '#000',
    borderRadius: 18,
    borderColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    overflow: 'hidden',
  },
  viewerTopBar: {
    height: 50,
    backgroundColor: 'rgba(0,0,0,0.62)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    borderBottomWidth: 1,
  },
  viewerTopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  viewerTopBarText: { color: UI.text, fontSize: 13.5, fontWeight: '800' },
  viewerImageWrap: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  chevron: {
    position: 'absolute',
    top: '45%',
    backgroundColor: 'rgba(0,0,0,0.52)',
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  pager: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  pagerText: { color: UI.text, fontSize: 12, fontWeight: '900' },

  /* ===== Thinking Overlay ===== */
  thinkingCard: {
    width: '86%',
    maxWidth: 420,
    alignItems: 'center',
    backgroundColor: UI.panel,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: UI.border,
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
  thinkingTitle: { color: UI.text, fontSize: 18, fontWeight: '900' },
  thinkingSub: { color: UI.muted, fontSize: 13, textAlign: 'center', marginTop: 6, fontWeight: '700' },
});
