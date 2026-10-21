/**
 * Spacing constants for consistent layout
 * Based on 8px grid system
 */

export const spacing = {
  // Base spacing unit (8px)
  unit: 8,

  // Spacing scale
  xs: 4,      // 0.5 * unit
  sm: 8,      // 1 * unit
  md: 16,     // 2 * unit
  lg: 24,     // 3 * unit
  xl: 32,     // 4 * unit
  xxl: 40,    // 5 * unit
  xxxl: 48,   // 6 * unit

  // Specific use cases
  touchTarget: 44, // Minimum touch target size (iOS HIG)
  screenPadding: 16, // Default screen padding
  cardPadding: 16, // Default card padding
  sectionSpacing: 24, // Space between sections
  listItemHeight: 56, // Standard list item height

  // Border radius
  radius: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    full: 9999, // Fully rounded
  },

  // Border width
  borderWidth: {
    thin: 1,
    medium: 2,
    thick: 3,
  },

  // Icon sizes
  iconSize: {
    xs: 16,
    sm: 20,
    md: 24,
    lg: 32,
    xl: 40,
    xxl: 48,
  },

  // Avatar sizes
  avatarSize: {
    xs: 24,
    sm: 32,
    md: 40,
    lg: 56,
    xl: 80,
  },
} as const;

export type Spacing = typeof spacing;

/**
 * Helper function to get spacing value
 * @param multiplier - Number to multiply the base unit by
 * @returns Spacing value in pixels
 */
export const getSpacing = (multiplier: number): number => {
  return spacing.unit * multiplier;
};
