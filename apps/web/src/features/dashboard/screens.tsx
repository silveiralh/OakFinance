import { OPEN_FINANCE_ENABLED } from '../../app/openFinance';
import { RejectedBanner } from '../../app/SyncStatus';
import { ConnectionBanner } from '../connections/ConnectionBanner';
import { HomeOverview } from './HomeOverview';
import { IncomeToConfirm } from './IncomeToConfirm';
import { InstallCard } from './InstallCard';
import { PendingSetupCard } from './PendingSetupCard';

export function HomeScreen() {
  return (
    <>
      <RejectedBanner />
      <InstallCard />
      <PendingSetupCard />
      {OPEN_FINANCE_ENABLED && <ConnectionBanner />}
      <IncomeToConfirm />
      <section className="screen" data-screen="H01" data-testid="screen-H01">
        <HomeOverview />
      </section>
    </>
  );
}

export { NoticesScreen } from '../notices/NoticesScreen';
