const axios = require('axios');
const crypto = require('crypto');
const { run, get } = require('../db/sqlite');
const { RSS_SOURCES, fetchRss } = require('../lib/sources');
const {
  resolveFinalUrl,
  extractCanonical,
  chooseBestUrl,
  buildLinkMeta,
} = require('../lib/linkIntegrity');
const {
  fetchArticleHtml,
  makeSummaryLines,
} = require('../lib/articleExtract');
const { translateToKo } = require('../lib/translate');

function normalizeLevel(level) {
  if (!level) return '3_5';
  if (level === '3-5y' || level === '3-5' || level === '3_5') return '3_5';
  if (level === '5-10y' || level === '5-10' || level === '5_10') return '5_10';
  return '3_5';
}

function normalizeThemeKey(theme) {
  return String(theme || '').trim();
}

function canonicalThemeKey(theme) {
  return normalizeThemeKey(theme)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s/_.-]+/g, '');
}

function parseThemeLimits(input) {
  if (!input) return {};
  let source = input;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return {};
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};

  const out = {};
  for (const [theme, value] of Object.entries(source)) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    out[normalizeThemeKey(theme)] = Math.max(0, Math.floor(n));
  }
  return out;
}

const ALLOWED_ITEM_COUNTS = [10, 20, 30, 50, 100];
const DEFAULT_ITEM_COUNT = 20;

function normalizeItemCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ITEM_COUNT;
  const normalized = Math.floor(n);
  return ALLOWED_ITEM_COUNTS.includes(normalized) ? normalized : DEFAULT_ITEM_COUNT;
}

