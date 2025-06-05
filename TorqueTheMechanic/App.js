import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import GarageFrontEnd from './components/GarageFrontEnd';
import HomeHeader from './components/HomeHeader';

export default function App() {
  const [vehicle, setVehicle] = useState(null); // placeholder: no vehicle yet
  const [garageName, setGarageName] = useState('');

  const handleAddVehicle = () => {
    // For now, just hardcode a sample vehicle
    setVehicle({
      year: 2004,
      make: 'Infiniti',
      model: 'G35',
      engine: 'V6 3.5L',
      mpg: '19 city / 26 hwy',
      hp: '280',
      gvw: '4,000 lbs',
    });
  };

  return (
    <View style={styles.container}>
      <HomeHeader garageName={garageName} setGarageName={setGarageName} />
      <GarageFrontEnd vehicle={vehicle} onAddPress={handleAddVehicle} />

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
});
