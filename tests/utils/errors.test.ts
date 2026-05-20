import { Errors } from '../../srv/utils/errors';

test('HANA_CONNECTION returns error with status 503', () => {
  const err = Errors.HANA_CONNECTION();
  expect(err.message).toContain('HANA');
  expect((err as any).statusCode ?? (err as any).status).toBe(503);
});

test('INVALID_PROVIDER includes provider name in message', () => {
  const err = Errors.INVALID_PROVIDER('unknown');
  expect(err.message).toContain('unknown');
});

test('PROMPT_NOT_FOUND includes step and lang in message', () => {
  const err = Errors.PROMPT_NOT_FOUND('view_selection', 'ja');
  expect(err.message).toContain('view_selection');
  expect(err.message).toContain('ja');
});
