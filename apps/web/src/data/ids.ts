// IDs criados no aparelho (tech §4.3): UUID v7 para tudo que o usuário cria e para o `mutation_id`.
import { v7 } from 'uuid';

export function newId(): string {
  return v7();
}
