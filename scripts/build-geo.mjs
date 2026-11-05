import { createReadStream } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { normalize } from '../src/search/normalize.ts';
import { readLandmarks } from './osm-landmarks.mjs';

const LANDMARK_CODES = new Set('MUS CSTL MNMT TOWR LTHSE RUIN TMPL PAL HSTS ANS BDG STDM ZOO PYR MT PK VLC CNYN ISL LK FLLS GLCR PRK RESN BLDG WALL WALLA MTS HBR GRGE BAY CAPE AMUS GDN SQR SHRN GATE OBS CH RLG'.split(' '));
const CITY_CENTRES = new Set(['PPLC', 'PPLA', 'PPLG']);
const EXCLUDED_CITIES = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW']);
const NON_LANGUAGES = new Set(['link', 'post', 'iata', 'icao', 'faac', 'abbr', 'wkdt', 'unlc', '']);
const SIMPLIFIED_LANGUAGES = new Set(['zh', 'zh-CN', 'zh-Hans', 'zh-SG']);
const TRADITIONAL_LANGUAGES = new Set(['zh-TW', 'zh-Hant', 'zh-HK']);
const hasHan = text => /\p{Script=Han}/u.test(text);
// Japanese names may stand in for Chinese only when written purely in kanji (広島, not ケベック州).
const isKanjiOnly = text => hasHan(text) && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);

export function parseFeatureLine(line) {
  const fields = line.split('\t');
  const feature = {
    id: Number(fields[0]), name: fields[1] ?? '', ascii: fields[2] ?? '',
    lat: Number(fields[4]), lon: Number(fields[5]), featureClass: fields[6],
    featureCode: fields[7], cc: fields[8] ?? '', admin1: fields[10] ?? '',
    population: Number(fields[14]) || 0,
  };
  if (fields.length < 19 || !Number.isSafeInteger(feature.id) || feature.id <= 0
    || !fields[4] || !fields[5] || !Number.isFinite(feature.lat) || Math.abs(feature.lat) > 90
    || !Number.isFinite(feature.lon) || Math.abs(feature.lon) > 180) return null;
  return feature;
}

export function isCity(feature) {
  return feature.featureClass === 'P' && !EXCLUDED_CITIES.has(feature.featureCode)
    && (feature.population >= 1000 || CITY_CENTRES.has(feature.featureCode));
}

export function isLandmark(feature, hasWikipedia) {
  return LANDMARK_CODES.has(feature.featureCode) && hasWikipedia;
}

export function parseAlternateLine(line) {
  const fields = line.split('\t');
  return {
    id: Number(fields[1]), language: fields[2] ?? '', name: fields[3] ?? '',
    preferred: fields[4] === '1', colloquial: fields[6] === '1', historic: fields[7] === '1',
  };
}

function chinesePriority(alternate) {
  if (SIMPLIFIED_LANGUAGES.has(alternate.language)) return alternate.preferred ? 0 : 1;
  if (TRADITIONAL_LANGUAGES.has(alternate.language)) return 2;
  if (alternate.language === '' && hasHan(alternate.name)) return 3;
  if (alternate.language === 'yue' || alternate.language === 'wuu') return 4;
  if (alternate.language === 'ja' && isKanjiOnly(alternate.name)) return 5;
  return Infinity;
}

function emptyNames() {
  return { zh: '', zhPriority: Infinity, buckets: Array.from({ length: 6 }, () => []), languages: new Set(), hasWikipedia: false };
}

function addAlternate(summary, alternate, primaryLanguage) {
  if (!alternate.name || alternate.historic || alternate.colloquial) return;
  if (alternate.language === 'link' && alternate.name.includes('wikipedia.org')) summary.hasWikipedia = true;
  if (!NON_LANGUAGES.has(alternate.language)) summary.languages.add(alternate.language);
  const priority = chinesePriority(alternate);
  if (priority < summary.zhPriority) {
    summary.zh = alternate.name;
    summary.zhPriority = priority;
  }
  const buckets = [];
  if (alternate.language === 'en') buckets.push(alternate.preferred ? 0 : 1);
  if (alternate.language === 'ja') buckets.push(alternate.preferred ? 2 : 3);
  if (/^zh(?:-|$)/u.test(alternate.language) || (alternate.language === '' && hasHan(alternate.name))) buckets.push(4);
  if (primaryLanguage && alternate.language === primaryLanguage) buckets.push(5);
  for (const index of buckets) {
    const bucket = summary.buckets[index];
    // Ten output aliases plus the two possible exclusions (name and zh) suffice.
    if (bucket.length < 12 && !bucket.includes(alternate.name)) bucket.push(alternate.name);
  }
}

