import { ScreenStub } from '../../app/ScreenStub';
import { InstallCard } from './InstallCard';

export function HomeScreen() {
  return (
    <>
      <InstallCard />
      <ScreenStub screen="H01" />
    </>
  );
}

export function NoticesScreen() {
  return <ScreenStub screen="H02" />;
}
