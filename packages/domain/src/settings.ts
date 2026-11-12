// Preferências do perfil (profiles.settings, tech §5.11) e os padrões usados quando o JSON não traz um campo.
import { DEFAULT_QUIET_HOURS } from './defaults.ts';
import type { CsvProfile } from './imports/csv.ts';
import { DEFAULT_RECON_OPTIONS, type ReconOptions } from './reconciliation.ts';
import { DEFAULT_SPENDABLE_CONFIG, type SpendableConfig } from './spendable.ts';

export interface ProfileSettings {
  spendable: SpendableConfig;
  hideValues: boolean; // "ocultar valores" (também na tela, com toque para revelar)
  theme: 'system' | 'light' | 'dark';
  glass: 'auto' | 'solid'; // S08 "Transparência"
  reduceMotion: 'system' | 'on' | 'off';
  quietHours: { start: string; end: string }; // 'HH:MM'; padrão 22:00–08:00 (RN-86)
  csvProfiles: CsvProfile[]; // mapeamentos salvos por conta (RN-76)
  reconciliation: ReconOptions;
  /** Limiares de aviso do orçamento em % (D-082, RN-92): 1 ≤ atenção < passou ≤ 200; padrão 80 e 100. */
  alerts: AlertPcts;
}

export interface AlertPcts {
  attentionPct: number;
  overPct: number;
}

export const DEFAULT_ALERT_PCTS: Readonly<AlertPcts> = { attentionPct: 80, overPct: 100 };
export const MAX_ALERT_PCT = 200;

/** D-082: os dois limiares são inteiros e 1 ≤ atenção < passou do planejado ≤ 200. */
export function validAlertPcts(attentionPct: unknown, overPct: unknown): boolean {
  return (
    typeof attentionPct === 'number' &&
    typeof overPct === 'number' &&
    Number.isInteger(attentionPct) &&
    Number.isInteger(overPct) &&
    attentionPct >= 1 &&
    attentionPct < overPct &&
    overPct <= MAX_ALERT_PCT
  );
}

/** Limiares em pontos-base, na ordem do orçamento ([atenção, passou]). */
export function alertThresholdsBp(alerts: AlertPcts): [number, number] {
  return [alerts.attentionPct * 100, alerts.overPct * 100];
}

export const DEFAULT_PROFILE_SETTINGS: Readonly<ProfileSettings> = {
  spendable: { ...DEFAULT_SPENDABLE_CONFIG },
  hideValues: false,
  theme: 'system',
  glass: 'auto',
  reduceMotion: 'system',
  quietHours: { ...DEFAULT_QUIET_HOURS },
  csvProfiles: [],
  reconciliation: DEFAULT_RECON_OPTIONS,
  alerts: { ...DEFAULT_ALERT_PCTS },
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Lê `profiles.settings` (JSON livre, possivelmente de uma versão anterior): campos ausentes ou inválidos ficam com
 * o padrão; os válidos são mantidos. Nunca lança.
 */
export function resolveProfileSettings(raw: unknown): ProfileSettings {
  const s = record(raw);
  const d = DEFAULT_PROFILE_SETTINGS;
  const sp = record(s.spendable);
  const quiet = record(s.quietHours);
  const recon = record(s.reconciliation);
  const windows = record(recon.windowDays);
  const tol = record(recon.suggestTolerance);
  const int = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
  const dw = d.reconciliation.windowDays;
  return {
    spendable: {
      includeExpectedIncome: bool(sp.includeExpectedIncome, d.spendable.includeExpectedIncome),
      savingsMode: pick(sp.savingsMode, ['target', 'none'], d.spendable.savingsMode),
      includeUpcoming: bool(sp.includeUpcoming, d.spendable.includeUpcoming),
      cardAttribution: pick(
        sp.cardAttribution,
        ['invoice_due_month', 'purchase_month'],
        d.spendable.cardAttribution,
      ),
      includeRestrictedAccounts: bool(
        sp.includeRestrictedAccounts,
        d.spendable.includeRestrictedAccounts,
      ),
    },
    hideValues: bool(s.hideValues, d.hideValues),
    theme: pick(s.theme, ['system', 'light', 'dark'], d.theme),
    glass: pick(s.glass, ['auto', 'solid'], d.glass),
    reduceMotion: pick(s.reduceMotion, ['system', 'on', 'off'], d.reduceMotion),
    quietHours: {
      start:
        typeof quiet.start === 'string' && HHMM.test(quiet.start)
          ? quiet.start
          : d.quietHours.start,
      end: typeof quiet.end === 'string' && HHMM.test(quiet.end) ? quiet.end : d.quietHours.end,
    },
    csvProfiles: Array.isArray(s.csvProfiles) ? (s.csvProfiles as CsvProfile[]) : [],
    reconciliation: {
      windowDays: {
        card: int(windows.card, dw.card),
        debit: int(windows.debit, dw.debit),
        pix: int(windows.pix, dw.pix),
        transfer: int(windows.transfer, dw.transfer),
        boleto: int(windows.boleto, dw.boleto),
        recurrence: int(windows.recurrence, dw.recurrence),
        nfce: int(windows.nfce, dw.nfce),
      },
      suggestTolerance: {
        minCents: int(tol.minCents, d.reconciliation.suggestTolerance.minCents),
        pctBp: int(tol.pctBp, d.reconciliation.suggestTolerance.pctBp),
      },
      lookbackDays: int(recon.lookbackDays, d.reconciliation.lookbackDays),
    },
    alerts: validAlertPcts(record(s.alerts).attentionPct, record(s.alerts).overPct)
      ? {
          attentionPct: record(s.alerts).attentionPct as number,
          overPct: record(s.alerts).overPct as number,
        }
      : { ...d.alerts },
  };
}
