// I01 sem o Open Finance (D-080, T-115): só "Importar extrato" e "Nota fiscal (NFC-e)". Os dois cards também
// compõem a I01 completa (`ConnectionsScreen`), usada quando `OPEN_FINANCE_ENABLED` está ligado.
import { FileUp, QrCode } from 'lucide-react';
import { useRef } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { t } from '../../i18n/pt-BR';
import { useOnline } from '../../lib/online';
import { Button, GlassCard } from '../../ui';
import { IMPORT_ACCEPT } from '../imports/accept';
import { RecentImports } from '../imports/RecentImports';

/** Importar extrato (funciona sem rede) e ler a nota fiscal (precisa de internet). */
export function ImportCards() {
  const online = useOnline();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <GlassCard level={2} title={t('conn.section.import')} data-testid="connections-import">
        {/* UXD-008: o botão abre o seletor e a I03 já abre com o arquivo carregado */}
        <input
          ref={input}
          type="file"
          accept={IMPORT_ACCEPT}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void navigate('/importar', { state: { file } });
            }
          }}
          data-testid="connections-import-file"
        />
        <Button
          variant="secondary"
          iconStart={FileUp}
          fullWidth
          onClick={() => input.current?.click()}
        >
          {t('import.choose')}
        </Button>
        <p className="account-meta">{t('import.formats')}</p>
        <p className="account-meta">{t('import.bbHint')}</p>
      </GlassCard>
      {/* UXD-005: "Desfazer importação" também aqui, nas importações das últimas 24 h */}
      <RecentImports />
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
