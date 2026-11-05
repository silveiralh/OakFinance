import assert from 'node:assert/strict';
import { AppError, ERRORS, errorBody, isErrorCode } from './errors.ts';

Deno.test('errorBody usa o formato { error: { code, message } }', () => {
  assert.deepEqual(errorBody('NOT_FOUND'), {
    error: { code: 'NOT_FOUND', message: ERRORS.NOT_FOUND.message },
  });
  assert.deepEqual(errorBody('BAD_REQUEST', 'campo x'), {
    error: { code: 'BAD_REQUEST', message: 'campo x' },
  });
});

Deno.test('códigos são estáveis, em caixa alta e com status HTTP de erro', () => {
  for (const [code, { status, message }] of Object.entries(ERRORS)) {
    assert.match(code, /^[A-Z][A-Z_]+$/);
    assert.ok(status >= 400 && status <= 599, code);
    assert.doesNotMatch(message, /!|\p{Extended_Pictographic}/u);
  }
});

Deno.test('isErrorCode reconhece só códigos conhecidos', () => {
  assert.equal(isErrorCode('INTERNAL'), true);
  assert.equal(isErrorCode('toString'), false);
  assert.equal(isErrorCode(42), false);
});

Deno.test('AppError carrega código e status', () => {
  const error = new AppError('RATE_LIMITED');
  assert.equal(error.code, 'RATE_LIMITED');
  assert.equal(error.status, 429);
  assert.equal(error.message, ERRORS.RATE_LIMITED.message);
  assert.equal(new AppError('FORBIDDEN', 'outra').message, 'outra');
});
