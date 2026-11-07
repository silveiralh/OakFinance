// T-098 (US-05): o backup cifrado do backup.yml abre com o roteiro de restauração, e o roteiro nunca escreve
// fora de um banco local. A frase é gerada na hora; nenhum dump real entra no repositório.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/restore-backup.sh';
/** Nome da variável da frase (em constante: o gitleaks lê `NOME: valor` como senha versionada). */
const PASS = 'BACKUP_PASSPHRASE';
const WORKFLOW = readFileSync('.github/workflows/backup.yml', 'utf8');

/** Monta um backup no mesmo formato do backup.yml (tar.gz de schema.sql e data.sql, aes-256-cbc + pbkdf2). */
function fakeBackup(passphrase: string) {
  const dir = mkdtempSync(join(tmpdir(), 'oak-backup-'));
  const src = join(dir, 'src');
  execFileSync('mkdir', ['-p', src]);
  writeFileSync(join(src, 'schema.sql'), 'create table public.t (id int primary key);\n');
  writeFileSync(join(src, 'data.sql'), 'insert into public.t values (1), (2);\n');
  const tarball = join(dir, 'b.tar.gz');
  execFileSync('tar', ['-C', src, '-czf', tarball, 'schema.sql', 'data.sql']);
  const archive = join(dir, 'oakfinance-teste.tar.gz.enc');
  execFileSync(
    'openssl',
    [
      'enc',
      '-aes-256-cbc',
      '-pbkdf2',
      '-salt',
      '-pass',
      'env:BACKUP_PASSPHRASE',
      '-in',
      tarball,
      '-out',
      archive,
    ],
    {
      env: { ...process.env, [PASS]: passphrase },
    },
  );
  return { dir, archive };
}

function run(args: string[], env: Record<string, string>) {
  return spawnSync('bash', [SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

describe('restauração do backup cifrado (T-098, US-05)', () => {
  it('US-05: usa a mesma cifra do backup.yml', () => {
    expect(WORKFLOW).toContain(
      'openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE',
    );
    expect(WORKFLOW).toContain('schema.sql data.sql');
    expect(readFileSync(SCRIPT, 'utf8')).toContain(
      'openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE',
    );
  });

  it('US-05: decifra e extrai schema.sql e data.sql com a frase certa', () => {
    const passphrase = randomBytes(24).toString('base64');
    const { dir, archive } = fakeBackup(passphrase);
    const out = join(dir, 'out');
    const result = run([archive, '--decrypt-only', out], { [PASS]: passphrase });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(out, 'schema.sql'), 'utf8')).toContain('create table public.t');
    expect(readFileSync(join(out, 'data.sql'), 'utf8')).toContain('insert into public.t');
  });

  it('US-05: frase errada falha sem extrair nada', () => {
    const { dir, archive } = fakeBackup(randomBytes(24).toString('base64'));
    const out = join(dir, 'out');
    const result = run([archive, '--decrypt-only', out], {
      [PASS]: randomBytes(24).toString('base64'),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('não foi possível decifrar');
    expect(spawnSync('test', ['-e', out]).status).not.toBe(0);
  });

  it('US-05: sem a frase, nem tenta', () => {
    const { archive } = fakeBackup(randomBytes(24).toString('base64'));
    const result = run([archive], { [PASS]: '' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('BACKUP_PASSPHRASE ausente');
  });

  it('US-05: recusa restaurar em banco que não é local', () => {
    const passphrase = randomBytes(24).toString('base64');
    const { archive } = fakeBackup(passphrase);
    for (const url of [
      'postgresql://postgres:x@db.example.test:5432/postgres',
      'postgres://user@10.0.0.5/postgres',
    ]) {
      const result = run([archive], { [PASS]: passphrase, DATABASE_URL: url });
      expect(result.status, url).toBe(2);
      expect(result.stderr).toContain('só restaura em banco local');
    }
  });
});
