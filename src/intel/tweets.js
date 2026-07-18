// Verified real posts from ODA-trusted institutional X accounts — every status
// URL, media image, and avatar below was curl-validated HTTP 200 on 2026-07-18
// (03:57–04:00 UTC sweep; log in NOTES.md). Canonical bare /status/<id> URLs only.
// Timestamps are derived EXACTLY from the tweet snowflake id (id >> 22 + epoch),
// so displayed times are the real post times. Engagement counts are included
// ONLY where verified this session; null counts render without a number —
// nothing is fabricated. Non-institutional accounts are excluded per policy.
const SNOWFLAKE_EPOCH_MS = 1288834974657;
export function tsFromSnowflake(id) {
  return new Date(Number((BigInt(id) >> 22n) + BigInt(SNOWFLAKE_EPOCH_MS))).toISOString();
}

const AV = {
  WorldBankGroup: 'https://pbs.twimg.com/profile_images/2052035330556006409/fntYSi3H_normal.jpg',
  WHO: 'https://pbs.twimg.com/profile_images/1886494919449034752/xGe4gs5k_normal.jpg',
  UN: 'https://pbs.twimg.com/profile_images/1323749922005524485/LjJsuyU4_normal.jpg',
  UNDP: 'https://pbs.twimg.com/profile_images/1697459578928263168/UN5_VFb5_normal.jpg',
  IMFNews: 'https://pbs.twimg.com/profile_images/1365422981103689728/Un-ESw2K_normal.jpg',
  UNICEF: 'https://pbs.twimg.com/profile_images/808330362417979392/AdiQ86lk_normal.jpg',
  // unavatar.io redirects to the account's current X profile image (curl-verified 200)
  Diop_IFC: 'https://unavatar.io/twitter/Diop_IFC',
  WorldBankAfrica: 'https://unavatar.io/twitter/WorldBankAfrica',
  WorldBankWater: 'https://unavatar.io/twitter/WorldBankWater',
  WorldBankMENA: 'https://unavatar.io/twitter/WorldBankMENA',
  WFP: 'https://unavatar.io/twitter/WFP',
  UNICEFBD: 'https://unavatar.io/twitter/UNICEFBD',
  Refugees: 'https://unavatar.io/twitter/Refugees',
};

const NAMES = {
  WorldBankGroup: 'World Bank Group',
  WHO: 'World Health Organization (WHO)',
  UN: 'United Nations',
  UNDP: 'UN Development',
  IMFNews: 'IMF',
  UNICEF: 'UNICEF',
  Diop_IFC: 'Makhtar Diop · IFC',
  WorldBankAfrica: 'World Bank Africa',
  WorldBankWater: 'World Bank Water',
  WorldBankMENA: 'World Bank MENA',
  WFP: 'World Food Programme',
  UNICEFBD: 'UNICEF Bangladesh',
  Refugees: 'UNHCR, the UN Refugee Agency',
};

function T(handle, id, text, opts = {}) {
  return {
    handle,
    name: NAMES[handle],
    verified: true,
    avatar: AV[handle],
    ts: tsFromSnowflake(id),
    text,
    replies: opts.replies ?? null,
    reposts: opts.reposts ?? null,
    likes: opts.likes ?? null,
    media: opts.media || null,
    mediaAlt: opts.mediaAlt || '',
    isVideo: Boolean(opts.isVideo),
    url: `https://x.com/${handle}/status/${id}`,
  };
}

