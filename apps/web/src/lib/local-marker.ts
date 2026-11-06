// G08 (US-05): marca, fora do IndexedDB, que este aparelho já teve a cópia local do usuário. Se a marca existe e o
// banco local abre vazio (cursor 0), o sistema apagou a cópia. O "Sair" apaga o banco e a marca juntos.
const KEY = 'oak.localData';

function read(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // armazenamento bloqueado: sem marca, o G08 não aparece (o pull do zero continua)
  }
}

export function markLocalData(userId: string): void {
  const ids = read();
  if (!ids.includes(userId)) {
    write([...ids, userId]);
  }
}

export function hadLocalData(userId: string): boolean {
  return read().includes(userId);
}

export function clearLocalData(userId: string): void {
  write(read().filter((id) => id !== userId));
}
