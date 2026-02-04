// components/AudioRecorderModal.js
// ✅ Pill-style recorder that supports playback + attach checkmark.
// ✅ Does NOT auto-send. It returns { uri, durationMs } to App via onDone().
// ✅ Auto-closes itself after attaching (App hides it too).
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

async function safeSetModeRecording(on) {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: !!on,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
  } catch (e) {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: !!on,
        playsInSilentModeIOS: true,
      });
    } catch {
      throw e;
    }
  }
}

export default function AudioRecorderModal({ visible, onClose, onDone, disabled = false }) {
  const recRef = useRef(null);
  const soundRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);

  const [uri, setUri] = useState(null);
  const [durationMs, setDurationMs] = useState(null);

  const [meter, setMeter] = useState(0);

  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);

  const resetState = () => {
    setReady(false);
    setBusy(false);
    setRecording(false);
    setUri(null);
    setDurationMs(null);
    setMeter(0);
    setPlaying(false);
    setPosMs(0);
  };

  const cleanupRecording = async () => {
    try {
      if (recRef.current) {
        try {
          const st = await recRef.current.getStatusAsync();
          if (st?.isRecording) await recRef.current.stopAndUnloadAsync();
        } catch {}
        recRef.current = null;
      }
    } catch {}
  };

  const cleanupSound = async () => {
    try {
      if (soundRef.current) {
        try {
          await soundRef.current.stopAsync();
        } catch {}
        try {
          await soundRef.current.unloadAsync();
        } catch {}
        soundRef.current = null;
      }
    } catch {}
    setPlaying(false);
    setPosMs(0);
  };

  const cleanupAll = async () => {
    await cleanupRecording();
    await cleanupSound();
    try {
      await safeSetModeRecording(false);
    } catch {}
  };

  useEffect(() => {
    if (!visible) {
      cleanupAll().finally(() => resetState());
      return;
    }

    (async () => {
      try {
        setBusy(true);

        const perm = await Audio.requestPermissionsAsync();
        if (!perm?.granted) {
          Alert.alert('Microphone permission needed', 'Enable microphone access in Settings to record engine sounds.');
          return;
        }

        await safeSetModeRecording(true);
        setReady(true);
      } catch (e) {
        console.log('Audio init error:', e);
        Alert.alert('Audio init failed', e?.message || 'Could not initialize audio.');
      } finally {
        setBusy(false);
      }
    })();

    return () => {
      cleanupAll().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const start = async () => {
    if (disabled || !ready || busy || recording) return;

    try {
      setBusy(true);
      await cleanupSound();
      setUri(null);
      setDurationMs(null);
      setMeter(0);
      setPosMs(0);

      await safeSetModeRecording(true);

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);

      rec.setProgressUpdateInterval(120);
      rec.setOnRecordingStatusUpdate((st) => {
        if (typeof st?.metering === 'number') {
          const db = Math.max(-60, Math.min(0, st.metering));
          const norm = (db + 60) / 60;
          setMeter(norm);
        }
      });

      await rec.startAsync();
      recRef.current = rec;
      setRecording(true);
    } catch (e) {
      console.log('startRecording error:', e);
      Alert.alert('Recording failed', e?.message || 'Could not start recording.');
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (disabled || !recRef.current || busy) return;

    try {
      setBusy(true);

      await recRef.current.stopAndUnloadAsync();
      const u = recRef.current.getURI();

      let dur = null;
      try {
        const st = await recRef.current.getStatusAsync();
        if (typeof st?.durationMillis === 'number') dur = st.durationMillis;
      } catch {}

      recRef.current = null;
      setRecording(false);
      setUri(u || null);
      setDurationMs(dur);

      await safeSetModeRecording(false);
    } catch (e) {
      console.log('stopRecording error:', e);
      Alert.alert('Stop failed', e?.message || 'Could not stop recording.');
    } finally {
      setBusy(false);
    }
  };

  const togglePlay = async () => {
    if (disabled || busy || !uri) return;

    try {
      setBusy(true);

      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: false, isLooping: false },
          (st) => {
            if (!st) return;
            if (typeof st.positionMillis === 'number') setPosMs(st.positionMillis);

            if (st.didJustFinish) {
              setPlaying(false);
              setPosMs(0);
            }
          }
        );
        soundRef.current = sound;
      }

      const st = await soundRef.current.getStatusAsync();
      if (st?.isPlaying) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
      } else {
        await soundRef.current.playAsync();
        setPlaying(true);
      }
    } catch (e) {
      console.log('playback error:', e);
      Alert.alert('Playback failed', e?.message || 'Could not play audio.');
    } finally {
      setBusy(false);
    }
  };

  const attach = async () => {
    if (disabled || busy || !uri || recording) return;

    try {
      setBusy(true);
      await cleanupSound();

      // ✅ pass payload to App; App will attach it to ChatBoxFixed
      onDone?.({ uri, durationMs: durationMs || null });

      // ✅ close + reset so user can’t attach multiple from this pill
      onClose?.();
      resetState();
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (busy) return;
    try {
      setBusy(true);
      await cleanupAll();
      onClose?.();
      resetState();
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  const pct = Math.round((meter || 0) * 100);
  const durSec = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay} pointerEvents="box-none">
        {/* Bottom pill */}
        <View style={[styles.pill, (disabled || busy) && styles.pillDisabled]}>
          {/* left record/stop */}
          <TouchableOpacity
            style={[
              styles.leftBtn,
              recording ? styles.btnStop : styles.btnRec,
              (!ready || disabled || busy) && styles.btnDisabled,
            ]}
            disabled={!ready || disabled || busy}
            onPress={recording ? stop : start}
            activeOpacity={0.85}
          >
            <Ionicons name={recording ? 'stop' : 'mic'} size={16} color="#fff" />
            <Text style={styles.leftText}>{recording ? 'Stop' : 'Record'}</Text>
          </TouchableOpacity>

          {/* middle meter / playback */}
          <View style={styles.mid}>
            {recording ? (
              <>
                <View style={styles.meterTrack}>
                  <View style={[styles.meterFill, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.midText}>Recording…</Text>
              </>
            ) : uri ? (
              <>
                <TouchableOpacity
                  style={[styles.playBtn, (disabled || busy) && styles.btnDisabled]}
                  onPress={togglePlay}
                  disabled={disabled || busy}
                  activeOpacity={0.85}
                >
                  <Ionicons name={playing ? 'pause' : 'play'} size={16} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.midText}>{durSec ? `${durSec}s ready` : 'Audio ready'}</Text>
              </>
            ) : (
              <Text style={styles.midText}>Voice note</Text>
            )}
          </View>

          {/* attach */}
          <TouchableOpacity
            style={[styles.iconCircle, (!uri || recording || disabled || busy) && styles.iconDisabled]}
            disabled={!uri || recording || disabled || busy}
            onPress={attach}
            activeOpacity={0.85}
          >
            <Ionicons name="checkmark" size={18} color="#fff" />
          </TouchableOpacity>

          {/* close */}
          <TouchableOpacity
            style={[styles.iconCircle, styles.iconClose, (disabled || busy) && styles.iconDisabled]}
            disabled={disabled || busy}
            onPress={close}
            activeOpacity={0.85}
          >
            <Ionicons name="close" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* small hint line */}
        <View style={styles.hintRow}>
          <MaterialCommunityIcons name="information-outline" size={14} color="#888" />
          <Text style={styles.hintText}>Record 8–12s near the source • Play • ✓ attaches to chat</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 18 : 14,
  },

  pill: {
    borderRadius: 999,
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pillDisabled: { opacity: 0.6 },

  leftBtn: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btnRec: { backgroundColor: '#4CAF50' },
  btnStop: { backgroundColor: '#FF6666' },
  btnDisabled: { opacity: 0.6 },
  leftText: { color: '#fff', fontWeight: '900', fontSize: 12 },

  mid: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  midText: { color: '#ddd', fontSize: 12, fontWeight: '800' },

  meterTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  meterFill: { height: '100%', backgroundColor: '#4CAF50' },

  playBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: '#2d2d2d',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },

  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconClose: { backgroundColor: '#444' },
  iconDisabled: { opacity: 0.55 },

  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingLeft: 6,
    paddingBottom: Platform.OS === 'ios' ? 6 : 0,
  },
  hintText: { color: '#888', fontSize: 11, fontWeight: '700' },
});
