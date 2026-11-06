import { ScreenStub } from '../../app/ScreenStub';
import { RejectedBanner } from '../../app/SyncStatus';
import { HomeOverview } from './HomeOverview';
import { IncomeToConfirm } from './IncomeToConfirm';
import { InstallCard } from './InstallCard';

export function HomeScreen() {
  return (
    <>
      <RejectedBanner />
      <InstallCard />
      <IncomeToConfirm />
      <section className="screen" data-screen="H01" data-testid="screen-H01">
        <HomeOverview />
      </section>
    </>
  );
}

export function NoticesScreen() {
  return <ScreenStub screen="H02" />;
}
