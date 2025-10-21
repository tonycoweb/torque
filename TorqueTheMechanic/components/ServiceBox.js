// ServiceBox.js — auto-unmark after due; "Mark Completed" opens Edit overlay first; focus lock prevents jumping
import React, { useState, useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import DatePicker from 'react-native-date-picker';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Alert, Image, TextInput,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { showRewardedAd, preloadRewardedAd } from '../components/RewardedAdManager';

export default function ServiceBox({ selectedVehicle, onUpdateVehicleCurrentMileage }) {
  const [modalVisible, setModalVisible] = useState(false);

  // data
  const [services, setServices] = useState([]);
  const [hasGeneratedServices, setHasGeneratedServices] = useState(false);

  // vehicle mileage
  const [vehicleMiles, setVehicleMiles] = useState('');
  const [vehicleMilesInput, setVehicleMilesInput] = useState('');

  // interval inline edit
  const [editingHeaderId, setEditingHeaderId] = useState(null);
  const [tempHeaderMiles, setTempHeaderMiles] = useState('');
  const headerMilesRef = useRef(null);

  // overlays
  const [overlay, setOverlay] = useState(null); // 'prompt' | 'thinking' | 'edit' | 'image' | 'custom' | null
  const [isGenerating, setIsGenerating] = useState(false);

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
  const [customPriority, setCustomPriority] = useState('low'); // 'low' | 'medium' | 'high'
  const [customNotes, setCustomNotes] = useState('');

  const [cameraPermission, requestCameraPermission] = ImagePicker.useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = ImagePicker.useMediaLibraryPermissions();
  const scrollViewRef = useRef(null);
  const saveTimeoutRef = useRef(null);

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

  // Compute next due ONLY when we have a recorded completion mileage.
  const computeDueMiles = (svc) => {
    if (!svc.intervalMiles) return undefined;
    const completed = svc.completedMileageNumber ?? (svc.completedMileage ? parseInt(digitsOnly(svc.completedMileage), 10) : undefined);
    if (!Number.isFinite(completed)) return undefined; // no completion recorded => unknown due
    return completed + svc.intervalMiles;
  };

  const recalcAllDues = (arr) =>
    arr.map((svc) => {
      const due = computeDueMiles(svc);
      return {
        ...svc,
        dueMilesNumber: due,
        dueDisplay: due ? `${formatThousands(String(due))} mi` : '—',
      };
    });

  const getRemainingMiles = (svc, currentMilesNumber) => {
    if (!currentMilesNumber) return undefined;
    const due = svc.dueMilesNumber ?? computeDueMiles(svc);
    if (!due) return undefined;
    return due - currentMilesNumber;
  };

  const getSeverityForService = (svc, currentMilesNumber) => {
    if (!svc.completedMileageNumber && !svc.completedMileage) return 'red'; // assume due until first completion logged
    if (!svc.intervalMiles || !currentMilesNumber) return 'neutral';
    const remaining = getRemainingMiles(svc, currentMilesNumber);
    if (remaining == null) return 'neutral';
    if (remaining <= 0) return 'red';
    const threshold = Math.max(500, Math.round(svc.intervalMiles * 0.2));
    if (remaining <= threshold) return 'yellow';
    return 'green';
  };

  const autoUnmarkIfOverdue = (arr, currentMilesNumber) => {
    if (!currentMilesNumber) return arr;
    let changed = false;
    const next = arr.map((svc) => {
      if (svc.completed && svc.dueMilesNumber && currentMilesNumber >= svc.dueMilesNumber) {
        changed = true;
        return { ...svc, completed: false };
      }
      return svc;
    });
    if (changed) {
      // optional user feedback
      // Alert.alert('Status Updated', 'One or more services are due again based on current mileage.');
    }
    return next;
  };

  const persistVehicleMiles = async (value) => {
    if (!selectedVehicle?.id) return;
    try { await AsyncStorage.setItem(`vehicleMileage_${selectedVehicle.id}`, String(value ?? '')); } catch {}
  };

  // ---------- load/save ----------
  useEffect(() => {
    const loadData = async () => {
      if (!selectedVehicle?.id) {
        setServices([]); setHasGeneratedServices(false);
        setVehicleMiles(''); setVehicleMilesInput('');
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
    const pm = await getPrefillMileage();
    setPromptMileage(pm ? String(pm) : '');
    setOverlay('prompt');
  };

  const startGenerationAfterMileage = async () => {
    if (isGenerating) return;
    setOverlay('thinking');
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
      setOverlay(null);
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
        }))
      : [];

    const newServices = sanitized.map((s, i) => ({
      id: Date.now().toString() + i,
      text: s.text,
      priority: s.priority,
      intervalMiles: s.intervalMiles,
      completed: false,
      proofUris: [],
      notes: '',
      completedMileage: '',
      completedMileageNumber: undefined,
      date: 'N/A',
      lastCompletedDate: undefined,
      dueDisplay: '—',       // unknown until first completion is logged
      dueMilesNumber: undefined,
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

  // ---------- mark complete / unmark ----------
  // New UX: "Mark Completed" opens Edit overlay FIRST; we only set completed after user fills mileage/date.
  const handleMarkCompleted = (id) => {
    const svc = services.find((s) => s.id === id);
    if (!svc) return;
    setPendingCompleteServiceId(id);
    setFocusLockServiceId(id);                 // prevent jumping while editing
    openEditDetails(svc, { hint: true });     // show overlay
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
          if (!result.canceled && result.assets?.[0]?.uri) addProof(serviceId, result.assets[0].uri);
        },
      },
      {
        text: 'Photo Library',
        onPress: async () => {
          const lib = await requestMediaPermission();
          if (!lib.granted) return Alert.alert('Photo library permission required');
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
          if (!result.canceled && result.assets?.[0]?.uri) addProof(serviceId, result.assets[0].uri);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const addProof = (serviceId, uri) => {
    setServices((prev) => {
      const updated = prev.map((s) => (s.id === serviceId ? { ...s, proofUris: [...s.proofUris, uri] } : s));
      saveServicesToStorage(updated); return updated;
    });
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
  const openEditDetails = (service, opts = {}) => {
    setEditService(service);
    setTempNotes(service.notes || '');
    const initial = service.completedMileageNumber != null
      ? String(service.completedMileageNumber)
      : service.completedMileage || '';
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

        // If this save came from "Mark Completed", set completed=true now
        if (pendingCompleteServiceId === svc.id) next.completed = true;

        // compute new due
        const due = computeDueMiles(next);
        next.dueMilesNumber = due;
        next.dueDisplay = due ? `${formatThousands(String(due))} mi` : '—';

        return next;
      });

      // auto-unmark if current mileage already past due
      const currentMilesNumber = parseInt(digitsOnly(vehicleMiles)) || undefined;
      const withAuto = autoUnmarkIfOverdue(recalcAllDues(updated), currentMilesNumber);

      saveServicesToStorage(withAuto);
      return withAuto;
    });

    // clear states & keep focus stable until overlay closes
    setOverlay(null);
    setPendingCompleteServiceId(null);
    setEditService(null);
    setFocusLockServiceId(null);

    // Optional UX toast:
    // Alert.alert('Saved', 'Service details updated.');
  };

  // ---------- interval inline save ----------
  const saveIntervalInline = (serviceId) => {
    const { value } = normalizeNumber(tempHeaderMiles);
    setServices((prev) => {
      const updated = prev.map((s) => (s.id === serviceId ? { ...s, intervalMiles: value } : s));
      const idx = updated.findIndex((u) => u.id === serviceId);
      if (idx >= 0) {
        const due = computeDueMiles(updated[idx]);
        updated[idx].dueMilesNumber = due;
        updated[idx].dueDisplay = due ? `${formatThousands(String(due))} mi` : '—';
      }
      saveServicesToStorage(updated);
      return updated;
    });
    setEditingHeaderId(null);
    setTempHeaderMiles('');
  };

  // ---------- custom service ----------
  const openCustomOverlay = () => {
    setCustomTitle('');
    setCustomInterval('');
    setCustomPriority('low');
    setCustomNotes('');
    setOverlay('custom');
  };

  const saveCustomService = () => {
    if (!customTitle.trim()) return Alert.alert('Missing Title', 'Please enter a service title.');
    const { value: intervalVal } = normalizeNumber(customInterval);

    const newService = {
      id: Date.now().toString(),
      text: customTitle.trim(),
      priority: customPriority,
      intervalMiles: intervalVal,
      completed: false,
      proofUris: [],
      notes: customNotes.trim(),
      completedMileage: '',
      completedMileageNumber: undefined,
      date: 'N/A',
      lastCompletedDate: undefined,
      dueDisplay: '—',
      dueMilesNumber: undefined,
    };

    const updated = [...services, newService];
    setServices(updated);
    saveServicesToStorage(updated);
    setOverlay(null);
    setTimeout(() => scrollViewRef.current?.scrollToEnd?.({ animated: true }), 200);
  };

  // ---------- vehicle mileage bar ----------
  const saveVehicleMilesAndRecalc = async () => {
    const { value } = normalizeNumber(vehicleMilesInput);
    const display = value ? String(value) : '';
    setVehicleMiles(display);
    setVehicleMilesInput(formatThousands(display));
    await persistVehicleMiles(display);
    onUpdateVehicleCurrentMileage?.(value); // optional parent callback

    // recalc dues and auto-unmark completed that became due
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
    setModalVisible(false);
  };

  // ---------- render ----------
  // If we're editing, freeze list order by NOT resorting; otherwise keep the natural array order (no completed-at-bottom shuffle).
  const listToRender = services; // keeping insertion order for stable UX

  const vehicleLabel = (() => {
    const v = selectedVehicle || {};
    const year = v.year ? String(v.year) : '';
    const base = [year, v.make, v.model].filter(Boolean).join(' ');
    return base || 'vehicle';
  })();
  const currentMilesNumber = parseInt(digitsOnly(vehicleMiles)) || undefined;

  return (
    <>
      <TouchableOpacity style={styles.container} onPress={() => setModalVisible(true)} disabled={isGenerating} activeOpacity={0.85}>
        <Text style={styles.label}>Recommended Service:</Text>
        <Text style={styles.mileage}>
          {services.find((s) => !s.completed && s.priority === 'high')?.text ||
            services.find((s) => !s.completed)?.text ||
            `No pending service for your ${vehicleLabel}`}
        </Text>
        <MaterialIcons name="keyboard-arrow-down" size={24} color="#fff" />
      </TouchableOpacity>

      {/* FULL-SCREEN MAIN MODAL */}
      <Modal
        visible={modalVisible}
        transparent={false}
        animationType="slide"
        onRequestClose={closeAll}
        presentationStyle="fullScreen"
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: '#121212' }}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
        >
          <View style={styles.modalWrapper}>
            <View style={styles.modalBox}>
              {/* Header */}
              <View style={styles.headerRow}>
                <TouchableOpacity onPress={() => Alert.alert('Info', `Managing services for your ${vehicleLabel}.`)} style={styles.headerButton}>
                  <MaterialIcons name="info-outline" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.modalTitle} numberOfLines={1} adjustsFontSizeToFit>All Service Recommendations</Text>
                <TouchableOpacity onPress={closeAll} style={styles.headerButton}>
                  <Text style={styles.modalCloseText}>×</Text>
                </TouchableOpacity>
              </View>

              {/* Vehicle mileage bar */}
              <View style={styles.mileageBar}>
                <Text style={styles.mileageBarLabel}>Vehicle Mileage</Text>
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
                {vehicleMiles ? (
                  <Text style={styles.mileageBarHint}>Using {formatThousands(vehicleMiles)} mi for urgency.</Text>
                ) : (
                  <Text style={styles.mileageBarHint}>Set mileage to enable urgency colors.</Text>
                )}
              </View>

              {/* Generate CTA (if needed) */}
              {!hasGeneratedServices && (
                <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
                  <TouchableOpacity style={styles.generateButton} onPress={handleGeneratePress} disabled={isGenerating} activeOpacity={0.95}>
                    <Text style={styles.addServiceText}>Generate Recommended Service Records</Text>
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

                  const dueText =
                    service.dueDisplay && service.dueDisplay !== '—'
                      ? `${service.dueDisplay}`
                      : '—';

                  let remainingText = '';
                  if (remaining != null) {
                    if (remaining <= 0) {
                      remainingText = ` (OVERDUE by ${formatThousands(String(Math.abs(remaining)))} mi)`;
                    } else {
                      remainingText = ` (${formatThousands(String(remaining))} mi left)`;
                    }
                  } else if (!service.completedMileageNumber && !service.completedMileage) {
                    remainingText = ' (log a completion to start tracking)';
                  }

                  return (
                    <View key={service.id} style={[styles.serviceItem, severityStyle]}>
                      {/* Header */}
                      <View style={styles.serviceHeaderRow}>
                        <View style={{ flex: 1, flexWrap: 'wrap' }}>
                          <Text style={styles.serviceTitleText}>{service.text}</Text>
                          <View style={styles.milesEditRow}>
                            <Text style={styles.serviceSubLabel}>Interval: </Text>
                            {isEditing ? (
                              <>
                                <TextInput
                                  ref={headerMilesRef}
                                  style={[styles.inlineInput, { paddingVertical: 4, minWidth: 90 }]}
                                  value={tempHeaderMiles}
                                  onChangeText={(t) => setTempHeaderMiles(formatThousands(t))}
                                  placeholder="miles"
                                  placeholderTextColor="#777"
                                  keyboardType="numeric"
                                  inputMode="numeric"
                                  maxLength={12}
                                  autoFocus
                                  returnKeyType="done"
                                  onSubmitEditing={() => saveIntervalInline(service.id)}
                                />
                                <Text style={styles.serviceSubLabel}> miles</Text>
                                <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#4CAF50' }]} onPress={() => saveIntervalInline(service.id)}>
                                  <Text style={styles.smallBtnText}>Save</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#FF5252' }]} onPress={() => { setEditingHeaderId(null); setTempHeaderMiles(''); }}>
                                  <Text style={styles.smallBtnText}>Cancel</Text>
                                </TouchableOpacity>
                              </>
                            ) : (
                              <TouchableOpacity
                                onPress={() => {
                                  setEditingHeaderId(service.id);
                                  setTempHeaderMiles(formatThousands(service.intervalMiles ?? ''));
                                  setTimeout(() => headerMilesRef.current?.focus?.(), 30);
                                }}
                              >
                                <Text style={styles.clickableMiles}>
                                  {service.intervalMiles ? `${formatThousands(service.intervalMiles)} miles` : 'set miles'}
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>

                        <TouchableOpacity style={styles.deleteButton} onPress={() => {
                          Alert.alert('Delete Service', 'Are you sure?', [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delete', style: 'destructive', onPress: () => {
                              setServices((prev) => {
                                const updated = prev.filter((s) => s.id !== service.id);
                                saveServicesToStorage(updated);
                                return updated;
                              });
                            }},
                          ]);
                        }}>
                          <MaterialCommunityIcons name="trash-can-outline" size={16} color="#fff" />
                        </TouchableOpacity>
                      </View>

                      {/* Due line */}
                      <View style={{ marginTop: 4 }}>
                        <Text style={styles.dueText}>
                          Due: <Text style={styles.dueValue}>{dueText}</Text>
                          <Text style={styles.dueRemaining}>{remainingText}</Text>
                        </Text>
                      </View>

                      {/* Proof thumbnails */}
                      {service.proofUris.length > 0 && (
                        <ScrollView horizontal style={styles.proofRow} contentContainerStyle={styles.proofRowContent}>
                          {service.proofUris.map((uri, index) => (
                            <TouchableOpacity
                              key={index}
                              onPress={() => { setImageForServiceId(service.id); setCurrentIndex(index); setOverlay('image'); }}
                              style={styles.thumbnailContainer}
                              activeOpacity={0.7}
                            >
                              <Image source={{ uri }} style={styles.thumbnail} />
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      )}

                      {/* Details summary */}
                      <View style={styles.detailsBox}>
                        <Text style={styles.detailText}>Notes: {service.notes || 'N/A'}</Text>
                        <Text style={styles.detailText}>
                          Completed Mileage:{' '}
                          {service.completedMileage || (service.completedMileageNumber != null ? formatThousands(service.completedMileageNumber) : 'N/A')}
                        </Text>
                        <Text style={styles.detailText}>Date: {service.date || 'N/A'}</Text>
                      </View>

                      {/* Actions */}
                      <View style={styles.buttonRow}>
                        {!service.completed ? (
                          <>
                            <TouchableOpacity style={styles.completeButton} onPress={() => handleMarkCompleted(service.id)}>
                              <MaterialCommunityIcons name="check-circle-outline" size={16} color="#fff" />
                              <Text style={styles.completeText}> Mark Completed</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.completeButton} onPress={() => { setFocusLockServiceId(service.id); openEditDetails(service); }}>
                              <MaterialIcons name="edit" size={16} color="#fff" />
                              <Text style={styles.completeText}> Edit Details</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.completeButton} onPress={() => handleUploadProof(service.id)}>
                              <MaterialCommunityIcons name="image-plus" size={16} color="#fff" />
                              <Text style={styles.completeText}> Add Proof</Text>
                            </TouchableOpacity>
                          </>
                        ) : (
                          <>
                            <TouchableOpacity style={styles.completeButton} onPress={() => { setFocusLockServiceId(service.id); openEditDetails(service); }}>
                              <MaterialIcons name="edit" size={16} color="#fff" />
                              <Text style={styles.completeText}> Edit Details</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.completeButton} onPress={() => handleUploadProof(service.id)}>
                              <MaterialCommunityIcons name="plus-circle-outline" size={16} color="#fff" />
                              <Text style={styles.completeText}> Add Proof</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.completeButton} onPress={() => handleUnmarkCompleted(service.id)}>
                              <MaterialCommunityIcons name="refresh" size={16} color="#fff" />
                              <Text style={styles.completeText}> Unmark</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>
                  );
                })}

                {/* Legacy bottom button */}
                <View style={{ alignItems: 'center' }}>
                  <TouchableOpacity style={styles.addServiceButton} onPress={openCustomOverlay} disabled={isGenerating}>
                    <Text style={styles.addServiceText}>+ Add Custom Service</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>

              {/* Floating Add FAB — always reachable */}
              <TouchableOpacity style={styles.addFab} onPress={openCustomOverlay} activeOpacity={0.9}>
                <MaterialIcons name="add" size={26} color="#fff" />
              </TouchableOpacity>

              {/* ===================== OVERLAYS ===================== */}

              {/* Prompt for current mileage */}
              {overlay === 'prompt' && (
                <View style={styles.overlay}>
                  <View style={styles.overlayCard}>
                    <Text style={[styles.decodingText, { marginBottom: 8 }]}>
                      Enter current mileage for your {vehicleLabel}
                    </Text>
                    <TextInput
                      style={[styles.inlineInput, { width: '100%', marginTop: 6 }]}
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
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 }}>
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

              {/* Thinking */}
              {overlay === 'thinking' && (
                <View style={styles.overlay}>
                  <View style={styles.overlayCardCenter}>
                    <Text style={styles.decodingText}>🔧 Torque is thinking…</Text>
                    <ActivityIndicator size="large" color="#4CAF50" />
                  </View>
                </View>
              )}

              {/* Edit Details */}
              {overlay === 'edit' && editService && (
                <View style={styles.overlay}>
                  <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '90%' }}>
                    <View style={[styles.overlayCard, { width: '100%' }]}>
                      <Text style={[styles.decodingText, { marginBottom: 4 }]}>Edit Details</Text>
                      {pendingCompleteServiceId === editService.id ? (
                        <Text style={{ color: '#9ae6b4', marginBottom: 8 }}>
                          Marking as completed — please enter completion mileage (required).
                        </Text>
                      ) : null}

                      <Text style={{ color: '#ccc', marginTop: 6 }}>Notes</Text>
                      <TextInput
                        style={[styles.inlineInput, { width: '100%', marginTop: 6, minHeight: 80, textAlignVertical: 'top' }]}
                        value={tempNotes}
                        onChangeText={setTempNotes}
                        placeholder="Part numbers, capacities, fluids, torque specs…"
                        placeholderTextColor="#777"
                        multiline
                      />

                      <Text style={{ color: '#ccc', marginTop: 12 }}>Completed Mileage {pendingCompleteServiceId === editService.id ? '(required)' : ''}</Text>
                      <TextInput
                        style={[styles.inlineInput, { width: '100%', marginTop: 6 }]}
                        value={tempCompletedMileage}
                        onChangeText={(t) => setTempCompletedMileage(formatThousands(t))}
                        placeholder="e.g., 181,000"
                        placeholderTextColor="#777"
                        keyboardType="numeric"
                        inputMode="numeric"
                        maxLength={12}
                      />

                      <Text style={{ color: '#ccc', marginTop: 12 }}>Date</Text>
                      <TouchableOpacity
                        onPress={() => setShowDatePicker(true)}
                        style={{ marginTop: 6, backgroundColor: '#222', padding: 10, borderRadius: 8 }}
                      >
                        <Text style={{ color: '#fff' }}>{tempDate || 'Select date'}</Text>
                      </TouchableOpacity>

                      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 }}>
                        <TouchableOpacity onPress={() => { setOverlay(null); setEditService(null); setPendingCompleteServiceId(null); setFocusLockServiceId(null); }} style={styles.btnGrey}>
                          <Text style={styles.btnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={saveEditDetails} style={styles.btnGreen}>
                          <Text style={[styles.btnText, { fontWeight: '600' }]}>Save</Text>
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

              {/* Image Viewer — nice UI with chevrons & pager */}
              {overlay === 'image' && imageForServiceId && (
                <View style={styles.overlay}>
                  <View style={styles.viewerShell}>
                    {/* Top bar */}
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

                    {/* Image */}
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

                    {/* Left/Right chevrons (hide if single image) */}
                    {(() => {
                      const svc = services.find((s) => s.id === imageForServiceId);
                      const total = svc?.proofUris?.length || 0;
                      if (total <= 1) return null;
                      return (
                        <>
                          <TouchableOpacity
                            style={[styles.chevron, { left: 10 }]}
                            onPress={() => {
                              const next = (currentIndex - 1 + total) % total;
                              setCurrentIndex(next);
                            }}
                            activeOpacity={0.8}
                          >
                            <MaterialIcons name="chevron-left" size={38} color="#fff" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.chevron, { right: 10 }]}
                            onPress={() => {
                              const next = (currentIndex + 1) % total;
                              setCurrentIndex(next);
                            }}
                            activeOpacity={0.8}
                          >
                            <MaterialIcons name="chevron-right" size={38} color="#fff" />
                          </TouchableOpacity>

                          {/* Pager */}
                          <View style={styles.pager}>
                            <Text style={styles.pagerText}>{currentIndex + 1}/{total}</Text>
                          </View>
                        </>
                      );
                    })()}
                  </View>
                </View>
              )}

              {/* Add Custom Service */}
              {overlay === 'custom' && (
                <View style={styles.overlay}>
                  <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '90%' }}>
                    <View style={[styles.overlayCard, { width: '100%' }]}>
                      <Text style={[styles.decodingText, { marginBottom: 8 }]}>Add Custom Service</Text>

                      <Text style={{ color: '#ccc', marginTop: 6 }}>Title</Text>
                      <TextInput
                        style={[styles.inlineInput, { width: '100%', marginTop: 6 }]}
                        value={customTitle}
                        onChangeText={setCustomTitle}
                        placeholder="e.g., Rear Differential Fluid Change"
                        placeholderTextColor="#777"
                      />

                      <Text style={{ color: '#ccc', marginTop: 12 }}>Interval (miles)</Text>
                      <TextInput
                        style={[styles.inlineInput, { width: '100%', marginTop: 6 }]}
                        value={customInterval}
                        onChangeText={(t) => setCustomInterval(formatThousands(t))}
                        placeholder="e.g., 30,000"
                        placeholderTextColor="#777"
                        keyboardType="numeric"
                        inputMode="numeric"
                        maxLength={12}
                      />

                      <Text style={{ color: '#ccc', marginTop: 12 }}>Priority</Text>
                      <View style={styles.priorityRow}>
                        {['low', 'medium', 'high'].map((p) => (
                          <TouchableOpacity
                            key={p}
                            onPress={() => setCustomPriority(p)}
                            style={[styles.prioBtn, customPriority === p && styles.prioBtnActive]}
                          >
                            <Text style={styles.prioText}>{p.toUpperCase()}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      <Text style={{ color: '#ccc', marginTop: 12 }}>Notes (optional)</Text>
                      <TextInput
                        style={[styles.inlineInput, { width: '100%', marginTop: 6, minHeight: 70, textAlignVertical: 'top' }]}
                        value={customNotes}
                        onChangeText={setCustomNotes}
                        placeholder="Part numbers, capacities, fluid type/viscosity, etc."
                        placeholderTextColor="#777"
                        multiline
                      />

                      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 }}>
                        <TouchableOpacity onPress={() => setOverlay(null)} style={styles.btnGrey}>
                          <Text style={styles.btnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={saveCustomService} style={styles.btnGreen}>
                          <Text style={[styles.btnText, { fontWeight: '600' }]}>Save</Text>
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

const styles = StyleSheet.create({
  container: { backgroundColor: '#333', borderRadius: 12, padding: 26, alignItems: 'center', marginVertical: 10 },
  label: { color: '#aaa', fontSize: 14 },
  mileage: { color: '#fff', fontSize: 18, fontWeight: '600', marginVertical: 4, textAlign: 'center' },

  modalWrapper: { flex: 1, paddingTop: 50, backgroundColor: '#121212' },
  scrollContent: { flexGrow: 1, paddingBottom: 160 },
  modalBox: { backgroundColor: '#121212', borderRadius: 20, marginHorizontal: 16, elevation: 10, paddingBottom: 20 },

  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8, width: '100%' },
  headerButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 22 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  modalCloseText: { color: '#fff', fontSize: 20, fontWeight: 'bold', lineHeight: 22 },

  mileageBar: { marginHorizontal: 16, marginBottom: 10, backgroundColor: '#1b1b1b', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#2b2b2b' },
  mileageBarLabel: { color: '#eee', fontWeight: '600', marginBottom: 6 },
  mileageInputRow: { flexDirection: 'row', alignItems: 'center' },
  mileageSaveBtn: { backgroundColor: '#4CAF50', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, marginLeft: 8 },
  mileageSaveText: { color: '#fff', fontWeight: '600' },
  mileageBarHint: { color: '#999', marginTop: 6, fontSize: 12 },

  serviceItem: { borderRadius: 8, padding: 12, marginBottom: 10 },
  serviceHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  serviceTitleText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  milesEditRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 4 },

  serviceSubLabel: { color: '#ccc', fontSize: 13 },
  clickableMiles: { color: '#FFD700', textDecorationLine: 'underline', fontSize: 13, paddingVertical: 2 },

  inlineInput: { backgroundColor: '#111', color: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#444', paddingHorizontal: 10, minWidth: 90, marginHorizontal: 4 },

  dueText: { color: '#ddd', fontSize: 12, flexWrap: 'wrap' },
  dueValue: { color: '#fff' },
  dueRemaining: { color: '#ccc' },

  deleteButton: { backgroundColor: '#FF5252', padding: 6, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },

  proofRow: { marginTop: 8 },
  proofRowContent: { flexDirection: 'row', alignItems: 'center' },
  thumbnailContainer: { marginRight: 8, borderRadius: 6, width: 60, height: 60, zIndex: 1 },
  thumbnail: { width: '100%', height: '100%', borderRadius: 6 },

  detailsBox: { marginTop: 8, backgroundColor: '#1e1e1e', padding: 8, borderRadius: 6 },
  detailText: { color: '#ccc', fontSize: 12, marginBottom: 2 },

  buttonRow: { flexDirection: 'row', justifyContent: 'flex-start', marginTop: 16, flexWrap: 'wrap' },
  completeButton: { backgroundColor: '#4CAF50', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, flexDirection: 'row', alignItems: 'center', marginRight: 8, marginBottom: 6 },
  completeText: { color: '#fff', fontSize: 12, marginLeft: 5 },

  serviceLow: { backgroundColor: '#424242' },
  serviceSevGreen: { backgroundColor: '#1f5f2a' },
  serviceSevYellow: { backgroundColor: '#8d6e00' },
  serviceSevRed: { backgroundColor: '#7f1d1d' },

  addServiceButton: { marginTop: 10, alignSelf: 'center', backgroundColor: '#4CAF50', paddingVertical: 10, paddingHorizontal: 36, height: 40, borderRadius: 10, zIndex: 1 },
  generateButton: { alignSelf: 'flex-start', backgroundColor: '#2196F3', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, zIndex: 1 },
  addServiceText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },

  addFab: {
    position: 'absolute',
    right: 22,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },

  decodingText: { color: '#fff', fontSize: 18, marginBottom: 20 },

  smallBtn: { marginLeft: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, alignSelf: 'center' },
  smallBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  overlayCard: {
    backgroundColor: '#111',
    padding: 16,
    borderRadius: 12,
    width: '90%',
  },
  overlayCardCenter: {
    backgroundColor: 'transparent',
    padding: 16,
    borderRadius: 12,
    width: '90%',
    alignItems: 'center',
  },

  btnGrey: { paddingVertical: 10, paddingHorizontal: 16, marginRight: 8, backgroundColor: '#555', borderRadius: 8 },
  btnGreen: { paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#4CAF50', borderRadius: 8 },
  btnText: { color: '#fff' },

  priorityRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  prioBtn: { backgroundColor: '#222', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#444' },
  prioBtnActive: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  prioText: { color: '#fff', fontWeight: '600', fontSize: 12 },

  viewerShell: {
    width: '95%',
    height: '82%',
    backgroundColor: '#080808',
    borderRadius: 14,
    overflow: 'hidden',
    borderColor: '#222',
    borderWidth: 1,
  },
  viewerTopBar: {
    height: 46,
    backgroundColor: 'rgba(0,0,0,0.55)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomColor: '#111',
    borderBottomWidth: 1,
  },
  viewerTopBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8 },
  viewerTopBarText: { color: '#fff', fontSize: 14 },
  viewerImageWrap: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },

  chevron: {
    position: 'absolute',
    top: '45%',
    backgroundColor: 'rgba(0,0,0,0.45)',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pager: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  pagerText: { color: '#fff', fontSize: 12 },
});