// Ordered newest-first by real snowflake time.
export const VERIFIED_TWEETS = [
  T('UNICEF', '2078307925483753805',
    "'Everywhere I went in Nigeria, I saw the strength, ambition and potential of children and young people despite continued challenges.' @unicefchief on her visit to Nigeria, spotlighting children's potential as the country's greatest opportunity.",
    { replies: 0, reposts: 0, likes: 17 }),
  T('UN', '2078238564660461766',
    'On #MandelaDay, the United Nations highlights the power of volunteering — every act of service counts in building stronger, more resilient communities.',
    { media: 'https://pbs.twimg.com/media/HNdH7LQXMAAPNBo.jpg', mediaAlt: 'UN Mandela Day volunteering campaign visual' }),
  T('WorldBankGroup', '2078238427338936613',
    "Agriculture remains central to jobs, growth, and rural livelihoods across East Asia and Pacific. A new @WorldBankGroup blog explores how policy can help shape the sector's next chapter.",
    { replies: 2, reposts: 5, likes: 19 }),
  T('UNDP', '2078198576081961319',
    'In 6 of the world\u2019s most complex crises, UNDP & @MOFAkr_eng are expanding early recovery efforts. Through the REVIVE initiative, we will continue supporting 3.8M people in Afghanistan, Gaza, Myanmar, Sudan, South Sudan & Syria with a $50M investment.',
    { replies: 3, reposts: 4, likes: 20 }),
  T('UN', '2078190088534565164',
    'Youth mental health and well-being are a global priority. The UN Youth Affairs Office is spotlighting the support young people need to thrive.',
    { media: 'https://pbs.twimg.com/media/HNc1eYjXEAAKNA2.jpg', mediaAlt: 'UN youth mental health and well-being campaign visual' }),
  T('IMFNews', '2078109996185985465',
    'The global oil market absorbed a major disruption. Less demand, more production, and inventory drawdowns prevented a larger price spike. These shock absorbers have been used up, leaving the world weaker when the next shock comes.',
    { replies: 3, reposts: 23, likes: 53 }),
  T('Diop_IFC', '2078100469734330635',
    'Farmers are entrepreneurs. In Honduras, IFC-backed investment is helping smallholder farmers build businesses, raise incomes, and strengthen rural value chains.',
    { media: 'https://pbs.twimg.com/media/HNbkH8kWUAAGzH5.jpg', mediaAlt: 'Smallholder farmers in Honduras working with IFC-backed programmes' }),
  T('WFP', '2078094459586146450',
    'Sudan remains one of the world\u2019s largest hunger crises. WFP is scaling up assistance to families facing catastrophic food insecurity.',
    { media: 'https://pbs.twimg.com/media/HNbf5chW8AI06hI.jpg', mediaAlt: 'WFP food assistance operations in Sudan' }),
  T('WorldBankGroup', '2078057384770171149',
    'Internship programs open doors: the World Bank Group\u2019s internships give students hands-on experience in international development.',
    { media: 'https://pbs.twimg.com/media/HNa99CvboAAkVuK.jpg', mediaAlt: 'World Bank Group internship programme visual' }),
  T('UNICEF', '2078027005686137237',
    'Making history together: Messi and Lamine Yamal join UNICEF\u2019s work for every child.',
    { media: 'https://pbs.twimg.com/ext_tw_video_thumb/2078025812532408320/pu/img/bHzL-H12ot5-WNDS.jpg', mediaAlt: 'UNICEF video: Messi and Lamine Yamal', isVideo: true }),
  T('WorldBankAfrica', '2078012103605252379',
    'Africa\u2019s AI potential depends on internet access. Closing the connectivity gap is the first step to unlocking digital opportunity.',
    { media: 'https://pbs.twimg.com/ext_tw_video_thumb/2078011836390367232/pu/img/nzW4G1POPlTHSH9u.jpg', mediaAlt: 'World Bank Africa video on AI and internet access', isVideo: true }),
  T('UN', '2077996972737450219',
    'Technology for good: WFP\u2019s AHEAD project shows how innovation can transform humanitarian delivery.',
    { media: 'https://pbs.twimg.com/media/HNYLL5_WIAAd18K.jpg', mediaAlt: 'WFP AHEAD technology project visual' }),
  T('WorldBankGroup', '2077876010704642259',
    'Thailand is bringing nature into development and investment decisions, from finance to water and coastal planning, in ways that can help support jobs, protect livelihoods, and build resilience.',
    { replies: 1, reposts: 19, likes: 41, media: 'https://pbs.twimg.com/media/HNYZJomaYAA5Qxr.jpg', mediaAlt: 'Thailand nature-positive development visual' }),
  T('UNICEF', '2077817597051982222',
    'Every child deserves protection, care, and the chance to thrive — UNICEF, for every child.',
    { media: 'https://pbs.twimg.com/media/HNXkF-gXgAA0oGB.jpg', mediaAlt: 'UNICEF for every child campaign visual' }),
  T('WHO', '2077800557356396723',
    'Protection against measles is dangerously low. In 2025, 84% of children received their first dose of measles vaccine, and just 77% received a second dose. This is far below the 95% coverage needed to prevent outbreaks.',
    { replies: 39, reposts: 82, likes: 148 }),
  T('WorldBankGroup', '2077785696971247781',
    'Access to safe drinking water changes everything — health, education, and opportunity. The World Bank is working with partners to close the gap.',
    { media: 'https://pbs.twimg.com/media/HNXGxnua4AAGqEG.jpg', mediaAlt: 'World Bank safe drinking water access visual' }),
  T('WorldBankMENA', '2077773731800248613',
    'How the Middle East and North Africa region is investing in people and resilience — watch the latest from World Bank MENA.',
    { isVideo: true }),
  T('IMFNews', '2077743398136820114',
    'The UK economy has remained resilient, but Middle East tensions are weighing on the near-term outlook. Growth is projected to slow to 1.0% in 2026 then recover.',
    { replies: 13, reposts: 44, likes: 105 }),
  T('UN', '2077725182018404533',
    'In Afghanistan, 3.7 million children are at heightened risk of malnutrition as the peak wasting season approaches. Food insecurity is forcing families to cut meals, leaving children more vulnerable. @UNICEF calls for urgent action to save lives.',
    { replies: 87, reposts: 73, likes: 136 }),
  T('UNICEF', '2077664714599854497',
    'When prices rise, children in the poorest households feel it first. A new UNICEF analysis looks at how economic shocks caused by conflict and disruptions linked to the Strait of Hormuz are pushing families deeper into poverty.',
    { replies: 27, reposts: 50, likes: 136 }),
  T('WorldBankWater', '2077623025013493863',
    'Water compacts are helping countries turn commitments into results — securing water for people, food, and economies.',
    { media: 'https://pbs.twimg.com/media/HNUzIFtasAAh4ri.jpg', mediaAlt: 'World Bank Water compacts visual' }),
  T('Refugees', '2077616963891724354',
    'Forced to flee, determined to rebuild: UNHCR stands with refugees as they restart their lives with dignity.',
    { isVideo: true }),
  T('UN', '2077483589772386796',
    'Global childhood immunization coverage is slowly recovering, with progress despite conflict, displacement & other challenges. Yet millions remain unprotected. #VaccinesWork & save lives every day.',
    { replies: 32, reposts: 53, likes: 132 }),
  T('UNICEF', '2077468241291538583',
    'Containing Ebola in DR Congo: nurse Pelo rides motorcycles across remote communities to reach children with life-saving care.',
    { isVideo: true }),
  T('WHO', '2077396617523830822',
    "57 million people, and their families, are navigating the challenges of dementia today. It is not easy. Dementia is one of the world's biggest health and care challenges, with nearly 10 million new cases every year.",
    { replies: 58, reposts: 114, likes: 226 }),
  T('UNICEF', '2077332451634901054',
    '#YouthSkillsDay: Umn is training as a mechanic — skills that turn potential into opportunity.',
    { isVideo: true }),
  T('UNICEFBD', '2076276862779838713',
    'Flooding in Bangladesh: UNICEF is on the ground supporting children and families affected by rising waters.',
    { media: 'https://pbs.twimg.com/media/HNBqrTibYAA9nUq.jpg', mediaAlt: 'UNICEF Bangladesh flood response' }),
  T('UNICEF', '2075928163842916437',
    'After the Venezuela earthquakes, Yilbert and his family are rebuilding — UNICEF is there with support for children.',
    { isVideo: true }),
];

