/**
 * Country list for shipping address form.
 * Uses Intl.DisplayNames for locale-aware country names.
 * Top shipping countries first, then the rest alphabetical.
 */
export interface Country {
  code: string;
  name: string;
}

const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** ISO codes in display order: popular shipping destinations first. */
const COUNTRY_CODES = [
  'US', 'CA', 'GB', 'AU',
  'DE', 'FR', 'NL', 'SE', 'NO', 'DK', 'FI', 'IE', 'NZ',
  'AT', 'BE', 'CH', 'CZ', 'ES', 'IT', 'JP', 'KR', 'MX',
  'PL', 'PT', 'SG', 'ZA', 'BR', 'IN', 'HK', 'TW',
] as const;

export const COUNTRIES: Country[] = COUNTRY_CODES.map(code => ({
  code,
  name: displayNames.of(code)!,
}));
