// ServiceBox.js — search + smart sorting (urgent first), inverted progress bar, refined actions
import React, { useState, useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Platform, ActivityIndicator, useWindowDimensions } from 'react-native';
import DatePicker from 'react-native-date-picker';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Alert, Image, TextInput, StatusBar,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { showRewardedAd, preloadRewardedAd } from '../components/RewardedAdManager';
import { exportServicesToPdf } from '../utils/servicePdfExporter';

// Tiny helper to animate "..." without extra libs
function AnimatedEllipsis({ style }) {
  const [dots, setDots] = React.useState('');
  React.useEffect(() => {
    const id = setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : prev + '.'));
    }, 450);
    return () => clearInterval(id);
  }, []);
  return <Text style={style}>Generating your service list{dots}</Text>;
}

export default function ServiceBox({ selectedVehicle, onUpdateVehicleCurrentMileage, onRequestAddVehicle }) {
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
    } catch { return 'N/A'; }
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
    const completed = svc.completedMileageNumber ?? (svc.completedMileage ? parseInt(digitsOnly(svc.completedMileage), 10) : undefined);
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
        else if (d <= Math.max(15, Math.round((svc.intervalMonths * 30) * 0.2))) timeSeverity = 'yellow';
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
      const overdueByMiles = svc.completed && svc.dueMilesNumber && currentMilesNumber && currentMilesNumber >= svc.dueMilesNumber;
      const overdueByTime  = svc.completed && svc.dueDateIso && now >= new Date(svc.dueDateIso);
      if (overdueByMiles || overdueByTime) {
        changed = true;
        return { ...svc, completed: false };
      }
      return svc;
    });
    if (changed) { /* optional toast */ }
    return next;
  };

  const persistVehicleMiles = async (value) => {
    if (!selectedVehicle?.id) return;
    try { await AsyncStorage.setItem(`vehicleMileage_${selectedVehicle.id}`, String(value ?? '')); } catch {}
  };

  // ---------- progress helper (INVERTED) ----------
  const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
  const getOriginalProgress = (svc, currentMilesNumber) => {
    if (svc.intervalMiles && Number.isFinite(svc.intervalMiles) &&
        Number.isFinite(svc.completedMileageNumber) && Number.isFinite(currentMilesNumber)) {
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
    const inverted = 1 - p; // full -> empty
    return clamp(inverted, 0, 1);
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
    const ba = bucket(a), bb = bucket(b);
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
    const filtered = !searchLower
      ? arr
      : arr.filter((s) => safeTitle(s).includes(searchLower));
    return filtered.slice().sort(compareServicesFactory(currentMilesNumber, searchLower));
  };

  // ---------- load/save ----------
  useEffect(() => {
    const loadData = async () => {
      if (!selectedVehicle?.id) {
        setServices([]); setHasGeneratedServices(false);
        setVehicleMiles(''); setVehicleMilesInput('');
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
        setServices([]); setHasGeneratedServices(false);
      }
    };
    loadData();
  }, [selectedVehicle]);

  useEffect(() => { if (modalVisible) { try { preloadRewardedAd(); } catch {} } }, [modalVisible]);
  useEffect(() => () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); }, []);

  const saveServicesToStorage = async (updated) => {
    if (!selectedVehicle?.id) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try { await AsyncStorage.setItem(`servicesData_${selectedVehicle.id}`, JSON.stringify(updated)); } catch {}
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
    if (!selectedVehicle?.id) { setOverlay(null); return; }
    if (isGenerating) return;
    setOverlay('thinking');     // show blocking overlay immediately
    setIsGenerating(true);
    try {
      let adOK = false;
      try { adOK = await showRewardedAd(); } catch {}
      if (!adOK) { Alert.alert('Ad Required', 'Please watch the ad to generate service recommendations.'); setOverlay(null); return; }

      await handleConfirmGenerate();
      setTimeout(() => scrollViewRef.current?.scrollToEnd?.({ animated: true }), 350);
    } catch (e) {
      Alert.alert('Error', String(e?.message || e));
    } finally {
      setIsGenerating(false);
      setOverlay(null);        // hide overlay after GPT finishes
    }
  };

  const handleConfirmGenerate = async () => {
    const mileageValue = parseInt(digitsOnly(promptMileage)) || undefined;
    const payload = { vehicle: selectedVehicle, currentMileage: mileageValue };
    const url = 'http://192.168.1.246:3001/generate-service-recommendations';

    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
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
      // ✅ always reset, even if user cancels share sheet
      setIsExporting(false);
    }
  };

  // ---------- mark complete / unmark ----------
  const handleMarkCompleted = (id) => {
    const svc = services.find((s) => s.id === id);
    if (!svc) return;
    setPendingCompleteServiceId(id);
    setFocusLockServiceId(id);
    openEditDetails(svc, { hint: true });
  };

  const handleUnmarkCompleted = (id) => {
    Alert.alert('Unmark Completed', 'Are you sure you want to unmark this service?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes', onPress: () => {
        setServices((prev) => {
          const updated = prev.map((s) => (s.id === id ? { ...s, completed: false } : s));
          const withDues = recalcAllDues(updated);
          saveServicesToStorage(withDues);
          return withDues;
        });
      }},
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
          const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
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
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
          if (!result.canceled && result.assets?.[0]?.uri) {
            await addProof(serviceId, result.assets[0].uri);
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // ✅ New: copy proof into documentDirectory so it’s readable later for PDFs
  const addProof = async (serviceId, uri) => {
    try {
      const filename = uri.split('/').pop() || `proof-${Date.now()}.jpg`;
      const destPath = FileSystem.documentDirectory + `proofs-${selectedVehicle?.id || 'generic'}-${filename}`;

      await FileSystem.copyAsync({ from: uri, to: destPath });

      setServices((prev) => {
        const updated = prev.map((s) =>
          s.id === serviceId
            ? { ...s, proofUris: [...(s.proofUris || []), destPath] }
            : s
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
          const copy = [...s.proofUris]; copy.splice(index, 1);
          return { ...s, proofUris: copy };
        }
        return s;
      });
      saveServicesToStorage(updated); return updated;
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
      Alert.alert('Success', 'Image saved to gallery.');
    } catch { Alert.alert('Error', 'Failed to save image.'); }
  };

  // ---------- edit details overlay ----------
  const openEditDetails = (service) => {
    setEditService(service);
    setTempNotes(service.notes || '');
    const initial = service.completedMileageNumber != null ? String(service.completedMileageNumber) : (service.completedMileage || '');
    setTempCompletedMileage(formatThousands(initial));
    setTempDate(service.lastCompletedDate ? formatDateDisplay(service.lastCompletedDate) : (service.date && service.date !== 'N/A' ? service.date : ''));
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
          date: tempDate || (pendingCompleteServiceId === svc.id ? formatDateDisplay(new Date()) : svc.date || 'N/A'),
          lastCompletedDate: parsedDate ? parsedDate.toISOString() : (pendingCompleteServiceId === svc.id ? new Date().toISOString() : svc.lastCompletedDate),
        };

        if (pendingCompleteServiceId === svc.id) next.completed = true;

        const dueM = computeDueMiles(next);
        next.dueMilesNumber = dueM;
        next.dueDisplay = dueM ? `${formatThousands(String(dueM))} mi` : '—';
        next.dueDateIso = computeDueDateIso(next);

        return next;
      });

      const currentMilesNumber = parseInt(digitsOnly(vehicleMiles)) || undefined;
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
    if (!selectedVehicle?.id) { setOverlay(null); return; }
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
    setServices((prev) => {
      const updated = prev.map((s) => (s.id === id ? { ...s, applies: false } : s));
      saveServicesToStorage(updated);
      return updated;
    });
  };

  // ---------- render ----------
  const currentMilesNumber = parseInt(digitsOnly(vehicleMiles)) || undefined;
  const listToRender = getSortedServices(services, currentMilesNumber, searchQuery);

  const vehicleLabel = (() => {
    const v = selectedVehicle || {};
    const year = v.year ? String(v.year) : '';
    const base = [year, v.make, v.model].filter(Boolean).join(' ');
    return base || 'vehicle';
  })();
  const hasVehicle = !!selectedVehicle?.id;

  // Validation helpers for overlays
  const customValid = Boolean(customTitle.trim());
  const editMileageRequired = pendingCompleteServiceId === editService?.id;
  const editValid = !editMileageRequired || digitsOnly(tempCompletedMileage).length > 0;

  // We avoid SafeArea by using static offsets + padding.
  const kvo = Platform.OS === 'ios' ? 12 : (StatusBar.currentHeight || 0);
  const topPad = Platform.OS === 'ios' ? 48 : (StatusBar.currentHeight || 24);

  return (
    <>
      {/* ENTRY CARD */}
      {hasVehicle ? (
        <TouchableOpacity
          style={styles.container}
          onPress={() => setModalVisible(true)}
          disabled={isGenerating}
          activeOpacity={0.85}
        >
          <Text style={styles.label}>Recommended Service:</Text>
          <Text style={styles.mileage}>
            {services.find((s) => !s.completed && s.priority === 'high')?.text ||
              services.find((s) => !s.completed)?.text ||
              `No pending service for your ${vehicleLabel}`}
          </Text>
          <MaterialIcons name="keyboard-arrow-down" size={24} color="#fff" />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.container, styles.disabledContainer]}
          onPress={() => {
            if (onRequestAddVehicle) onRequestAddVehicle();
            else Alert.alert('Add Your Car', 'Add your ride in the box above first to generate a service report for the added car.');
          }}
          activeOpacity={0.95}
        >
          <Text style={styles.label}>Recommended Service</Text>
          <Text style={styles.mileage}>Add your vehicle to generate a service report</Text>
          <MaterialIcons name="add-circle-outline" size={24} color="#fff" />
        </TouchableOpacity>
      )}

      {/* MAIN MODAL */}
      <Modal
        visible={modalVisible && hasVehicle}
        transparent={false}
        animationType="slide"
        onRequestClose={() => { if (!isGenerating) closeAll(); }}  // block closing while generating
        presentationStyle="fullScreen"
        statusBarTranslucent={false}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: '#121212' }}
          keyboardVerticalOffset={kvo}
        >
          <View style={[styles.modalWrapper, { paddingTop: topPad }]}>
            <View style={styles.modalBox}>
              {/* Header */}
              <View style={styles.headerRow}>
                <TouchableOpacity onPress={() => Alert.alert('Info', `Managing services for your ${vehicleLabel}.`)} style={styles.headerButton}>
                  <MaterialIcons name="info-outline" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.modalTitle} numberOfLines={1} adjustsFontSizeToFit>All Service Recommendations</Text>
                <TouchableOpacity onPress={() => { if (!isGenerating) closeAll(); }} style={styles.headerButton} disabled={isGenerating}>
                  <Text style={[styles.modalCloseText, isGenerating && { opacity: 0.4 }]}>×</Text>
                </TouchableOpacity>
              </View>

              {/* ======= CTAs / Mileage ======= */}
              {!hasGeneratedServices ? (
                <View style={{ paddingHorizontal: 16, marginTop: 6, marginBottom: 6 }}>
                  <TouchableOpacity style={styles.ctaBtnSecondary} onPress={handleGeneratePress} disabled={isGenerating} activeOpacity={0.95}>
                    <Text style={styles.ctaBtnText}>Generate Recommended Service Records</Text>
                  </TouchableOpacity>
                  <Text style={styles.ctaHint}>We’ll ask for your current mileage first.</Text>
                </View>
              ) : (
                <View style={styles.mileageCard}>
                  <Text style={styles.mileageBarLabel}>Update current vehicle mileage</Text>
                  <View style={styles.mileageInputRow}>
                    <TextInput
                      style={[styles.inlineInput, { flex: 1 }]}
                      value={vehicleMilesInput}
                      onChangeText={(t) => setVehicleMilesInput(formatThousands(t))}
                      placeholder="e.g., 181,000"
                      placeholderTextColor="#777"
                      keyboardType="numeric"
                      inputMode="numeric"
                      maxLength={12}
                      returnKeyType="done"
                      onSubmitEditing={saveVehicleMilesAndRecalc}
                    />
                    <TouchableOpacity style={styles.mileageSaveBtn} onPress={saveVehicleMilesAndRecalc}>
                      <Text style={styles.mileageSaveText}>Save</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.mileageBarHint}>
                    {vehicleMiles ? `Using ${formatThousands(vehicleMiles)} mi for updating.` : 'Set mileage to enable urgency colors.'}
                  </Text>
                </View>
              )}

              {/* SEARCH */}
              <View style={styles.searchRow}>
                <MaterialIcons name="search" size={20} color="#bbb" />
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search services (e.g., oil, brake, filter)"
                  placeholderTextColor="#777"
                  returnKeyType="search"
                />
                {Boolean(searchQuery) && (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <MaterialIcons name="close" size={20} color="#bbb" />
                  </TouchableOpacity>
                )}
              </View>

              {/* TOP ACTION ROW: Add Custom + Export */}
              {hasGeneratedServices && (
                <View
                  style={{
                    flexDirection: 'row',
                    gap: 10,
                    paddingHorizontal: 16,
                    marginBottom: 8,
                  }}
                >
                  <TouchableOpacity
                    style={[styles.ctaBtnSecondary, { flex: 1 }]}
                    onPress={openCustomOverlay}
                    activeOpacity={0.95}
                    disabled={isExporting}
                  >
                    <Text style={styles.ctaBtnText}>+ Custom Service</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.ctaBtnPrimary,
                      { flex: 1, opacity: isExporting ? 0.7 : 1 },
                    ]}
                    onPress={handleExportServices}
                    activeOpacity={0.95}
                    disabled={isExporting}
                  >
                    <Text style={styles.ctaBtnText}>
                      {isExporting ? 'Exporting…' : 'Export Service PDF'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* LIST */}
              <ScrollView
                ref={scrollViewRef}
                contentContainerStyle={styles.scrollContent}
                initialNumToRender={10}
                windowSize={5}
                keyboardShouldPersistTaps="handled"
              >

                {listToRender.map((service) => {
                  const isEditing = editingHeaderId === service.id;
                  const severity = getSeverityForService(service, currentMilesNumber);
                  const remaining = getRemainingMiles(service, currentMilesNumber);
                  const severityStyle =
                    severity === 'red' ? styles.serviceSevRed :
                    severity === 'yellow' ? styles.serviceSevYellow :
                    severity === 'green' ? styles.serviceSevGreen :
                    styles.serviceLow;

                  const dueMilesText = service.dueDisplay && service.dueDisplay !== '—' ? service.dueDisplay : '—';
                  let remainingText = '';
                  if (remaining != null) {
                    remainingText = remaining <= 0
                      ? `OVERDUE by ${formatThousands(String(Math.abs(remaining)))} mi`
                      : `${formatThousands(String(remaining))} mi left`;
                  } else if (!service.completedMileageNumber && !service.completedMileage) {
                    remainingText = 'Log a completion to start tracking';
                  }

                  const daysLeft = daysUntil(service.dueDateIso);
                  const dueDateText = service.dueDateIso ? formatDateDisplay(service.dueDateIso) : '—';
                  let timeRemainingText = '';
                  if (daysLeft != null) {
                    timeRemainingText = daysLeft <= 0 ? `OVERDUE by ${Math.abs(daysLeft)} days` : `${daysLeft} days left`;
                  }

                  const isInactive = !service.applies;
                  const progress = getInvertedProgress(service, currentMilesNumber);
                  const barColor = getProgressColor(progress);

                  return (
                    <View key={service.id} style={[styles.serviceItem, severityStyle, styles.serviceCard]}>
                      {isInactive && (
                        <View style={styles.inactiveRibbon}>
                          <MaterialCommunityIcons name="pause-circle-outline" size={14} color="#fff" />
                          <Text style={styles.inactiveRibbonText}>Inactive</Text>
                        </View>
                      )}

                      <View style={styles.titleRow}>
                        <View style={{ flex: 1, paddingRight: 8, opacity: isInactive ? 0.6 : 1 }}>
                          <Text style={styles.titleText} numberOfLines={2}>{service.text}</Text>

                          <View style={styles.metaRow}>
                            <TouchableOpacity
                              onPress={() => {
                                setEditingHeaderId(service.id);
                                setTempHeaderMiles(formatThousands(service.intervalMiles ?? ''));
                                setTimeout(() => headerMilesRef.current?.focus?.(), 30);
                              }}
                              activeOpacity={0.8}
                            >
                              <Text style={styles.pillLink}>
                                {service.intervalMiles ? `${formatThousands(service.intervalMiles)} miles` : 'set miles'}
                              </Text>
                            </TouchableOpacity>

                            <Text style={styles.dot}>•</Text>

                            <Text style={styles.pillStatic}>
                              {service.intervalMonths ? `${service.intervalMonths} months` : 'set time'}
                            </Text>
                            <TouchableOpacity onPress={() => openMonthsEditor(service)} activeOpacity={0.85}>
                              <Text style={styles.pillEdit}>Edit</Text>
                            </TouchableOpacity>

                            {isEditing && (
                              <View style={styles.inlineEditWrap}>
                                <TextInput
                                  ref={headerMilesRef}
                                  style={[styles.inlineInput, { minWidth: 110 }]}
                                  value={tempHeaderMiles}
                                  onChangeText={(t) => setTempHeaderMiles(formatThousands(t))}
                                  placeholder="miles"
                                  placeholderTextColor="#777"
                                  keyboardType="numeric"
                                  inputMode="numeric"
                                  maxLength={12}
                                  returnKeyType="done"
                                  onSubmitEditing={() => saveIntervalInline(service.id)}
                                />
                                <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#4CAF50' }]} onPress={() => saveIntervalInline(service.id)}>
                                  <Text style={styles.smallBtnText}>Save</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#FF5252' }]} onPress={() => { setEditingHeaderId(null); setTempHeaderMiles(''); }}>
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
                        >
                          <MaterialCommunityIcons name="trash-can-outline" size={18} color="#fff" />
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
                        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: barColor }]} />
                      </View>
                      <Text style={styles.progressHint}>
                        {remaining != null
                          ? remaining <= 0
                            ? `0% health • ${formatThousands(String(Math.abs(remaining)))} mi overdue${timeRemainingText ? ` • ${timeRemainingText}` : ''}`
                            : `${Math.max(1, Math.round(progress * 100))}% health • ${formatThousands(String(remaining))} mi left${timeRemainingText ? ` • ${timeRemainingText}` : ''}`
                          : `Updating starts after first completion${timeRemainingText ? ` • ${timeRemainingText}` : ''}`
                        }
                      </Text>

                      <View style={styles.detailsPanel}>
                        <View style={styles.detailRow}>
                          <MaterialCommunityIcons name="note-text-outline" size={16} color="#bbb" />
                          <Text style={styles.detailKey}>Notes</Text>
                          <Text style={styles.detailVal} numberOfLines={2}>{service.notes || 'N/A'}</Text>
                        </View>
                        <View style={styles.detailRow}>
                          <MaterialCommunityIcons name="counter" size={16} color="#bbb" />
                          <Text style={styles.detailKey}>Completed Mileage</Text>
                          <Text style={styles.detailVal}>
                            {service.completedMileage || (service.completedMileageNumber != null ? formatThousands(service.completedMileageNumber) : 'N/A')}
                          </Text>
                        </View>
                        <View style={styles.detailRow}>
                          <MaterialCommunityIcons name="calendar-month-outline" size={16} color="#bbb" />
                          <Text style={styles.detailKey}>Date</Text>
                          <Text style={styles.detailVal}>{service.date || 'N/A'}</Text>
                        </View>
                      </View>

                      {service.proofUris.length > 0 && (
                        <ScrollView horizontal style={styles.proofRow} contentContainerStyle={styles.proofRowContent}>
                          {service.proofUris.map((uri, index) => (
                            <TouchableOpacity
                              key={index}
                              onPress={() => { setImageForServiceId(service.id); setCurrentIndex(index); setOverlay('image'); }}
                              style={styles.thumbnailContainer}
                              activeOpacity={0.8}
                            >
                              <Image source={{ uri }} style={styles.thumbnail} />
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      )}

                      <View style={styles.buttonRow}>
                        {!service.applies ? (
                          <TouchableOpacity style={[styles.actionBtn, styles.actionPrimary]} onPress={() => applyServiceToVehicle(service.id)}>
                            <MaterialCommunityIcons name="play-circle-outline" size={18} color="#0b1220" />
                            <Text style={[styles.actionTextPrimary]}>Activate</Text>
                          </TouchableOpacity>
                        ) : (
                          <>
                            {!service.completed ? (
                              <>
                                <TouchableOpacity style={[styles.actionBtn, styles.actionPrimary]} onPress={() => handleMarkCompleted(service.id)}>
                                  <MaterialCommunityIcons name="check-circle-outline" size={18} color="#0b1220" />
                                  <Text style={styles.actionTextPrimary}>Mark Completed</Text>
                                </TouchableOpacity>

                                <TouchableOpacity style={[styles.actionBtn, styles.actionNeutral]} onPress={() => { setFocusLockServiceId(service.id); openEditDetails(service); }}>
                                  <MaterialIcons name="edit" size={18} color="#fff" />
                                  <Text style={styles.actionText}>Edit Details</Text>
                                </TouchableOpacity>

                                <TouchableOpacity style={[styles.actionBtn, styles.actionOutline]} onPress={() => handleUploadProof(service.id)}>
                                  <MaterialCommunityIcons name="image-plus" size={18} color="#fff" />
                                  <Text style={styles.actionText}>Add Proof</Text>
                                </TouchableOpacity>
                              </>
                            ) : (
                              <>
                                <TouchableOpacity style={[styles.actionBtn, styles.actionNeutral]} onPress={() => { setFocusLockServiceId(service.id); openEditDetails(service); }}>
                                  <MaterialIcons name="edit" size={18} color="#fff" />
                                  <Text style={styles.actionText}>Edit Details</Text>
                                </TouchableOpacity>

                                <TouchableOpacity style={[styles.actionBtn, styles.actionOutline]} onPress={() => handleUploadProof(service.id)}>
                                  <MaterialCommunityIcons name="plus-circle-outline" size={18} color="#fff" />
                                  <Text style={styles.actionText}>Add Proof</Text>
                                </TouchableOpacity>

                                <TouchableOpacity style={[styles.actionBtn, styles.actionNeutral]} onPress={() => handleUnmarkCompleted(service.id)}>
                                  <MaterialCommunityIcons name="refresh" size={18} color="#fff" />
                                  <Text style={styles.actionText}>Unmark</Text>
                                </TouchableOpacity>
                              </>
                            )}

                            <TouchableOpacity style={[styles.actionBtn, styles.actionPurple]} onPress={() => deactivateServiceForVehicle(service.id)}>
                              <MaterialCommunityIcons name="pause-circle-outline" size={18} color="#fff" />
                              <Text style={styles.actionText}>Make Inactive</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>
                  );
                })}

              </ScrollView>

              {/* ===================== OVERLAYS ===================== */}

              {/* ——— THINKING (blocks input during ad + GPT, no Lottie) ——— */}
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

              {overlay === 'prompt' && (
                <View style={styles.overlay}>
                  <View style={[styles.sheet, { width: sheetWidth }]}>
                    <View style={styles.sheetHeader}>
                      <Text style={styles.sheetTitle}>Current Mileage</Text>
                      <TouchableOpacity onPress={() => setOverlay(null)} style={styles.sheetClose}>
                        <Text style={styles.sheetCloseText}>×</Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.labelStrong}>Enter current mileage for your {vehicleLabel}</Text>
                    <TextInput
                      style={[styles.inputLg]}
                      value={formatThousands(promptMileage)}
                      onChangeText={(t) => setPromptMileage(digitsOnly(t))}
                      placeholder="e.g., 181000"
                      placeholderTextColor="#777"
                      keyboardType="numeric"
                      inputMode="numeric"
                      maxLength={12}
                      autoFocus
                      returnKeyType="done"
                      onSubmitEditing={startGenerationAfterMileage}
                    />
                    <Text style={styles.helperText}>This helps prioritize urgent services.</Text>

                    <View style={styles.sheetFooterRow}>
                      <TouchableOpacity onPress={() => setOverlay(null)} style={styles.btnGrey}>
                        <Text style={styles.btnText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={startGenerationAfterMileage} style={styles.btnGreen} disabled={isGenerating}>
                        <Text style={[styles.btnText, { fontWeight: '600' }]}>Continue</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}

              {/* ——— EDIT DETAILS (Revamped) ——— */}
              {overlay === 'edit' && editService && (
                <View style={styles.overlay}>
                  <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: sheetWidth }} keyboardVerticalOffset={kvo}>
                    <View style={[styles.sheet, { width: '100%' }]}>
                      <View style={styles.sheetHeader}>
                        <Text style={styles.sheetTitle}>Edit Details</Text>
                        <TouchableOpacity onPress={() => { setOverlay(null); setEditService(null); setPendingCompleteServiceId(null); setFocusLockServiceId(null); }} style={styles.sheetClose}>
                          <Text style={styles.sheetCloseText}>×</Text>
                        </TouchableOpacity>
                      </View>

                      {pendingCompleteServiceId === editService.id ? (
                        <Text style={[styles.banner, { backgroundColor: 'rgba(34,197,94,0.15)', borderColor: '#22c55e' }]}>
                          Marking as completed — completion mileage is required.
                        </Text>
                      ) : null}

                      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
                        {/* Mileage + Date row */}
                        <View style={styles.formRow}>
                          <View style={styles.formCol}>
                            <Text style={styles.labelStrong}>Completed Mileage {editMileageRequired ? '(required)' : ''}</Text>
                            <View style={styles.inputRow}>
                              <MaterialCommunityIcons name="counter" size={18} color="#aaa" />
                              <TextInput
                                style={[styles.input, { flex: 1 }]}
                                value={tempCompletedMileage}
                                onChangeText={(t) => setTempCompletedMileage(formatThousands(t))}
                                placeholder="e.g., 181,000"
                                placeholderTextColor="#777"
                                keyboardType="numeric"
                                inputMode="numeric"
                                maxLength={12}
                              />
                            </View>
                            <Text style={[styles.helperText, !editValid && { color: '#ffb4b4' }]}>
                              {editMileageRequired ? 'Enter the mileage when you performed this service.' : 'Optional if you’re only updating notes or date.'}
                            </Text>
                          </View>

                          <View style={styles.formCol}>
                            <Text style={styles.labelStrong}>Date</Text>
                            <TouchableOpacity
                              onPress={() => setShowDatePicker(true)}
                              style={styles.inputRowButton}
                              activeOpacity={0.9}
                            >
                              <MaterialCommunityIcons name="calendar-month-outline" size={18} color="#aaa" />
                              <Text style={styles.inputRowButtonText}>
                                {tempDate || 'Select date'}
                              </Text>
                              <MaterialIcons name="edit-calendar" size={18} color="#ddd" style={{ marginLeft: 'auto' }} />
                            </TouchableOpacity>
                            <Text style={styles.helperText}>Tap to choose a completion date.</Text>
                          </View>
                        </View>

                        {/* Notes */}
                        <View style={{ marginTop: 10 }}>
                          <Text style={styles.labelStrong}>Notes</Text>
                          <TextInput
                            style={[styles.inputMultiline]}
                            value={tempNotes}
                            onChangeText={setTempNotes}
                            placeholder="Part numbers, capacities, fluids, torque specs…"
                            placeholderTextColor="#777"
                            multiline
                          />
                          <Text style={styles.helperText}>Keep your references here for later (e.g., 5W-30, 4.5 qt, NGK 93175).</Text>
                        </View>
                      </ScrollView>

                      {/* Sticky footer */}
                      <View style={styles.sheetFooterRow}>
                        <TouchableOpacity onPress={() => { setOverlay(null); setEditService(null); setPendingCompleteServiceId(null); setFocusLockServiceId(null); }} style={styles.btnGrey}>
                          <Text style={styles.btnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={saveEditDetails} style={[styles.btnGreen, !editValid && { opacity: 0.6 }]} disabled={!editValid}>
                          <Text style={[styles.btnText, { fontWeight: '700' }]}>Save</Text>
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

              {/* ——— IMAGE VIEWER (unchanged) ——— */}
              {overlay === 'image' && imageForServiceId && (
                <View style={styles.overlay}>
                  <View style={styles.viewerShell}>
                    <View style={styles.viewerTopBar}>
                      <TouchableOpacity onPress={() => { setOverlay(null); setImageForServiceId(null); }}>
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
                        >
                          <MaterialIcons name="file-download" size={20} color="#fff" />
                          <Text style={styles.viewerTopBarText}> Save</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.viewerTopBtn, { marginLeft: 12 }]}
                          onPress={() => {
                            const svc = services.find((s) => s.id === imageForServiceId);
                            if (!svc) return;
                            deleteImage(imageForServiceId, currentIndex);
                          }}
                        >
                          <MaterialCommunityIcons name="trash-can-outline" size={20} color="#fff" />
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
                            activeOpacity={0.8}
                          >
                            <MaterialIcons name="chevron-left" size={38} color="#fff" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.chevron, { right: 10 }]}
                            onPress={() => setCurrentIndex((i) => (i + 1) % total)}
                            activeOpacity={0.8}
                          >
                            <MaterialIcons name="chevron-right" size={38} color="#fff" />
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

              {/* ——— ADD CUSTOM SERVICE (Revamped) ——— */}
              {overlay === 'custom' && (
                <View style={styles.overlay}>
                  <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: sheetWidth }} keyboardVerticalOffset={kvo}>
                    <View style={[styles.sheet, { width: '100%' }]}>
                      <View style={styles.sheetHeader}>
                        <Text style={styles.sheetTitle}>Add Custom Service</Text>
                        <TouchableOpacity onPress={() => setOverlay(null)} style={styles.sheetClose}>
                          <Text style={styles.sheetCloseText}>×</Text>
                        </TouchableOpacity>
                      </View>

                      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
                        {/* Title */}
                        <Text style={styles.labelStrong}>Title *</Text>
                        <View style={styles.inputRow}>
                          <MaterialCommunityIcons name="wrench-outline" size={18} color="#aaa" />
                          <TextInput
                            style={[styles.input, { flex: 1 }]}
                            value={customTitle}
                            onChangeText={setCustomTitle}
                            placeholder="e.g., Rear Differential Fluid Change"
                            placeholderTextColor="#777"
                          />
                        </View>
                        <Text style={[styles.helperText, !customValid && { color: '#ffb4b4' }]}>
                          Short, clear action (e.g., “Engine Oil & Filter”, “Coolant Flush”)
                        </Text>

                        {/* Interval row */}
                        <View style={styles.formRow}>
                          <View style={styles.formCol}>
                            <Text style={styles.labelStrong}>Interval (miles)</Text>
                            <View style={styles.inputRow}>
                              <MaterialCommunityIcons name="counter" size={18} color="#aaa" />
                              <TextInput
                                style={[styles.input, { flex: 1 }]}
                                value={customInterval}
                                onChangeText={(t) => setCustomInterval(formatThousands(t))}
                                placeholder="e.g., 30,000"
                                placeholderTextColor="#777"
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
                              <MaterialCommunityIcons name="clock-outline" size={18} color="#aaa" />
                              <TextInput
                                style={[styles.input, { flex: 1 }]}
                                value={customMonths}
                                onChangeText={(t) => setCustomMonths(digitsOnly(t))}
                                placeholder="e.g., 24"
                                placeholderTextColor="#777"
                                keyboardType="numeric"
                                inputMode="numeric"
                                maxLength={3}
                              />
                            </View>
                            <Text style={styles.helperText}>Leave blank if mileage-based only.</Text>
                          </View>
                        </View>

                        {/* Priority segmented */}
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

                        {/* Notes */}
                        <Text style={styles.labelStrong}>Notes (optional)</Text>
                        <TextInput
                          style={[styles.inputMultiline]}
                          value={customNotes}
                          onChangeText={setCustomNotes}
                          placeholder="Part numbers, fluid specs, torque values, reminders…"
                          placeholderTextColor="#777"
                          multiline
                        />
                        <Text style={styles.helperText}>Examples: 0W-20 full synthetic • 4.4 qt • OEM 15208-65F0E</Text>
                      </ScrollView>

                      {/* Sticky footer */}
                      <View style={styles.sheetFooterRow}>
                        <TouchableOpacity onPress={() => setOverlay(null)} style={styles.btnGrey}>
                          <Text style={styles.btnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={saveCustomService}
                          style={[styles.btnGreen, !customValid && { opacity: 0.6 }]}
                          disabled={!customValid}
                        >
                          <Text style={[styles.btnText, { fontWeight: '700' }]}>Save</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </KeyboardAvoidingView>
                </View>
              )}

              {/* ——— MONTHS EDITOR ——— */}
              {overlay === 'editMonths' && (
                <View style={styles.overlay}>
                  <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: sheetWidth }} keyboardVerticalOffset={kvo}>
                    <View style={[styles.sheet, { width: '100%' }]}>
                      <View style={styles.sheetHeader}>
                        <Text style={styles.sheetTitle}>Interval (Months)</Text>
                        <TouchableOpacity onPress={() => { setOverlay(null); setMonthsEditServiceId(null); setMonthsInput(''); }} style={styles.sheetClose}>
                          <Text style={styles.sheetCloseText}>×</Text>
                        </TouchableOpacity>
                      </View>

                      <Text style={styles.labelStrong}>Months</Text>
                      <TextInput
                        style={[styles.inputLg]}
                        value={monthsInput}
                        onChangeText={(t) => setMonthsInput(digitsOnly(t))}
                        placeholder="e.g., 6"
                        placeholderTextColor="#777"
                        keyboardType="numeric"
                        inputMode="numeric"
                        maxLength={3}
                        autoFocus
                      />
                      <Text style={styles.helperText}>Leave blank to remove the time-based interval.</Text>

                      <View style={styles.sheetFooterRow}>
                        <TouchableOpacity onPress={() => { setOverlay(null); setMonthsEditServiceId(null); setMonthsInput(''); }} style={styles.btnGrey}>
                          <Text style={styles.btnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={saveMonthsEdit} style={styles.btnGreen}>
                          <Text style={[styles.btnText, { fontWeight: '700' }]}>Save</Text>
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

const BLUE = '#3b82f6';
const GREEN = '#22c55e';

const styles = StyleSheet.create({
  // Entry tile
  container: { backgroundColor: '#333', borderRadius: 16, padding: 33, alignItems: 'center', marginVertical: 10 },
  disabledContainer: { backgroundColor: '#2d2d2d', borderColor: '#666', borderWidth: 1 },
  label: { color: '#aaa', fontSize: 15, fontWeight: '600' },
  mileage: { color: '#fff', fontSize: 19, fontWeight: '700', marginVertical: 6, textAlign: 'center' },

  modalWrapper: { flex: 1, backgroundColor: '#121212' },
  scrollContent: { flexGrow: 1, paddingBottom: 300, paddingTop: 10},
  modalBox: { backgroundColor: '#121212', borderRadius: 24, marginHorizontal: 16, elevation: 10, paddingBottom: 20 },

  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8, width: '100%' },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 22 },
  modalTitle: { color: '#fff', fontSize: 22, fontWeight: '900', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  modalCloseText: { color: '#fff', fontSize: 22, fontWeight: 'bold', lineHeight: 22 },

  // CTAs
  ctaBtnPrimary: {
    backgroundColor: BLUE,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  ctaBtnSecondary: {
    backgroundColor: GREEN,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  ctaBtnText: { color: '#0b1220', fontSize: 14, fontWeight: '900' },
  ctaHint: { color: '#9aa5b1', fontSize: 12, marginTop: 8, marginLeft: 4 },

  // Mileage card
  mileageCard: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 6,
    backgroundColor: '#1b1b1b',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2b2b2b',
  },
  mileageBarLabel: { color: '#eee', fontWeight: '900', marginBottom: 6, fontSize: 15 },
  mileageInputRow: { flexDirection: 'row', alignItems: 'center' },
  mileageSaveBtn: { backgroundColor: GREEN, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12, marginLeft: 8 },
  mileageSaveText: { color: '#0b1220', fontWeight: '900' },
  mileageBarHint: { color: '#999', marginTop: 6, fontSize: 12 },

  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#1b1b1b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2b2b2b',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    paddingVertical: 0,
  },

  // List + base item
  serviceItem: { borderRadius: 10, padding: 12, marginBottom: 10 },
  serviceLow: { backgroundColor: '#424242' },
  serviceSevGreen: { backgroundColor: '#1f5f2a' },
  serviceSevYellow: { backgroundColor: '#8d6e00' },
  serviceSevRed: { backgroundColor: '#7f1d1d' },

  // --- CARD UPGRADE ---
  serviceCard: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    position: 'relative',
  },

  // Inactive ribbon moved to top-left
  inactiveRibbon: {
    position: 'absolute',
    top: 10,
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 2,
  },
  inactiveRibbonText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },

  // Title & meta
  titleRow: { flexDirection: 'row', alignItems: 'flex-start' },
  titleText: { color: '#fff', fontSize: 20, fontWeight: '900', lineHeight: 26 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  dot: { color: '#ddd', marginHorizontal: 6, fontSize: 14, opacity: 0.8 },

  pillStatic: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    color: '#fff',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 13,
    fontWeight: '700',
  },
  pillEdit: {
    marginLeft: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
    color: '#fff',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '800',
  },
  pillLink: {
    color: '#FFD700',
    paddingVertical: 6,
    paddingHorizontal: 0,
    borderRadius: 999,
    fontSize: 14,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  inlineEditWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 6, marginTop: 6 },

  // Small inline buttons
  smallBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10 },
  smallBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  // Delete button
  deleteBtnBig: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 2,
    alignSelf: 'flex-start',
    marginLeft: 6,
  },

  // Badges
  badgeRow: { flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 10 },
  badge: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  badgeLabel: { color: '#bbb', fontSize: 12, fontWeight: '700' },
  badgeValue: { color: '#fff', fontSize: 16, fontWeight: '900', marginTop: 2 },

  // Inverted progress
  progressWrap: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressHint: { color: '#ddd', marginTop: 8, fontSize: 13, fontWeight: '700', alignSelf: 'center' },

  // Details panel
  detailsPanel: {
    marginTop: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  detailKey: { color: '#ccc', fontSize: 13, fontWeight: '800', width: 140 },
  detailVal: { color: '#fff', fontSize: 13, flexShrink: 1 },

  // Inputs (base)
  inlineInput: { backgroundColor: '#111', color: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#444', paddingHorizontal: 10, minWidth: 90, marginHorizontal: 4 },

  // Proofs
  proofRow: { marginTop: 8 },
  proofRowContent: { flexDirection: 'row', alignItems: 'center' },
  thumbnailContainer: { marginRight: 8, borderRadius: 8, width: 70, height: 70, zIndex: 1 },
  thumbnail: { width: '100%', height: '100%', borderRadius: 8 },

  // Actions
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16, alignItems: 'center' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionPrimary: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  actionNeutral: { backgroundColor: 'rgba(255,255,255,0.10)', borderColor: 'rgba(255,255,255,0.15)' },
  actionOutline: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.25)' },
  actionPurple: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
  actionTextPrimary: { color: '#0b1220', fontSize: 13.5, fontWeight: '900' },
  actionText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },

  // FAB
  addFab: {
    position: 'absolute',
    right: 22,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },

  // ---------------- SHEET / OVERLAY (revamped) ----------------
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  sheet: {
    backgroundColor: '#0f0f0f',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '900', flex: 1, textAlign: 'left', paddingRight: 16 },
  sheetClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  sheetCloseText: { color: '#fff', fontSize: 22, lineHeight: 22 },

  sheetFooterRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingTop: 8 },

  // Inputs (revamped)
  labelStrong: { color: '#eee', fontWeight: '900', marginTop: 8, marginBottom: 6, fontSize: 14.5 },
  helperText: { color: '#9aa5b1', fontSize: 12, marginTop: 4 },

  input: {
    backgroundColor: '#111',
    color: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputLg: {
    backgroundColor: '#111',
    color: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  inputMultiline: {
    backgroundColor: '#111',
    color: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    minHeight: 110,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inputRowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inputRowButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  chipAction: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chipActionText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  // Form grid
  formRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  formCol: { flex: 1, minWidth: 140 },

  // Segmented
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    marginBottom: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  segmentActive: {
    backgroundColor: '#22c55e',
  },
  segmentText: { color: '#ddd', fontWeight: '800' },
  segmentTextActive: { color: '#0b1220', fontWeight: '900' },

  // Buttons
  decodingText: { color: '#fff', fontSize: 18, marginBottom: 20 },
  btnGrey: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#555', borderRadius: 10 },
  btnGreen: { paddingVertical: 12, paddingHorizontal: 18, backgroundColor: '#4CAF50', borderRadius: 10 },
  btnText: { color: '#fff', fontSize: 14.5, fontWeight: '700' },

  // Banner
  banner: {
    color: '#d6ffe4',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '700',
  },

  // Image viewer
  viewerShell: {
    width: '100%',
    height: '60%',
    backgroundColor: '#000',
    borderRadius: 16,
    borderColor: '#222',
    borderWidth: 1,

  },
  viewerTopBar: { height: 46, backgroundColor: 'rgba(0,0,0,0.55)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, borderBottomColor: '#111', borderBottomWidth: 1 },
  viewerTopBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8 },
  viewerTopBarText: { color: '#fff', fontSize: 14 },
   viewerImageWrap: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },

  chevron: { position: 'absolute', top: '45%', backgroundColor: 'rgba(0,0,0,0.45)', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  pager: { position: 'absolute', bottom: 10, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  pagerText: { color: '#fff', fontSize: 12 },

  // Thinking overlay (new)
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
  thinkingTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  thinkingSub: {
    color: '#9aa5b1',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
});
