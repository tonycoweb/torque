// components/LoginScreen.js
// ✅ FIXED: SecureStore 2048-byte limit by storing tokens in separate keys (no big JSON blob)
// ✅ Keeps your Cognito Hosted UI + PKCE flow exactly the same
// ✅ Still calls /me with Bearer token so your backend can create/ensure the user row
// ✅ /health is now __DEV__ only (saves backend calls in production)

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity, Alert, Animated, Easing } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import LottieView from 'lottie-react-native';

WebBrowser.maybeCompleteAuthSession();

// ✅ MUST MATCH App.js base (no stage unless your API truly uses one)
const BACKEND_BASE = 'https://rd9gvjuco8.execute-api.us-east-2.amazonaws.com';

// ===== Cognito config =====
const COGNITO_REGION = 'us-east-2';
const USER_POOL_ID = 'us-east-2_WqTltztIe';
const CLIENT_ID = '6eb9a2q3nmcrlfl9mtke4tpgsa';

// ✅ Hosted UI domain (host only — no https://)
const COGNITO_DOMAIN = 'us-east-2wqtltztie.auth.us-east-2.amazoncognito.com';

// ✅ OIDC Issuer (THIS is what discovery must use)
const ISSUER = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${USER_POOL_ID}`;

// ===================== SecureStore keys (split to avoid 2048 byte limit) =====================
const KEY_ID = 'pm_id_token_v1';
const KEY_ACCESS = 'pm_access_token_v1';
const KEY_REFRESH = 'pm_refresh_token_v1';
const KEY_META = 'pm_token_meta_v1';

async function clearTokens() {
  await SecureStore.deleteItemAsync(KEY_ID).catch(() => {});
  await SecureStore.deleteItemAsync(KEY_ACCESS).catch(() => {});
  await SecureStore.deleteItemAsync(KEY_REFRESH).catch(() => {});
  await SecureStore.deleteItemAsync(KEY_META).catch(() => {});
}

async function saveTokens(tokens) {
  // Store each token separately to avoid SecureStore per-key size limits
  if (tokens?.idToken) await SecureStore.setItemAsync(KEY_ID, tokens.idToken);
  if (tokens?.accessToken) await SecureStore.setItemAsync(KEY_ACCESS, tokens.accessToken);
  if (tokens?.refreshToken) await SecureStore.setItemAsync(KEY_REFRESH, tokens.refreshToken);

  // meta is small; safe to store as JSON
  await SecureStore.setItemAsync(
    KEY_META,
    JSON.stringify({
      obtainedAt: Date.now(),
      expiresIn: tokens?.expiresIn ?? null,
      tokenType: tokens?.tokenType ?? null,
    })
  );
}

async function getJwtForApiFromLoginResult(tokenResult) {
  // API Gateway JWT authorizers typically expect ID token (aud = client_id),
  // but we keep fallback to access token in case your authorizer is configured differently.
  return tokenResult?.idToken || tokenResult?.accessToken || null;
}

export default function LoginScreen({ onLogin }) {
  const [loading, setLoading] = useState(false);

  const discovery = AuthSession.useAutoDiscovery(ISSUER);

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: 'pocketmechanic',
    path: 'auth',
  });

  // --- UI animation bits ---
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const torqueSlideIn = useRef(new Animated.Value(-200)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        easing: Easing.out(Easing.exp),
        useNativeDriver: true,
      }),
      Animated.timing(torqueSlideIn, {
        toValue: 0,
        duration: 2000,
        easing: Easing.out(Easing.back(1)),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim, torqueSlideIn]);

  const authEndpoint = `https://${COGNITO_DOMAIN}/oauth2/authorize`;

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: CLIENT_ID,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: ['openid', 'profile', 'email'],
      usePKCE: true,
    },
    discovery
      ? {
          ...discovery,
          authorizationEndpoint: authEndpoint,
        }
      : null
  );

  const ready = !!request && !!discovery?.tokenEndpoint;

  async function callMe(jwtForApi) {
    const r = await fetch(`${BACKEND_BASE}/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwtForApi}` },
    });

    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`API /me failed (${r.status}): ${t}`);
    }
    return r.json();
  }

  // (Optional) public smoke test.
  async function callHealth() {
    const r = await fetch(`${BACKEND_BASE}/health`);
    const data = await r.json().catch(() => ({}));
    console.log('✅ /health:', r.status, data);
  }

  useEffect(() => {
    (async () => {
      if (!response) return;

      if (response.type === 'success') {
        try {
          setLoading(true);

          if (!discovery?.tokenEndpoint) throw new Error('OIDC discovery not ready (token endpoint missing).');
          if (!request?.codeVerifier) throw new Error('PKCE verifier missing (auth request not ready).');

          // Exchange the authorization code for tokens
          const tokenResult = await AuthSession.exchangeCodeAsync(
            {
              clientId: CLIENT_ID,
              code: response.params.code,
              redirectUri,
              extraParams: { code_verifier: request.codeVerifier },
            },
            discovery
          );

          // Expo AuthSession returns camelCase: accessToken/idToken/refreshToken
          const jwtForApi = await getJwtForApiFromLoginResult(tokenResult);
          if (!jwtForApi) throw new Error('No tokens returned from Cognito.');

          // ✅ Save tokens (split keys) BEFORE we hit backend
          await saveTokens(tokenResult);

          // optional: verify backend is alive (dev only)
          if (__DEV__) await callHealth();

          // ✅ this should create/ensure the user row
          const me = await callMe(jwtForApi);
          console.log('✅ /me response:', me);

          onLogin?.(me);
        } catch (e) {
          console.error('Login exchange error:', e);

          // wipe tokens on failure
          await clearTokens();

          Alert.alert('Login Failed', e?.message || 'Token exchange failed.');
        } finally {
          setLoading(false);
        }
      } else if (response.type === 'error') {
        Alert.alert('Login Failed', response?.error?.message || 'Authorization error.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  async function handleLogin() {
    if (!request) {
      Alert.alert('Not ready', 'Auth request not initialized yet.');
      return;
    }
    if (!discovery?.tokenEndpoint) {
      Alert.alert('Loading…', 'Auth is still initializing. Try again in a second.');
      return;
    }
    await promptAsync({ useProxy: false });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>Torque The Mechanic</Text>

      {!ready && !loading ? <Text style={styles.hint}>Initializing secure sign-in…</Text> : null}

      {loading ? (
        <ActivityIndicator size="large" color="#4CAF50" style={{ marginTop: 40 }} />
      ) : (
        <TouchableOpacity
          style={[styles.loginBtn, !ready && { opacity: 0.55 }]}
          onPress={handleLogin}
          activeOpacity={0.85}
          disabled={!ready}
        >
          <Text style={styles.loginBtnText}>Sign in (Apple / Cognito)</Text>
        </TouchableOpacity>
      )}

      <View style={styles.torqueIntroSection}>
        <Animated.View style={{ transform: [{ translateX: torqueSlideIn }] }}>
          <LottieView source={require('../assets/lottie/robotResting.json')} autoPlay loop style={styles.robot} />
        </Animated.View>

        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <View style={styles.chatBubble}>
            <Text style={styles.chatText}>
              👋 Secure sign-in, one account per person, 15,000 energy once — enforced on the server.
            </Text>
            <View style={styles.chatTail} />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center', padding: 24 },
  brand: { fontSize: 32, color: '#4CAF50', fontWeight: 'bold', marginBottom: 10 },
  hint: { color: 'rgba(255,255,255,0.65)', fontSize: 13, marginBottom: 18 },
  loginBtn: {
    width: 260,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#0b0b0b',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  loginBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  torqueIntroSection: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', paddingHorizontal: 10, marginTop: 18 },
  robot: { width: 90, height: 90 },
  chatBubble: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginLeft: 10,
    width: 240,
    minHeight: 70,
    borderColor: '#ddd',
    borderWidth: 1,
    elevation: 3,
    position: 'relative',
    justifyContent: 'center',
  },
  chatText: { color: '#333', fontSize: 14, lineHeight: 20 },
  chatTail: {
    position: 'absolute',
    top: 12,
    left: -8,
    width: 0,
    height: 0,
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderRightWidth: 12,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: '#fff',
  },
});
