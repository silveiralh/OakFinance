// I01 sem o Open Finance (D-080, T-115): só "Importar extrato" e "Nota fiscal (NFC-e)". Os dois cards também
// compõem a I01 completa (`ConnectionsScreen`), usada quando `OPEN_FINANCE_ENABLED` está ligado.
import { FileUp, QrCode } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router';
import { t } from '../../i18n/pt-BR';
import { useOnline } from '../../lib/online';
import { Button, GlassCard } from '../../ui';

/** Importar extrato (funciona sem rede) e ler a nota fiscal (precisa de internet). */
export function ImportCards() {
  const online = useOnline();
  const navigate = useNavigate();
  return (
    <>
      <GlassCard level={2} title={t('conn.section.import')} data-testid="connections-import">
        <Button
          variant="secondary"
          iconStart={FileUp}
          fullWidth
          onClick={() => void navigate('/importar')}
        >
          {t('import.choose')}
        </Button>
        <p className="account-meta">{t('import.bbHint')}</p>
      </GlassCard>
      <GlassCard level={2} title={t('conn.section.nfce')} data-testid="connections-nfce">
        <Button
          variant="secondary"
          iconStart={QrCode}
          fullWidth
          disabled={!online}
          disabledReason={t('conn.needsInternet')}
          onClick={() => void navigate('/nota')}
        >
          {t('conn.nfce.read')}
        </Button>
        <p className="account-meta">{t('conn.nfce.hint')}</p>
      </GlassCard>
    </>
  );
}

/** I01 com o Open Finance desligado: nenhum caminho para conectar banco. */
export function ImportHubScreen() {
  return (
    <section className="screen connections" data-screen="I01" data-testid="screen-I01">
      <ImportCards />
    </section>
  );
}

/** I02 com o Open Finance desligado: a rota continua existindo e leva à I01. */
export function RedirectToConnections() {
  return <Navigate to="/ajustes/conexoes" replace />;
}
