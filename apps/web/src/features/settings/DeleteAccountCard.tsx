// S10 — Excluir minha conta e dados (T-094; US-61, UX §3 S01 S10 e §6.6): oferece o backup antes, lembra de revogar
// no Meu Pluggy e pede "EXCLUIR". A `account-delete` apaga os itens na Pluggy e o usuário (cascata no banco); o
// aparelho apaga a cópia local e sai.
import { DatabaseBackup, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { OPEN_FINANCE_ENABLED } from '../../app/openFinance';
import { errorStates, t, uiText } from '../../i18n/pt-BR';
import { invokeFunction } from '../../lib/functions';
import { BottomSheet, Button, GlassCard, TextField } from '../../ui';

export const DELETE_WORD = 'EXCLUIR';

export function DeleteAccountCard({ onBackup }: { onBackup: () => Promise<void> }) {
  const { user, client, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user) {
    return null;
  }
  const confirmed = typed.trim() === DELETE_WORD;
  const run = async () => {
    if (!confirmed || !client) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await invokeFunction<{ ok: boolean }>(client, 'account-delete', {
        confirm: DELETE_WORD,
      });
      if (!result.ok || !result.data.ok) {
        setError(
          !result.ok && result.reason === 'offline'
            ? t('deleteAccount.offline')
            : t('deleteAccount.failed'),
        );
        return;
      }
      // a conta já não existe no servidor: apaga a cópia local e sai (a fila não tem para onde ir)
      await signOut('discard');
      void navigate('/entrar', { replace: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <GlassCard level={2} className="export-card" data-testid="delete-account-card">
      <h2>{t('deleteAccount.title')}</h2>
      <p className="account-meta">{t('deleteAccount.hint')}</p>
      {OPEN_FINANCE_ENABLED && <p className="account-meta">{t('deleteAccount.pluggy')}</p>}
      <Button
        variant="secondary"
        iconStart={DatabaseBackup}
        fullWidth
        onClick={() => void onBackup()}
        data-testid="delete-account-backup"
      >
        {t('deleteAccount.backup')}
      </Button>
      <Button
        variant="danger"
        iconStart={Trash2}
        fullWidth
        onClick={() => {
          setTyped('');
          setError(null);
          setOpen(true);
        }}
        data-testid="delete-account-open"
      >
        {t('deleteAccount.cta')}
      </Button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('deleteAccount.title')}
        variant="dialog"
        role="alertdialog"
        data-testid="delete-account-confirm"
      >
        <p className="dialog-description">{errorStates.deleteAccount.text}</p>
        {OPEN_FINANCE_ENABLED && <p className="dialog-description">{t('deleteAccount.pluggy')}</p>}
        <TextField
          label={t('deleteAccount.typeLabel')}
          value={typed}
          onChange={setTyped}
          autoComplete="off"
          data-testid="delete-account-word"
        />
        {error && (
          <p role="alert" data-testid="delete-account-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button
            variant="danger"
            fullWidth
            disabled={!confirmed}
            loading={busy}
            onClick={() => void run()}
            data-testid="delete-account-run"
          >
            {t('deleteAccount.confirm')}
          </Button>
          <Button variant="ghost" fullWidth onClick={() => setOpen(false)}>
            {uiText.cancel}
          </Button>
        </div>
      </BottomSheet>
    </GlassCard>
  );
}
