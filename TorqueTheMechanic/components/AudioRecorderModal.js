// components/AudioRecorderModal.js
// ✅ Pill-style recorder that supports playback + attach checkmark.
// ✅ Does NOT auto-send. It returns { uri, durationMs } to App via onDone().
// ✅ Adds: 3s countdown before record + 10s max cap + waveform visual.
// ✅ UPDATED: uses smaller recording profile (LOW_QUALITY) to help keep uploads under 10MB.
// ✅ UPDATED: safer cleanup + avoids timer leaks + avoids calling setState after unmount.
// ✅ UPDATED: metering enabled where possible; waveform fallback remains.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';

const MAX_RECORD_MS = 10_000; // ✅ safeguard cap
const COUNTDOWN_SEC = 3; // ✅ pre-roll safety countdown
const WAVE_BARS = 18; // waveform bar count

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

// small helper
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default function AudioRecorderModal({ visible, onClose, onDone, disabled = false }) {
  const mountedRef = useRef(false);

  const recRef = useRef(null);
  const soundRef = useRef(null);

  const countdownTimerRef = useRef(null);
  const hardStopTimerRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);

  const [countdown, setCountdown] = useState(0); // 3..2..1
  const countingDown = countdown > 0;

  const [uri, setUri] = useState(null);
  const [durationMs, setDurationMs] = useState(null);

  const [meter, setMeter] = useState(0); // 0..1
  const meterSmoothRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);

  const [recordedMs, setRecordedMs] = useState(0); // live while recording
  const recordedMsRef = useRef(0);

  // “waveform” state – array of heights (0..1)
  const [wave, setWave] = useState(Array.from({ length: WAVE_BARS }, () => 0.1));
  const waveRef = useRef(wave);

  const safeSet = (setter) => {
    if (!mountedRef.current) return;
    setter();
  };

  const resetState = () => {
    safeSet(() => {
      setReady(false);
      setBusy(false);
      setRecording(false);
      setCountdown(0);
      setUri(null);
      setDurationMs(null);
      setMeter(0);
      setPlaying(false);
      setPosMs(0);
      setRecordedMs(0);
    });

    recordedMsRef.current = 0;

    const init = Array.from({ length: WAVE_BARS }, () => 0.12);
    waveRef.current = init;
    safeSet(() => setWave(init));
  };

  const clearTimers = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (hardStopTimerRef.current) {
      clearTimeout(hardStopTimerRef.current);
      hardStopTimerRef.current = null;
    }
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
    safeSet(() => {
      setPlaying(false);
      setPosMs(0);
    });
  };

  const cleanupAll = async () => {
    clearTimers();
    await cleanupRecording();
    await cleanupSound();
    try {
      await safeSetModeRecording(false);
    } catch {}
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      cleanupAll().finally(() => resetState());
      return;
    }

    (async () => {
      try {
        safeSet(() => setBusy(true));

        const perm = await Audio.requestPermissionsAsync();
        if (!perm?.granted) {
          Alert.alert('Microphone permission needed', 'Enable microphone access in Settings to record engine sounds.');
          return;
        }

        await safeSetModeRecording(true);
        safeSet(() => setReady(true));
      } catch (e) {
        console.log('Audio init error:', e);
        Alert.alert('Audio init failed', e?.message || 'Could not initialize audio.');
      } finally {
        safeSet(() => setBusy(false));
      }
    })();

    return () => {
      cleanupAll().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // -------- waveform animator (driven by metering) --------
  const pushWave = (normMeter) => {
    meterSmoothRef.current = meterSmoothRef.current * 0.75 + normMeter * 0.25;
    const base = meterSmoothRef.current;

    const prev = waveRef.current || [];
    const next = [];
    for (let i = 0; i < WAVE_BARS; i++) {
      const jitter = (Math.random() - 0.5) * 0.22;
      const drift = i % 2 === 0 ? 0.04 : -0.04;
      const target = clamp(base + jitter + drift, 0.08, 1);

      const last = prev[i] ?? 0.1;
      const eased = last * 0.65 + target * 0.35;
      next.push(eased);
    }

    waveRef.current = next;
    safeSet(() => setWave(next));
  };

  // -------- countdown -> start --------
  const beginCountdownThenStart = async () => {
    if (disabled || !ready || busy || recording || countingDown) return;

    try {
      await cleanupSound();

      safeSet(() => {
        setUri(null);
        setDurationMs(null);
        setMeter(0);
        setPosMs(0);
        setRecordedMs(0);
      });
      recordedMsRef.current = 0;

      safeSet(() => setCountdown(COUNTDOWN_SEC));
      clearTimers();

      countdownTimerRef.current = setInterval(() => {
        if (!mountedRef.current) return;
        setCountdown((c) => {
          const next = c - 1;
          if (next <= 0) {
            if (countdownTimerRef.current) {
              clearInterval(countdownTimerRef.current);
              countdownTimerRef.current = null;
            }
            startRecording().catch(() => {});
            return 0;
          }
          return next;
        });
      }, 1000);
    } catch (e) {
      console.log('countdown error:', e);
      Alert.alert('Recording failed', e?.message || 'Could not start countdown.');
      safeSet(() => setCountdown(0));
      clearTimers();
    }
  };

  const cancelCountdown = () => {
    if (!countingDown) return;
    safeSet(() => setCountdown(0));
    clearTimers();
  };

  // -------- start recording (internal) --------
  const startRecording = async () => {
    if (disabled || !ready || busy || recording) return;

    try {
      safeSet(() => setBusy(true));

      await safeSetModeRecording(true);

      const rec = new Audio.Recording();

      // ✅ Smaller file sizes vs HIGH_QUALITY
      // For engine/road noises, this is more than enough and helps stay under 10MB comfortably.
      const options = Audio.RecordingOptionsPresets.LOW_QUALITY;

      await rec.prepareToRecordAsync(options);

      rec.setProgressUpdateInterval(90);
      rec.setOnRecordingStatusUpdate((st) => {
        if (!st || !mountedRef.current) return;

        if (typeof st.durationMillis === 'number') {
          recordedMsRef.current = st.durationMillis;
          setRecordedMs(st.durationMillis);
        }

        if (typeof st?.metering === 'number') {
          const db = clamp(st.metering, -60, 0);
          const norm = (db + 60) / 60;
          setMeter(norm);
          pushWave(norm);
        } else {
          pushWave(0.18 + Math.random() * 0.06);
        }
      });

      await rec.startAsync();
      recRef.current = rec;
      safeSet(() => setRecording(true));

      clearTimers();
      hardStopTimerRef.current = setTimeout(() => {
        stop().catch(() => {});
      }, MAX_RECORD_MS + 80);
    } catch (e) {
      console.log('startRecording error:', e);
      Alert.alert('Recording failed', e?.message || 'Could not start recording.');
      safeSet(() => setRecording(false));
      clearTimers();
    } finally {
      safeSet(() => setBusy(false));
    }
  };

  // -------- stop recording --------
  const stop = async () => {
    if (disabled || !recRef.current || busy) return;

    try {
      safeSet(() => setBusy(true));
      clearTimers();

      await recRef.current.stopAndUnloadAsync();
      const u = recRef.current.getURI();

      let dur = null;
      try {
        const st = await recRef.current.getStatusAsync();
        if (typeof st?.durationMillis === 'number') dur = st.durationMillis;
      } catch {}

      recRef.current = null;

      safeSet(() => {
        setRecording(false);
        setUri(u || null);
        setDurationMs(dur ?? recordedMsRef.current ?? null);
      });

      await safeSetModeRecording(false);
    } catch (e) {
      console.log('stopRecording error:', e);
      Alert.alert('Stop failed', e?.message || 'Could not stop recording.');
    } finally {
      safeSet(() => setBusy(false));
    }
  };

  const togglePlay = async () => {
    if (disabled || busy || !uri) return;

    try {
      safeSet(() => setBusy(true));

      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: false, isLooping: false },
          (st) => {
            if (!st || !mountedRef.current) return;

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
        safeSet(() => setPlaying(false));
      } else {
        await soundRef.current.playAsync();
        safeSet(() => setPlaying(true));
      }
    } catch (e) {
      console.log('playback error:', e);
      Alert.alert('Playback failed', e?.message || 'Could not play audio.');
    } finally {
      safeSet(() => setBusy(false));
    }
  };

  const attach = async () => {
    if (disabled || busy || !uri || recording || countingDown) return;

    try {
      safeSet(() => setBusy(true));
      await cleanupSound();

      onDone?.({ uri, durationMs: durationMs || null });

      onClose?.();
      resetState();
    } finally {
      safeSet(() => setBusy(false));
    }
  };

  const close = async () => {
    if (busy) return;
    try {
      safeSet(() => setBusy(true));
      await cleanupAll();
      onClose?.();
      resetState();
    } finally {
      safeSet(() => setBusy(false));
    }
  };

  if (!visible) return null;

  const durSec = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : null;

  // live “remaining” while recording
  const remainingSec = recording ? Math.max(0, Math.ceil((MAX_RECORD_MS - recordedMs) / 1000)) : null;

  const canAttach = !!uri && !recording && !countingDown && !disabled && !busy;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.pill, (disabled || busy) && styles.pillDisabled]}>
          {/* left record/stop */}
          <TouchableOpacity
            style={[
              styles.leftBtn,
              countingDown ? styles.btnCountdown : recording ? styles.btnStop : styles.btnRec,
              (!ready || disabled || busy) && styles.btnDisabled,
            ]}
            disabled={!ready || disabled || busy}
            onPress={recording ? stop : countingDown ? cancelCountdown : beginCountdownThenStart}
            activeOpacity={0.85}
          >
            <Ionicons name={recording ? 'stop' : countingDown ? 'close' : 'mic'} size={16} color="#fff" />
            <Text style={styles.leftText}>{recording ? 'Stop' : countingDown ? 'Cancel' : 'Record'}</Text>
          </TouchableOpacity>

          {/* middle waveform / playback */}
          <View style={styles.mid}>
            {countingDown ? (
              <View style={styles.countdownWrap}>
                <Text style={styles.countdownText}>{countdown}</Text>
                <Text style={styles.midText}>Starting…</Text>
              </View>
            ) : recording ? (
              <>
                <Waveform bars={wave} />
                <Text style={styles.midText}>
                  Recording… {remainingSec != null ? `${remainingSec}s left` : ''}
                </Text>
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
                <Text style={styles.midText}>{durSec ? `${durSec}s ready` : 'Play recording'}</Text>
              </>
            ) : (
              <>
                <Waveform bars={wave} idle />
                <Text style={styles.midText}>Automotive sound diagnosis</Text>
              </>
            )}
          </View>

          {/* attach */}
          <TouchableOpacity
            style={[styles.iconCircle, !canAttach && styles.iconDisabled]}
            disabled={!canAttach}
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

        <View style={styles.hintRow}>
          <Text style={styles.hintText} />
        </View>
      </View>
    </Modal>
  );
}

