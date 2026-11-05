import { describe, expect, it } from 'vitest';
import { NFCE_PARSER_PACKAGE } from '../src/index.ts';

describe('smoke do nfce-parser', () => {
  it('exporta a identificação do pacote', () => {
    expect(NFCE_PARSER_PACKAGE).toBe('@oakfinance/nfce-parser');
  });
});
