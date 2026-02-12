// components/VehiclePhotoModal.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  Dimensions,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
} from 'react-native-reanimated';

const { width: SCREEN_W } = Dimensions.get('window');

// Card aspect for the garage tiles (matches VehicleSelector bg)
const CARD_ASPECT = 16 / 9;

export default function VehiclePhotoModal({
  visible,
  onClose,
  onSave, // (finalUri) => void
  onPickFromLibrary, // optional: async () => uri (cropped/edited)
}) {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();

  // steps:
  // 'pick' -> choose/take buttons
  // 'camera' -> live camera view for capture
  // 'adjust' -> pinch/drag adjust then crop+save
  const [step, setStep] = useState('pick');
  const [capturedUri, setCapturedUri] = useState(null);
  const [busy, setBusy] = useState(false);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });

  // Frame size inside modal (same ratio you’ll render on the card)
  const frameW = useMemo(() => Math.min(SCREEN_W * 0.86, 420), []);
  const frameH = useMemo(() => Math.round(frameW / CARD_ASPECT), [frameW]);

  // gesture state for adjustment
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // gesture anchors (fixes pinch compounding)
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  // subtle “alive” drift while adjusting (optional)
  const drift = useSharedValue(0);
  useEffect(() => {
    drift.value = withRepeat(withTiming(1, { duration: 8000 }), -1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetAdjust = () => {
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    startScale.value = 1;
    startX.value = 0;
    startY.value = 0;
  };

  useEffect(() => {
    if (!visible) {
      setStep('pick');
      setCapturedUri(null);
      setBusy(false);
      setImgSize({ w: 0, h: 0 });
      resetAdjust();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (capturedUri) {
      Image.getSize(
        capturedUri,
        (w, h) => setImgSize({ w, h }),
        () => setImgSize({ w: 0, h: 0 })
      );
    }
  }, [capturedUri]);

  const ensureCameraPermission = async () => {
    if (!permission) return false;
    if (permission.granted) return true;
    const res = await requestPermission();
    return !!res?.granted;
  };

  const pickFromPhotos = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Prefer App-provided picker (so App.js can enforce the "adjust image" UX)
      if (typeof onPickFromLibrary === 'function') {
        const uri = await onPickFromLibrary();
        if (uri) {
          setCapturedUri(uri);
          resetAdjust();
          setStep('adjust');
        }
        return;
      }

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm?.granted) {
        Alert.alert('Permission needed', 'Enable Photo Library access in Settings.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,     // ✅ native cropper
        aspect: [16, 9],         // ✅ matches your card aspect
        quality: 0.95,
      });

      if (result.canceled) return;

      const uri = result.assets?.[0]?.uri;
      if (!uri) return;

      setCapturedUri(uri);
      resetAdjust();
      setStep('adjust');
    } catch (e) {
      Alert.alert('Photo error', e?.message || 'Could not open photo library.');
    } finally {
      setBusy(false);
    }
  };

  const openCamera = async () => {
    if (busy) return;
    const ok = await ensureCameraPermission();
    if (!ok) {
      Alert.alert('Camera permission', 'Enable camera access in Settings.');
      return;
    }
    setStep('camera');
  };

  const takePhoto = async () => {
    const ok = await ensureCameraPermission();
    if (!ok) return;

    try {
      setBusy(true);
      const pic = await cameraRef.current?.takePictureAsync({
        quality: 0.92,
        skipProcessing: false,
      });

      if (!pic?.uri) throw new Error('No photo URI returned');

      setCapturedUri(pic.uri);
      resetAdjust();
      setStep('adjust');
    } catch (e) {
      // noop
    } finally {
      setBusy(false);
    }
  };

  // ---- Base cover sizing (KEY) ----
  const imgW = imgSize.w || 0;
  const imgH = imgSize.h || 0;

  const baseScale = imgW && imgH ? Math.max(frameW / imgW, frameH / imgH) : 1;
  const baseRenderW = imgW ? imgW * baseScale : frameW;
  const baseRenderH = imgH ? imgH * baseScale : frameH;

  // Clamp translate so you can’t drag the image beyond its edges
  const clampTranslate = (tx, ty) => {
    const renderW = baseRenderW * (scale.value || 1);
    const renderH = baseRenderH * (scale.value || 1);

    const maxX = Math.max(0, (renderW - frameW) / 2);
    const maxY = Math.max(0, (renderH - frameH) / 2);

    return {
      x: Math.max(-maxX, Math.min(tx, maxX)),
      y: Math.max(-maxY, Math.min(ty, maxY)),
    };
  };

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onChange((e) => {
      const nextX = startX.value + e.translationX;
      const nextY = startY.value + e.translationY;
      const { x, y } = clampTranslate(nextX, nextY);
      translateX.value = x;
      translateY.value = y;
    });

  const pinchGesture = Gesture.Pinch()
    .onBegin(() => {
      startScale.value = scale.value;
    })
    .onChange((e) => {
      const next = startScale.value * e.scale;
      const clamped = Math.max(1, Math.min(next, 3.5));
      scale.value = clamped;

      const { x, y } = clampTranslate(translateX.value, translateY.value);
      translateX.value = x;
      translateY.value = y;
    });

  const composed = Gesture.Simultaneous(panGesture, pinchGesture);

  const imageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value + (drift.value * 4 - 2) },
      { translateY: translateY.value + (drift.value * 3 - 1.5) },
      { scale: scale.value },
    ],
  }));

  const saveCropped = async () => {
    if (!capturedUri || !imgW || !imgH) return;

    setBusy(true);
    try {
      const effectiveScale = baseScale * scale.value;

      const cropW = frameW / effectiveScale;
      const cropH = frameH / effectiveScale;

      const centerX = imgW / 2 - translateX.value / effectiveScale;
      const centerY = imgH / 2 - translateY.value / effectiveScale;

      let originX = centerX - cropW / 2;
      let originY = centerY - cropH / 2;

      originX = Math.max(0, Math.min(originX, imgW - cropW));
      originY = Math.max(0, Math.min(originY, imgH - cropH));

      const targetW = 1200;
      const targetH = Math.round(targetW / CARD_ASPECT);

      const result = await ImageManipulator.manipulateAsync(
        capturedUri,
        [
          {
            crop: {
              originX: Math.round(originX),
              originY: Math.round(originY),
              width: Math.round(cropW),
              height: Math.round(cropH),
            },
          },
          { resize: { width: targetW, height: targetH } },
        ],
        { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
      );

      if (!result?.uri) throw new Error('Crop failed');

      onSave?.(result.uri);
      onClose?.();
    } catch (e) {
      // noop
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  const Title =
    step === 'pick' ? 'Set Vehicle Photo'
    : step === 'camera' ? 'Take a Photo'
    : 'Adjust Photo';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={S.backdrop}>
        <View style={S.sheet}>
          <View style={S.header}>
            <Text style={S.title}>{Title}</Text>

            <TouchableOpacity style={S.closePill} onPress={onClose} activeOpacity={0.9}>
              <Text style={S.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* ============== PICK STEP ============== */}
          {step === 'pick' && (
            <View style={{ alignItems: 'center' }}>
              <View style={[S.previewBox, { width: frameW, height: frameH }]}>
                <View style={S.previewInner}>
                  <Text style={S.previewTitle}>Choose a clean photo of the vehicle</Text>
                  <Text style={S.previewSub}>You can crop/adjust it next.</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[S.primaryBtn, { marginTop: 14, width: frameW }]}
                onPress={pickFromPhotos}
                disabled={busy}
                activeOpacity={0.9}
              >
                {busy ? (
                  <ActivityIndicator color="#0f172a" />
                ) : (
                  <Text style={S.primaryText}>🖼️ Choose from Photos</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[S.secondaryBtn, { marginTop: 10, width: frameW }]}
                onPress={openCamera}
                disabled={busy}
                activeOpacity={0.9}
              >
                <Text style={S.secondaryText}>📷 Take Photo</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ============== CAMERA STEP ============== */}
          {step === 'camera' && (
            <View style={{ alignItems: 'center' }}>
              {!permission ? (
                <ActivityIndicator />
              ) : !permission.granted ? (
                <View style={{ padding: 14 }}>
                  <Text style={S.sub}>Camera permission is needed to take a vehicle photo.</Text>
                  <TouchableOpacity style={S.primaryBtn} onPress={requestPermission} activeOpacity={0.9}>
                    <Text style={S.primaryText}>Allow Camera</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={[S.cameraWrap, { width: frameW, height: frameH + 110 }]}>
                  <View style={[S.frame, { width: frameW, height: frameH }]}>
                    <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
                    <View style={S.frameBorder} pointerEvents="none" />
                    <View style={S.frameShadeTop} pointerEvents="none" />
                    <View style={S.frameShadeBottom} pointerEvents="none" />
                    <Text style={S.frameHint} pointerEvents="none">
                      Fit the car in the frame
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[S.primaryBtn, { marginTop: 14, width: frameW }]}
                    onPress={takePhoto}
                    disabled={busy}
                    activeOpacity={0.9}
                  >
                    {busy ? <ActivityIndicator color="#0f172a" /> : <Text style={S.primaryText}>📷 Capture</Text>}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[S.secondaryBtn, { marginTop: 10, width: frameW }]}
                    onPress={() => setStep('pick')}
                    disabled={busy}
                    activeOpacity={0.9}
                  >
                    <Text style={S.secondaryText}>Back</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* ============== ADJUST STEP ============== */}
          {step === 'adjust' && (
            <View style={{ alignItems: 'center' }}>
              <View style={[S.frame, { width: frameW, height: frameH, overflow: 'hidden' }]}>
                <GestureDetector gesture={composed}>
                  <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                    <Animated.Image
                      source={{ uri: capturedUri }}
                      style={[
                        {
                          width: baseRenderW,
                          height: baseRenderH,
                        },
                        imageAnimatedStyle,
                      ]}
                      resizeMode="cover"
                    />
                  </Animated.View>
                </GestureDetector>

                <View style={S.frameBorder} pointerEvents="none" />
                <View style={S.frameShadeTop} pointerEvents="none" />
                <View style={S.frameShadeBottom} pointerEvents="none" />
                <Text style={S.frameHint} pointerEvents="none">
                  Pinch to zoom • Drag to reposition
                </Text>
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <TouchableOpacity
                  style={S.secondaryBtn}
                  onPress={() => {
                    setCapturedUri(null);
                    setStep('pick');
                  }}
                  activeOpacity={0.9}
                >
                  <Text style={S.secondaryText}>Change</Text>
                </TouchableOpacity>

                <TouchableOpacity style={S.primaryBtn} onPress={saveCropped} disabled={busy} activeOpacity={0.9}>
                  {busy ? <ActivityIndicator color="#0f172a" /> : <Text style={S.primaryText}>Save Photo</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}

          <Text style={S.sub}>
            This photo becomes your vehicle card background (with a clean gradient so the text stays readable).
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#121212',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '900' },
  sub: { color: '#94a3b8', fontSize: 13, marginTop: 12, textAlign: 'center', lineHeight: 18 },

  closePill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  closeText: { color: '#fff', fontSize: 18, fontWeight: '900' },

  previewBox: {
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  previewInner: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  previewTitle: { color: '#fff', fontSize: 14, fontWeight: '900', textAlign: 'center' },
  previewSub: { color: '#94a3b8', fontSize: 12, marginTop: 6, fontWeight: '700', textAlign: 'center' },

  cameraWrap: { alignItems: 'center', justifyContent: 'flex-start' },

  frame: {
    borderRadius: 18,
    backgroundColor: '#000',
    position: 'relative',
  },
  frameBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: 18,
  },
  frameShadeTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 56,
    backgroundColor: 'rgba(0,0,0,0.40)',
  },
  frameShadeBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 70,
    backgroundColor: 'rgba(0,0,0,0.46)',
  },
  frameHint: {
    position: 'absolute',
    bottom: 10,
    left: 12,
    right: 12,
    color: 'rgba(255,255,255,0.86)',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },

  primaryBtn: {
    backgroundColor: '#22c55e',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
    minWidth: 150,
  },
  primaryText: { color: '#0f172a', fontWeight: '900', fontSize: 14 },

  secondaryBtn: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  secondaryText: { color: '#fff', fontWeight: '900', fontSize: 14 },
});
