// Shared, renderer-independent helpers for the weekly-resetting ladder: the country list used by
// the account/flag picker, a flag-emoji renderer, and the season-id math that makes the ladder
// reset every 7 days without needing any server-side cron job (a "season" is just a fixed-width
// time bucket computed from a shared epoch - once the current instant moves into the next bucket,
// everyone's next ladder write lands in a fresh row automatically).
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LADDER_EPOCH = Date.UTC(2024, 0, 1); // arbitrary fixed Monday-ish reference, never changes

export function currentSeasonId(date = new Date()) {
  return Math.floor((date.getTime() - LADDER_EPOCH) / WEEK_MS);
}

export function seasonWindow(seasonId) {
  const start = new Date(LADDER_EPOCH + seasonId * WEEK_MS);
  const end = new Date(start.getTime() + WEEK_MS);
  return { start, end };
}

// ISO 3166-1 alpha-2 codes only - a flag emoji is just two Regional Indicator Symbols, one per
// letter, so no emoji data has to be stored or shipped at all.
export function flagEmoji(code) {
  if (!code || code.length !== 2) return '\u{1F3F3}️'; // white flag - unset/unknown
  const upper = code.toUpperCase();
  const base = 0x1F1E6 - 65; // regional indicator 'A' minus ASCII 'A'
  return [...upper].map(ch => String.fromCodePoint(base + ch.charCodeAt(0))).join('');
}

// A practical subset (not the full ISO-3166 list) covering the regions this game's players are
// most likely to come from - keeps the <select> short instead of dumping 195 entries on it.
export const COUNTRY_LIST = [
  ['SA', 'Saudi Arabia'], ['AE', 'United Arab Emirates'], ['QA', 'Qatar'], ['KW', 'Kuwait'],
  ['BH', 'Bahrain'], ['OM', 'Oman'], ['EG', 'Egypt'], ['JO', 'Jordan'], ['IQ', 'Iraq'],
  ['ES', 'Spain'], ['PT', 'Portugal'], ['FR', 'France'], ['IT', 'Italy'], ['DE', 'Germany'],
  ['GB', 'United Kingdom'], ['IE', 'Ireland'], ['NL', 'Netherlands'], ['BE', 'Belgium'],
  ['CH', 'Switzerland'], ['AT', 'Austria'], ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'],
  ['FI', 'Finland'], ['PL', 'Poland'], ['CZ', 'Czechia'], ['GR', 'Greece'], ['TR', 'Turkey'],
  ['RU', 'Russia'], ['UA', 'Ukraine'], ['RO', 'Romania'],
  ['US', 'United States'], ['CA', 'Canada'], ['MX', 'Mexico'], ['BR', 'Brazil'],
  ['AR', 'Argentina'], ['CL', 'Chile'], ['CO', 'Colombia'], ['PE', 'Peru'],
  ['CN', 'China'], ['JP', 'Japan'], ['KR', 'South Korea'], ['IN', 'India'], ['PK', 'Pakistan'],
  ['ID', 'Indonesia'], ['PH', 'Philippines'], ['VN', 'Vietnam'], ['TH', 'Thailand'],
  ['AU', 'Australia'], ['NZ', 'New Zealand'],
  ['ZA', 'South Africa'], ['MA', 'Morocco'], ['DZ', 'Algeria'], ['TN', 'Tunisia'], ['NG', 'Nigeria']
];
