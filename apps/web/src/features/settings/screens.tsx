import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { shellText, t } from '../../i18n/pt-BR';
import { readEnvironmentPrefs } from '../../lib/environment';
import { restart, STEP_PATH, updateOnboarding } from '../onboarding/progress';
import { appearanceOf } from './AppearanceScreen';
import { SignOutAction } from './SignOut';

/**
 * S01 em grupos (T-125, UXC-004, D-096 item 2): cada grupo com título, cada linha leva a uma subtela, com o valor
 * atual à direita quando houver; as menos usadas no fim e "Sair" separado.
 */
export function SettingsScreen() {
  return (
    <section className="screen settings" data-screen="S01" data-testid="screen-S01">
      <SettingsGroups />
      <section className="settings-group" aria-labelledby="settings-group-help">
        <h2 id="settings-group-help" className="settings-group-title">
          {t('settings.group.help')}
        </h2>
        <div className="glass settings-list">
          <SettingsRow label={shellText.screens.S11} to="/ajustes/diagnostico" />
          <RedoOnboarding />
        </div>
      </section>
      <div className="settings-signout">
        <SignOutAction />
      </div>
    </section>
  );
}

interface RowProps {
  label: string;
  to: string;
  value?: string;
}

/** Linha de 48 px: rótulo à esquerda, valor atual em texto secundário e seta à direita. */
function SettingsRow({ label, to, value }: RowProps) {
  const navigate = useNavigate();
  return (
    <button type="button" className="settings-row" onClick={() => void navigate(to)}>
      <span className="settings-row-label">{label}</span>
      {value && <span className="settings-row-value">{value}</span>}
      <ChevronRight size={20} aria-hidden="true" />
    </button>
  );
}

const THEME_KEY = {
  light: 'appearance.theme.light',
  dark: 'appearance.theme.dark',
  auto: 'appearance.theme.auto',
} as const;

function SettingsGroups() {
  const theme = appearanceOf(readEnvironmentPrefs()).theme;
  const groups: { id: string; title: string; rows: RowProps[] }[] = [
    {
      id: 'money',
      title: t('settings.group.money'),
      rows: [
        { label: shellText.screens.S03, to: '/ajustes/contas' },
        { label: shellText.screens.S04, to: '/ajustes/categorias' },
        { label: shellText.screens.S05, to: '/ajustes/renda' },
        // UXC-021: o título curto, como no TopBar
        { label: shellText.shortTitles.S06, to: '/ajustes/calculo' },
      ],
    },
    {
      id: 'alerts',
      title: t('settings.group.alerts'),
      rows: [{ label: shellText.screens.S07, to: '/ajustes/lembretes' }],
    },
    {
      id: 'data',
      title: t('settings.group.data'),
      rows: [
        // UXC-002: importar extrato, ler nota e (com o Open Finance) conexões ficam na I01
        { label: shellText.screens.I01, to: '/ajustes/conexoes' },
        { label: shellText.screens.I06, to: '/ajustes/regras' },
        { label: shellText.screens.S10, to: '/ajustes/dados' },
      ],
    },
    {
      id: 'device',
      title: t('settings.group.device'),
      rows: [
        {
          label: shellText.screens.S08,
          to: '/ajustes/aparencia',
          value: t(THEME_KEY[theme]),
        },
      ],
    },
  ];
  return (
    <>
      {groups.map((group) => (
        <section
          key={group.id}
          className="settings-group"
          aria-labelledby={`settings-group-${group.id}`}
        >
          <h2 id={`settings-group-${group.id}`} className="settings-group-title">
            {group.title}
          </h2>
          <div className="glass settings-list" data-testid={`settings-${group.id}`}>
            {group.rows.map((row) => (
              <SettingsRow key={row.to} {...row} />
            ))}
          </div>
        </section>
      ))}
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
    <button
      type="button"
      className="settings-row"
      onClick={() => void redo()}
      data-testid="onb-redo"
    >
      <span className="settings-row-label">{t('onb.redo')}</span>
      <ChevronRight size={20} aria-hidden="true" />
    </button>
  );
}