// ---------- Waveform component ----------
function Waveform({ bars = [], idle = false }) {
  const normalized = useMemo(() => {
    const base = idle ? 0.16 : 0;
    return (bars || []).map((h) => clamp((h ?? 0.1) + base, 0.08, 1));
  }, [bars, idle]);

  return (
    <View style={styles.waveWrap}>
      {normalized.map((h, i) => {
        const height = 6 + Math.round(h * 22);
        return (
          <View
            key={i}
            style={[styles.waveBar, { height, opacity: idle ? 0.55 : 1 }, i % 3 === 0 ? styles.waveBarStrong : null]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 80 : 20,
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
    gap: 7,
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
  btnCountdown: { backgroundColor: '#3b82f6' },
  btnDisabled: { opacity: 0.6 },
  leftText: { color: '#fff', fontWeight: '900', fontSize: 12 },

  mid: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  midText: { color: '#ddd', fontSize: 12, fontWeight: '800' },

  countdownWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countdownText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    width: 22,
    textAlign: 'center',
  },

  waveWrap: {
    width: '100%',
    height: 30,
    borderRadius: 999,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  waveBar: {
    width: 4,
    borderRadius: 999,
    backgroundColor: '#3b82f6',
  },
  waveBarStrong: { opacity: 0.92 },

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
  hintText: { color: '#888', fontSize: 11, fontWeight: '700', textAlign: 'center' },
});
