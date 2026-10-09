export const GENERIC_OPTION_NAME = 'Outro';

const GENERIC_OPTION_ALIASES = ['outro', 'outros'];

export function isGenericOptionName(name: string): boolean {
  return GENERIC_OPTION_ALIASES.includes(name.trim().toLowerCase());
}
