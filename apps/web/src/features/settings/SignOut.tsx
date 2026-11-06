import { SignOut as SignOutIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { shellText } from '../../i18n/pt-BR';
import { Button, Dialog } from '../../ui';

/** "Sair" (S02, RN-100): sem fila sai direto; com fila, o G16 pergunta. Sair sempre apaga o banco local. */
export function SignOutAction() {
  const { pending, signOut } = useAuth();
  const navigate = useNavigate();
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const leave = async (mode: 'send' | 'discard') => {
    setBusy(true);
    const ok = await signOut(mode);
    setBusy(false);
    if (ok) {
      setCount(null);
      void navigate('/entrar', { replace: true });
    } else {
      setCount(await pending());
    }
  };

  const start = async () => {
    const n = await pending();
    if (n === 0) {
      await leave('discard');
    } else {
      setCount(n);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        iconStart={SignOutIcon}
        loading={busy}
        onClick={() => void start()}
      >
        {shellText.signOut}
      </Button>
      <Dialog
        open={count !== null}
        title={shellText.pendingOnSignOut.replace('{n}', String(count ?? 0))}
        description={shellText.signOutWipes}
        options={[
          { value: 'send', label: shellText.sendAndSignOut },
          { value: 'discard', label: shellText.discardAndSignOut, tone: 'danger' },
        ]}
        onChoose={(value) => void leave(value === 'send' ? 'send' : 'discard')}
        onCancel={() => setCount(null)}
        data-testid="g16"
      />
    </>
  );
}
