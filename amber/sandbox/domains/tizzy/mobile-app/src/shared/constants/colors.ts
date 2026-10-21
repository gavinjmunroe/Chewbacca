/**
 * Color palette for Tizzy mobile app
 * Professional, calming color scheme with good contrast
 */

export const colors = {
  // Primary colors - Calming blue
  primary: {
    main: '#2563EB', // Blue 600
    light: '#60A5FA', // Blue 400
    dark: '#1E40AF', // Blue 700
    contrast: '#FFFFFF',
  },

  // Secondary colors - Trustworthy teal
  secondary: {
    main: '#14B8A6', // Teal 500
    light: '#5EEAD4', // Teal 300
    dark: '#0F766E', // Teal 700
    contrast: '#FFFFFF',
  },

  // Accent colors - Soothing green
  accent: {
    main: '#10B981', // Emerald 500
    light: '#6EE7B7', // Emerald 300
    dark: '#059669', // Emerald 600
    contrast: '#FFFFFF',
  },

  // Danger/Error colors
  danger: {
    main: '#EF4444', // Red 500
    light: '#FCA5A5', // Red 300
    dark: '#DC2626', // Red 600
    contrast: '#FFFFFF',
  },

  // Warning colors
  warning: {
    main: '#F59E0B', // Amber 500
    light: '#FCD34D', // Amber 300
    dark: '#D97706', // Amber 600
    contrast: '#FFFFFF',
  },

  // Success colors
  success: {
    main: '#10B981', // Emerald 500
    light: '#6EE7B7', // Emerald 300
    dark: '#059669', // Emerald 600
    contrast: '#FFFFFF',
  },

  // Info colors
  info: {
    main: '#3B82F6', // Blue 500
    light: '#93C5FD', // Blue 300
    dark: '#2563EB', // Blue 600
    contrast: '#FFFFFF',
  },

  // Neutral/Gray colors
  neutral: {
    white: '#FFFFFF',
    gray50: '#F9FAFB',
    gray100: '#F3F4F6',
    gray200: '#E5E7EB',
    gray300: '#D1D5DB',
    gray400: '#9CA3AF',
    gray500: '#6B7280',
    gray600: '#4B5563',
    gray700: '#374151',
    gray800: '#1F2937',
    gray900: '#111827',
    black: '#000000',
  },

  // Background colors
  background: {
    primary: '#FFFFFF',
    secondary: '#F9FAFB',
    tertiary: '#F3F4F6',
    dark: '#1F2937',
  },

  // Text colors
  text: {
    primary: '#111827', // Gray 900
    secondary: '#6B7280', // Gray 500
    tertiary: '#9CA3AF', // Gray 400
    disabled: '#D1D5DB', // Gray 300
    inverse: '#FFFFFF',
  },

  // Border colors
  border: {
    light: '#E5E7EB', // Gray 200
    main: '#D1D5DB', // Gray 300
    dark: '#9CA3AF', // Gray 400
    focus: '#2563EB', // Blue 600
  },

  // Shadow colors
  shadow: {
    light: 'rgba(0, 0, 0, 0.05)',
    main: 'rgba(0, 0, 0, 0.1)',
    dark: 'rgba(0, 0, 0, 0.2)',
  },

  // Overlay colors
  overlay: {
    light: 'rgba(0, 0, 0, 0.3)',
    main: 'rgba(0, 0, 0, 0.5)',
    dark: 'rgba(0, 0, 0, 0.7)',
  },

  // Common colors (for backwards compatibility)
  white: '#FFFFFF',
  black: '#000000',
} as const;

export type ColorPalette = typeof colors;
