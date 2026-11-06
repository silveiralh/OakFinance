// RN-92: ao cruzar 80% ou 100% de Necessidades, Desejos ou do limite de uma categoria, o aparelho onde a mudança
// aconteceu mostra um toast e grava o aviso local (`notices`, id v5 da mesma dedupe_key do reminders-tick). Uma vez
// por (faixa ou categoria, limiar, mês): o que já estava cruzado quando a sessão abriu só vira aviso, sem toast.
import { type DueNotification, type ISODate, noticeId } from '@oakfinance/domain';
import { useEffect, useRef } from 'react';
import { useLive } from '../data/live';
import { saveRow } from '../data/repositories/rows';
import { pendingCount } from '../data/sync/outbox';
import {
  BAND_NAME,
  type BudgetView,
  budgetAlerts,
  budgetView,
  parseBudgetKey,
} from '../features/budget/budget';
import { loadHomeRows } from '../features/dashboard/data';
import { useToday } from '../features/dashboard/HomeOverview';
import { t } from '../i18n/pt-BR';
import { useToast } from '../ui';
import { useAuth } from './auth';
import { useValuesHidden } from './values';

/** "Restaurantes e delivery atingiu 81% do limite" / "Desejos atingiu 85% do planejado" / "{nome} acima do planejado". */
export function alertToast(alert: DueNotification, view: BudgetView): string | null {
  const key = parseBudgetKey(alert.dedupeKey);
  if (!key) {
    return null;
  }
  const band = view.bands.find((b) => b.bucket === key.ref);
  const category = view.bands.flatMap((b) => b.categories).find((c) => c.id === key.ref);
  const name = band ? BAND_NAME[band.bucket] : category?.name;
  if (!name) {
    return null;
  }
  if (key.thresholdBp >= 10000) {
    return t('budget.toast.over', { nome: name });
  }
  const p = Math.floor((band ? band.status.usageBp : (category?.usageBp ?? 0)) / 100);
  return band
    ? t('budget.toast.bucket', { faixa: name, p })
    : t('budget.toast.category', { categoria: name, p });
}

export function BudgetAlerts({ today: fixedToday }: { today?: ISODate } = {}) {
  const { user } = useAuth();
  const showToast = useToast();
  const hidden = useValuesHidden();
  const today = useToday(fixedToday);
  const data = useLive(
    user
      ? async () => ({
          rows: await loadHomeRows(user.db),
          noticeKeys: (await user.db.notices.toArray())
            .filter((n) => n.deleted_at === null)
            .map((n) => n.dedupe_key),
          // mudança feita neste aparelho ainda na fila: só ela mostra toast (a que chega pelo pull vira só aviso)
          localChanges: await pendingCount(user.db),
        })
      : null,
    [user],
  );
  const seen = useRef<{ userId: string; keys: Set<string> } | null>(null);
  useEffect(() => {
    if (!user || !data) {
      return;
    }
    const first = seen.current?.userId !== user.userId;
    if (first) {
      seen.current = { userId: user.userId, keys: new Set() };
    }
    const keys = seen.current?.keys ?? new Set<string>();
    const known = new Set(data.noticeKeys);
    const fresh = budgetAlerts(data.rows, today, hidden).filter(
      (a) => !known.has(a.dedupeKey) && !keys.has(a.dedupeKey),
    );
    if (fresh.length === 0) {
      return;
    }
    const view = budgetView(data.rows, today);
    const now = new Date().toISOString();
    for (const alert of fresh) {
      keys.add(alert.dedupeKey);
      void saveRow(user.db, 'notices', {
        id: noticeId(user.userId, alert.dedupeKey),
        user_id: user.userId,
        kind: alert.kind,
        dedupe_key: alert.dedupeKey,
        title: alert.title,
        body: alert.body,
        navigate: alert.navigate,
        read_at: null,
        created_at: now,
        updated_at: now,
        client_updated_at: now,
        deleted_at: null,
        server_version: 0,
        device_id: null,
      }).then(() => user.engine.notifyWrite());
      const message = first || data.localChanges === 0 ? null : alertToast(alert, view);
      if (message) {
        showToast({ message, tone: alert.dedupeKey.endsWith(':10000') ? 'warning' : 'info' });
      }
    }
  }, [user, data, today, hidden, showToast]);
  return null;
}
