import { ScreenStub } from '../../app/ScreenStub';
import { IncomeToConfirm } from './IncomeToConfirm';
import { InstallCard } from './InstallCard';

export function HomeScreen() {
  return (
    <>
      <InstallCard />
      <IncomeToConfirm />
      <ScreenStub screen="H01" />
    </>
  );
}

export function NoticesScreen() {
  return <ScreenStub screen="H02" />;
}
