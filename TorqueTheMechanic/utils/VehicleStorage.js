import AsyncStorage from '@react-native-async-storage/async-storage';

const VEHICLE_KEY = 'decoded_vehicles';

export async function saveVehicle(vehicle) {
  const existingRaw = await AsyncStorage.getItem(VEHICLE_KEY);
  const vehicles = existingRaw ? JSON.parse(existingRaw) : [];

  const existingIndex = vehicles.findIndex(v => v.vin === vehicle.vin);

  if (existingIndex >= 0) {
    vehicles[existingIndex] = vehicle;
  } else {
    vehicles.push(vehicle);
  }

  await AsyncStorage.setItem(VEHICLE_KEY, JSON.stringify(vehicles));
}

export async function getAllVehicles() {
  const raw = await AsyncStorage.getItem(VEHICLE_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function getVehicleByVin(vin) {
  const raw = await AsyncStorage.getItem(VEHICLE_KEY);
  if (!raw) return null;
  const vehicles = JSON.parse(raw);
  return vehicles.find(v => v.vin === vin) || null;
}
