import { t } from '../../srv/utils/i18n';

test('returns key as fallback when key not found', () => {
  expect(t('nonexistent.key', 'zh')).toBe('nonexistent.key');
});

test('returns zh translation', () => {
  expect(t('error.hana_connection', 'zh')).toBe('HANA 连接失败');
});

test('returns ja translation', () => {
  expect(t('error.hana_connection', 'ja')).toBe('HANA 接続に失敗しました');
});

test('interpolates {placeholder} variables', () => {
  expect(t('error.invalid_provider', 'zh', { p: 'grok' })).toBe('未知的 Provider: grok');
});

test('interpolates multiple placeholders in ja', () => {
  expect(t('error.prompt_not_found', 'ja', { step: 'view_selection', lang: 'en' }))
    .toBe('ステップ "view_selection" 言語 "en" のアクティブなプロンプトが見つかりません');
});

test('falls back to ja when unknown lang requested', () => {
  const result = t('error.hana_connection', 'fr');
  expect(result).toBe('HANA 接続に失敗しました');
});
