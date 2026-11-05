/**
 * Languages used on a country's own signs and maps, besides English, which is always offered. Contributors: keep to the
 * languages most places there are named in, as a person choosing a label language would expect to find them.
 */
const SPOKEN_IN = Object.fromEntries(`
AD:ca AE:ar AF:fa,ps AL:sq AM:hy AO:pt AR:es AT:de AZ:az BA:bs BD:bn BE:nl,fr,de BF:fr BG:bg BH:ar BI:fr BJ:fr BN:ms BO:es
BR:pt BT:dz BY:be,ru CA:fr CD:fr CF:fr CG:fr CH:de,fr,it CI:fr CL:es CM:fr CN:zh CO:es CR:es CU:es CV:pt CY:el,tr CZ:cs DE:de
DJ:fr,ar DK:da DO:es DZ:ar EC:es EE:et EG:ar ER:ti,ar ES:es ET:am FI:fi,sv FO:fo FR:fr GA:fr GE:ka GF:fr GL:kl GN:fr GP:fr
GQ:es GR:el GT:es GW:pt HK:zh-Hant HN:es HR:hr HT:fr HU:hu ID:id IL:he,ar IN:hi IQ:ar IR:fa IS:is IT:it JO:ar JP:ja KG:ky,ru
KH:km KM:ar,fr KP:ko KR:ko KW:ar KZ:kk,ru LA:lo LB:ar LI:de LK:si,ta LT:lt LU:fr,de,lb LV:lv LY:ar MA:ar,fr MC:fr MD:ro ME:sr
MG:mg,fr MK:mk ML:fr MM:my MN:mn MO:zh-Hant,pt MQ:fr MR:ar MT:mt MV:dv MX:es MY:ms MZ:pt NC:fr NE:fr NI:es NL:nl NO:no NP:ne
OM:ar PA:es PE:es PF:fr PH:fil PK:ur PL:pl PR:es PS:ar PT:pt PY:es QA:ar RE:fr RO:ro RS:sr RU:ru RW:rw,fr SA:ar SD:ar SE:sv
SG:zh,ms,ta SI:sl SK:sk SM:it SN:fr SO:so,ar SR:nl SV:es SY:ar TD:fr,ar TG:fr TH:th TJ:tg,ru TL:pt TM:tk TN:ar,fr TR:tr
TW:zh-Hant TZ:sw UA:uk UY:es UZ:uz VA:it VE:es VN:vi YE:ar YT:fr
`.trim().split(/\s+/).map(entry => {
  const [country, languages] = entry.split(':') as [string, string];
  return [country, languages.split(',')];
}));

const ENGLISH_ONLY: readonly string[] = [];

/** The same array for the same country, so that it can be compared to tell when the country's languages have changed. */
export function languagesOfCountry(country: string | null): readonly string[] {
  return (country && SPOKEN_IN[country]) || ENGLISH_ONLY;
}

/** The reader's own language, in the form map names use. It is only read here, and goes nowhere. */
export function readerLanguage(tag: string = navigator.language): string {
  const { language, script, region } = new Intl.Locale(tag);
  if (language === 'zh') return script === 'Hant' || (region && ['TW', 'HK', 'MO'].includes(region)) ? 'zh-Hant' : 'zh';
  return language === 'nb' || language === 'nn' ? 'no' : language;
}

/** English, then the languages of the place on the map, then the reader's own. */
export function languageOptions(local: readonly string[], reader: string): string[] {
  return [...new Set(['en', ...local, reader])];
}

/** Each language in its own words, so a reader can always find theirs. */
export function languageName(code: string): string {
  const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
}
