import { QrCode } from '@phosphor-icons/react';
import { lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { QUICK_ENTRY_PARAM } from '../../app/screens';
import { t } from '../../i18n/pt-BR';
import { BottomSheet, Button } from '../../ui';

const QuickEntrySheet = lazy(() =>
  import('./QuickEntrySheet').then((m) => ({ default: m.QuickEntrySheet })),
);

/** URL sem o `?novo=` (fecha o Q01 sem empilhar histórico). */
export function withoutQuickEntry(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(QUICK_ENTRY_PARAM);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/** Abre o Q01 como sheet quando a URL tem `?novo=despesa` (o modo Receita/Guardar chega na T-041). */
export function QuickEntryHost() {
  const location = useLocation();
  const navigate = useNavigate();
  const mode = new URLSearchParams(location.search).get(QUICK_ENTRY_PARAM);
  if (mode !== 'despesa') {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <QuickEntrySheet
        onClose={() =>
          void navigate(withoutQuickEntry(location.pathname, location.search), { replace: true })
        }
      />
    </Suspense>
  );
}

export interface FabMenuProps {
  open: boolean;
  onClose: () => void;
  onPick: (href: string) => void;
}

/** Toque longo no FAB (UX §3 H01): Despesa, Receita, Guardar e Ler nota. */
export function FabMenu({ open, onClose, onPick }: FabMenuProps) {
  const items = [
    { label: t('quick.type.expense'), href: `?${QUICK_ENTRY_PARAM}=despesa` },
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
        <Button variant="secondary" fullWidth iconStart={QrCode} onClick={() => onPick('/nota')}>
          {t('quick.readNote')}
        </Button>
      </div>
    </BottomSheet>
  );
}
