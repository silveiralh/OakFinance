import { ScreenStub } from '../../app/ScreenStub';
import { SignOutAction } from './SignOut';

/** S01: a lista de ajustes chega depois; por enquanto só o "Sair" (S02, RN-100). */
export function SettingsScreen() {
  return (
    <>
      <ScreenStub screen="S01" />
      <SignOutAction />
    </>
  );
}
