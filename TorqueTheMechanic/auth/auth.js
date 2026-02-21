// api/auth.js
import * as SecureStore from 'expo-secure-store';

const KEY_ID_TOKEN = 'pm_id_token';
const KEY_ACCESS_TOKEN = 'pm_access_token';

export async function setTokens({ idToken, accessToken }) {
  if (idToken) await SecureStore.setItemAsync(KEY_ID_TOKEN, idToken);
  if (accessToken) await SecureStore.setItemAsync(KEY_ACCESS_TOKEN, accessToken);
}

export async function getIdToken() {
  return await SecureStore.getItemAsync(KEY_ID_TOKEN);
}

export async function getAccessToken() {
  return await SecureStore.getItemAsync(KEY_ACCESS_TOKEN);
}

export async function clearTokens() {
  await SecureStore.deleteItemAsync(KEY_ID_TOKEN);
  await SecureStore.deleteItemAsync(KEY_ACCESS_TOKEN);
}
