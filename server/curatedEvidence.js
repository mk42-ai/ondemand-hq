// curatedEvidence.js — CE-V2 stage (c): REAL fetched evidence, normalized to the
// evidence schema {id, claim, platform, source, url, publish_date, snippet, media[],
// confidence}. ZERO simulated data: every record below is a real public document/post
// supplied by the research pass on 2026-07-19; X post dates decoded from snowflake ids.
// Merged into every V2 run + served via /api/correlation/v2/evidence.
export const CURATED_EVIDENCE = [
  {
    id: 'C1',
    claim: 'The UAE has provided unconditional foreign assistance globally since 1971 under its International Development Cooperation programme.',
    platform: 'web', source: 'UAE Ministry of Foreign Affairs',
    url: 'https://www.mofa.gov.ae/en/the-ministry/uae-international-development-cooperation',
    publish_date: null, snippet: 'UAE International Development Cooperation overview — unconditional foreign assistance globally since 1971.',
    media: [], confidence: 0.95, tags: ['aid', 'official'],
  },
  {
    id: 'C2',
    claim: 'UAE foreign policy is anchored on dialogue, cooperation, stability and prosperity.',
    platform: 'web', source: 'UAE Ministry of Foreign Affairs',
    url: 'https://www.mofa.gov.ae/en/foreign-policy',
    publish_date: null, snippet: 'Official MoFA foreign-policy statement: dialogue, cooperation, stability, prosperity.',
    media: [], confidence: 0.95, tags: ['diplomacy', 'official'],
  },
  {
    id: 'C3',
    claim: 'The UAE publishes Annual Foreign Aid Reports, most recently the Foreign Aid Report 2023.',
    platform: 'web', source: 'UAE Ministry of Foreign Affairs',
    url: 'https://www.mofa.gov.ae/en/the-ministry/uae-international-development-cooperation/annual-foreign-aid-report',
    publish_date: null, snippet: 'Annual Foreign Aid Report series (latest: 2023).',
    media: [], confidence: 0.9, tags: ['aid', 'official', 'report'],
  },
  {
    id: 'C4',
    claim: 'The UAE Foreign Assistance Policy 2022 defines six categories of assistance including bilateral country partnerships aligned to the SDGs.',
    platform: 'web', source: 'UAE Ministry of Foreign Affairs',
    url: 'https://www.mofa.gov.ae/en/the-ministry/uae-international-development-cooperation/-/Media/The%20United%20Arab%20Emirates%20policy%20for%20foreign%20assistance%202022%20EN',
    publish_date: '2022-01-01', snippet: 'Foreign Assistance Policy 2022: six categories incl. bilateral partnerships aligned to SDGs.',
    media: [], confidence: 0.9, tags: ['aid', 'policy', 'official'],
  },
  {
    id: 'C5',
    claim: 'The UAE dispatched 50 tonnes of food aid to Burkina Faso in January 2024.',
    platform: 'web', source: 'UAE Ministry of Foreign Affairs',
    url: 'https://www.mofa.gov.ae/en/mediahub/news/2024/1/23/23-1-2024-uae-burkina-faso',
    publish_date: '2024-01-23', snippet: 'MoFA news 23 Jan 2024: 50 tonnes of food aid to Burkina Faso.',
    media: [], confidence: 0.95, tags: ['aid', 'food-security', 'official-statement'],
  },
  {
    id: 'C6',
    claim: 'UAE MoFA and IFRC held a humanitarian partnership meeting in April 2025: Sultan Mohammed Al Shamsi met Xavier Castellanos Mosquera.',
    platform: 'web', source: 'UAE Ministry of Foreign Affairs',
    url: 'https://www.mofa.gov.ae/en/mediahub/news/2025/4/8/8-4-2025-uae-uae2',
    publish_date: '2025-04-08', snippet: 'MoFA–IFRC humanitarian partnership meeting, 8 Apr 2025.',
    media: [], confidence: 0.95, tags: ['humanitarian', 'diplomacy', 'official-statement'],
  },
  {
    id: 'C7',
    claim: 'The UAE has provided over $100 billion in foreign aid since 1971; Gaza is the largest recipient with ~50% of all aid into Gaza, >$3 billion since 2023, >90,000 tons delivered via 8,700 trucks, 80 airdrops and 13 ships, plus medical care for 75,000 Gazans.',
    platform: 'web', source: 'UAE Embassy (Washington)',
    url: 'https://www.uae-embassy.org/foreign-policy/foreign-aid',
    publish_date: null, snippet: '>$100bn aid since 1971; Gaza largest recipient: >$3bn since 2023, 90k tons, 8,700 trucks, 80 airdrops, 13 ships, 75k treated.',
    media: [], confidence: 0.9, tags: ['aid', 'humanitarian', 'official'],
  },
  {
    id: 'C8',
    claim: 'OECD Development Co-operation Profile: UAE total ODA USD 3.4 billion (2025 preliminary), 0.61% of GNI; UAE Aid established 2024 with seven thematic priorities including food security.',
    platform: 'web', source: 'OECD',
    url: 'https://www.oecd.org/content/dam/oecd/en/publications/reports/2025/06/development-co-operation-profiles_02ffa45c/united-arab-emirates_9d2f851d/f39888ef-en.pdf',
    publish_date: '2025-06-01', snippet: 'OECD profile: ODA USD 3.4bn (2025 prelim), 0.61% GNI; UAE Aid est. 2024; 7 priorities incl. food security.',
    media: [], confidence: 0.95, tags: ['aid', 'data', 'multilateral'],
  },
  {
    id: 'C9',
    claim: 'The UAE President issued Federal Decree No. 27 of 2024 establishing the UAE Aid Agency.',
    platform: 'web', source: 'UAE National Media Authority',
    url: 'https://www.nmo.gov.ae/en/news/uae-president-issues-federal-decree-establishing-uae-aid-agency',
    publish_date: '2026-06-29', snippet: 'Federal Decree No. 27 of 2024 establishes the UAE Aid Agency (page dated 29 Jun 2026 — recent).',
    media: [], confidence: 0.95, tags: ['aid', 'official-statement', 'institution'],
  },
  {
    id: 'C10',
    claim: 'The UAE National Food Security Strategy 2051 targets topping the Global Food Security Index by 2051; the UAE imports >90% of its food; the inaugural World Food Security Summit was held in November 2024.',
    platform: 'web', source: 'US-UAE Business Council',
    url: 'https://usuaebusiness.org/wp-content/uploads/2024/11/SectorUpdate_FoodReport_Web.pdf',
    publish_date: '2024-11-01', snippet: 'NFSS 2051: >90% food imported; #1 GFSI target by 2051; World Food Security Summit Nov 2024.',
    media: [], confidence: 0.9, tags: ['food-security', 'strategy'],
  },
  {
    id: 'C11',
    claim: 'WEF (14 Feb 2025): GCC food security via innovation represents a $30.5 billion potential opportunity.',
    platform: 'web', source: 'World Economic Forum',
    url: 'https://www.weforum.org/stories/2025/02/gulf-food-security-innovation/',
    publish_date: '2025-02-14', snippet: 'GCC food security via innovation — $30.5bn potential (WEF).',
    media: [], confidence: 0.9, tags: ['food-security', 'investment'],
  },
  {
    id: 'C12',
    claim: 'The UAE adopted a National Pathway for Food Systems Transformation, was the first country with a Minister of State for Food and Water Security, and operates the Emirates Food Security Council.',
    platform: 'web', source: 'UN Food Systems Hub',
    url: 'https://www.unfoodsystemshub.org/docs/unfoodsystemslibraries/national-pathways/united-arab-emirates/2021-09-17-en-uae-national-pathways_final.pdf',
    publish_date: '2021-09-17', snippet: 'UAE National Pathway for Food Systems Transformation; first Minister of State for Food & Water Security; Emirates Food Security Council.',
    media: [], confidence: 0.9, tags: ['food-security', 'policy'],
  },
  {
    id: 'C13',
    claim: 'The Office of Development Affairs at the UAE Presidential Court held an event with the UAE Embassy in Beijing.',
    platform: 'x', source: '@UAEEmbChina',
    url: 'https://x.com/UAEEmbChina/status/2078363281899868167',
    publish_date: '2026-07-18', snippet: 'ODA at UAE Presidential Court event with UAE Embassy Beijing (X post; snowflake-dated 2026-07-18 — BREAKING).',
    media: [], confidence: 0.8, tags: ['oda', 'diplomacy', 'x'],
  },
  {
    id: 'C14',
    claim: 'Theyab bin Mohamed bin Zayed attended the International Development Dialogue hosted by the Office of Development Affairs.',
    platform: 'x', source: '@ADMediaOffice',
    url: 'https://x.com/ADMediaOffice/status/1999049266795606068',
    publish_date: '2025-12-11', snippet: 'International Development Dialogue hosted by ODA; attended by Theyab bin Mohamed bin Zayed (snowflake-dated 2025-12-11).',
    media: [], confidence: 0.85, tags: ['oda', 'official', 'x'],
  },
  {
    id: 'C15',
    claim: 'The Office of Development Affairs hosted two sessions at Investopia 2025 on the future of philanthropy.',
    platform: 'x', source: '@AletihadEn',
    url: 'https://x.com/AletihadEn/status/1895871762488819882',
    publish_date: '2025-03-01', snippet: 'ODA hosted two Investopia 2025 sessions on the future of philanthropy (snowflake-dated 2025-03-01).',
    media: [], confidence: 0.8, tags: ['oda', 'philanthropy', 'x'],
  },
  {
    id: 'C16',
    claim: 'The Tony Elumelu Foundation partnered with the UAE Office of Development Affairs and the Khalifa Bin Zayed Al Nahyan Foundation to empower an additional 1,000 young African entrepreneurs.',
    platform: 'x', source: '@TonyElumeluFDN',
    url: 'https://x.com/TonyElumeluFDN/status/1889711563432464643',
    publish_date: '2025-02-12', snippet: 'TEF × ODA × KBZF partnership: +1,000 young African entrepreneurs (snowflake-dated 2025-02-12).',
    media: [], confidence: 0.85, tags: ['oda', 'partnership', 'x'],
  },
  {
    id: 'C17',
    claim: 'The UAE contributed $1.5 million (May 2026) via the International Affairs Office at the UAE Presidential Court to an ADB fund promoting agricultural innovation and food security in Asia-Pacific.',
    platform: 'web', source: 'Asian Development Bank',
    url: 'https://www.adb.org/news/uae-contributes-1-5-million-adb-fund-promote-agricultural-innovation',
    publish_date: '2026-05-01', snippet: 'UAE $1.5m to ADB agricultural-innovation/food-security fund via IAO at Presidential Court (May 2026 — recent).',
    media: [], confidence: 0.9, tags: ['funding', 'food-security', 'multilateral'],
  },
  {
    id: 'C18',
    claim: 'The UAE launched a national programme to boost food security focusing on climate-smart crops (~April 2026).',
    platform: 'web', source: 'Emirates News (Facebook video)',
    url: 'https://www.facebook.com/EmiratesNews/videos/the-uae-has-launched-a-national-programme-to-boost-food-security-focusing-on-hea/1509087217250354/',
    publish_date: '2026-04-01', snippet: 'National programme for food security — climate-smart crops (≈Apr 2026 — recent).',
    media: [], confidence: 0.8, tags: ['food-security', 'climate', 'programme'],
  },
];

/** Merge curated evidence with any prior evidence arrays, dedup by URL (curated wins on clash). */
export function mergeEvidence(...arrays) {
  const seen = new Map();
  for (const arr of arrays) {
    for (const ev of arr || []) {
      const key = (ev.url || `${ev.source}|${ev.claim}`).toLowerCase();
      if (!seen.has(key)) seen.set(key, ev);
    }
  }
  return [...seen.values()];
}
