# Tizzy Shared UI Components Library

A comprehensive, reusable component library for the Tizzy mobile app with consistent styling, TypeScript support, and accessibility features.

## Features

- **Consistent Design System**: Professional color palette with calming blues and greens
- **Type-Safe**: Full TypeScript support with comprehensive prop types
- **Accessible**: Proper ARIA labels, touch targets, and screen reader support
- **Reusable**: Composable components that work together seamlessly
- **Responsive**: Proper spacing and sizing based on 8px grid system
- **Customizable**: Support for custom styles while maintaining consistency

## Installation

Import components and constants from the shared module:

```typescript
import { Button, Input, Card, colors, spacing } from '../shared';
```

## Components

### Button

Versatile button component with multiple variants and sizes.

```typescript
import { Button } from '../shared';

<Button
  title="Submit"
  onPress={() => console.log('Pressed')}
  variant="primary" // primary | secondary | danger | outline | ghost
  size="medium" // small | medium | large
  disabled={false}
  loading={false}
  fullWidth={false}
  leftIcon={<Icon name="check" />}
/>
```

**Props:**
- `title` (required): Button text
- `onPress` (required): Press handler
- `variant`: Visual style (default: 'primary')
- `size`: Button size (default: 'medium')
- `disabled`: Disable state (default: false)
- `loading`: Show loading spinner (default: false)
- `fullWidth`: Take full width (default: false)
- `leftIcon`, `rightIcon`: Optional icons

### Input

Text input component with label, error states, and helper text.

```typescript
import { Input } from '../shared';

<Input
  label="Email"
  placeholder="Enter your email"
  value={email}
  onChangeText={setEmail}
  error={emailError}
  helperText="We'll never share your email"
  required={true}
  isPassword={false}
  leftIcon={<Icon name="mail" />}
/>
```

**Props:**
- `label`: Label text above input
- `error`: Error message to display
- `helperText`: Helper text below input
- `required`: Mark as required (default: false)
- `disabled`: Disable state (default: false)
- `isPassword`: Password field with show/hide toggle (default: false)
- `leftIcon`, `rightIcon`: Optional icons
- All standard TextInput props supported

### Card

Card container component with multiple variants.

```typescript
import { Card, CardHeader, CardContent, CardFooter } from '../shared';

<Card
  variant="elevated" // elevated | outlined | flat
  pressable={true}
  onPress={() => console.log('Card pressed')}
>
  <CardHeader
    title="Card Title"
    subtitle="Subtitle text"
    rightContent={<Icon name="more" />}
  />
  <CardContent>
    <Text>Card content goes here</Text>
  </CardContent>
  <CardFooter>
    <Button title="Action" onPress={() => {}} />
  </CardFooter>
</Card>
```

**Props:**
- `variant`: Visual style (default: 'elevated')
- `pressable`: Make card tappable (default: false)
- `onPress`: Press handler when pressable
- `padding`: Custom padding (default: 16)

**Sub-components:**
- `CardHeader`: Consistent header with title, subtitle, and optional content
- `CardContent`: Content area
- `CardFooter`: Footer with actions

### LoadingSpinner

Loading indicator with multiple variants.

```typescript
import { LoadingSpinner, LoadingOverlay, InlineLoading } from '../shared';

// Standard spinner
<LoadingSpinner
  size="medium" // small | medium | large
  color="primary" // primary | secondary | white
  text="Loading..."
  fullscreen={false}
/>

// Overlay
<LoadingOverlay
  visible={isLoading}
  size="large"
  text="Please wait..."
/>

// Inline
<InlineLoading text="Loading data..." />
```

### EmptyState

Empty state component for when there's no content to display.

```typescript
import { EmptyState, CompactEmptyState, ErrorState } from '../shared';

// Full empty state
<EmptyState
  title="No items found"
  description="Get started by adding your first item"
  icon={<Icon name="inbox" size={64} />}
  primaryAction={{
    title: "Add Item",
    onPress: () => handleAdd()
  }}
  secondaryAction={{
    title: "Learn More",
    onPress: () => handleLearnMore()
  }}
/>

// Compact version
<CompactEmptyState
  message="No results found"
  icon={<Icon name="search" />}
  action={{
    title: "Clear filters",
    onPress: () => clearFilters()
  }}
/>

// Error state
<ErrorState
  title="Failed to load"
  message="Unable to fetch data. Please try again."
  onRetry={() => refetch()}
/>
```

## Constants

### Colors

