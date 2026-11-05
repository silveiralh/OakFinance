// Varredura de dados pessoais e arquivos reais (tech §8.6, job `secrets`; ADR-18).
// Complementa o gitleaks: aqui ficam as regras específicas do OakFinance.
//
// Uso:
//   node scripts/ci-secrets.ts --base origin/main   # linhas adicionadas no diff base...HEAD
//   node scripts/ci-secrets.ts --all                # todos os arquivos versionados
//
// Caminho protegido pelo guard (tech §8.6): mudanças só com o rótulo needs-owner.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Finding {
  file: string;
  line?: number;
  rule: string;
  detail: string;
}

export interface AddedLine {
  line: number;
  text: string;
}

const ALLOWED_ENV_FILES = new Set(['.env.example', 'supabase/.env.test']);
const ALLOWED_EMAIL_DOMAINS = ['example.com', 'example.test', 'users.noreply.github.com'];

export function isInFixtures(file: string): boolean {
  return file.split('/').includes('fixtures');
}

// ---------------------------------------------------------------- validadores

export function onlyDigits(text: string): string {
  return text.replace(/\D/g, '');
}

/** CPF com os dois dígitos verificadores válidos (sequências repetidas não contam). */
export function cpfValid(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) {
    return false;
  }
  const digit = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += Number(d[i]) * (len + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

export function luhnValid(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length < 2) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Prefixos de bandeiras (Visa, Mastercard, Amex, Diners, Elo, Hipercard, Discover). */
export function hasCardPrefix(digits: string): boolean {
  return /^(?:4|5[1-5]|2[2-7]|3[47]|3[0689]|6)/.test(digits);
}

export function looksLikeCard(value: string): boolean {
  const d = onlyDigits(value);
  return d.length >= 13 && d.length <= 19 && hasCardPrefix(d) && luhnValid(d);
}

/** Chave de acesso da NFC-e (44 dígitos) com o DV módulo 11 válido. */
export function nfceKeyValid(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 44) {
    return false;
  }
  let sum = 0;
  let weight = 2;
  for (let i = 42; i >= 0; i--) {
    sum += Number(d[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  const dv = rest < 2 ? 0 : 11 - rest;
  return dv === Number(d[43]);
}

export function emailAllowed(email: string): boolean {
  const [local = '', domain = ''] = email.toLowerCase().split('@');
  if (local === 'noreply' || local === 'no-reply') {
    return true;
  }
  return ALLOWED_EMAIL_DOMAINS.some((ok) => domain === ok || domain.endsWith(`.${ok}`));
}

// ---------------------------------------------------------------- regras

const EMAIL_RE = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;
const CPF_RE = /(?<![\d.])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\d])/g;
const CARD_RE = /(?<![A-Za-z0-9])(?:\d[ -]?){12,18}\d(?![A-Za-z0-9])/g;
const NFCE_KEY_RE = /(?<![A-Za-z0-9])(?:\d{4} ?){10}\d{4}(?![A-Za-z0-9])/g;

function mask(value: string): string {
  return value.length <= 4 ? '****' : `${value.slice(0, 2)}…${value.slice(-2)}`;
}

/** Regras de conteúdo aplicadas a cada linha adicionada (inclusive em fixtures). */
export function scanLine(file: string, text: string, line: number): Finding[] {
  const findings: Finding[] = [];
  for (const match of text.matchAll(EMAIL_RE)) {
    if (!emailAllowed(match[0])) {
      findings.push({
        file,
        line,
        rule: 'email',
        detail: `e-mail fora de @example.com/@example.test/noreply (${mask(match[0])})`,
      });
    }
  }
  for (const match of text.matchAll(CPF_RE)) {
    if (cpfValid(match[0])) {
      findings.push({ file, line, rule: 'cpf', detail: `CPF com DV válido (${mask(match[0])})` });
    }
  }
  for (const match of text.matchAll(CARD_RE)) {
    if (looksLikeCard(match[0])) {
      findings.push({
        file,
        line,
        rule: 'cartao',
        detail: `número que passa no Luhn (${mask(onlyDigits(match[0]))})`,
      });
    }
  }
  if (!isInFixtures(file)) {
    for (const match of text.matchAll(NFCE_KEY_RE)) {
      if (nfceKeyValid(match[0])) {
        findings.push({
          file,
          line,
          rule: 'chave-nfce',
          detail: 'chave de acesso de NFC-e com DV válido fora de fixtures/',
        });
      }
    }
  }
  return findings;
}

/** Regras de caminho e de tipo de arquivo, aplicadas a cada arquivo adicionado ou alterado. */
export function scanFile(file: string, content: string | null): Finding[] {
  const findings: Finding[] = [];
  const base = file.split('/').pop() ?? file;
  const lower = file.toLowerCase();
  const inFixtures = isInFixtures(file);
  if (base.startsWith('.env') && !ALLOWED_ENV_FILES.has(file)) {
    findings.push({ file, rule: 'env', detail: 'arquivo .env* não pode ser versionado' });
  }
  if (!inFixtures && /\.(ofx|csv)$/.test(lower)) {
    findings.push({ file, rule: 'arquivo-real', detail: 'OFX/CSV só em fixtures/ anonimizadas' });
  }
  if (
    !inFixtures &&
    /\.html?$/.test(lower) &&
    (/nfc-?e|sefaz|fazenda/i.test(file) || /nfc-?e|sefaz|fazenda\.pr/i.test(content ?? ''))
  ) {
    findings.push({ file, rule: 'arquivo-real', detail: 'HTML de NFC-e só em fixtures/' });
  }
  if (
    !inFixtures &&
    lower.endsWith('.json') &&
    /"(?:itemId|creditData|connectorId|providerId)"\s*:/.test(content ?? '')
  ) {
    findings.push({
      file,
      rule: 'arquivo-real',
      detail: 'JSON de resposta da Pluggy só em fixtures/',
    });
  }
  return findings;
}

/** Toda pasta fixtures/ precisa de um README.md que descreva a anonimização. */
export function checkFixtureReadmes(files: readonly string[]): Finding[] {
  const all = new Set(files);
  const roots = new Set<string>();
  for (const file of files) {
    const parts = file.split('/');
    const index = parts.indexOf('fixtures');
    if (index >= 0) {
      roots.add(parts.slice(0, index + 1).join('/'));
    }
  }
  const findings: Finding[] = [];
  for (const root of [...roots].sort()) {
    if (!all.has(`${root}/README.md`)) {
      findings.push({
        file: root,
        rule: 'fixtures-readme',
        detail: 'pasta fixtures/ sem README.md de anonimização',
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------- git

/** Linhas adicionadas por arquivo a partir de `git diff --unified=0`. */
export function parseAddedLines(diff: string): Map<string, AddedLine[]> {
  const result = new Map<string, AddedLine[]>();
  let current: AddedLine[] | null = null;
  let lineNo = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const path = raw.slice(4);
      if (path === '/dev/null') {
        current = null;
      } else {
        const file = path.startsWith('b/') ? path.slice(2) : path;
        current = result.get(file) ?? [];
        result.set(file, current);
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      lineNo = Number(hunk[1]);
      continue;
    }
    if (current && raw.startsWith('+')) {
      current.push({ line: lineNo, text: raw.slice(1) });
      lineNo++;
    }
  }
  return result;
}

function git(args: readonly string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function readText(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  const buffer = readFileSync(path);
  return buffer.includes(0) ? null : buffer.toString('utf8');
}

export function scanRepository(cwd: string, base: string | null): Finding[] {
  const tracked = git(['ls-files', '-z'], cwd).split('\0').filter(Boolean);
  const findings: Finding[] = [];
  let changed: string[];
  let added: Map<string, AddedLine[]>;
  if (base) {
    const range = `${base}...HEAD`;
    changed = git(['diff', '--name-only', '-z', '--diff-filter=AMR', range], cwd)
      .split('\0')
      .filter(Boolean);
    added = parseAddedLines(
      git(['diff', '--unified=0', '--no-color', '--no-ext-diff', range], cwd),
    );
  } else {
    changed = tracked;
    added = new Map();
    for (const file of tracked) {
      const text = readText(join(cwd, file));
      if (text !== null) {
        added.set(
          file,
          text.split('\n').map((line, i) => ({ line: i + 1, text: line })),
        );
      }
    }
  }
  for (const file of changed) {
    findings.push(...scanFile(file, readText(join(cwd, file))));
  }
  for (const [file, lines] of added) {
    if (readText(join(cwd, file)) === null) {
      continue; // binário ou removido
    }
    for (const { line, text } of lines) {
      findings.push(...scanLine(file, text, line));
    }
  }
  findings.push(...checkFixtureReadmes(tracked));
  return findings;
}

export function formatFinding(finding: Finding): string {
  const where = finding.line ? `${finding.file}:${finding.line}` : finding.file;
  return `${where} [${finding.rule}] ${finding.detail}`;
}

export function main(argv: readonly string[], cwd = process.cwd()): number {
  const baseIndex = argv.indexOf('--base');
  const explicitBase = baseIndex >= 0 ? argv[baseIndex + 1] : undefined;
  const base = argv.includes('--all') ? null : (explicitBase ?? 'origin/main');
  const findings = scanRepository(cwd, base);
  if (findings.length > 0) {
    console.error(
      `secrets: ${findings.length} achado(s). Repositório público: remova antes do merge.`,
    );
    for (const finding of findings) {
      console.error(`  ${formatFinding(finding)}`);
    }
    return 1;
  }
  console.log(
    `secrets: nenhum dado pessoal ou arquivo real (${base ? `diff ${base}...HEAD` : 'todos os arquivos'})`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
