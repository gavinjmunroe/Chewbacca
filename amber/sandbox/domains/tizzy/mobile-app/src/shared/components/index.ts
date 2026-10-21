/**
 * Shared UI Components
 * Export all reusable components from a central location
 */

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Input } from './Input';
export type { InputProps } from './Input';

export { Card, CardHeader, CardContent, CardFooter } from './Card';
export type { CardProps, CardVariant, CardHeaderProps, CardContentProps, CardFooterProps } from './Card';

export { LoadingSpinner, LoadingOverlay, InlineLoading } from './LoadingSpinner';
export type { LoadingSpinnerProps, LoadingSpinnerSize, LoadingSpinnerColor, LoadingOverlayProps, InlineLoadingProps } from './LoadingSpinner';

export { EmptyState, CompactEmptyState, ErrorState } from './EmptyState';
export type { EmptyStateProps, CompactEmptyStateProps, ErrorStateProps } from './EmptyState';

export { StatusBanner } from './StatusBanner';

export { SessionCard } from './SessionCard';
export type { SessionData } from './SessionCard';

export { QuickActions, QuickActionButton } from './QuickActions';
export type { QuickAction } from './QuickActions';

export { SkeletonBox, HomeScreenSkeleton, SessionsListSkeleton, DeviceCardSkeleton } from './SkeletonLoader';

export { ErrorBoundary } from './ErrorBoundary';

export { ErrorView } from './ErrorView';

export { BLEErrorView } from './BLEErrorView';
export type { BLEErrorType } from './BLEErrorView';

export { OfflineBanner } from './OfflineBanner';

export { NetworkStatusIndicator } from './NetworkStatusIndicator';

export { SyncStatusBanner, SyncIndicator } from './SyncStatusBanner';

export {
  InAppNotificationBanner,
  useNotificationBanner,
} from './notifications';
export type { NotificationBannerData } from './notifications';
