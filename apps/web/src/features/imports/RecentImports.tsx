// Importações das últimas 24 h com "Desfazer importação" (RN-78). Aparece na I03 e, pela UXD-005, também na I01.
import type { ISODate } from '@oakfinance/domain';
import { useAuth } from '../../app/auth';
import { useLive } from '../../data/live';
import { t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { Button, GlassCard, useToast } from '../../ui';
import { undoable, undoImport } from './ofx-import';

export function RecentImports() {
  const { user } = useAuth();
  const showToast = useToast();
  const imports = useLive(user ? () => user.db.imports.toArray() : null, [user]);
  if (!user || !imports) {
    return null;
  }
  const recent = undoable(imports, Date.now());
  if (recent.length === 0) {
    return null;
  }
  return (
    <GlassCard level={1} title={t('import.recent')} headingLevel={2} data-testid="import-recent">
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
  );
}
