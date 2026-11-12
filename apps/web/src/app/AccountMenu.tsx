// Menu da conta (D-076, T-118; UXA-001, UXC-002): avatar com as iniciais no topo das abas principais. Leva a
// Configurações, Importar extrato e Ler nota fiscal, e tem o "Sair" do S02 (com o aviso de pendências da RN-100).
// "Conexões" só aparece com o Open Finance ligado (D-080).
import { CircleUser, FileUp, Plug, QrCode, Settings } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useLive } from '../data/live';
import { SignOutAction } from '../features/settings/SignOut';
import { t } from '../i18n/pt-BR';
import { BottomSheet, Button } from '../ui';
import { useAuth } from './auth';
import { OPEN_FINANCE_ENABLED } from './openFinance';

/** Até duas iniciais do nome ("Maria da Silva" → "MS"); sem nome, `null` (o avatar mostra o ícone). */
export function initialsOf(name: string | null | undefined): string | null {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0 && !/^(da|de|do|das|dos|e)$/i.test(w));
  if (words.length === 0) {
    return null;
  }
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toLocaleUpperCase('pt-BR');
}

/** Itens do menu, na ordem; `href` é a rota de destino. */
export function accountMenuItems(openFinance: boolean) {
  return [
    { key: 'settings', label: t('account.settings'), icon: Settings, href: '/ajustes' },
    ...(openFinance
      ? [
          {
            key: 'connections',
            label: t('account.connections'),
            icon: Plug,
            href: '/ajustes/conexoes',
          },
        ]
      : []),
    { key: 'import', label: t('account.import'), icon: FileUp, href: '/importar' },
    { key: 'note', label: t('account.readNote'), icon: QrCode, href: '/nota' },
  ] as const;
}

export function AccountMenu() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const name = useLive(
    user ? async () => (await user.db.profiles.get(user.userId))?.display_name ?? null : null,
    [user],
  );
  const initials = initialsOf(name);
  const go = (href: string) => {
    setOpen(false);
    void navigate(href);
  };
  return (
    <>
      <button
        type="button"
        className="icon-btn account-avatar"
        aria-label={t('account.open')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        data-testid="account-avatar"
      >
        {initials ? (
          <span className="account-initials" aria-hidden="true">
            {initials}
          </span>
        ) : (
          <CircleUser size={24} aria-hidden="true" />
        )}
      </button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('account.title')}
        data-testid="account-menu"
      >
        <nav className="account-menu" aria-label={t('account.title')}>
          {accountMenuItems(OPEN_FINANCE_ENABLED).map((item) => (
            <Button
              key={item.key}
              variant="secondary"
              fullWidth
              iconStart={item.icon}
              onClick={() => go(item.href)}
              data-testid={`account-${item.key}`}
            >
              {item.label}
            </Button>
          ))}
          <SignOutAction />
        </nav>
      </BottomSheet>
    </>
  );
}