function normalizeParams({ date, mode, level, themeMin, themeMax, itemCount }) {
  const today = new Date().toISOString().split('T')[0];
  return {
    date: date || today,
    mode: mode === 'decision' ? 'decision' : 'execution',
    level: normalizeLevel(level),
    themeMin: parseThemeLimits(themeMin),
    themeMax: parseThemeLimits(themeMax),
    itemCount: normalizeItemCount(itemCount),
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function hashId(input) {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 12);
}

function seedFromText(text) {
  if (!text) return 0;
  const h = crypto.createHash('sha1').update(text).digest('hex');
  return parseInt(h.slice(0, 8), 16);
}

function pickDeterministic(list, seed, count) {
  const out = [];
  if (!Array.isArray(list) || list.length === 0 || count <= 0) return out;
  let idx = seed % list.length;
  for (let i = 0; i < list.length && out.length < count; i += 1) {
    const item = list[(idx + i * 3) % list.length];
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

const MAX_PER_SOURCE = 12;
const MAX_TOTAL_ITEMS = 160;
const MAX_HTML_FETCH = 30;
const MAX_AGE_HOURS = 72;
const REGION_TARGET_RATIO = 0.5;
const REGION_MIN_RATIO = 0.3;
const MIN_GLOBAL_SHARE = 0.2;
const FINAL_DEFAULT_MAX_BY_SOURCE = Number.POSITIVE_INFINITY;
const FINAL_MAX_BY_SOURCE = {
  '연합뉴스TV 경제': 2,
  '연합뉴스TV 최신': 2,
};

const THEME_MIN = { '바이오/헬스케어 국산화': 1 };
const THEME_MAX = { 'AI/딥테크 인프라': 2 };

function normalizeRegion(region) {
  const v = String(region || '').trim().toLowerCase();
  return v === 'global' ? 'global' : 'domestic';
}

function computeRegionTargets(items, limit) {
  const available = { domestic: 0, global: 0 };
  for (const item of items) {
    const key = normalizeRegion(item.region);
    available[key] += 1;
  }

  let domesticTarget = Math.min(Math.floor(limit * REGION_TARGET_RATIO), available.domestic);
  let globalTarget = Math.min(limit - domesticTarget, available.global);
  let remaining = limit - domesticTarget - globalTarget;

  while (remaining > 0) {
    const spareDomestic = available.domestic - domesticTarget;
    const spareGlobal = available.global - globalTarget;
    if (spareDomestic <= 0 && spareGlobal <= 0) break;

    if (spareDomestic >= spareGlobal && spareDomestic > 0) domesticTarget += 1;
    else if (spareGlobal > 0) globalTarget += 1;
    else if (spareDomestic > 0) domesticTarget += 1;
    remaining -= 1;
  }

  const minMinority = Math.ceil(limit * REGION_MIN_RATIO);
  if (available.domestic >= minMinority && available.global >= minMinority) {
    if (domesticTarget < minMinority) {
      const need = minMinority - domesticTarget;
      const shift = Math.min(need, Math.max(0, globalTarget - minMinority));
      domesticTarget += shift;
      globalTarget -= shift;
    }
    if (globalTarget < minMinority) {
      const need = minMinority - globalTarget;
      const shift = Math.min(need, Math.max(0, domesticTarget - minMinority));
      globalTarget += shift;
      domesticTarget -= shift;
    }
  }

  return { domestic: domesticTarget, global: globalTarget };
}

function isWithinHours(publishedAt, hours) {
  if (!publishedAt) return false;
  const t = new Date(publishedAt).getTime();
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  const diff = now - t;
  if (diff < 0) return false;
  return diff <= hours * 60 * 60 * 1000;
}

function countRegion(items, targetRegion) {
  if (!Array.isArray(items)) return 0;
  return items.filter((item) => normalizeRegion(item?.region) === targetRegion).length;
}


const TAG_RULES = [
  { tag: 'AI', keywords: ['AI', '인공지능', 'LLM', '모델', 'GPU', 'agent', 'agentic', 'foundation model'] },
  { tag: 'Semiconductor', keywords: ['반도체', '칩', '파운드리', '웨이퍼', '패키징', 'semiconductor', 'chip', 'foundry'] },
  { tag: 'Policy', keywords: ['규제', '정책', '법', '법안', '정부', '공정위', 'regulation', 'policy', 'law', 'antitrust', 'FTC', 'SEC'] },
  { tag: 'Bio', keywords: ['바이오', '제약', '의료', '헬스', '임상', 'biotech', 'pharma', 'clinical', 'health'] },
  { tag: 'Energy', keywords: ['배터리', '에너지', '전기차', '리사이클', '탄소', 'battery', 'energy', 'solar', 'wind', 'EV', 'electric vehicle'] },
  { tag: 'Fintech', keywords: ['핀테크', '금융', '증권', '은행', 'fintech', 'bank', 'payment', 'wallet'] },
  { tag: 'Security', keywords: ['보안', '인증', '제로트러스트', 'security', 'cyber', 'breach', 'ransomware', 'zero trust'] },
  { tag: 'Web3', keywords: ['웹3', '블록체인', '토큰', '메타버스', 'web3', 'blockchain', 'token', 'crypto', 'NFT'] },
  { tag: 'Retail', keywords: ['커머스', '이커머스', '리테일', 'D2C', 'retail', 'ecommerce', 'commerce', 'shopping'] },
  { tag: 'Export', keywords: ['수출', '해외', '동남아', '글로벌', 'export', 'overseas', 'global expansion', 'cross-border'] },
  { tag: 'Collaboration', keywords: ['협력', '파트너십', '제휴', 'MOU', '업무협약', '공동', '협업', 'alliance', 'partnership', 'collaboration', 'deal', 'agreement'] },
];

function deriveTags(title) {
  const tags = [];
  for (const rule of TAG_RULES) {
    if (rule.keywords.some((k) => title.includes(k))) tags.push(rule.tag);
  }
  return tags.length ? tags : ['General'];
}

function deriveTheme(tags) {
  if (tags.includes('AI') || tags.includes('Semiconductor')) return 'AI/딥테크 인프라';
  if (tags.includes('Policy')) return 'VC 생태계 변화';
  if (tags.includes('Bio')) return '바이오/헬스케어 국산화';
  if (tags.includes('Energy')) return '그린 테크/ESG';
  if (tags.includes('Fintech') || tags.includes('Security')) return '보안/인증 솔루션';
  if (tags.includes('Retail') || tags.includes('Export')) return '글로벌 확장 모델';
  if (tags.includes('Web3')) return '디지털 자산/웹3.0';
  return '기타/산업 일반';
}

function computeScore(breakdown) {
  const values = Object.values(breakdown || {});
  if (!values.length) return 0;
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(avg);
}
function computeSelectionScore(item, mode, level) {
  const tags = Array.isArray(item.category_tags) ? item.category_tags : [];
  const theme = item.top5_theme || '';
  let score = item.score_total || 0;

  const addIfTag = (tag, val) => { if (tags.includes(tag)) score += val; };
  const addIfTheme = (t, val) => { if (theme === t) score += val; };

  if (mode === 'decision') {
    addIfTag('Policy', 10);
    addIfTag('Fintech', 8);
    addIfTag('Security', 6);
    addIfTag('Bio', 5);
    addIfTag('Collaboration', 4);
    addIfTheme('VC 생태계 변화', 8);
    addIfTheme('보안/인증 솔루션', 5);
  } else {
    addIfTag('AI', 8);
    addIfTag('Semiconductor', 6);
    addIfTag('Collaboration', 4);
    addIfTag('Retail', 4);
    addIfTag('Export', 4);
    addIfTheme('AI/딥테크 인프라', 6);
    addIfTheme('글로벌 확장 모델', 4);
  }

  if (level === '5_10') {
    addIfTag('Energy', 8);
    addIfTag('Bio', 8);
    addIfTag('Policy', 5);
    addIfTheme('그린 테크/ESG', 6);
    addIfTheme('바이오/헬스케어 국산화', 6);
    if (tags.includes('AI')) score -= 2;
  } else {
    addIfTag('Fintech', 5);
    addIfTag('Security', 5);
    addIfTag('AI', 3);
    addIfTag('Collaboration', 3);
    addIfTheme('보안/인증 솔루션', 4);
    addIfTheme('AI/딥테크 인프라', 3);
  }

  return score;
}
function computeBreakdown(title, tags, linkStatus, published_at, refDate) {
  const t = (title || '').toLowerCase();

  let impact = 60;
  if (tags.includes('AI')) impact += 15;
  if (tags.includes('Semiconductor')) impact += 10;
  if (tags.includes('Policy')) impact += 10;
  if (tags.includes('Bio')) impact += 8;
  if (tags.includes('Energy')) impact += 8;
  if (tags.includes('Fintech')) impact += 6;
  if (tags.includes('Security')) impact += 6;
  if (tags.includes('Web3')) impact += 4;
  if (tags.includes('Export') || tags.includes('Retail')) impact += 5;
  impact += Math.min(6, tags.length * 2);

  let relevance = 55 + Math.min(12, tags.length * 3);
  if (tags.includes('AI')) relevance += 8;
  if (tags.includes('Policy')) relevance += 6;
  if (tags.includes('Bio')) relevance += 6;
  if (tags.includes('Energy')) relevance += 6;
  if (tags.includes('Fintech')) relevance += 5;
  if (tags.includes('Security')) relevance += 5;

  let urgency = 50;
  const pub = new Date(published_at);
  const ref = new Date(refDate);
  if (!isNaN(pub.getTime()) && !isNaN(ref.getTime())) {
    const diffHours = Math.max(0, (ref - pub) / (1000 * 60 * 60));
    if (diffHours <= 12) urgency += 25;
    else if (diffHours <= 24) urgency += 20;
    else if (diffHours <= 48) urgency += 12;
    else if (diffHours <= 72) urgency += 6;
    else if (diffHours <= 120) urgency += 2;
  }
  if (/(regulation|policy|law|guideline|ban|approval)/.test(t)) urgency += 6;
  if (/(launch|release|introduc|rollout|test|beta|preview)/.test(t)) urgency += 4;
  if (/(security|breach|hack|attack|vulnerab)/.test(t)) urgency += 6;

  let credibility = 50;
  if (linkStatus === 'verified') credibility += 30;
  else if (linkStatus === 'unverified') credibility += 10;

  return {
    impact: clamp(Math.round(impact), 0, 100),
    relevance: clamp(Math.round(relevance), 0, 100),
    urgency: clamp(Math.round(urgency), 0, 100),
    credibility: clamp(Math.round(credibility), 0, 100),
  };
}
function makeCheckpoints(title, tags, theme, mode) {
  const points = [];
  const t = (title || '').toLowerCase();
  const seed = seedFromText(`${title || ''}|${theme || ''}`);
  const isDecision = mode === 'decision';

  if (/(raise|funding|round|series|seed|investment|financing)/.test(t)) {
    points.push('라운드 규모와 밸류에이션 근거 확인');
    points.push('자금 사용 계획과 런웨이 점검');
  }
  if (/(partnership|collab|agreement|deal|joins|signed)/.test(t)) {
    points.push('파트너십 범위·권한·수익배분 구조 확인');
  }
  if (/(acquire|acquisition|merger|buyout|m\&a)/.test(t)) {
    points.push('인수 가격의 합리성과 PMI 리스크 검토');
  }
  if (/(earnings|revenue|profit|loss|growth|margin)/.test(t)) {
    points.push('매출/마진 추세와 핵심 KPI 확인');
  }
  if (/(launch|release|introduc|rollout|test|beta|preview)/.test(t)) {
    points.push('제품 성능 지표와 초기 고객 반응 확인');
  }
  if (/(regulation|policy|law|guideline|ban|approval)/.test(t)) {
    points.push('규제 적용 범위와 시행 일정 확인');
  }
  if (/(security|breach|hack|attack|vulnerab)/.test(t)) {
    points.push('보안 인증·감사 이력 및 사고 대응 체계 점검');
  }

  if (tags.includes('AI')) points.push('모델 성능 대비 비용 구조(TCO) 점검');
  if (tags.includes('Semiconductor')) points.push('공급망·캐파·수율 개선 추이 확인');
  if (tags.includes('Bio')) points.push('임상/인허가 일정과 실패 리스크 점검');
  if (tags.includes('Energy')) points.push('원가 구조와 원자재 가격 민감도 점검');
  if (tags.includes('Fintech')) points.push('규제 준수 비용과 수익성 구조 검토');
  if (tags.includes('Security')) points.push('신뢰 확보를 위한 인증 로드맵 점검');
  if (tags.includes('Web3')) points.push('토큰 이코노미와 실사용 지표 확인');
  if (tags.includes('Export') || tags.includes('Retail')) points.push('현지 채널·물류·CAC 추이 확인');
  if (tags.includes('Policy')) points.push('정책 변경 시나리오별 영향도 분석');

  const decisionPool = [
    '투자 결정 전 실사 범위·우선순위 확정',
    '밸류에이션 민감도 및 다운사이드 시나리오 점검',
    '법무/규제 리스크 및 계약 구조 확인',
    '핵심 리스크(기술·시장·재무) 완화 계획 검증',
    'Exit 경로와 예상 회수 기간 검토',
  ];

  const execPool = [
    '핵심 고객군의 지불 의향과 구매 주기 확인',
    '단기 매출 가시성과 계약 파이프라인 확인',
    '제품 차별화 요소와 모트 검증',
    '규모 확장 시 조직/운영 리스크 점검',
  ];

  const themePools = {
    'AI/딥테크 인프라': [
      '데이터 접근성 및 파트너십 구조 점검',
      '모델 성능 지표와 경쟁 벤치마크 비교',
      '추론 비용 절감 로드맵 확인',
    ],
    'VC 생태계 변화': [
      '공동투자 네트워크와 딜 소싱 채널 점검',
      '후속 라운드 자금 조달 환경 확인',
      '펀드 구조 변경에 따른 리스크 검토',
    ],
    '바이오/헬스케어 국산화': [
      '임상 단계별 마일스톤 달성 가능성 점검',
      '품질 인증 및 GMP/ISO 확보 여부 확인',
      '규제 대응 인력과 파트너 보유 여부 확인',
    ],
    '그린 테크/ESG': [
      '탄소 크레딧/규제 변화 민감도 점검',
      '공급망 재활용 루프 구축 여부 확인',
      '에너지 단가 하락 시나리오 검토',
    ],
    '보안/인증 솔루션': [
      '레퍼런스 확보 및 엔터프라이즈 PoC 진행 여부',
      '보안 규격 인증 확보 계획 확인',
      '침해 사고 대응 프로세스 점검',
    ],
    '글로벌 확장 모델': [
      '현지 파트너 채널 의존도 점검',
      '물류/배송 비용 구조와 수익성 검토',
      '지역별 LTV/CAC 차이 분석',
    ],
    '디지털 자산/웹3.0': [
      '토큰 유통량과 락업 정책 확인',
      'DAU/거래량 등 실사용 지표 점검',
      '규제 리스크와 지역별 허용 범위 확인',
    ],
  };

  const pool = isDecision ? decisionPool : execPool;
  const themePicks = pickDeterministic(themePools[theme] || [], seed, 2);
  const poolPicks = pickDeterministic(pool, seed + 11, 2);
  points.push(...themePicks, ...poolPicks);

  if (points.length < 3) {
    points.push('시장 수요 검증과 핵심 지표 추적');
    points.push('경쟁사 대비 포지셔닝 확인');
  }

  const uniq = [];
  for (const p of points) {
    if (!uniq.includes(p)) uniq.push(p);
  }
  return uniq.slice(0, 5);
}
function makeInsightLine(title, tags, theme, mode) {
  const t = (title || '').toLowerCase();
  const isDecision = mode === 'decision';

  if (/(raise|funding|round|series|seed|investment|financing)/.test(t)) {
    return isDecision
      ? '밸류에이션 민감도와 자금 사용 계획을 투자 판단 기준으로 점검'
      : '라운드 규모와 밸류에이션 민감도 점검 필요';
  }
  if (/(partnership|collab|agreement|deal|joins|signed)/.test(t)) {
    return isDecision
      ? '파트너십의 매출 기여도와 계약 구조를 투자 판단 기준으로 점검'
      : '파트너십 범위와 매출 기여도 확인 필요';
  }
  if (/(regulation|policy|law|guideline|ban|approval)/.test(t)) {
    return isDecision
      ? '규제 일정·비용 영향이 투자 결정에 미치는 리스크 평가 필요'
      : '규제 일정과 비용 영향 평가 필요';
  }
  if (/(security|breach|hack|attack|vulnerab)/.test(t)) {
    return isDecision
      ? '보안 리스크와 인증 확보 수준이 투자 리스크에 미치는 영향 평가'
      : '보안 리스크 및 인증 확보 상황 점검 필요';
  }
  if (/(acquire|acquisition|merger|buyout|m\&a)/.test(t)) {
    return isDecision
      ? '인수 시너지와 통합 리스크를 투자 결정 기준으로 검증'
      : '인수 시너지와 통합 리스크 검증 필요';
  }
  if (/(earnings|revenue|profit|loss|growth|margin)/.test(t)) {
    return isDecision
      ? '수익성 추이와 KPI 질을 투자 결정 기준으로 점검'
      : '수익성 추이와 KPI 질 점검 필요';
  }
  if (/(launch|release|introduc|rollout|test|beta|preview)/.test(t)) {
    return isDecision
      ? '초기 고객 반응과 PMF 검증이 투자 결정의 핵심'
      : '초기 고객 반응 및 PMF 검증 필요';
  }

  if (tags.includes('AI')) return isDecision ? 'AI 경쟁 우위의 지속성과 비용 구조를 투자 판단 기준으로 점검' : '성능 대비 비용 구조와 데이터 접근성 점검 필요';
  if (tags.includes('Semiconductor')) return isDecision ? '캐파·수율·공급계약 변동이 수익성에 미치는 영향 점검' : '캐파·수율·공급계약 변동 점검 필요';
  if (tags.includes('Bio')) return isDecision ? '임상/인허가 일정의 성공 가능성을 투자 판단 기준으로 점검' : '임상/인허가 일정과 실패 리스크 점검 필요';
  if (tags.includes('Energy')) return isDecision ? '원가 민감도와 규제 시나리오를 투자 판단 기준으로 점검' : '원가와 원자재 가격 민감도 점검 필요';
  if (tags.includes('Fintech')) return isDecision ? '규제 준수 비용과 수익성 구조를 투자 판단 기준으로 점검' : '규제 준수 비용과 수익성 구조 검토 필요';
  if (tags.includes('Security')) return isDecision ? '인증 확보 로드맵과 사고 대응 체계를 투자 판단 기준으로 점검' : '인증 확보 로드맵과 사고 대응 체계 점검 필요';
  if (tags.includes('Web3')) return isDecision ? '토큰 설계와 실사용 지표를 투자 판단 기준으로 점검' : '토큰 설계와 실사용 지표 점검 필요';
  if (tags.includes('Export') || tags.includes('Retail')) return isDecision ? '현지 채널 장악력과 CAC를 투자 판단 기준으로 점검' : '현지 채널 장악력과 CAC 점검 필요';

  return isDecision ? `${theme} 핵심 지표와 경쟁 구도를 투자 판단 기준으로 점검` : `${theme} 핵심 지표와 경쟁 구도 점검 필요`;
}
async function translateLabeled(line, labels) {
  if (!line) return line;
  for (const label of labels) {
    const prefix = label + ':';
    if (line.startsWith(prefix)) {
      const rest = line.slice(prefix.length).trim();
      const translated = await translateToKo(rest);
      return translated ? (label + ': ' + translated) : line;
    }
  }
  const translated = await translateToKo(line);
  return translated || line;
}

async function translateItems(items) {
  const translated = [];
  for (const item of items) {
    const koTitle = await translateToKo(item.title);
    const next = { ...item };
    if (koTitle) {
      next.title_original = item.title;
      next.title = koTitle;
    }

    if (Array.isArray(next.summary_3lines) && next.summary_3lines.length > 0) {
      next.summary_3lines[0] = `<${next.source}>`;
      if (next.summary_3lines[1]) {
        next.summary_3lines[1] = await translateLabeled(next.summary_3lines[1], ['\uD575\uC2EC \uC694\uC57D', '\uACB0\uC815 \uC694\uC57D', '\uD575\uC2EC']);
      }
      if (next.summary_3lines[2]) {
        next.summary_3lines[2] = await translateLabeled(next.summary_3lines[2], ['\uD22C\uC790 \uC2DC\uC0AC\uC810', '\uD22C\uC790 \uD310\uB2E8', '\uC2DC\uC0AC\uC810']);
      }
    }

    translated.push(next);
  }
  return translated;
}
function computeTop5Summary(items) {
  const themeCounts = new Map();
  const tagCounts = new Map();

  for (const item of items) {
    if (item.top5_theme) {
      themeCounts.set(item.top5_theme, (themeCounts.get(item.top5_theme) || 0) + 1);
    }
    if (Array.isArray(item.category_tags)) {
      for (const tag of item.category_tags) {
        if (tag === 'General') continue;
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
  }

  const themes = Array.from(themeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  const tags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  const tagLabels = {
    AI: 'AI',
    Semiconductor: '???',
    Policy: '??/??',
    Bio: '???',
    Energy: '???',
    Fintech: '???',
    Security: '??',
    Web3: '?3',
    Retail: '???',
    Export: '??',
    Collaboration: '??',
  };

  const result = [];
  for (const t of themes) {
    if (result.length >= 5) break;
    if (!result.includes(t)) result.push(t);
  }

  for (const tag of tags) {
    if (result.length >= 5) break;
    const label = tagLabels[tag] || tag;
    if (!result.includes(label)) result.push(label);
  }

  while (result.length < 5) result.push(`?? ?? ?? ${result.length + 1}`);
  return result.slice(0, 5);
}
async function upsertArticle(db, article) {
  const {
    url_original,
    final_url,
    canonical_url,
    title,
    source,
    published_at,
    fetched_at,
    domain,
    link_status,
    verification_note,
  } = article;

  await run(
    db,
    `
    INSERT OR IGNORE INTO articles
    (url_original, final_url, canonical_url, title, source, published_at, fetched_at, domain, link_status, verification_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      url_original,
      final_url,
      canonical_url,
      title,
      source,
      published_at,
      fetched_at,
      domain,
      link_status,
      verification_note,
    ]
  );

  const row = await get(
    db,
    `
    SELECT id FROM articles
    WHERE canonical_url = ? OR final_url = ? OR url_original = ?
    ORDER BY id DESC LIMIT 1
    `,
    [canonical_url, final_url, url_original]
  );

  if (row?.id) {
    await run(
      db,
      `
      UPDATE articles
      SET title = ?, source = ?, published_at = ?, fetched_at = ?, domain = ?, link_status = ?, verification_note = ?
      WHERE id = ?
      `,
      [
        title,
        source,
        published_at,
        fetched_at,
        domain,
        link_status,
        verification_note,
        row.id,
      ]
    );
  }

  return row?.id || null;
}

function selectBalancedItems(items, limit, options = {}) {
  const selected = [];
  const themeCounts = new Map();
  const sourceCounts = new Map();
  const regionCounts = new Map();
  const used = new Set();
  const minByThemeRaw = options.minByTheme || {};
  const maxByThemeRaw = options.maxByTheme || {};
  const maxBySourceRaw = options.maxBySource || {};
  const targetByRegionRaw = options.targetByRegion || {};
  const excludeUrls = options.excludeUrls || new Set();
  const defaultMaxBySource = Number.isFinite(options.defaultMaxBySource)
    ? Number(options.defaultMaxBySource)
    : Number.POSITIVE_INFINITY;

  const minByTheme = {};
  for (const [theme, value] of Object.entries(minByThemeRaw)) {
    minByTheme[canonicalThemeKey(theme)] = Number(value) || 0;
  }

  const maxByTheme = {};
  for (const [theme, value] of Object.entries(maxByThemeRaw)) {
    maxByTheme[canonicalThemeKey(theme)] = Number(value);
  }

  const maxBySource = {};
  for (const [source, value] of Object.entries(maxBySourceRaw)) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    maxBySource[String(source)] = Math.max(0, Math.floor(n));
  }

  const targetByRegion = {};
  for (const [region, value] of Object.entries(targetByRegionRaw)) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    targetByRegion[normalizeRegion(region)] = Math.max(0, Math.floor(n));
  }

  const canUse = (item, cfg = {}) => {
    const key = item.id || item.url || item.title;
    if (used.has(key)) return false;
    if (item.url && excludeUrls.has(item.url)) return false;

    if (!cfg.ignoreThemeMax) {
      const themeKey = canonicalThemeKey(item.top5_theme || '기타/산업 일반');
      const maxTheme = Object.prototype.hasOwnProperty.call(maxByTheme, themeKey) ? maxByTheme[themeKey] : limit;
      const themeCount = themeCounts.get(themeKey) || 0;
      if (themeCount >= maxTheme) return false;
    }

    const source = item.source || 'unknown';
    const sourceLimit = Object.prototype.hasOwnProperty.call(maxBySource, source)
      ? maxBySource[source]
      : defaultMaxBySource;
    const sourceCount = sourceCounts.get(source) || 0;
    if (sourceCount >= sourceLimit) return false;

    return true;
  };

  const addItem = (item) => {
    const key = item.id || item.url || item.title;
    selected.push(item);
    used.add(key);

    const themeKey = canonicalThemeKey(item.top5_theme || '기타/산업 일반');
    themeCounts.set(themeKey, (themeCounts.get(themeKey) || 0) + 1);

    const source = item.source || 'unknown';
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);

    const region = normalizeRegion(item.region);
    regionCounts.set(region, (regionCounts.get(region) || 0) + 1);
  };

  const fillByRegion = (region, target, ignoreThemeMax = false) => {
    if (!target || target <= 0) return;
    for (const item of items) {
      if (selected.length >= limit) break;
      const regionCount = regionCounts.get(region) || 0;
      if (regionCount >= target) break;
      if (normalizeRegion(item.region) !== region) continue;
      if (!canUse(item, { ignoreThemeMax })) continue;
      addItem(item);
    }
  };

  fillByRegion('domestic', targetByRegion.domestic || 0, false);
  fillByRegion('global', targetByRegion.global || 0, false);

  if (targetByRegion.domestic && (regionCounts.get('domestic') || 0) < targetByRegion.domestic) {
    fillByRegion('domestic', targetByRegion.domestic, true);
  }
  if (targetByRegion.global && (regionCounts.get('global') || 0) < targetByRegion.global) {
    fillByRegion('global', targetByRegion.global, true);
  }

  for (const [themeKey, min] of Object.entries(minByTheme)) {
    if (!min || min <= 0 || selected.length >= limit) continue;
    for (const item of items) {
      if (selected.length >= limit) break;
      const itemThemeKey = canonicalThemeKey(item.top5_theme || '\uAE30\uD0C0/\uC0B0\uC5C5 \uC77C\uBC18');
      if (itemThemeKey !== themeKey) continue;
      if (!canUse(item)) continue;
      addItem(item);
      if ((themeCounts.get(themeKey) || 0) >= min) break;
    }
  }

  const themeSet = new Set(items.map((i) => canonicalThemeKey(i.top5_theme || '\uAE30\uD0C0/\uC0B0\uC5C5 \uC77C\uBC18')));
  const targetUnique = Math.min(limit, Math.min(4, themeSet.size));

  const pickedThemes = new Set(selected.map((i) => canonicalThemeKey(i.top5_theme || '\uAE30\uD0C0/\uC0B0\uC5C5 \uC77C\uBC18')));
  for (const item of items) {
    if (selected.length >= targetUnique) break;
    const themeKey = canonicalThemeKey(item.top5_theme || '\uAE30\uD0C0/\uC0B0\uC5C5 \uC77C\uBC18');
    if (pickedThemes.has(themeKey)) continue;
    if (!canUse(item)) continue;
    addItem(item);
    pickedThemes.add(themeKey);
  }

  for (const item of items) {
    if (selected.length >= limit) break;
    if (!canUse(item)) continue;
    addItem(item);
  }

  for (const item of items) {
    if (selected.length >= limit) break;
    if (!canUse(item, { ignoreThemeMax: true })) continue;
    addItem(item);
  }

  return selected.slice(0, limit);
}
function buildBrief(date, mode, level, items, top5_summary_override) {
  const isDecision = mode === 'decision';
  const isLong = level === '5_10';

  const takeaways_3 = [];
  if (items[0]) takeaways_3.push(`${isDecision ? '의사결정 포인트' : '최상위 뉴스'}: ${items[0].title}`);
  if (items[1]) takeaways_3.push(`${isDecision ? '리스크/기회 요약' : '두 번째 시그널'}: ${items[1].title}`);
  if (items[2]) takeaways_3.push(`${isDecision ? '추가 검토' : '추가 모니터링'}: ${items[2].title}`);
  while (takeaways_3.length < 3) takeaways_3.push('주요 이슈가 없습니다.');

  if (isLong) {
    for (let i = 0; i < takeaways_3.length; i += 1) {
      takeaways_3[i] = `${takeaways_3[i]} (5~10y 관점)`;
    }
  }

  const themes = [];
  for (const item of items) {
    if (!themes.includes(item.top5_theme)) themes.push(item.top5_theme);
  }
  const top5_summary = Array.isArray(top5_summary_override) && top5_summary_override.length
    ? top5_summary_override.slice(0, 5)
    : themes.slice(0, 5);
  while (top5_summary.length < 5) top5_summary.push('시장 일반');

  let checklist_5 = [];

  if (isDecision && isLong) {
    checklist_5 = [
      '의사결정: 5~10y 밸류에이션 민감도 시나리오 점검',
      '의사결정: 장기 규제/표준 변화가 회수전략에 미치는 영향 검토',
      '의사결정: 핵심 IP/데이터 자산의 장기 방어력 검증',
      '의사결정: 현금흐름 가정 및 다운사이드 방어력 검토',
      '의사결정: Exit 경로(IPO/M&A) 실현 가능성 점검',
    ];
  } else if (isDecision) {
    checklist_5 = [
      '의사결정: 투자위원회 핵심 리스크 정리',
      '의사결정: 밸류에이션 밴드 및 조건 비교',
      '의사결정: 경쟁사 대비 차별화 포인트 검증',
      '의사결정: 규제/법무 이슈 확인',
      '의사결정: Exit 시나리오와 회수 전략 점검',
    ];
  } else if (isLong) {
    checklist_5 = [
      '실행: 5~10y 기술 로드맵 및 TAM 확장성 검증',
      '실행: 장기 규제/표준화 변화 시나리오 정리',
      '실행: 핵심 IP/데이터 자산 방어력 검토',
      '실행: 장기 수익성 구조와 캐시플로 가정 점검',
      '실행: 전략 파트너십/생태계 내 포지션 검토',
    ];
  } else {
    checklist_5 = [
      '실행: 후속 미팅/실사 일정 정리',
      '실행: 핵심 지표(KPI) 업데이트 확인',
      '실행: 기술/제품 로드맵 검토',
      '실행: 시장 반응/고객 인터뷰 요약',
      '실행: 경쟁사/대체재 리서치 업데이트',
    ];
  }

  return { date, mode, level, takeaways_3, items, top5_summary, checklist_5 };
}
async function getOtherModeUrls(db, date, mode, level) {
  const otherMode = mode === 'decision' ? 'execution' : 'decision';
  try {
    const row = await get(db, 'SELECT json FROM daily_briefs WHERE date=? AND mode=? AND level=?', [date, otherMode, level]);
    if (!row || !row.json) return new Set();
    const brief = JSON.parse(row.json);
    const urls = new Set();
    const items = Array.isArray(brief.items) ? brief.items : [];
    for (const item of items) {
      if (item && item.url) urls.add(item.url);
    }
    return urls;
  } catch {
    return new Set();
  }
}
async function refreshBrief(params, db) {
  const { date, mode, level, themeMin, themeMax, itemCount } = normalizeParams(params);

  const rawArticles = [];
  for (const src of RSS_SOURCES) {
    const items = await fetchRss(src.url, src.name, src.region);
    const perSourceLimit = Number.isFinite(src.maxItems)
      ? Math.max(0, Math.min(MAX_PER_SOURCE, Math.floor(src.maxItems)))
      : MAX_PER_SOURCE;
    const recent = items
      .filter(i => isWithinHours(i.published_at, MAX_AGE_HOURS))
      .slice(0, perSourceLimit);
    rawArticles.push(...recent);
  }

  const candidates = rawArticles
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, MAX_TOTAL_ITEMS);

  const processed = [];
  let htmlFetchCount = 0;
  const now = new Date().toISOString();

  for (const raw of candidates) {
    const { final_url, link_status, verification_note } = await resolveFinalUrl(raw.url_original);

    let html = null;
    let canonical_url = null;
    const summaryText = raw.summary || '';
    if (final_url && link_status !== 'broken') {
      if (summaryText.length < 80 && htmlFetchCount < MAX_HTML_FETCH) {
        html = await fetchArticleHtml(final_url);
        htmlFetchCount += 1;
        if (html) canonical_url = extractCanonical(html, final_url);
      }
    }

    const linkMeta = buildLinkMeta({
      url_original: raw.url_original,
      final_url,
      canonical_url,
      link_status,
      verification_note,
    });

    const article = {
      url_original: raw.url_original,
      final_url,
      canonical_url,
      title: raw.title,
      source: raw.source,
      published_at: raw.published_at,
      fetched_at: now,
      domain: linkMeta.domain,
      link_status: linkMeta.link_status,
      verification_note: linkMeta.verification_note,
    };

    const articleId = await upsertArticle(db, article);
    const url = chooseBestUrl({
      canonical_url: article.canonical_url,
      final_url: article.final_url,
      url_original: article.url_original,
    });

    const category_tags = deriveTags(article.title || '');
    const top5_theme = deriveTheme(category_tags);
    const score_breakdown = computeBreakdown(article.title || '', category_tags, article.link_status, article.published_at, date);
    const score_total = computeScore(score_breakdown);

    const summary_3lines = makeSummaryLines({
      title: article.title,
      source: article.source,
      tags: category_tags,
      theme: top5_theme,
      html,
      rssSummary: raw.summary || '',
      insight: makeInsightLine(article.title, category_tags, top5_theme, mode),
      mode,
    });

    const newsItem = {
      id: articleId ? String(articleId) : hashId(url || article.title || now),
      title: article.title,
      source: article.source,
      region: normalizeRegion(raw.region),
      published_at: article.published_at,
      url,
      domain: article.domain,
      link_status: article.link_status,
      verification_note: article.verification_note,
      category_tags,
      top5_theme,
      summary_3lines,
      checkpoints: makeCheckpoints(article.title, category_tags, top5_theme, mode),
      score_total,
      score_breakdown,
    };

    processed.push(newsItem);
  }

  const deduped = [];
  const seen = new Set();
  for (const item of processed) {
    if (item.url && seen.has(item.url)) continue;
    if (item.url) seen.add(item.url);
    deduped.push(item);
  }

  const top5_summary = computeTop5Summary(deduped);

  const excludeUrls = await getOtherModeUrls(db, date, mode, level);

  const sorted = deduped
    .map(item => ({ item, selectionScore: computeSelectionScore(item, mode, level) }))
    .sort((a, b) => b.selectionScore - a.selectionScore)
    .map(entry => entry.item);

  const minByTheme = { ...THEME_MIN, ...(themeMin || {}) };
  const maxByTheme = { ...THEME_MAX, ...(themeMax || {}) };
  const eligibleForTargets = sorted.filter((item) => !(item.url && excludeUrls.has(item.url)));
  const targetByRegion = computeRegionTargets(eligibleForTargets, itemCount);
  let items = selectBalancedItems(sorted, itemCount, {
    minByTheme,
    maxByTheme,
    maxBySource: FINAL_MAX_BY_SOURCE,
    defaultMaxBySource: FINAL_DEFAULT_MAX_BY_SOURCE,
    targetByRegion,
    excludeUrls,
  });

  const requiredGlobal = Math.ceil(itemCount * MIN_GLOBAL_SHARE);
  const selectedGlobal = countRegion(items, 'global');
  const availableGlobal = countRegion(sorted, 'global');

  // If cross-mode de-dup exhausted global items, prioritize regional mix target.
  if (requiredGlobal > 0 && selectedGlobal < requiredGlobal && availableGlobal >= requiredGlobal) {
    items = selectBalancedItems(sorted, itemCount, {
      minByTheme,
      maxByTheme,
      maxBySource: FINAL_MAX_BY_SOURCE,
      defaultMaxBySource: FINAL_DEFAULT_MAX_BY_SOURCE,
      targetByRegion,
      excludeUrls: new Set(),
    });
  }

  const items_ko = await translateItems(items);

  const brief = buildBrief(date, mode, level, items_ko, top5_summary);

  await run(
    db,
    `
    INSERT INTO daily_briefs (date, mode, level, json, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date, mode, level)
    DO UPDATE SET json = excluded.json, created_at = excluded.created_at
    `,
    [date, mode, level, JSON.stringify(brief), now]
  );

  return { ok: true, date, mode, level, itemsCount: items_ko.length, itemCount };
}

module.exports = { refreshBrief, normalizeParams };


















































