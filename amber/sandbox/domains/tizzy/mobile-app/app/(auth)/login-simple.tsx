import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function LoginSimple() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Tizzy Login Screen</Text>
      <Text style={styles.subtitle}>App is working!</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  text: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
  },
});
