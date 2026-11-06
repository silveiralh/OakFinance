import { ScreenStub } from '../../app/ScreenStub';

export function OnbRemindersScreen() {
  return <ScreenStub screen="ON04" standalone />;
}

export function OnbIncomeScreen() {
  return <ScreenStub screen="ON05" standalone />;
}

export function OnbAccountsScreen() {
  return <ScreenStub screen="ON06" standalone />;
}

export function OnbCardsScreen() {
  return <ScreenStub screen="ON07" standalone />;
}

export function OnbReserveScreen() {
  return <ScreenStub screen="ON07b" standalone />;
}

export function OnbDoneScreen() {
  return <ScreenStub screen="ON08" standalone />;
}

export { AuthCallback } from './AuthCallback';
export { InstallScreen } from './InstallScreen';
export { LoginScreen } from './LoginScreen';
export { WelcomeScreen } from './WelcomeScreen';