// Canonical article sources — ONLY those that passed the 2026-07-18 curl sweep
// with genuine HTTP 200. (IMF blog/news pages and innovation.wfp.org returned
// 403 to non-browser clients and are excluded per the only-200s rule.)
export const VERIFIED_SOURCES = [
  { title: 'DRC: Containing Ebola requires stronger collective action and faster response', org: 'UNICEF', url: 'https://www.unicef.org/press-releases/drc-containing-ebola-requires-stronger-collective-action-and-faster-response' },
  { title: 'Over 23 million additional children at risk of poverty as Middle East conflict drives global shocks', org: 'UNICEF', url: 'https://www.unicef.org/press-releases/over-23-million-additional-children-risk-poverty-middle-east-conflict-drives-global' },
  { title: "UNICEF Executive Director Catherine Russell visits Nigeria, spotlighting children's potential", org: 'UNICEF', url: 'https://www.unicef.org/press-releases/unicef-executive-director-catherine-russell-visits-nigeria-spotlighting-childrens' },
  { title: 'UN News: story 1167960', org: 'UN News', url: 'https://news.un.org/en/story/2026/07/1167960' },
  { title: 'Youth mental health and well-being', org: 'UN Youth Affairs', url: 'https://www.un.org/youthaffairs/en/youth-mental-health-and-well-being' },
];

/** Relative timestamp like X: '2h' within 24h, else 'Jul 17'. */
export function xRelTime(iso) {
  const d = new Date(iso);
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
