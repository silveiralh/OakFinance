import { FileUp, QrCode } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { QUICK_ENTRY_PARAM } from '../../app/screens';
import { t } from '../../i18n/pt-BR';
import { BottomSheet, Button } from '../../ui';

const QuickEntrySheet = lazy(() =>
  import('./QuickEntrySheet').then((m) => ({ default: m.QuickEntrySheet })),
);
const ReserveMoveSheet = lazy(() =>
  import('../budget/ReserveMoveSheet').then((m) => ({ default: m.ReserveMoveSheet })),
);

export const EDIT_PARAM = 'editar';

/** URL sem o `?novo=`/`?editar=` (fecha o Q01 sem empilhar histórico). */
export function withoutQuickEntry(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(QUICK_ENTRY_PARAM);
  params.delete(EDIT_PARAM);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/** Abre o Q01 como sheet com `?novo=despesa` ou `?novo=receita`; `?novo=guardar` abre o modo Guardar (US-33). */
export function QuickEntryHost() {
  const location = useLocation();
  const navigate = useNavigate();
  const mode = new URLSearchParams(location.search).get(QUICK_ENTRY_PARAM);
  const close = () =>
    void navigate(withoutQuickEntry(location.pathname, location.search), { replace: true });
  if (mode === 'guardar') {
    return (
      <Suspense fallback={null}>
        <ReserveMoveSheet kind="save" onClose={close} />
      </Suspense>
    );
  }
  if (mode !== 'despesa' && mode !== 'receita') {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <QuickEntrySheet
        onClose={close}
        {...(mode === 'receita' ? { mode: 'income' as const } : {})}
      />
    </Suspense>
  );
}

export interface FabMenuProps {
  open: boolean;
  onClose: () => void;
  onPick: (href: string) => void;
}

/**
 * Toque longo no FAB (UX §3 H01, D-076): Receita, Guardar, Importar extrato e Ler nota (o toque simples já abre a
 * despesa). Alternativa sem gesto (WCAG 2.5.1): Receita e Guardar pelo seletor de tipo do Q01; Importar extrato e
 * Ler nota fiscal pelo menu da conta.
 */
export function FabMenu({ open, onClose, onPick }: FabMenuProps) {
  const items = [
    { label: t('quick.type.income'), href: `?${QUICK_ENTRY_PARAM}=receita` },
    { label: t('quick.type.save'), href: `?${QUICK_ENTRY_PARAM}=guardar` },
  ];
  return (
    <BottomSheet open={open} onClose={onClose} title={t('quick.title')} data-testid="fab-menu">
      <div className="fab-menu" role="menu">
        {items.map((item) => (
          <Button key={item.href} variant="secondary" fullWidth onClick={() => onPick(item.href)}>
            {item.label}
          </Button>
        ))}
        <Button
          variant="secondary"
          fullWidth
          iconStart={FileUp}
          onClick={() => onPick('/importar')}
        >
          {t('account.import')}
        </Button>
        <Button variant="secondary" fullWidth iconStart={QrCode} onClick={() => onPick('/nota')}>
          {t('quick.readNote')}
        </Button>
      </div>
    </BottomSheet>
  );
}
