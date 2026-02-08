import React, { useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { AppMode, BriefData, NewsItem } from './types';
import Header from './components/Header';
import ConclusionSection from './components/ConclusionSection';
import NewsGrid from './components/NewsGrid';

const API_BASE_ENV = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
const IS_NATIVE = Capacitor.isNativePlatform();
const FIXED_MODE: AppMode = 'execution';
const FIXED_LEVEL = '3_5';
const SIGNAL_COUNT_OPTIONS = [10, 20, 30, 50, 100];
const INITIAL_ITEM_COUNT = 100;
const PREFETCH_ITEM_COUNT = 100;
const AUTO_UPDATE_INTERVAL_MS = 30 * 60 * 1000;
const DISPLAY_COUNT_LABEL = '\uD45C\uC2DC \uAC1C\uC218';
const API_BASE_STORAGE_KEY = 'vcbrief.api_base';
const MIN_GLOBAL_RATIO = 0.2;

function normalizeApiBase(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isLoopbackApiBase(value: string): boolean {
  try {
    const u = new URL(value);
    return ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  } catch {
    return false;
  }
}

function getSavedApiBase(): string {
  if (typeof window === 'undefined') return '';
  return normalizeApiBase(window.localStorage.getItem(API_BASE_STORAGE_KEY) || '');
}

function getInitialApiBase(): string {
  const saved = getSavedApiBase();
  if (saved) return saved;
  return normalizeApiBase(API_BASE_ENV);
}

function toUserFriendlyError(err: any, apiBase: string): string {
  const fallback = '데이터를 불러오지 못했습니다.';
  const raw = String(err?.message || '').trim();
  const base = normalizeApiBase(apiBase);

  if (/failed to fetch/i.test(raw) || /networkerror/i.test(raw)) {
    if (!base) {
      return 'API 주소가 비어 있습니다. 앱 설정에서 API Base URL을 입력해 주세요.';
    }
    if (IS_NATIVE && isLoopbackApiBase(base)) {
      return '실기기에서는 localhost API를 사용할 수 없습니다. PC의 같은 Wi-Fi 대역 IP(예: http://192.168.x.x:3001)로 API Base URL을 설정해 주세요.';
    }
    return `네트워크 연결에 실패했습니다. API Base URL(${base})과 서버 상태를 확인해 주세요.`;
  }

  return raw || fallback;
}

function normalizeRegion(value: string | undefined): 'domestic' | 'global' {
  return String(value || '').trim().toLowerCase() === 'global' ? 'global' : 'domestic';
}

function selectWithGlobalQuota(items: NewsItem[], count: number): NewsItem[] {
  const sorted = [...items].sort((a, b) => b.score_total - a.score_total);
  const initial = sorted.slice(0, count);
  if (initial.length <= 1) return initial;

  const requiredGlobal = Math.ceil(initial.length * MIN_GLOBAL_RATIO);
  if (requiredGlobal <= 0) return initial;

  let globalCount = initial.filter((item) => normalizeRegion(item.region) === 'global').length;
  if (globalCount >= requiredGlobal) return initial;

  const reserveGlobal = sorted.filter(
    (item) => !initial.includes(item) && normalizeRegion(item.region) === 'global'
  );
  if (!reserveGlobal.length) return initial;

  const selected = [...initial];
  const replaceCandidates = selected
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => normalizeRegion(item.region) !== 'global')
    .sort((a, b) => a.item.score_total - b.item.score_total);

  let reserveIdx = 0;
  for (const candidate of replaceCandidates) {
    if (globalCount >= requiredGlobal) break;
    if (reserveIdx >= reserveGlobal.length) break;
    selected[candidate.idx] = reserveGlobal[reserveIdx];
    reserveIdx += 1;
    globalCount += 1;
  }

  return selected.sort((a, b) => b.score_total - a.score_total);
}

function normalizeBrief(data: any): BriefData {
  return {
    date: data?.date || new Date().toISOString().split('T')[0],
    mode: data?.mode === 'decision' ? 'decision' : 'execution',
    level: data?.level === '5_10' ? '5-10y' : data?.level === '3_5' ? '3-5y' : (data?.level || '3-5y'),
    takeaways_3: Array.isArray(data?.takeaways_3) ? data.takeaways_3 : [],
    items: Array.isArray(data?.items) ? data.items : [],
    top5_summary: Array.isArray(data?.top5_summary) ? data.top5_summary : [],
    checklist_5: Array.isArray(data?.checklist_5) ? data.checklist_5 : [],
  };
}

const App: React.FC = () => {
  const [data, setData] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [visibleItemCount, setVisibleItemCount] = useState<number>(20);
  const [updatingCount, setUpdatingCount] = useState(false);
  const [apiBase, setApiBase] = useState<string>(() => getInitialApiBase());
  const [apiBaseDraft, setApiBaseDraft] = useState<string>(() => getInitialApiBase());

  const fetchBrief = async (itemCount: number) => {
    if (IS_NATIVE && !apiBase) {
      throw new Error('앱 설정에서 API Base URL을 입력해 주세요.');
    }
    if (IS_NATIVE && isLoopbackApiBase(apiBase)) {
      throw new Error('실기기에서는 localhost API를 사용할 수 없습니다. API Base URL을 PC의 로컬 IP로 변경해 주세요.');
    }
    const res = await fetch(
      `${apiBase}/api/brief?date=${selectedDate}&mode=${FIXED_MODE}&level=${FIXED_LEVEL}&itemCount=${itemCount}`,
      { cache: 'no-store' }
    );
    if (!res.ok) {
      throw new Error('데이터를 불러오지 못했습니다.');
    }
    const json = await res.json();
    return normalizeBrief(json);
  };

  const ensureItemsForCount = async (targetCount: number) => {
    if (updatingCount) return;
    setUpdatingCount(true);
    try {
      const next = await fetchBrief(targetCount);
      setData((prev) => {
        if (!prev) return next;
        return next.items.length >= prev.items.length ? next : prev;
      });
    } catch {
      // Keep current data and let the user continue.
    } finally {
      setUpdatingCount(false);
    }
  };

  useEffect(() => {
    let alive = true;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const initial = await fetchBrief(INITIAL_ITEM_COUNT);
        if (!alive) return;
        setData(initial);
        setLoading(false);

        const refreshBody = {
          date: selectedDate,
          mode: FIXED_MODE,
          level: FIXED_LEVEL,
          itemCount: PREFETCH_ITEM_COUNT,
        };

        fetch(`${apiBase}/api/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(refreshBody),
        })
          .then(async () => {
            const next = await fetchBrief(PREFETCH_ITEM_COUNT);
            if (!alive) return;
            setData((prev) => {
              if (!prev) return next;
              return next.items.length >= prev.items.length ? next : prev;
            });
          })
          .catch(() => {
            // Keep initial data if refresh fails.
          });
      } catch (err: any) {
        if (!alive) return;
        setError(toUserFriendlyError(err, apiBase));
      } finally {
        if (alive) setLoading(false);
      }
    };

    fetchData();
    return () => {
      alive = false;
    };
  }, [apiBase, selectedDate]);

  useEffect(() => {
    const timerId = window.setInterval(async () => {
      try {
        const next = await fetchBrief(PREFETCH_ITEM_COUNT);

        setData((prev) => {
          if (!prev) return next;
          return next.items.length >= prev.items.length ? next : prev;
        });
      } catch {
        // Ignore transient polling failures and keep current data.
      }
    }, AUTO_UPDATE_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [apiBase, selectedDate]);

  const sortedNews = useMemo(() => {
    if (!data) return [] as NewsItem[];
    return selectWithGlobalQuota(data.items, visibleItemCount);
  }, [data, visibleItemCount]);

  const topItems = useMemo(() => sortedNews.slice(0, 3), [sortedNews]);

  if (loading) {
    return (
      <div className="terminal-screen terminal-centered">
        <div className="loading-line">데이터를 정규화하는 중입니다...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="terminal-screen terminal-centered">
        <div className="error-box">
          <h2>오류</h2>
          <p>{error}</p>
          <p style={{ fontSize: '0.9rem', opacity: 0.8 }}>
            현재 API Base URL: <code>{apiBase || '(미설정)'}</code>
          </p>
          <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
            <input
              type="url"
              placeholder="https://api.example.com 또는 http://192.168.x.x:3001"
              value={apiBaseDraft}
              onChange={(e) => setApiBaseDraft(e.target.value)}
              style={{ padding: '0.55rem 0.7rem' }}
            />
            <button
              onClick={() => {
                const next = normalizeApiBase(apiBaseDraft);
                window.localStorage.setItem(API_BASE_STORAGE_KEY, next);
                setApiBase(next);
                setError(null);
                setLoading(true);
              }}
            >
              API 주소 저장 후 다시 시도
            </button>
          </div>
          <button onClick={() => window.location.reload()}>다시 시도</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="terminal-screen pb-10">
      <Header />

      <main className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <section className="xl:col-span-12 space-y-6">
            <ConclusionSection takeaways={data.takeaways_3} items={topItems} />

            <section>
              <div className="list-head">
                <h2>
                  Key News Signals (TOP {visibleItemCount})
                </h2>
                <div className="list-head-tools">
                  <label htmlFor="signal-count" className="list-head-label">{DISPLAY_COUNT_LABEL}</label>
                  <select
                    id="signal-count"
                    className="signal-count-select"
                    value={visibleItemCount}
                    disabled={updatingCount}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setVisibleItemCount(next);
                      if (data.items.length < next) {
                        ensureItemsForCount(next);
                      }
                    }}
                  >
                    {SIGNAL_COUNT_OPTIONS.map((count) => (
                      <option key={count} value={count}>{count}</option>
                    ))}
                  </select>
                  {updatingCount && <span className="list-head-label">불러오는 중...</span>}
                </div>
              </div>
              <NewsGrid items={sortedNews} />
            </section>
          </section>
        </div>
      </main>
    </div>
  );
};

export default App;
