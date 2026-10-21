// Temporary stub for expo-symbols until New Architecture compatibility is fixed
import React from 'react';

export const SymbolView = (props: any) => {
  // Return null - SF Symbols won't show until expo-symbols supports New Architecture
  return null;
};

export const SymbolWeight = {
  THIN: 'thin',
  LIGHT: 'light',
  REGULAR: 'regular',
  MEDIUM: 'medium',
  SEMIBOLD: 'semibold',
  BOLD: 'bold',
  HEAVY: 'heavy',
  BLACK: 'black',
} as const;

export const SymbolScale = {
  SMALL: 'small',
  MEDIUM: 'medium',
  LARGE: 'large',
} as const;
