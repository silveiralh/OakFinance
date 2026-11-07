// I03 — Importar OFX (UX §3 I03; US-52, RN-65, RN-75, RN-78): escolher (ou arrastar, no computador) o arquivo,
// o destino (lembrado pela conta do arquivo), a prévia e "Importar {n} lançamentos". Funciona offline: tudo é lido
// e gravado no aparelho e sincroniza depois. As importações das últimas 24 h podem ser desfeitas.
import type { ISODate, OfxStatement } from '@oakfinance/domain';
import { FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAuth } from '../../app/auth';
import { useLive } from '../../data/live';
import { t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { Button, GlassCard, Select, useToast } from '../../ui';
import {
  commitImport,
  type Destination,
  type ImportPlan,
  planImport,
  previousImport,
  rememberedDestination,
  sha256Hex,
  undoable,
  undoImport,
} from './ofx-import';
import { parseFile } from './parse-file';

interface Loaded {
  fileName: string;
  sha: string;
  statement: OfxStatement;
  already: string | null;
}

function encode(dest: Destination): string {
  return `${dest.kind}:${dest.id}`;
}

function decode(value: string): Destination | null {
  const [kind, id] = value.split(':');
  return (kind === 'account' || kind === 'card') && id ? { kind, id } : null;
}

export function ImportScreen() {
  const { user } = useAuth();
  const showToast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dest, setDest] = useState('');
  const [anyway, setAnyway] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = useLive(
    user
      ? async () => ({
          accounts: (await user.db.accounts.toArray()).filter(
            (a) => a.deleted_at === null && a.archived_at === null,
          ),
          cards: (await user.db.cards.toArray()).filter(
            (c) => c.deleted_at === null && c.archived_at === null,
          ),
          imports: await user.db.imports.toArray(),
        })
      : null,
    [user],
  );
  if (!user || !data) {
    return <section className="screen" data-screen="I03" data-testid="screen-I03" />;
  }
  const options = [
    ...data.accounts.map((a) => ({ value: encode({ kind: 'account', id: a.id }), label: a.name })),
    ...data.cards.map((c) => ({ value: encode({ kind: 'card', id: c.id }), label: c.name })),
  ];

  const choose = async (file: File | undefined) => {
    if (input.current) {
      input.current.value = '';
    }
    if (!file) {
      return;
    }
    setError(null);
    setLoaded(null);
    setAnyway(false);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseFile(bytes);
    if (!parsed.ok) {
      setError(parsed.code === 'EMPTY' ? t('import.empty') : t('import.badFile'));
      return;
    }
    const statement = parsed.statements[0] as OfxStatement;
    const sha = await sha256Hex(bytes);
    const before = await previousImport(user.db, sha);
    const remembered = await rememberedDestination(user.db, statement.acctIdMasked);
    const fallback =
      statement.kind === 'creditcard'
        ? data.cards[0] && { kind: 'card' as const, id: data.cards[0].id }
        : data.accounts[0] && { kind: 'account' as const, id: data.accounts[0].id };
    const chosen = remembered ?? fallback ?? null;
    setDest(chosen ? encode(chosen) : '');
    setLoaded({
      fileName: file.name,
      sha,
      statement,
      already: before ? formatDateBR(before.created_at.slice(0, 10) as ISODate).slice(0, 5) : null,
    });
  };

  const destination = decode(dest);
  const planFor = async (): Promise<ImportPlan | null> => {
    if (!loaded || !destination) {
      return null;
    }
    return planImport({
      userId: user.userId,
      statement: loaded.statement,
      destination,
      fileName: loaded.fileName,
      sha: loaded.sha,
      txs: await user.db.transactions.toArray(),
      invoices: await user.db.invoices.toArray(),
      cards: await user.db.cards.toArray(),
      recurrences: await user.db.recurrences.toArray(),
      nowMs: Date.now(),
    });
  };

  const run = async () => {
    setBusy(true);
    try {
      const plan = await planFor();
      if (!plan || !loaded) {
        return;
      }
      const result = await commitImport(user.db, plan, loaded.statement.acctIdMasked);
      if (result.ok) {
        user.engine.notifyWrite();
        const importId = plan.importRow.id;
        setLoaded(null);
        showToast({
          message: t('import.done', { n: result.value }),
          tone: 'success',
          action: {
            label: t('import.undo'),
            onPress: () => void undoImport(user.db, importId).then(() => user.engine.notifyWrite()),
          },
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const recent = undoable(data.imports, Date.now());

  return (
    <section className="screen import" data-screen="I03" data-testid="screen-I03">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrastar é atalho no computador; o botão abaixo é o caminho acessível */}
      <div
        className="import-drop-zone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void choose(event.dataTransfer.files[0]);
        }}
      >
        <GlassCard level={2} className="import-drop" data-testid="import-drop">
          <p>{t('import.bbHint')}</p>
          <input
            ref={input}
            type="file"
            accept=".ofx,application/x-ofx"
            hidden
            onChange={(event) => void choose(event.target.files?.[0])}
            data-testid="import-file"
          />
          <Button iconStart={FileUp} fullWidth onClick={() => input.current?.click()}>
            {t('import.choose')}
          </Button>
          <p className="account-meta">{t('import.local')}</p>
          {error && (
            <p role="alert" data-testid="import-error">
              {error}
            </p>
          )}
        </GlassCard>
      </div>

      {loaded && (
        <ImportPreviewCard
          loaded={loaded}
          options={options}
          dest={dest}
          setDest={setDest}
          anyway={anyway}
          setAnyway={setAnyway}
          busy={busy}
          planFor={planFor}
          onRun={() => void run()}
        />
      )}

      {recent.length > 0 && (
        <GlassCard
          level={1}
          title={t('import.recent')}
          headingLevel={2}
          data-testid="import-recent"
        >
          <ul className="inbox-list">
            {recent.map((row) => (
              <li key={row.id}>
                <p>
                  {t('import.recentItem', {
                    arquivo: row.file_name ?? '',
                    n: Number((row.stats as { total?: number } | null)?.total ?? 0),
                    data: formatDateBR(row.created_at.slice(0, 10) as ISODate),
                  })}
                </p>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void undoImport(user.db, row.id).then((r) => {
                      if (r.ok) {
                        user.engine.notifyWrite();
                        showToast({ message: t('import.undone') });
                      }
                    })
                  }
                >
                  {t('import.undo')}
                </Button>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}
    </section>
  );
}

function ImportPreviewCard(props: {
  loaded: Loaded;
  options: Array<{ value: string; label: string }>;
  dest: string;
  setDest: (value: string) => void;
  anyway: boolean;
  setAnyway: (value: boolean) => void;
  busy: boolean;
  planFor: () => Promise<ImportPlan | null>;
  onRun: () => void;
}) {
  const { loaded, options, dest } = props;
  const preview = useLive(
    () => props.planFor().then((p) => p?.preview ?? null),
    [dest, loaded.sha],
  );
  if (options.length === 0) {
    return (
      <GlassCard level={2} data-testid="import-preview">
        <p role="alert">{t('import.noDestination')}</p>
      </GlassCard>
    );
  }
  const blocked = loaded.already !== null && !props.anyway;
  const count = preview ? preview.fresh + preview.merged + preview.suggested : 0;
  return (
    <GlassCard level={2} className="import-preview" data-testid="import-preview">
      <Select
        label={t('import.destination')}
        value={dest}
        onChange={props.setDest}
        options={options}
      />
      {preview && (
        <>
          <p data-testid="import-summary">
            {t('import.preview', { n: preview.total, d: preview.existing, s: preview.suggested })}
          </p>
          {preview.merged > 0 && (
            <p data-testid="import-merging">{t('import.merging', { n: preview.merged })}</p>
          )}
        </>
      )}
      {loaded.already && (
        <div role="alert" data-testid="import-already">
          <p>{t('import.already', { data: loaded.already })}</p>
          {!props.anyway && (
            <Button variant="secondary" onClick={() => props.setAnyway(true)}>
              {t('import.anyway')}
            </Button>
          )}
        </div>
      )}
      <Button
        fullWidth
        loading={props.busy}
        disabled={blocked || count === 0}
        onClick={props.onRun}
        data-testid="import-run"
      >
        {t('import.cta', { n: count })}
      </Button>
    </GlassCard>
  );
}
