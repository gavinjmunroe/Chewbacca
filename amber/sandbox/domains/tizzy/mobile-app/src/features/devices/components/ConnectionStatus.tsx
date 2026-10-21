import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { ConnectionState } from '../../../services/BLEManager';

interface ConnectionStatusProps {
  state: ConnectionState;
  compact?: boolean;
}

export function ConnectionStatus({ state, compact = false }: ConnectionStatusProps) {
  const getStatusConfig = (state: ConnectionState) => {
    switch (state) {
      case 'connected':
        return {
          icon: '✓',
          text: compact ? 'Connected' : 'Connected',
          color: '#4CAF50',
          backgroundColor: '#E8F5E9',
          showSpinner: false,
        };
      case 'connecting':
        return {
          icon: '⟳',
          text: compact ? 'Connecting' : 'Connecting...',
          color: '#FFC107',
          backgroundColor: '#FFF8E1',
          showSpinner: true,
        };
      case 'discovering':
        return {
          icon: 'magnifyingglass',
          text: compact ? 'Discovering' : 'Discovering...',
          color: '#2196F3',
          backgroundColor: '#E3F2FD',
          showSpinner: true,
        };
      case 'disconnected':
      default:
        return {
          icon: '✕',
          text: compact ? 'Disconnected' : 'Disconnected',
          color: '#9E9E9E',
          backgroundColor: '#F5F5F5',
          showSpinner: false,
        };
    }
  };

  const config = getStatusConfig(state);

  if (compact) {
    return (
      <View style={[styles.compactContainer, { backgroundColor: config.backgroundColor }]}>
        <View style={[styles.compactDot, { backgroundColor: config.color }]} />
        {config.showSpinner ? (
          <ActivityIndicator size="small" color={config.color} style={styles.compactSpinner} />
        ) : state === 'discovering' ? (
          <SymbolView
            name={config.icon}
            size={14}
            tintColor={config.color}
            style={styles.compactSymbol}
          />
        ) : (
          <Text style={[styles.compactIcon, { color: config.color }]}>{config.icon}</Text>
        )}
        <Text style={[styles.compactText, { color: config.color }]}>{config.text}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: config.backgroundColor }]}>
      <View style={styles.iconContainer}>
        {config.showSpinner ? (
          <ActivityIndicator size="small" color={config.color} />
        ) : state === 'discovering' ? (
          <SymbolView
            name={config.icon}
            size={18}
            tintColor={config.color}
          />
        ) : (
          <Text style={[styles.icon, { color: config.color }]}>{config.icon}</Text>
        )}
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.text, { color: config.color }]}>{config.text}</Text>
        {state === 'connecting' && (
          <Text style={styles.subtext}>Searching for device...</Text>
        )}
        {state === 'discovering' && (
          <Text style={styles.subtext}>Setting up connection...</Text>
        )}
      </View>
      <View style={[styles.statusDot, { backgroundColor: config.color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    minHeight: 56,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  icon: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  textContainer: {
    flex: 1,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  subtext: {
    fontSize: 12,
    color: '#666',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: 12,
  },
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  compactDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  compactIcon: {
    fontSize: 14,
    fontWeight: 'bold',
    marginRight: 4,
  },
  compactSymbol: {
    marginRight: 4,
  },
  compactSpinner: {
    marginRight: 4,
  },
  compactText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