/** Aliases that normalize alike (Montréal/Montreal, Tōkyō/Tokyo, 東京/东京) add bytes but never a new match. */
export function uniqueByNormalized(names, taken) {
  const keys = new Set(taken.filter(Boolean).map(normalize));
  return names.filter(name => {
    const key = name ? normalize(name) : '';
    if (!key || keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

function namesFromSummary(feature, summary) {
  const zh = summary?.zh ?? '';
  const alt = uniqueByNormalized([feature.ascii, ...(summary?.buckets.flat() ?? [])], [feature.name, zh]).slice(0, 10);
  return { name: feature.name, zh, alt };
}

export function selectNames(feature, alternates, primaryLanguage = '') {
  const summary = emptyNames();
  for (const alternate of alternates) addAlternate(summary, alternate, primaryLanguage);
  return namesFromSummary(feature, summary);
}

export function cityRank(population) {
  return Math.min(100, Math.round(12 * Math.log10(Math.max(0, population) + 1)));
}

/** Logarithmic so famous landmarks (50–150 languages) stay distinguishable instead of capping at 100. */
export function landmarkRank(languages) {
  const count = new Set([...languages].filter(language => !NON_LANGUAGES.has(language))).size;
  return Math.min(100, Math.round(40 * Math.log10(1 + count)));
}

export function sphericalDistance(a, b) {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

export function nearestCity(feature, cities) {
  const national = cities.filter(city => city.cc === feature.cc);
  const regional = feature.admin1 ? national.filter(city => city.admin1 === feature.admin1) : [];
  let closest = 0;
  let distance = Infinity;
  for (const city of regional.length ? regional : national) {
    const candidateDistance = sphericalDistance(feature, city);
    if (candidateDistance < distance) {
      distance = candidateDistance;
      closest = city.id;
    }
  }
  return closest;
}

export function placeTuple(place, cityId) {
  const tuple = [place.id, place.name ?? '', place.zh ?? '', Number(place.lat.toFixed(5)), Number(place.lon.toFixed(5)),
    place.kind, place.cc, place.admin1 ?? '', place.rank, place.alt ?? []];
  if (cityId !== undefined) tuple.push(cityId);
  return tuple;
}

export function communityLanguage(filename) {
  if (!/^[a-z]{2,3}\.tsv$/u.test(filename)) throw new Error(`${filename}:1: filename must be a lowercase 2–3 letter language code followed by .tsv`);
  return filename.slice(0, -4);
}

export function parseCommunityLine(line, filename, lineNumber, seen) {
  const fail = message => { throw new Error(`${filename}:${lineNumber}: ${message}`); };
  if (line.includes('\uFFFD')) fail('invalid UTF-8 or replacement character');
  if (lineNumber === 1) line = line.replace(/^\uFEFF/u, '');
  if (line.startsWith('#') || line.trim() === '') return null;
  const fields = line.split('\t');
  if (fields.length < 2 || fields.length > 3) fail('expected id<TAB>name[<TAB>note]');
  if (!/^[1-9]\d*$/u.test(fields[0]) || !Number.isSafeInteger(Number(fields[0]))) fail('id must be a positive integer');
  if (!fields[1] || fields[1].trim() !== fields[1] || fields[1].includes('\t')) fail('name must be nonempty with no surrounding whitespace or tabs');
  const key = `${Number(fields[0])}\t${fields[1]}`;
  if (seen.has(key)) fail('duplicate id + name');
  seen.add(key);
  return { id: Number(fields[0]), name: fields[1] };
}

export function parseCommunityNames(source, filename) {
  const language = communityLanguage(filename);
  const seen = new Set();
  const entries = source.toString('utf8').split(/\r?\n/u)
    .map((line, index) => parseCommunityLine(line, filename, index + 1, seen)).filter(Boolean);
  return { filename, language, entries };
}

export function mergeCommunityNames(places, files) {
  const supplements = new Map();
  const selectedIds = new Set(places.map(place => place.id));
  const stats = files.map(file => {
    let applied = 0;
    for (const entry of file.entries) {
      if (!selectedIds.has(entry.id)) continue;
      applied += 1;
      let supplement = supplements.get(entry.id);
      if (!supplement) supplements.set(entry.id, supplement = { zh: undefined, alt: [] });
      if (file.language === 'zh' && supplement.zh === undefined) supplement.zh = entry.name;
      else supplement.alt.push(entry.name);
    }
    return { file: file.filename, entries: file.entries.length, applied, skipped: file.entries.length - applied };
  });
  return {
    places: places.map(place => {
      const supplement = supplements.get(place.id);
      if (!supplement) return place;
      const zh = supplement.zh ?? place.zh;
      // A displaced GeoNames display name remains searchable as an ordinary alias.
      const regular = [place.zh, ...place.alt].filter(name => name && name !== zh && name !== place.name).slice(0, 10);
      const alt = uniqueByNormalized([...supplement.alt, ...regular], [place.name, zh]);
      return { ...place, zh, alt };
    }), stats,
  };
}

/** OSM separates several values of one tag with a semicolon: 大阪城;大阪城天守阁. */
export function tagValues(value) {
  return String(value ?? '').split(';').map(part => part.trim()).filter(Boolean);
}

/** One OSM record as a place. `name` is Latin where there is one, as with GeoNames: the app shows it outside Chinese. */
export function osmPlace(record, id, region) {
  const extra = [];
  const first = (value) => {
    const [head, ...rest] = tagValues(value);
    extra.push(...rest);
    return head;
  };
  const local = first(record.name);
  const names = Object.fromEntries(Object.entries(record.names).map(([language, value]) => [language, first(value)]));
  const name = names.en ?? local;
  const zh = names['zh-Hans'] ?? names['zh-Hant'] ?? (isKanjiOnly(local) && !/\p{Script=Hangul}/u.test(local) ? local : '');
  return {
    id, name, zh, lat: record.lat, lon: record.lon, cc: region.cc, admin1: region.admin1,
    kind: { peak: 'PK', village: 'AREA' }[record.kind] ?? 'LMK',
    rank: landmarkRank(Object.keys(names)),
    alt: uniqueByNormalized([local, names['zh-Hant'], names.ja, names.ko, ...extra].filter(Boolean), [name, zh]).slice(0, 10),
  };
}

/**
 * OSM points carry no country or province, so a landmark takes them from the GeoNames features around it, of any class.
 * Cities alone are too sparse: the closest one to Macau's Ruins of St. Paul's is across the border in Zhuhai. The five
 * closest vote, because GeoNames files a few places in Macau under China.
 */
function regionFinder(features, cities) {
  const cell = (lat, lon) => `${Math.floor(lat * 10)},${Math.floor(lon * 10)}`;
  const grid = Map.groupBy(features, feature => cell(feature.lat, feature.lon));
  const closest = (point, pool, count) => {
    const cos = Math.cos(point.lat * Math.PI / 180);
    const found = [];
    for (const feature of pool) {
      const distance = (feature.lat - point.lat) ** 2 + ((feature.lon - point.lon) * cos) ** 2;
      if (found.length === count && distance >= found[count - 1].distance) continue;
      found.push({ feature, distance });
      found.sort((a, b) => a.distance - b.distance);
      found.length = Math.min(found.length, count);
    }
    return found.map(({ feature }) => feature);
  };
  const around = (point) => {
    for (const reach of [1, 3, 10, 30]) {
      const pool = [];
      for (let lat = -reach; lat <= reach; lat++) {
        for (let lon = -reach; lon <= reach; lon++) {
          const features = grid.get(cell(point.lat + lat / 10, point.lon + lon / 10));
          if (features) pool.push(...features);
        }
      }
      if (pool.length) return pool;
    }
    return features;  // A remote island: 南鸟岛.
  };
  const province = admin1 => admin1 && admin1 !== '00';
  return (point) => {
    const voters = closest(point, around(point), 5);
    const votes = Map.groupBy(voters, feature => feature.cc);
    // Most votes; on a tie, the country of the closest. Map keeps the order in which the countries first voted.
    const [cc] = [...votes].reduce((best, entry) => entry[1].length > best[1].length ? entry : best);
    const admin1 = voters.find(feature => feature.cc === cc && province(feature.admin1))?.admin1
      ?? closest(point, cities.filter(city => city.cc === cc), 1)[0]?.admin1 ?? '';
    return { cc, admin1 };
  };
}

const namesOf = place => [place.name, place.zh, ...place.alt].filter(Boolean).map(normalize);

/**
 * OSM's landmarks, with its points and names, since the map labels come from the same data. A GeoNames landmark of the
 * same name nearby adds its aliases and its more specific type. The rest of GeoNames stays: harbours, ranges, walls.
 */
export function mergeOsmLandmarks(records, geonames, features, cities, communityNames = new Set()) {
  const regionOf = regionFinder(features, cities);
  const within = (a, b, km) => sphericalDistance(a, b) < km * 1000;
  const areaOf = (lat, lon) => `${Math.floor(lat * 10)},${Math.floor(lon * 10)}`;
  const byName = new Map();
  const byArea = new Map();
  const osm = [];
  let id = 1_000_000_000;  // Clear of GeoNames ids.
  for (const record of records) {
    const place = osmPlace(record, id, regionOf(record));
    const keys = [...new Set(namesOf(place))];
    // The same place mapped twice, as a point and an area or as two parts of one site.
    const twin = keys.flatMap(key => byName.get(key) ?? []).find(other => within(other, place, 1));
    if (twin) {
      twin.rank = Math.max(twin.rank, place.rank);
      continue;
    }
    id += 1;
    osm.push(place);
    for (const key of keys) byName.set(key, [...byName.get(key) ?? [], place]);
    const area = areaOf(place.lat, place.lon);
    byArea.set(area, [...byArea.get(area) ?? [], place]);
  }
  const kept = [];
  for (const feature of geonames) {
    const wanted = namesOf(feature);
    let match = wanted.flatMap(key => byName.get(key) ?? []).find(place => within(place, feature, 5));
    if (!match) {
      // One name inside the other, close by: 金龙山浅草寺 and 浅草寺.
      const row = Math.floor(feature.lat * 10), column = Math.floor(feature.lon * 10);
      const close = [];
      for (let dRow = -1; dRow <= 1; dRow++) {
        for (let dColumn = -1; dColumn <= 1; dColumn++) close.push(...byArea.get(`${row + dRow},${column + dColumn}`) ?? []);
      }
      match = close.filter(place => within(place, feature, 1)).find(place => namesOf(place).some(key => wanted.some((alias) => {
        const [short, long] = key.length < alias.length ? [key, alias] : [alias, key];
        return short.length >= 3 && long.includes(short);
      })));
    }
    if (!match) {
      kept.push(feature);
      continue;
    }
    match.rank = Math.max(match.rank, feature.rank);
    if (match.kind === 'LMK' || match.kind === 'PK') match.kind = feature.kind;
    if (feature.zh && (!match.zh || communityNames.has(feature.id))) match.zh = feature.zh;
    match.alt = uniqueByNormalized([...match.alt, feature.name, feature.zh, ...feature.alt].filter(Boolean), [match.name, match.zh]).slice(0, 10);
  }
  return [...osm, ...kept];
}


export async function main(args = process.argv.slice(2)) {
  const options = { input: resolve('data-downloads/geonames'), output: resolve('public/geo-2026'), landmarks: null, countries: null, minimumPopulation: 5000, maximumLandmarks: 40000, checkNames: false };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--check-names') { options.checkNames = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    if (key === '--in') options.input = resolve(value);
    else if (key === '--out') options.output = resolve(value);
    else if (key === '--landmarks') options.landmarks = resolve(value);
    else if (key === '--countries') {
      const codes = value.split(',');
      if (codes.some(code => !/^[A-Z]{2}$/u.test(code))) throw new Error('--countries must contain uppercase country codes separated by commas');
      options.countries = new Set(codes);
    } else if (key === '--major-min-population' || key === '--major-landmarks') {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${key} must be a nonnegative integer`);
      options[key === '--major-min-population' ? 'minimumPopulation' : 'maximumLandmarks'] = number;
    } else throw new Error(`Unknown option ${key}`);
  }

  async function* lines(path) {
    const input = createReadStream(path, { encoding: 'utf8' });
    const reader = createInterface({ input, crlfDelay: Infinity });
    try { yield* reader; } finally { reader.close(); input.destroy(); }
  }

  const namesDirectory = fileURLToPath(new URL('../data/place-names/', import.meta.url));
  const nameFiles = [];
  for (const file of (await readdir(namesDirectory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const language = communityLanguage(file.name);
    if (!file.isFile()) throw new Error(`${file.name}:1: expected a TSV file`);
    const entries = [];
    const seen = new Set();
    let number = 0;
    for await (const line of lines(join(namesDirectory, file.name))) {
      const entry = parseCommunityLine(line, file.name, ++number, seen);
      if (entry) entries.push(entry);
    }
    nameFiles.push({ filename: file.name, language, entries });
  }
  if (options.checkNames) {
    for (const file of nameFiles) console.log(`${file.filename}: ${file.entries.length} valid entries`);
    console.log('Community place names are valid.');
    return;
  }

  const started = performance.now();
  const countryInfo = new Map();
  for await (const line of lines(join(options.input, 'countryInfo.txt'))) {
    if (!line || line.startsWith('#')) continue;
    const fields = line.split('\t');
    if (!options.countries || options.countries.has(fields[0])) countryInfo.set(fields[0], {
      code: fields[0], continent: fields[8] ?? '', name: fields[4] ?? '', primaryLanguage: (fields[15] ?? '').split(',')[0].split('-')[0],
    });
  }
  const admins = [];
  const candidateIds = new Set();
  for await (const line of lines(join(options.input, 'admin1CodesASCII.txt'))) {
    if (!line) continue;
    const [key, name, ascii, rawId] = line.split('\t');
    const [cc, admin1] = key.split('.');
    if (!countryInfo.has(cc)) continue;
    const id = Number(rawId);
    admins.push({ id, name: name ?? '', ascii: ascii ?? '', cc, admin1 });
    candidateIds.add(id);
  }
  const featureFiles = options.countries ? [...options.countries].map(cc => `${cc}.txt`) : ['allCountries.txt'];
  const candidates = new Map();
  const regions = [];
  let readFeatures = 0;
  let invalidFeatures = 0;
  for (const filename of featureFiles) {
    for await (const line of lines(join(options.input, filename))) {
      if (!line) continue;
      readFeatures += 1;
      const feature = parseFeatureLine(line);
      if (!feature) { invalidFeatures += 1; continue; }
      if (options.landmarks && countryInfo.has(feature.cc)) {
        regions.push({ lat: feature.lat, lon: feature.lon, cc: feature.cc, admin1: feature.admin1 });
      }
      if (!countryInfo.has(feature.cc) || (!isCity(feature) && !LANDMARK_CODES.has(feature.featureCode))) continue;
      candidates.set(feature.id, feature);
      candidateIds.add(feature.id);
    }
  }
  const candidateCountries = new Map([...admins, ...candidates.values()].map(place => [place.id, place.cc]));
  const nameSummaries = new Map();
  const alternateFiles = options.countries ? [...options.countries].map(cc => join('alternatenames', `${cc}.txt`)) : ['alternateNamesV2.txt'];
  let readAlternates = 0;
  for (const filename of alternateFiles) {
    for await (const line of lines(join(options.input, filename))) {
      if (!line) continue;
      readAlternates += 1;
      // Avoid splitting irrelevant long rows in the global alternate-names dump.
      const firstTab = line.indexOf('\t');
      const secondTab = line.indexOf('\t', firstTab + 1);
      const id = Number(line.slice(firstTab + 1, secondTab));
      if (!candidateIds.has(id)) continue;
      let summary = nameSummaries.get(id);
      if (!summary) nameSummaries.set(id, summary = emptyNames());
      addAlternate(summary, parseAlternateLine(line), countryInfo.get(candidateCountries.get(id))?.primaryLanguage ?? '');
    }
  }
  const selected = [];
  for (const feature of candidates.values()) {
    const summary = nameSummaries.get(feature.id);
    const city = isCity(feature);
    if (!city && !isLandmark(feature, summary?.hasWikipedia ?? false)) continue;
    selected.push({ ...feature, ...namesFromSummary(feature, summary), kind: city ? 'city' : feature.featureCode,
      rank: city ? cityRank(feature.population) : landmarkRank(summary.languages) });
  }
  const namedAdmins = admins.map(admin => ({ ...admin, ...namesFromSummary(admin, nameSummaries.get(admin.id)) }));
  const merged = mergeCommunityNames([...selected, ...namedAdmins], nameFiles);
  const places = merged.places.slice(0, selected.length);
  const adminPlaces = merged.places.slice(selected.length);
  // Release candidate-only state before JSON serialization and compression.
  candidates.clear(); candidateIds.clear(); candidateCountries.clear(); nameSummaries.clear();
  const version = basename(options.output);
  const byId = (a, b) => a.id - b.id;
  const cities = places.filter(place => place.kind === 'city');
  const geonamesLandmarks = places.filter(place => place.kind !== 'city');
  const communityNames = new Set(nameFiles.filter(file => file.language === 'zh').flatMap(file => file.entries.map(entry => entry.id)));
  const landmarks = (options.landmarks
    ? mergeOsmLandmarks(await readLandmarks(options.landmarks), geonamesLandmarks, regions, cities, communityNames)
    : geonamesLandmarks).sort((a, b) => b.rank - a.rank || byId(a, b));
  const majorCities = cities.filter(city => city.population >= options.minimumPopulation || CITY_CENTRES.has(city.featureCode));
  const majorPlaces = [...majorCities, ...landmarks.slice(0, options.maximumLandmarks)].sort(byId);
  const availableCountries = [...new Set([...cities, ...landmarks].map(place => place.cc))].sort();
  await mkdir(join(options.output, 'country'), { recursive: true });
  const report = [];
  async function writeJson(filename, value, entries, budget = Infinity) {
    const json = JSON.stringify(value);
    const bytes = Buffer.byteLength(json);
    const gzipBytes = gzipSync(json).byteLength;
    await writeFile(join(options.output, filename), json, 'utf8');
    report.push({ file: filename, entries, bytes, gzipBytes });
    if (gzipBytes > budget) console.warn(`WARNING: ${filename} gzip ${gzipBytes} bytes exceeds target ${budget} bytes`);
  }
  await writeJson('countries.json', { version, generated: new Date().toISOString().slice(0, 10), source: options.landmarks ? 'GeoNames, CC BY 4.0; OpenStreetMap contributors, ODbL' : 'GeoNames, CC BY 4.0', countries: availableCountries.map(code => {
    const { continent, name } = countryInfo.get(code);
    return { code, continent, name, file: `country/${code}.json` };
  }) }, availableCountries.length);
  await writeJson('major.json', { version, admin1: Object.fromEntries(adminPlaces.filter(admin => availableCountries.includes(admin.cc))
    .map(admin => [`${admin.cc}.${admin.admin1}`, [admin.name, admin.zh]])), places: majorPlaces.map(place => placeTuple(place)) }, majorPlaces.length, 2_000_000);
  for (const cc of availableCountries) {
    const countryPlaces = [...cities, ...landmarks].filter(place => place.cc === cc).sort(byId);
    const countryCities = cities.filter(city => city.cc === cc);
    await writeJson(`country/${cc}.json`, { version, code: cc,
      admin1: adminPlaces.filter(admin => admin.cc === cc).sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id - b.id)
        .map(admin => [admin.admin1, admin.name, admin.zh]),
      places: countryPlaces.map(place => placeTuple(place, place.kind === 'city' ? 0 : nearestCity(place, countryCities))),
    }, countryPlaces.length, 1_000_000);
  }
  console.table(report);
  console.log(`Read ${readFeatures} features (${invalidFeatures} invalid), ${readAlternates} alternate names; selected ${cities.length} cities, ${landmarks.length} landmarks and ${adminPlaces.length} admin1 entries.`);
  console.log(`Top landmarks: ${landmarks.slice(0, 10).map(place => `${place.name} (${place.cc}, ${place.kind}, rank ${place.rank})`).join('; ')}`);
  console.log(`Top cities: ${cities.toSorted((a, b) => b.population - a.population || byId(a, b)).slice(0, 10).map(place => `${place.name} (${place.cc}, population ${place.population}, rank ${place.rank})`).join('; ')}`);
  console.table(merged.stats);
  console.log(`Build completed in ${((performance.now() - started) / 1000).toFixed(2)} s; peak RSS ${(process.resourceUsage().maxRSS / 1024).toFixed(1)} MiB.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'GeoNames build failed.');
    process.exitCode = 1;
  }
}
