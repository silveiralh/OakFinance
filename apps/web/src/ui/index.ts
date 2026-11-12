// Componentes de base (UX §5). Importe daqui.

export {
  AmountInput,
  type AmountInputProps,
  appendDigits,
  parsePastedAmount,
  preferredKeypad,
} from './AmountInput';
export { AppBackdrop } from './AppBackdrop';
export { Badge, type BadgeProps } from './Badge';
export { Banner, type BannerProps } from './Banner';
export { TabBar, type TabBarProps, type TabItem, TopBar, type TopBarProps } from './Bars';
export { BottomSheet, type BottomSheetProps } from './BottomSheet';
export { BrandLogo, type BrandLogoProps, resolveLogoArt } from './BrandLogo';
export { type BandKey, BudgetRing, type BudgetRingProps, ringLabel } from './BudgetRing';
export { Button, type ButtonProps } from './Button';
export {
  type CategoryBand,
  CategoryChip,
  type CategoryChipProps,
  CategoryPicker,
  type CategoryPickerProps,
  type ChipCategory,
} from './CategoryChip';
export { DateChip, type DateChipProps } from './DateChip';
export { Dialog, type DialogOption, type DialogProps } from './Dialog';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { FAB, type FABProps } from './FAB';
export { GlassCard, type GlassCardProps } from './GlassCard';
export { GoalProgress, type GoalProgressProps } from './GoalProgress';
export { IconButton, type IconButtonProps } from './IconButton';
export {
  detectInstallVariant,
  InstallGuide,
  type InstallGuideProps,
  type InstallPlatform,
  type InstallVariant,
} from './InstallGuide';
export {
  InstallmentStepper,
  type InstallmentStepperProps,
  installmentPreview,
} from './InstallmentStepper';
export { InvoiceCard, type InvoiceCardProps, InvoiceMini, invoiceBadge } from './InvoiceCard';
export { MoneyText, type MoneyTextProps, moneyLabel } from './MoneyText';
export { NumericKeypad, type NumericKeypadProps } from './NumericKeypad';
export { PaceIndicator, type PaceIndicatorProps, paceText } from './PaceIndicator';
export {
  type MethodKind,
  type PaymentMethodOption,
  PaymentMethodPicker,
  type PaymentMethodPickerProps,
} from './PaymentMethodPicker';
export { ProgressBar, type ProgressBarProps, percentOf } from './ProgressBar';
export { SegmentedControl, type SegmentedControlProps } from './SegmentedControl';
export { Skeleton, type SkeletonProps } from './Skeleton';
export { SyncBadge, type SyncBadgeProps, type SyncState, syncLabel } from './SyncBadge';
export {
  Select,
  type SelectProps,
  Switch,
  type SwitchProps,
  TextField,
  type TextFieldProps,
} from './TextField';
export { type ToastInput, ToastProvider, useToast } from './Toast';
export { type RowTx, rowLabel, TransactionRow, type TransactionRowProps } from './TransactionRow';
export type { AppIcon, BaseProps } from './types';
