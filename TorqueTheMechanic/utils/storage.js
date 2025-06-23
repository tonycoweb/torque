// utils/storage.js
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'saved_chats';

export async function saveChat(chatId, messages) {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const chats = raw ? JSON.parse(raw) : {};
    chats[chatId] = messages;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch (err) {
    console.error('Failed to save chat:', err);
  }
}

export async function getChat(chatId) {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const chats = raw ? JSON.parse(raw) : {};
    return chats[chatId] || [];
  } catch (err) {
    console.error('Failed to get chat:', err);
    return [];
  }
}

export async function getAllChats() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('Failed to load all chats:', err);
    return {};
  }
}

export async function deleteChat(chatId) {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const chats = raw ? JSON.parse(raw) : {};
    delete chats[chatId];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch (err) {
    console.error('Failed to delete chat:', err);
  }
}

export async function clearAllChats() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear all chats:', err);
  }
}