Professional, calming color palette with excellent contrast.

```typescript
import { colors } from '../shared';

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background.primary,
    borderColor: colors.border.main,
  },
  text: {
    color: colors.text.primary,
  },
  primaryButton: {
    backgroundColor: colors.primary.main,
  },
});
```

**Color Categories:**
- `primary`: Main brand color (blue)
- `secondary`: Secondary brand color (teal)
- `accent`: Accent color (green)
- `danger`, `warning`, `success`, `info`: Semantic colors
- `neutral`: Gray scale
- `background`: Background colors
- `text`: Text colors
- `border`: Border colors
- `shadow`, `overlay`: Effect colors

### Spacing

Consistent spacing based on 8px grid system.

```typescript
import { spacing, getSpacing } from '../shared';

const styles = StyleSheet.create({
  container: {
    padding: spacing.md, // 16px
    margin: spacing.lg, // 24px
    borderRadius: spacing.radius.md, // 12px
    gap: spacing.sm, // 8px
  },
  customSpacing: {
    marginTop: getSpacing(3), // 24px (3 * 8)
  },
});
```

**Spacing Scale:**
- `xs`: 4px
- `sm`: 8px
- `md`: 16px
- `lg`: 24px
- `xl`: 32px
- `xxl`: 40px
- `xxxl`: 48px

**Special Values:**
- `touchTarget`: 44px (minimum touch target)
- `screenPadding`: 16px
- `cardPadding`: 16px
- `radius`: Border radius values (xs, sm, md, lg, xl, full)
- `iconSize`: Standard icon sizes
- `avatarSize`: Standard avatar sizes

### Typography

Consistent text styling with predefined text styles.

```typescript
import { typography } from '../shared';

const styles = StyleSheet.create({
  heading: {
    ...typography.heading1,
    color: colors.text.primary,
  },
  body: {
    ...typography.body1,
    color: colors.text.secondary,
  },
  button: {
    ...typography.button,
  },
});
```

**Text Styles:**
- `heading1` through `heading6`: Heading styles
- `body1`, `body2`: Body text styles
- `subtitle1`, `subtitle2`: Subtitle styles
- `caption`: Small text
- `overline`: Uppercase labels
- `button`, `buttonSmall`, `buttonLarge`: Button text styles

**Font Properties:**
- `fontSize`: Font size scale (xs to massive)
- `fontWeight`: Font weights (regular, medium, semiBold, bold)
- `lineHeight`: Line height ratios (tight, normal, relaxed)
- `letterSpacing`: Letter spacing values

## Best Practices

1. **Use Design Tokens**: Always use colors, spacing, and typography constants instead of hard-coded values
2. **Compose Components**: Build complex UIs by composing simple components
3. **Maintain Consistency**: Use the provided variants and sizes for consistency
4. **Accessibility First**: Always provide proper labels and test with screen readers
5. **Type Safety**: Leverage TypeScript types for better developer experience
6. **Custom Styling**: Use `style` props to customize while maintaining base styles

## Example Usage

```typescript
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Button,
  Input,
  Card,
  CardHeader,
  CardContent,
  LoadingSpinner,
  EmptyState,
  colors,
  spacing,
} from '../shared';

export const ExampleScreen = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <View style={styles.container}>
      <Card variant="elevated">
        <CardHeader
          title="Login"
          subtitle="Enter your credentials"
        />
        <CardContent>
          <Input
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            required
          />
          <Button
            title="Sign In"
            onPress={() => setLoading(true)}
            loading={loading}
            fullWidth
            style={styles.button}
          />
        </CardContent>
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
    padding: spacing.screenPadding,
  },
  button: {
    marginTop: spacing.lg,
  },
});
```

## Color Palette Reference

### Primary (Blue)
- Main: `#2563EB`
- Light: `#60A5FA`
- Dark: `#1E40AF`

### Secondary (Teal)
- Main: `#14B8A6`
- Light: `#5EEAD4`
- Dark: `#0F766E`

### Accent (Green)
- Main: `#10B981`
- Light: `#6EE7B7`
- Dark: `#059669`

### Semantic Colors
- Danger: `#EF4444`
- Warning: `#F59E0B`
- Success: `#10B981`
- Info: `#3B82F6`

## Contributing

When adding new components:
1. Follow the established patterns and conventions
2. Provide comprehensive TypeScript types
3. Include accessibility features
4. Support customization through style props
5. Document usage with examples
6. Test on both iOS and Android
