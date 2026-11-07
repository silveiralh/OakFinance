// Regressão da issue #82: o deploy de staging falhou porque o bundle server-side da Supabase
// não achou o import map e recusou o especificador nu `@supabase/supabase-js` em push-test.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FUNCTIONS_DIR = 'supabase/functions';
const IMPORT_MAP = `${FUNCTIONS_DIR}/deno.json`;
const SCRIPT = readFileSync('scripts/deploy-supabase.sh', 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

/** Especificadores nus (nem relativos, nem com esquema `npm:`/`jsr:`/`node:`/URL). */
function bareSpecifiers(source: string): string[] {
  const found = new Set<string>();
  const re =
    /(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(re)) {
    const spec = match[1] ?? match[2] ?? '';
    if (!/^(\.{0,2}\/|[a-z]+:)/.test(spec)) {
      found.add(spec);
    }
  }
  return [...found];
}

describe('deploy das Edge Functions (regressão #82)', () => {
  it('passa o import map único explicitamente ao bundle server-side', () => {
    expect(SCRIPT).toContain(`IMPORT_MAP="${IMPORT_MAP}"`);
    expect(SCRIPT).toMatch(
      /supabase functions deploy [^\n]*--use-api[^\n]*--import-map "\$IMPORT_MAP"/,
    );
  });

  it('todo especificador nu usado pelas funções está declarado no import map', () => {
    const imports = (
      JSON.parse(readFileSync(IMPORT_MAP, 'utf8')) as { imports: Record<string, string> }
    ).imports;
    const missing = sourceFiles(FUNCTIONS_DIR).flatMap((file) =>
      bareSpecifiers(readFileSync(file, 'utf8'))
        .filter((spec) => !(spec in imports))
        .map((spec) => `${file}: ${spec}`),
    );
    expect(missing).toEqual([]);
  });

  it('reconhece especificadores nus e ignora relativos e com esquema', () => {
    const source = [
      "import { createClient } from '@supabase/supabase-js';",
      "import webpush from 'web-push';",
      "import { x } from '../_shared/http.ts';",
      "import assert from 'node:assert/strict';",
      "import { y } from 'npm:uuid@14.0.3';",
    ].join('\n');
    expect(bareSpecifiers(source).sort()).toEqual(['@supabase/supabase-js', 'web-push']);
  });
});
