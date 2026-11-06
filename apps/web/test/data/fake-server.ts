// Servidor de sync em memória para os testes do motor: imita o contrato de `sync_push`/`sync_pull` (tech §4.7)
// — duplicate por mutation_id, stale quando o client_updated_at é mais antigo, rejected por tabela, cursor por
// server_version e reset_required abaixo do horizonte.
import type { RpcName, RpcResponse, SyncTransport } from '../../src/data/sync/transport';

type Row = Record<string, unknown> & { id: string; client_updated_at: string };

export class FakeServer {
  version = 0;
  horizon = 0;
  rows = new Map<string, { t: string; v: number; r: Row }>();
  seen = new Set<string>();
  rejectTables = new Set<string>();
  calls: Array<{ name: RpcName; args: Record<string, unknown> }> = [];
  events: unknown[] = [];
  /** Próximas respostas forçadas (falha de rede, 401, 500…). */
  failures: Array<RpcResponse<never> | 'throw' | 'hang'> = [];
  session = true;
  serverTime = () => new Date().toISOString();

  put(t: string, r: Row) {
    this.version += 1;
    this.rows.set(`${t}:${r.id}`, {
      t,
      v: this.version,
      r: { ...r, server_version: this.version },
    });
  }

  transport(): SyncTransport {
    return {
      hasSession: () => Promise.resolve(this.session),
      rpc: <T>(name: RpcName, args: Record<string, unknown>, signal: AbortSignal) =>
        this.handle(name, args, signal) as Promise<RpcResponse<T>>,
    };
  }

  private handle(
    name: RpcName,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<RpcResponse<unknown>> {
    this.calls.push({ name, args });
    const forced = this.failures.shift();
    if (forced === 'throw') {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    if (forced === 'hang') {
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('abort'))),
      );
    }
    if (forced) {
      return Promise.resolve(forced);
    }
    if (name === 'sync_push') {
      return Promise.resolve({ data: this.push(args), error: null, status: 200 });
    }
    if (name === 'sync_pull') {
      return Promise.resolve({ data: this.pull(args), error: null, status: 200 });
    }
    this.events.push(...(args.p_events as unknown[]));
    return Promise.resolve({ data: null, error: null, status: 204 });
  }

  private push(args: Record<string, unknown>) {
    const results = [];
    for (const m of args.p_mutations as Array<{ mutation_id: string; table: string; row: Row }>) {
      if (this.seen.has(m.mutation_id)) {
        results.push({ mutation_id: m.mutation_id, status: 'duplicate' });
        continue;
      }
      this.seen.add(m.mutation_id);
      if (this.rejectTables.has(m.table)) {
        results.push({ mutation_id: m.mutation_id, status: 'rejected', code: '23503' });
        continue;
      }
      const current = this.rows.get(`${m.table}:${m.row.id}`);
      if (current && current.r.client_updated_at > m.row.client_updated_at) {
        results.push({ mutation_id: m.mutation_id, status: 'stale', row: current.r });
        continue;
      }
      this.put(m.table, { ...m.row, device_id: args.p_device_id });
      results.push({ mutation_id: m.mutation_id, status: 'applied', server_version: this.version });
    }
    return { results, server_time: this.serverTime() };
  }

  private pull(args: Record<string, unknown>) {
    const since = args.p_since as number;
    const limit = args.p_limit as number;
    if (since > 0 && since < this.horizon) {
      return { reset_required: true, server_time: this.serverTime() };
    }
    const all = [...this.rows.values()].filter((x) => x.v > since).sort((a, b) => a.v - b.v);
    const page = all.slice(0, limit);
    const next = page.at(-1)?.v ?? since;
    return {
      rows: page.map((x) => ({ t: x.t, v: x.v, r: x.r })),
      next,
      has_more: all.length > page.length,
      server_time: this.serverTime(),
    };
  }
}
