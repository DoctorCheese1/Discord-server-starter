const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isIdracOnlyMode() {
  const raw = (process.env.IDRAC_ONLY_MODE || '').trim().toLowerCase();
  return TRUE_VALUES.has(raw);
}

