import { useNavigate } from 'react-router';
import { ScreenStub } from '../../app/ScreenStub';
import { shellText } from '../../i18n/pt-BR';
import { Button } from '../../ui';
import { SignOutAction } from './SignOut';

/** S01: a lista de ajustes chega depois; por enquanto só o "Sair" (S02, RN-100). */
export function SettingsScreen() {
  return (
    <>
      <ScreenStub screen="S01" />
      <SettingsLinks />
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
    </>
  );
}
