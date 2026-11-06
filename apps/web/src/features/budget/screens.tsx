import { ScreenStub } from '../../app/ScreenStub';

export function BudgetScreen() {
  return <ScreenStub screen="P01" />;
}

export function ReserveScreen() {
  return <ScreenStub screen="P02" />;
}

export function CloseMonthScreen() {
  return <ScreenStub screen="P04" />;
}

export { FutureScreen } from './FutureScreen';
