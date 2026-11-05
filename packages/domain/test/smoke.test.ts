import { describe, expect, it } from 'vitest';
import { BUSINESS_TIME_ZONE, DOMAIN_PACKAGE } from '../src/index.ts';

describe('smoke do domínio', () => {
  it('exporta a identificação do pacote', () => {
    expect(DOMAIN_PACKAGE).toBe('@oakfinance/domain');
  });

  it('usa o fuso America/Sao_Paulo nas datas de negócio', () => {
    expect(BUSINESS_TIME_ZONE).toBe('America/Sao_Paulo');
  });
});
