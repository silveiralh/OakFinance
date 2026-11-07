import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { ScreenStub } from '../../app/ScreenStub';
import { shellText, t } from '../../i18n/pt-BR';
import { Button } from '../../ui';
import { restart, STEP_PATH, updateOnboarding } from '../onboarding/progress';
import { SignOutAction } from './SignOut';

/** S01: a lista de ajustes chega depois; por enquanto só o "Sair" (S02, RN-100). */
export function SettingsScreen() {
  return (
    <>
      <ScreenStub screen="S01" />
      <SettingsLinks />
      <RedoOnboarding />
      <SignOutAction />
    </>
  );
}

/** Subtelas já existentes (UX §3 S01). */
function SettingsLinks() {
  const navigate = useNavigate();
  return (
    <>
      <Button variant="secondary" onClick={() => void navigate('/ajustes/contas')}>
        {shellText.screens.S03}
      </Button>
      <Button variant="secondary" onClick={() => void navigate('/ajustes/categorias')}>
        {shellText.screens.S04}
      </Button>
      <Button variant="secondary" onClick={() => void navigate('/ajustes/renda')}>
        {shellText.screens.S05}
      </Button>
      <Button variant="secondary" onClick={() => void navigate('/ajustes/calculo')}>
        {shellText.screens.S06}
      </Button>
      <Button variant="secondary" onClick={() => void navigate('/ajustes/lembretes')}>
        {shellText.screens.S07}
      </Button>
      <Button variant="secondary" onClick={() => void navigate('/ajustes/aparencia')}>
        {shellText.screens.S08}
      </Button>
      <Button variant="secondary" onClick={() => void navigate('/ajustes/dados')}>
        {shellText.screens.S10}
      </Button>
      <Button variant="secondary" onClick={() => void navigate('/ajustes/diagnostico')}>
        {shellText.screens.S11}
      </Button>
    </>
  );
}

/** S02 "Refazer configuração inicial" (UX §3 S01, US-08): reabre o fluxo no ON04 sem apagar dados. */
function RedoOnboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const redo = async () => {
    if (user) {
      await updateOnboarding(user.db, (s) => restart(s, new Date().toISOString()));
      user.engine.notifyWrite();
    }
    void navigate(STEP_PATH.reminders);
  };
  return (
    <Button variant="secondary" onClick={() => void redo()} data-testid="onb-redo">
      {t('onb.redo')}
    </Button>
  );
}
