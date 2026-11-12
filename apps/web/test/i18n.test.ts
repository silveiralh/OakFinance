import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type MessageKey, ptBR, t } from '../src/i18n/pt-BR';

const here = dirname(fileURLToPath(import.meta.url));
const ux = readFileSync(join(here, '../../../docs/specs/03-ux-design-system.md'), 'utf8');

/** Linhas `| \`chave\` | texto |` da UX §6.4, com as chaves abreviadas (`a.b` / `.c`) expandidas. */
function uxMessages(): Map<string, string> {
  const section = ux.slice(ux.indexOf('### 6.4 '), ux.indexOf('### 6.5 '));
  const out = new Map<string, string>();
  for (const line of section.split('\n')) {
    if (!line.startsWith('| `')) {
      continue;
    }
    const [keyCell = '', text = ''] = line.replace(/^\|\s*|\s*\|\s*$/g, '').split(' | ');
    const keys: string[] = [];
    let base = '';
    for (const raw of keyCell.split(' / ').map((k) => k.trim().replace(/`/g, ''))) {
      if (raw.startsWith('.')) {
        keys.push(base.slice(0, base.lastIndexOf('.')) + raw);
      } else {
        base = raw;
        keys.push(raw);
      }
    }
    const texts = keys.length === 1 ? [text] : text.split(' / ').map((s) => s.trim());
    for (const [i, key] of keys.entries()) {
      out.set(key, texts[i] ?? '');
    }
  }
  return out;
}

describe('i18n pt-BR (UX §6)', () => {
  it('UX §6.4: todas as chaves, com o texto exatamente igual ao da spec', () => {
    const expected = uxMessages();
    expect(expected.size).toBeGreaterThan(150);
    expect(Object.fromEntries(expected)).toEqual(ptBR);
  });

  it('UX §6.2: nenhum texto com "!" ou emoji', () => {
    for (const [key, text] of Object.entries(ptBR)) {
      expect(text, key).not.toMatch(/!|\p{Extended_Pictographic}/u);
    }
  });

  it('t() preenche os placeholders e mantém os que faltam', () => {
    expect(t('onb.step', { n: 2, nome: 'Renda' })).toBe('Passo 2 de 5 · Renda');
    expect(t('onb.step', { n: 3 })).toBe('Passo 3 de 5 · {nome}');
    expect(t('onb.welcome.title')).toBe('OakFinance');
    const key: MessageKey = 'onb.welcome.cta';
    expect(t(key)).toBe('Começar');
  });
});

describe('T-126: plural (UXD-009)', () => {
  it('US-46 (UXD-009): "1 nova", "1 vinculada", "Expira amanhã" e "1 lançamento importado." no singular', async () => {
    const { tn } = await import('../src/i18n/pt-BR');
    expect(tn('conn.summary.fresh', 1)).toBe('1 nova');
    expect(tn('conn.summary.fresh', 2)).toBe('2 novas');
    expect(tn('conn.summary.linked', 1)).toBe('1 vinculada');
    expect(tn('conn.summary.review', 1)).toBe('1 para conferir');
    expect(tn('conn.expiresIn', 1)).toBe('Expira amanhã');
    expect(tn('conn.expiresIn', 5)).toBe('Expira em 5 dias');
    expect(tn('conn.result.imported', 1)).toBe('1 lançamento importado.');
    expect(tn('conn.result.review', 1)).toBe('1 precisa de conferência.');
    expect(tn('conn.result.review', 0)).toBe('0 precisam de conferência.');
  });
});
