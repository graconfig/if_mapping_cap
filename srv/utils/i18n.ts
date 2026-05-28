import { readFileSync } from 'fs';
import { join } from 'path';

type Messages = Record<string, string>;

const _cache = new Map<string, Messages>();

function load(lang: string): Messages {
  if (_cache.has(lang)) return _cache.get(lang)!;
  const file = join(process.cwd(), 'srv', 'i18n', `messages_${lang}.json`);
  try {
    const msgs = JSON.parse(readFileSync(file, 'utf-8')) as Messages;
    _cache.set(lang, msgs);
    return msgs;
  } catch {
    if (lang !== 'ja') return load('ja');
    return {};
  }
}

export function t(key: string, lang: string, vars?: Record<string, string>): string {
  const msgs = load(lang);
  let text = msgs[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.split(`{${k}}`).join(v);
    }
  }
  return text;
}
