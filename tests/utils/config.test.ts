import { buildRequestConfig } from '../../srv/utils/config';

test('buildRequestConfig uses request parameters', () => {
  const cfg = buildRequestConfig('openai', 'en');
  expect(cfg.provider).toBe('openai');
  expect(cfg.language).toBe('en');
});

test('buildRequestConfig defaults to claude/ja when empty strings passed', () => {
  const cfg = buildRequestConfig('', '');
  expect(cfg.provider).toBe('claude');
  expect(cfg.language).toBe('ja');
});

test('buildRequestConfig has numeric defaults', () => {
  const cfg = buildRequestConfig('claude', 'ja');
  expect(cfg.batchSize).toBeGreaterThan(0);
  expect(cfg.vectorThreshold).toBeGreaterThan(0);
  expect(cfg.vectorThreshold).toBeLessThanOrEqual(1);
});
