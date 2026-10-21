import { View, Text, StyleSheet } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>TIZZY WORKS!</Text>
      <Text style={styles.subtext}>Build 27 - No Navigation</Text>
      <Text style={styles.details}>Testing bare minimum</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#000000',
    marginTop: 16,
  },
  subtext: {
    fontSize: 16,
    color: '#666666',
    marginTop: 8,
  },
  details: {
    fontSize: 14,
    color: '#999999',
    marginTop: 4,
  },
});
