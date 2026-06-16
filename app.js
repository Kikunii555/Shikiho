/**
 * ShikihoAI - 四季報AI評価ツール
 * メインアプリケーション (Supabase & Googleスプレッドシート連携版 - 重複エラー修正済)
 */

// ============================================================
// Constants & Config
// ============================================================
let supabaseClient = null; // window.supabase との競合を避けるため別名で定義
let scoreSettingsMap = {}; // 配点マスタキャッシュ用

const STORAGE_KEY = 'shikiho_ai_data'; // Supabaseがオフラインの時の代替やデモ用
const ISSUE_LABELS = {
  1: '1集 新春号',
  2: '2集 春号',
  3: '3集 夏号',
  4: '4集 秋号'
};

const RATING_ORDER = { S: 6, A: 5, B: 4, C: 3, D: 2, E: 1, '': 0 };
const RATING_MULTIPLIERS = { S: 1.0, A: 0.85, B: 0.7, C: 0.55, D: 0.4, E: 0.2, '': 0 };

const ITEM_TO_RATING_KEY = {
  '④': 'futureScenario',
  '⑤': 'futureScenario',
  '⑥': 'financialSafety',
  '⑦': 'futureScenario',
  '⑧': 'dividendPower',
  '⑨': 'earningsPower',
  '⑩': 'futureScenario',
  '⑪': 'valueGap'
};

// ============================================================
// State
// ============================================================
const AppState = {
  currentIssueKey: '2026-3',
  sortColumn: 'highDividend',
  sortAsc: false,
  searchQuery: '',
  selectedId: null
};

// ============================================================
// Supabase Mapping Utilities
// ============================================================
function mapEvaluationToDb(item) {
  return {
    id: item.id || undefined,
    issue_year: item.issueYear,
    issue_number: item.issueNumber,
    issue_label: item.issueLabel,
    issue_key: item.issueKey,
    code: item.code,
    name: item.name,
    business_article: item.businessArticle,
    material_article: item.materialArticle,
    shareholders: item.shareholders,
    equity_ratio: item.equityRatio,
    retained_earnings: item.retainedEarnings,
    interest_bearing_debt: item.interestBearingDebt,
    roe: item.roe,
    dividend_current: item.dividendCurrent,
    dividend_next: item.dividendNext,
    dividend_yield: item.dividendYield,
    payout_ratio: item.payoutRatio,
    earnings: item.earnings,
    per: item.per,
    pbr: item.pbr,
    market_cap: item.marketCap,
    high_dividend_score: item.highDividendScore,
    growth_score: item.growthScore,
    ratings: item.ratings,
    keywords: item.keywords,
    industry: item.industry,
    status: item.status,
    dividend_score: item.dividendScore,
    financial_score: item.financialScore,
    earning_score: item.earningScore,
    future_score: item.futureScore,
    valuation_score: item.valuationScore,
    shikiho_comment: item.shikihoComment,
    updated_at: new Date().toISOString()
  };
}

function mapEvaluationFromDb(row) {
  return {
    id: row.id,
    issueYear: row.issue_year,
    issueNumber: row.issue_number,
    issueLabel: row.issue_label,
    issueKey: row.issue_key,
    code: row.code,
    name: row.name,
    businessArticle: row.business_article,
    materialArticle: row.material_article,
    shareholders: row.shareholders,
    equityRatio: row.equity_ratio != null ? parseFloat(row.equity_ratio) : null,
    retainedEarnings: row.retained_earnings != null ? parseFloat(row.retained_earnings) : null,
    interestBearingDebt: row.interest_bearing_debt != null ? parseFloat(row.interest_bearing_debt) : null,
    roe: row.roe != null ? parseFloat(row.roe) : null,
    dividendCurrent: row.dividend_current != null ? parseFloat(row.dividend_current) : null,
    dividendNext: row.dividend_next != null ? parseFloat(row.dividend_next) : null,
    dividendYield: row.dividend_yield != null ? parseFloat(row.dividend_yield) : null,
    payoutRatio: row.payout_ratio != null ? parseFloat(row.payout_ratio) : null,
    earnings: row.earnings || [],
    per: row.per != null ? parseFloat(row.per) : null,
    pbr: row.pbr != null ? parseFloat(row.pbr) : null,
    marketCap: row.market_cap != null ? parseFloat(row.market_cap) : null,
    highDividendScore: row.high_dividend_score,
    growthScore: row.growth_score,
    ratings: row.ratings || {},
    keywords: row.keywords || '',
    industry: row.industry || '',
    status: row.status || '',
    dividendScore: row.dividend_score != null ? parseInt(row.dividend_score) : null,
    financialScore: row.financial_score != null ? parseInt(row.financial_score) : null,
    earningScore: row.earning_score != null ? parseInt(row.earning_score) : null,
    futureScore: row.future_score != null ? parseInt(row.future_score) : null,
    valuationScore: row.valuation_score != null ? parseInt(row.valuation_score) : null,
    shikihoComment: row.shikiho_comment || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ============================================================
// Data Store (GAS API)
// ============================================================
let gasAppUrl = null;

const DataStore = {
  async init() {
    try {
      const response = await fetch('./config.json');
      const config = await response.json();
      if (config.GAS_WEB_APP_URL) {
        gasAppUrl = config.GAS_WEB_APP_URL;
        console.log('✅ GAS Web App configured');
      } else {
        console.error('❌ config.json に GAS_WEB_APP_URL が未設定:', config);
      }
    } catch (e) {
      console.error('❌ Failed to initialize config:', e);
    }
  },

  async getAll() {
    if (!gasAppUrl) return [];
    try {
      // キャッシュを無視して常に最新データを取得するようパラメータ(t)を付与
      const res = await fetch(`${gasAppUrl}?t=${new Date().getTime()}`, {
        cache: 'no-store'
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data.map(mapEvaluationFromDb).sort((a,b) => a.code.localeCompare(b.code));
    } catch (e) {
      console.error('Failed to get all evaluations:', e);
      return [];
    }
  },

  async getByIssue(issueKey) {
    const all = await this.getAll();
    return all.filter(item => item.issueKey === issueKey);
  },

  async getById(id) {
    const all = await this.getAll();
    return all.find(item => item.id === id) || null;
  },

  async add(item) {
    if (!gasAppUrl) return null;
    try {
      const dbRow = mapEvaluationToDb(item);
      delete dbRow.id; // DB側で生成
      const res = await fetch(gasAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'add', item: dbRow })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return mapEvaluationFromDb(json.data);
    } catch (e) {
      console.error('Failed to add evaluation:', e);
      return null;
    }
  },

  async update(id, updates) {
    if (!gasAppUrl) return null;
    try {
      const dbRow = {};
      const keyMapping = {
        issueYear: 'issue_year',
        issueNumber: 'issue_number',
        issueLabel: 'issue_label',
        issueKey: 'issue_key',
        code: 'code',
        name: 'name',
        businessArticle: 'business_article',
        materialArticle: 'material_article',
        shareholders: 'shareholders',
        equityRatio: 'equity_ratio',
        retainedEarnings: 'retained_earnings',
        interestBearingDebt: 'interest_bearing_debt',
        roe: 'roe',
        dividendCurrent: 'dividend_current',
        dividendNext: 'dividend_next',
        dividendYield: 'dividend_yield',
        payoutRatio: 'payout_ratio',
        earnings: 'earnings',
        per: 'per',
        pbr: 'pbr',
        marketCap: 'market_cap',
        highDividendScore: 'high_dividend_score',
        growthScore: 'growth_score',
        ratings: 'ratings',
        keywords: 'keywords',
        industry: 'industry',
        status: 'status',
        dividendScore: 'dividend_score',
        financialScore: 'financial_score',
        earningScore: 'earning_score',
        futureScore: 'future_score',
        valuationScore: 'valuation_score',
        shikihoComment: 'shikiho_comment'
      };

      for (const [jsKey, dbKey] of Object.entries(keyMapping)) {
        if (updates[jsKey] !== undefined) {
          dbRow[dbKey] = updates[jsKey];
        }
      }

      const res = await fetch(gasAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'update', id: id, updates: dbRow })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return true;
    } catch (e) {
      console.error('Failed to update evaluation:', e);
      return null;
    }
  },

  async remove(id) {
    if (!gasAppUrl) return;
    try {
      const res = await fetch(gasAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'delete', id: id })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
    } catch (e) {
      console.error('Failed to delete evaluation:', e);
    }
  },

  async getIssueKeys() {
    const all = await this.getAll();
    const keys = new Set();
    all.forEach(d => keys.add(d.issueKey));
    return Array.from(keys).sort().reverse();
  },

  async exportAll() {
    const all = await this.getAll();
    return JSON.stringify(all, null, 2);
  },

  async importAll(jsonStr) {
    alert('一括インポート機能は現在スプレッドシート(GAS)版ではサポートされていません。直接スプレッドシートに貼り付けてください。');
  }
};

async function loadScoreSettings() {
  // スプレッドシート(GAS)版では未実装のためスタブとして機能
  scoreSettingsMap = {};
}

// ============================================================
// Brand Master Autocomplete Lookup
// ============================================================
async function searchBrandFromDb(query) {
  if (typeof searchStocks === 'function') {
    return searchStocks(query);
  }
  return [];
}

async function lookupBrandName(code) {
  if (typeof lookupStock === 'function') {
    return lookupStock(code);
  }
  return '';
}

async function lookupBrandDetail(code) {
  if (typeof lookupStock === 'function') {
    const name = lookupStock(code);
    if (name) {
      return { name: name, industry: '' };
    }
  }
  return null;
}

// ============================================================
// Dynamic Scoring & Prompt Utilities
// ============================================================
function calculateBaseScore(ratings, scoreType) {
  if (!ratings || !scoreSettingsMap || Object.keys(scoreSettingsMap).length === 0) {
    return 100; // 初期値フォールバック
  }
  let totalBase = 0;
  for (const [itemNo, setting] of Object.entries(scoreSettingsMap)) {
    const ratingKey = ITEM_TO_RATING_KEY[itemNo];
    if (!ratingKey) continue;
    const rating = ratings[ratingKey] || '';
    const multiplier = RATING_MULTIPLIERS[rating] || 0;
    const baseScore = scoreType === 'highDividend' 
      ? (setting.dividend_base_score || 0)
      : (setting.growth_base_score || 0);
    totalBase += baseScore * multiplier;
  }
  return Math.round(totalBase);
}

async function generateAiCriteriaPrompt() {
  if (!supabaseClient) return 'S〜Eの評価判定基準がロードされていません。';
  try {
    const { data, error } = await supabaseClient
      .from('rating_criteria')
      .select('*')
      .order('category')
      .order('id');
    if (error) throw error;
    
    const groups = {};
    data.forEach(item => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    });
    
    let prompt = "S〜E of evaluations and criteria:\n\n";
    for (const [category, items] of Object.entries(groups)) {
      prompt += `■ ${category} の判定基準:\n`;
      items.sort((a, b) => {
        const ranks = ['S', 'A', 'B', 'C', 'D', 'E'];
        return ranks.indexOf(a.rank) - ranks.indexOf(b.rank);
      });
      items.forEach(item => {
        prompt += `  - ランク ${item.rank}: ${item.condition_text}\n`;
      });
      prompt += "\n";
    }
    return prompt;
  } catch (e) {
    console.error('Failed to generate AI prompt from criteria:', e);
    return 'S〜Eの評価判定基準のロードに失敗しました。';
  }
}

// ============================================================
// Utility Functions
// ============================================================
function getIssueKey(year, number) {
  return `${year}-${number}`;
}

function getIssueLabel(year, number) {
  return `${year}年${ISSUE_LABELS[number]}`;
}

function parseIssueKey(key) {
  const [year, number] = key.split('-');
  return { year: parseInt(year), number: parseInt(number) };
}

function computeOverallGrade(item) {
  const hdTotal = item.highDividendScore ? item.highDividendScore.total : 0;
  const grTotal = item.growthScore ? item.growthScore.total : 0;
  const maxScore = Math.max(hdTotal, grTotal);
  if (maxScore >= 120) return 'S';
  if (maxScore >= 100) return 'A';
  if (maxScore >= 75) return 'B';
  if (maxScore >= 55) return 'C';
  if (maxScore >= 35) return 'D';
  return 'E';
}

function getSortValue(item, column) {
  switch (column) {
    case 'code': return item.code || '';
    case 'name': return item.name || '';
    case 'industry': return item.industry || '';
    case 'status': return item.status || '';
    case 'highDividend': return item.highDividendScore ? item.highDividendScore.total : 0;
    case 'growth': return item.growthScore ? item.growthScore.total : 0;
    case 'overall': return RATING_ORDER[computeOverallGrade(item)] || 0;
    case 'dividendPower': return RATING_ORDER[item.ratings?.dividendPower] || 0;
    case 'financialSafety': return RATING_ORDER[item.ratings?.financialSafety] || 0;
    case 'earningsPower': return RATING_ORDER[item.ratings?.earningsPower] || 0;
    case 'futureScenario': return RATING_ORDER[item.ratings?.futureScenario] || 0;
    case 'valueGap': return RATING_ORDER[item.ratings?.valueGap] || 0;
    default: return 0;
  }
}

// ============================================================
// Table Rendering
// ============================================================
async function renderTable() {
  const tbody = document.getElementById('tableBody');
  const emptyState = document.getElementById('emptyState');
  const recordCount = document.getElementById('recordCount');

  let data = await DataStore.getByIssue(AppState.currentIssueKey);

  // Search filter
  if (AppState.searchQuery) {
    const q = AppState.searchQuery.toLowerCase();
    data = data.filter(d =>
      (d.code && d.code.includes(q)) ||
      (d.name && d.name.toLowerCase().includes(q))
    );
  }

  // Sort
  data.sort((a, b) => {
    const va = getSortValue(a, AppState.sortColumn);
    const vb = getSortValue(b, AppState.sortColumn);
    let cmp = 0;
    if (typeof va === 'string') {
      cmp = va.localeCompare(vb, 'ja');
    } else {
      cmp = va - vb;
    }
    return AppState.sortAsc ? cmp : -cmp;
  });

  recordCount.textContent = `${data.length}件`;

  if (data.length === 0) {
    tbody.innerHTML = '';
    emptyState.classList.add('visible');
    return;
  }

  emptyState.classList.remove('visible');

  tbody.innerHTML = data.map(item => {
    const overall = computeOverallGrade(item);
    return `
      <tr data-id="${item.id}">
        <td class="col-code">${item.code || '-'}</td>
        <td class="col-name" title="${item.name || ''}">${item.name || '-'}</td>
        <td>${item.industry || '-'}</td>
        <td>${renderStatusSelect(item.status)}</td>
        <td class="col-keywords">${renderKeywords(item.keywords)}</td>
        <td>${renderScoreCell(item.highDividendScore)}</td>
        <td>${renderScoreCell(item.growthScore)}</td>
        <td class="col-center"><span class="overall-grade overall-${overall}">${overall}</span></td>
        <td class="col-center">${renderRatingBadge(item.ratings?.dividendPower)}</td>
        <td class="col-center">${renderRatingBadge(item.ratings?.financialSafety)}</td>
        <td class="col-center">${renderRatingBadge(item.ratings?.earningsPower)}</td>
        <td class="col-center">${renderRatingBadge(item.ratings?.futureScenario)}</td>
        <td class="col-center">${renderRatingBadge(item.ratings?.valueGap)}</td>
      </tr>
    `;
  }).join('');

  // Row click handlers
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      // ステータスセレクトボックスのクリック時は詳細を開かないようにガード
      if (e.target.classList.contains('status-select')) {
        return;
      }
      const id = tr.dataset.id;
      showDetail(id);
    });
  });

  // Inline status select change handlers
  tbody.querySelectorAll('.status-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const tr = select.closest('tr');
      const id = tr.dataset.id;
      const newStatus = e.target.value;
      
      select.dataset.status = newStatus; // 即座にCSS色分けを反映
      
      const updated = await DataStore.update(id, { status: newStatus });
      if (updated) {
        showToast('✅ ステータスを更新しました');
      } else {
        showToast('❌ ステータスの更新に失敗しました');
      }
    });
  });
}

function renderStatusSelect(status) {
  const options = [
    { value: '', label: '- 未設定 -' },
    { value: '配当保有', label: '配当保有' },
    { value: '成長保有', label: '成長保有' },
    { value: '優待保有', label: '優待保有' },
    { value: '要注目', label: '要注目' },
    { value: '様子見', label: '様子見' },
    { value: '新規', label: '新規' }
  ];
  
  return `
    <select class="status-select" data-status="${status || ''}">
      ${options.map(opt => `<option value="${opt.value}" ${status === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
    </select>
  `;
}

function renderKeywords(keywords) {
  if (!keywords) return '<span style="color:var(--color-text-tertiary)">-</span>';
  return keywords.split(/[,，]/).map(kw => {
    const trimKw = kw.trim();
    if (!trimKw) return '';
    return `<span class="keyword-tag">${escapeHtml(trimKw)}</span>`;
  }).join('');
}

function renderScoreCell(score) {
  if (!score) return '<span style="color:var(--color-text-tertiary)">-</span>';
  const bonusClass = score.bonus > 0 ? 'positive' : score.bonus < 0 ? 'negative' : 'zero';
  const bonusPrefix = score.bonus > 0 ? '+' : '';
  return `
    <div class="score-cell">
      <span class="score-total-large">${score.total}</span>
      <span class="score-breakdown-inline">(${score.base}<span class="score-bonus-inline ${bonusClass}">${bonusPrefix}${score.bonus}</span>)</span>
    </div>
  `;
}

function renderRatingBadge(rating) {
  if (!rating) return '<span style="color:var(--color-text-muted)">-</span>';
  return `<span class="rating-badge rating-${rating}">${rating}</span>`;
}

// ============================================================
// Sort Handling
// ============================================================
function initSort() {
  document.querySelectorAll('.data-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (AppState.sortColumn === col) {
        AppState.sortAsc = !AppState.sortAsc;
      } else {
        AppState.sortColumn = col;
        AppState.sortAsc = false;
      }
      updateSortUI();
      renderTable();
    });
  });
  updateSortUI();
}

function updateSortUI() {
  document.querySelectorAll('.data-table th[data-sort]').forEach(th => {
    const col = th.dataset.sort;
    th.classList.toggle('sorted', col === AppState.sortColumn);
    const icon = th.querySelector('.sort-icon');
    if (icon) {
      icon.textContent = col === AppState.sortColumn
        ? (AppState.sortAsc ? '▲' : '▼')
        : '▼';
    }
  });
}

// ============================================================
// Issue Selector
// ============================================================
function initIssueSelector() {
  const yearSelect = document.getElementById('issueYearSelect');
  const numberSelect = document.getElementById('issueNumberSelect');

  function updateIssue() {
    const year = yearSelect.value;
    const number = numberSelect.value;
    AppState.currentIssueKey = getIssueKey(year, number);
    renderTable();
  }

  yearSelect.addEventListener('change', updateIssue);
  numberSelect.addEventListener('change', updateIssue);

  const { year, number } = parseIssueKey(AppState.currentIssueKey);
  yearSelect.value = year;
  numberSelect.value = number;
}

// ============================================================
// Search
// ============================================================
function initSearch() {
  const input = document.getElementById('searchInput');
  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      AppState.searchQuery = input.value.trim();
      renderTable();
    }, 200);
  });
}

// ============================================================
// Detail View
// ============================================================
async function showDetail(id) {
  const item = await DataStore.getById(id);
  if (!item) return;

  AppState.selectedId = id;
  const overlay = document.getElementById('detailOverlay');
  document.getElementById('detailCode').textContent = item.code;
  document.getElementById('detailName').textContent = item.name;

  const content = document.getElementById('detailContent');
  content.innerHTML = buildDetailHTML(item);

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function hideDetail() {
  document.getElementById('detailOverlay').classList.remove('active');
  document.body.style.overflow = '';
  AppState.selectedId = null;
}

function buildDetailHTML(item) {
  const overall = computeOverallGrade(item);
  let html = '';

  // Industry & Status Badge at top
  if (item.industry || item.status) {
    html += `
      <div class="detail-section" style="margin-bottom: var(--spacing-sm); display: flex; align-items: center; gap: var(--spacing-sm); flex-wrap: wrap;">
        ${item.status ? `<span class="status-badge status-${item.status}">${escapeHtml(item.status)}</span>` : ''}
        ${item.industry ? `<span style="font-size: 0.8rem; font-weight: 600; color: var(--color-text-secondary); background: var(--color-bg); padding: 4px 12px; border-radius: 12px; border: 1px solid var(--color-border);">${escapeHtml(item.industry)}</span>` : ''}
      </div>
    `;
  }

  // Keywords tags at top
  if (item.keywords) {
    html += `
      <div class="detail-section" style="margin-bottom: var(--spacing-sm);">
        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
          ${item.keywords.split(/[,，]/).map(kw => {
            const trimKw = kw.trim();
            if (!trimKw) return '';
            return `<span class="keyword-tag" style="font-size:0.75rem; padding:3px 10px; margin: 0 4px 4px 0;"># ${escapeHtml(trimKw)}</span>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  // Score Cards
  html += `
    <div class="detail-section">
      <div class="detail-section-title">投資スコア</div>
      <div class="score-cards">
        <div class="score-card">
          <div class="score-card-label">高配当株スコア</div>
          <div class="score-card-value">${item.highDividendScore ? item.highDividendScore.total : '-'}</div>
          <div class="score-card-breakdown">
            ${item.highDividendScore ? `基本 ${item.highDividendScore.base} <span style="color:${item.highDividendScore.bonus >= 0 ? 'var(--color-positive)' : 'var(--color-negative)'}">${item.highDividendScore.bonus >= 0 ? '+' : ''}${item.highDividendScore.bonus}</span>` : ''}
          </div>
        </div>
        <div class="score-card">
          <div class="score-card-label">成長株スコア</div>
          <div class="score-card-value">${item.growthScore ? item.growthScore.total : '-'}</div>
          <div class="score-card-breakdown">
            ${item.growthScore ? `基本 ${item.growthScore.base} <span style="color:${item.growthScore.bonus >= 0 ? 'var(--color-positive)' : 'var(--color-negative)'}">${item.growthScore.bonus >= 0 ? '+' : ''}${item.growthScore.bonus}</span>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;

  // Rating Grid
  html += `
    <div class="detail-section">
      <div class="detail-section-title">5大評価</div>
      <div style="text-align:center; margin-bottom:var(--spacing-md);">
        <span class="overall-grade overall-${overall}" style="font-size:1.1rem; padding:6px 16px;">総合 ${overall}</span>
      </div>
      <div class="rating-grid">
        ${buildRatingItem('配当力', item.ratings?.dividendPower, item.dividendScore)}
        ${buildRatingItem('財務安全', item.ratings?.financialSafety, item.financialScore)}
        ${buildRatingItem('稼ぐ力', item.ratings?.earningsPower, item.earningScore)}
        ${buildRatingItem('将来性', item.ratings?.futureScenario, item.futureScore)}
        ${buildRatingItem('割安度', item.ratings?.valueGap, item.valuationScore)}
      </div>
    </div>
  `;

  // Financial Data
  html += `
    <div class="detail-section">
      <div class="detail-section-title">財務・配当データ</div>
      <div class="detail-data-grid">
        ${buildDataItem('自己資本比率', item.equityRatio != null ? item.equityRatio + '%' : '-')}
        ${buildDataItem('利益剰余金', item.retainedEarnings != null ? item.retainedEarnings.toLocaleString() + '億円' : '-')}
        ${buildDataItem('有利子負債', item.interestBearingDebt != null ? item.interestBearingDebt.toLocaleString() + '億円' : '-')}
        ${buildDataItem('ROE', item.roe != null ? item.roe + '%' : '-')}
        ${buildDataItem('配当利回り', item.dividendYield != null ? item.dividendYield + '%' : '-')}
        ${buildDataItem('配当性向', item.payoutRatio != null ? item.payoutRatio + '%' : '-')}
        ${buildDataItem('今期配当', item.dividendCurrent != null ? item.dividendCurrent + '円' : '-')}
        ${buildDataItem('来期配当', item.dividendNext != null ? item.dividendNext + '円' : '-')}
        ${buildDataItem('PER', item.per != null ? item.per + '倍' : '-')}
        ${buildDataItem('PBR', item.pbr != null ? item.pbr + '倍' : '-')}
        ${buildDataItem('時価総額', item.marketCap != null ? item.marketCap.toLocaleString() + '億円' : '-')}
      </div>
    </div>
  `;

  // Earnings Table
  if (item.earnings && item.earnings.length > 0) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">業績推移</div>
        <table class="earnings-table">
          <thead>
            <tr>
              <th>期</th>
              <th>売上高(億)</th>
              <th>営業利益(億)</th>
              <th>純利益(億)</th>
            </tr>
          </thead>
          <tbody>
            ${item.earnings.map(e => {
              const isForecast = e.period.includes('予');
              return `
                <tr class="${isForecast ? 'forecast' : ''}">
                  <td>${e.period}</td>
                  <td>${e.revenue != null ? e.revenue.toLocaleString() : '-'}</td>
                  <td>${e.opProfit != null ? e.opProfit.toLocaleString() : '-'}</td>
                  <td>${e.netProfit != null ? e.netProfit.toLocaleString() : '-'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Articles
  if (item.businessArticle || item.materialArticle || item.shikihoComment) {
    html += `<div class="detail-section">`;
    html += `<div class="detail-section-title">四季報記事</div>`;
    if (item.businessArticle) {
      html += `
        <div style="margin-bottom:var(--spacing-sm);">
          <div class="detail-article-label">📰 業績記事</div>
          <div class="detail-article">${escapeHtml(item.businessArticle)}</div>
        </div>
      `;
    }
    if (item.materialArticle) {
      html += `
        <div style="margin-bottom:var(--spacing-sm);">
          <div class="detail-article-label">💡 材料記事</div>
          <div class="detail-article">${escapeHtml(item.materialArticle)}</div>
        </div>
      `;
    }
    if (item.shikihoComment) {
      html += `
        <div>
          <div class="detail-article-label">💬 四季報コメント</div>
          <div class="detail-article">${escapeHtml(item.shikihoComment)}</div>
        </div>
      `;
    }
    html += `</div>`;
  }

  // Shareholders
  if (item.shareholders) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">株主情報</div>
        <div class="detail-article">${escapeHtml(item.shareholders)}</div>
      </div>
    `;
  }

  return html;
}

function buildRatingItem(label, rating, score) {
  return `
    <div class="rating-item">
      <div class="rating-item-label">${label}</div>
      ${rating ? `<span class="rating-badge rating-${rating}">${rating}</span>` : '<span style="color:var(--color-text-muted)">-</span>'}
      ${score != null ? `<div style="font-size:0.75rem; color:var(--color-text-secondary); margin-top:4px;">Score: ${score} pts</div>` : ''}
    </div>
  `;
}

function buildDataItem(label, value) {
  return `
    <div class="detail-data-item">
      <div class="detail-data-label">${label}</div>
      <div class="detail-data-value">${value}</div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// Register Modal
// ============================================================
async function openRegisterModal(editId) {
  const modal = document.getElementById('registerModal');
  const title = document.getElementById('registerModalTitle');
  const form = document.getElementById('registerForm');

  form.reset();
  document.getElementById('editId').value = '';
  document.getElementById('jsonPreview').classList.remove('active');
  document.getElementById('jsonPreview').innerHTML = '';
  document.getElementById('stockNameDisplay').textContent = 'コードを入力してください';
  document.getElementById('stockNameDisplay').className = 'stock-name-display empty';

  const { year, number } = parseIssueKey(AppState.currentIssueKey);
  document.getElementById('regIssueYear').value = year;
  document.getElementById('regIssueNumber').value = number;

  if (editId) {
    title.textContent = '✏️ 銘柄データ編集';
    const item = await DataStore.getById(editId);
    if (item) {
      populateForm(item);
      document.getElementById('editId').value = editId;
    }
  } else {
    title.textContent = '📝 銘柄データ登録';
  }

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeRegisterModal() {
  document.getElementById('registerModal').classList.remove('active');
  document.body.style.overflow = '';
}

function populateForm(item) {
  if (item.issueYear !== undefined && item.issueYear !== null) document.getElementById('regIssueYear').value = item.issueYear;
  if (item.issueNumber !== undefined && item.issueNumber !== null) document.getElementById('regIssueNumber').value = item.issueNumber;
  if (item.code) {
    document.getElementById('inputCode').value = item.code;
    updateStockNameDisplay(item.code);
  }
  document.getElementById('inputName').value = item.name || '';

  // 業種：まず保存済みの値を（空文字でも必ず）セットする
  document.getElementById('inputIndustry').value = item.industry || '';
  // 保存済みの業種が空の場合のみ、brand_masterから非同期で補完（既存値は上書きしない）
  if (!item.industry && item.code) {
    lookupBrandDetail(item.code).then(detail => {
      const el = document.getElementById('inputIndustry');
      if (detail && detail.industry && !el.value) {
        el.value = detail.industry;
      }
    });
  }
  
  // ステータス・キーワード
  document.getElementById('inputStatus').value = item.status || '';
  document.getElementById('inputKeywords').value = item.keywords || '';
  
  // 記事・株主
  document.getElementById('inputBusinessArticle').value = item.businessArticle || '';
  document.getElementById('inputMaterialArticle').value = item.materialArticle || '';
  document.getElementById('inputShareholders').value = item.shareholders || '';
  
  // 数値データ（0も許容するため null/undefined チェック）
  if (item.equityRatio != null) document.getElementById('inputEquityRatio').value = item.equityRatio;
  if (item.retainedEarnings != null) document.getElementById('inputRetainedEarnings').value = item.retainedEarnings;
  if (item.interestBearingDebt != null) document.getElementById('inputDebt').value = item.interestBearingDebt;
  if (item.roe != null) document.getElementById('inputRoe').value = item.roe;
  if (item.dividendYield != null) document.getElementById('inputDividendYield').value = item.dividendYield;
  if (item.payoutRatio != null) document.getElementById('inputPayoutRatio').value = item.payoutRatio;
  if (item.dividendCurrent != null) document.getElementById('inputDividendCurrent').value = item.dividendCurrent;
  if (item.dividendNext != null) document.getElementById('inputDividendNext').value = item.dividendNext;
  if (item.per != null) document.getElementById('inputPer').value = item.per;
  if (item.pbr != null) document.getElementById('inputPbr').value = item.pbr;
  if (item.marketCap != null) document.getElementById('inputMarketCap').value = item.marketCap;
  
  // 業績データ（JSON）
  if (item.earnings && Array.isArray(item.earnings) && item.earnings.length > 0) {
    document.getElementById('inputEarnings').value = JSON.stringify(item.earnings, null, 2);
  } else {
    document.getElementById('inputEarnings').value = '';
  }
  
  // スコア
  if (item.highDividendScore) {
    document.getElementById('inputHdBase').value = item.highDividendScore.base !== undefined ? item.highDividendScore.base : '';
    document.getElementById('inputHdBonus').value = item.highDividendScore.bonus !== undefined ? item.highDividendScore.bonus : '';
  }
  if (item.growthScore) {
    document.getElementById('inputGrBase').value = item.growthScore.base !== undefined ? item.growthScore.base : '';
    document.getElementById('inputGrBonus').value = item.growthScore.bonus !== undefined ? item.growthScore.bonus : '';
  }
  
  // 評価（レーティング）
  if (item.ratings) {
    document.getElementById('inputRatingDiv').value = item.ratings.dividendPower || '';
    document.getElementById('inputRatingFin').value = item.ratings.financialSafety || '';
    document.getElementById('inputRatingEarn').value = item.ratings.earningsPower || '';
    document.getElementById('inputRatingFuture').value = item.ratings.futureScenario || '';
    document.getElementById('inputRatingValue').value = item.ratings.valueGap || '';
  }
  
  // スコア（新設カラム）
  document.getElementById('inputScoreDiv').value = item.dividendScore !== undefined && item.dividendScore !== null ? item.dividendScore : '';
  document.getElementById('inputScoreFin').value = item.financialScore !== undefined && item.financialScore !== null ? item.financialScore : '';
  document.getElementById('inputScoreEarn').value = item.earningScore !== undefined && item.earningScore !== null ? item.earningScore : '';
  document.getElementById('inputScoreFuture').value = item.futureScore !== undefined && item.futureScore !== null ? item.futureScore : '';
  document.getElementById('inputScoreValue').value = item.valuationScore !== undefined && item.valuationScore !== null ? item.valuationScore : '';
  
  // 四季報コメント
  document.getElementById('inputShikihoComment').value = item.shikihoComment || '';
}

// 登録フォームでの自動計算の即時反映
function setupDynamicScoreEvents() {
  const ratingSelects = [
    'inputRatingDiv',
    'inputRatingFin',
    'inputRatingEarn',
    'inputRatingFuture',
    'inputRatingValue'
  ];
  
  ratingSelects.forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      const ratings = {
        dividendPower: document.getElementById('inputRatingDiv').value,
        financialSafety: document.getElementById('inputRatingFin').value,
        earningsPower: document.getElementById('inputRatingEarn').value,
        futureScenario: document.getElementById('inputRatingFuture').value,
        valueGap: document.getElementById('inputRatingValue').value
      };
      
      const hdBase = calculateBaseScore(ratings, 'highDividend');
      const grBase = calculateBaseScore(ratings, 'growth');
      
      document.getElementById('inputHdBase').value = hdBase;
      document.getElementById('inputGrBase').value = grBase;
    });
  });
}

function collectFormData() {
  const year = parseInt(document.getElementById('regIssueYear').value);
  const number = parseInt(document.getElementById('regIssueNumber').value);

  const ratings = {
    dividendPower: document.getElementById('inputRatingDiv').value || null,
    financialSafety: document.getElementById('inputRatingFin').value || null,
    earningsPower: document.getElementById('inputRatingEarn').value || null,
    futureScenario: document.getElementById('inputRatingFuture').value || null,
    valueGap: document.getElementById('inputRatingValue').value || null,
  };

  const hdBaseAuto = calculateBaseScore(ratings, 'highDividend');
  const grBaseAuto = calculateBaseScore(ratings, 'growth');
  
  const hdBase = parseFloat(document.getElementById('inputHdBase').value) || hdBaseAuto;
  const hdBonus = parseFloat(document.getElementById('inputHdBonus').value) || 0;
  const grBase = parseFloat(document.getElementById('inputGrBase').value) || grBaseAuto;
  const grBonus = parseFloat(document.getElementById('inputGrBonus').value) || 0;

  let earnings = [];
  try {
    const earningsStr = document.getElementById('inputEarnings').value.trim();
    if (earningsStr) earnings = JSON.parse(earningsStr);
  } catch (e) { /* ignore */ }

  return {
    issueYear: year,
    issueNumber: number,
    issueLabel: getIssueLabel(year, number),
    issueKey: getIssueKey(year, number),
    code: document.getElementById('inputCode').value.trim(),
    name: document.getElementById('inputName').value.trim(),
    industry: document.getElementById('inputIndustry').value.trim(),
    status: document.getElementById('inputStatus').value,
    keywords: document.getElementById('inputKeywords').value.trim(),
    businessArticle: document.getElementById('inputBusinessArticle').value.trim(),
    materialArticle: document.getElementById('inputMaterialArticle').value.trim(),
    shareholders: document.getElementById('inputShareholders').value.trim(),
    equityRatio: parseFloat(document.getElementById('inputEquityRatio').value) || null,
    retainedEarnings: parseFloat(document.getElementById('inputRetainedEarnings').value) || null,
    interestBearingDebt: parseFloat(document.getElementById('inputDebt').value) || null,
    roe: parseFloat(document.getElementById('inputRoe').value) || null,
    dividendCurrent: parseFloat(document.getElementById('inputDividendCurrent').value) || null,
    dividendNext: parseFloat(document.getElementById('inputDividendNext').value) || null,
    dividendYield: parseFloat(document.getElementById('inputDividendYield').value) || null,
    payoutRatio: parseFloat(document.getElementById('inputPayoutRatio').value) || null,
    earnings: earnings,
    per: parseFloat(document.getElementById('inputPer').value) || null,
    pbr: parseFloat(document.getElementById('inputPbr').value) || null,
    marketCap: parseFloat(document.getElementById('inputMarketCap').value) || null,
    highDividendScore: { base: hdBase, bonus: hdBonus, total: hdBase + hdBonus },
    growthScore: { base: grBase, bonus: grBonus, total: grBase + grBonus },
    ratings: ratings,
    dividendScore: parseInt(document.getElementById('inputScoreDiv').value) || null,
    financialScore: parseInt(document.getElementById('inputScoreFin').value) || null,
    earningScore: parseInt(document.getElementById('inputScoreEarn').value) || null,
    futureScore: parseInt(document.getElementById('inputScoreFuture').value) || null,
    valuationScore: parseInt(document.getElementById('inputScoreValue').value) || null,
    shikihoComment: document.getElementById('inputShikihoComment').value.trim()
  };
}

async function saveForm() {
  const editId = document.getElementById('editId').value;
  const data = collectFormData();

  if (!data.code) {
    showToast('⚠️ 銘柄コードを入力してください');
    return;
  }

  if (!data.name) {
    data.name = await lookupBrandName(data.code) || '新規銘柄';
  }

  if (editId) {
    const updated = await DataStore.update(editId, data);
    if (!updated) {
      showToast('❌ 更新に失敗しました。Supabaseの接続やテーブル設定（setup.sql）を確認してください。');
      return;
    }
    showToast('✅ 銘柄データを更新しました');
  } else {
    const added = await DataStore.add(data);
    if (!added) {
      showToast('❌ 登録に失敗しました。Supabaseの接続やテーブル設定（setup.sql）を確認してください。');
      return;
    }
    showToast('✅ 銘柄を登録しました');
  }

  closeRegisterModal();
  await renderTable();
}

// ============================================================
// JSON Parsing
// ============================================================
function parseJsonInput() {
  const text = document.getElementById('jsonInputText').value.trim();
  if (!text) {
    showToast('⚠️ JSONテキストを入力してください');
    return;
  }

  try {
    const parsed = JSON.parse(text);
    applyParsedJson(parsed);
    showJsonPreview(parsed);
    showToast('✅ JSONの解析に成功しました');
  } catch (e) {
    showToast('❌ JSON of format incorrect: ' + e.message);
  }
}

async function applyParsedJson(data) {
  const mapping = {
    code: 'inputCode',
    name: 'inputName',
    businessArticle: 'inputBusinessArticle',
    materialArticle: 'inputMaterialArticle',
    shareholders: 'inputShareholders',
    equityRatio: 'inputEquityRatio',
    retainedEarnings: 'inputRetainedEarnings',
    interestBearingDebt: 'inputDebt',
    roe: 'inputRoe',
    dividendYield: 'inputDividendYield',
    payoutRatio: 'inputPayoutRatio',
    dividendCurrent: 'inputDividendCurrent',
    dividendNext: 'inputDividendNext',
    per: 'inputPer',
    pbr: 'inputPbr',
    marketCap: 'inputMarketCap',
  };

  for (const [key, inputId] of Object.entries(mapping)) {
    if (data[key] !== undefined && data[key] !== null) {
      document.getElementById(inputId).value = data[key];
    }
  }

  if (data.keywords) {
    if (Array.isArray(data.keywords)) {
      document.getElementById('inputKeywords').value = data.keywords.join(', ');
    } else {
      document.getElementById('inputKeywords').value = data.keywords;
    }
  }

  if (data.industry) {
    document.getElementById('inputIndustry').value = data.industry;
  }
  if (data.status) {
    document.getElementById('inputStatus').value = data.status;
  }

  if (data.code) {
    await updateStockNameDisplay(data.code);
  }

  if (data.earnings && Array.isArray(data.earnings)) {
    document.getElementById('inputEarnings').value = JSON.stringify(data.earnings);
  }

  if (data.ratings) {
    const ratingMap = {
      dividendPower: 'inputRatingDiv',
      financialSafety: 'inputRatingFin',
      earningsPower: 'inputRatingEarn',
      futureScenario: 'inputRatingFuture',
      valueGap: 'inputRatingValue',
    };
    for (const [key, inputId] of Object.entries(ratingMap)) {
      if (data.ratings[key]) document.getElementById(inputId).value = data.ratings[key];
    }
  }

  const ratings = {
    dividendPower: document.getElementById('inputRatingDiv').value,
    financialSafety: document.getElementById('inputRatingFin').value,
    earningsPower: document.getElementById('inputRatingEarn').value,
    futureScenario: document.getElementById('inputRatingFuture').value,
    valueGap: document.getElementById('inputRatingValue').value
  };
  
  const hdBase = calculateBaseScore(ratings, 'highDividend');
  const grBase = calculateBaseScore(ratings, 'growth');
  
  document.getElementById('inputHdBase').value = hdBase;
  document.getElementById('inputGrBase').value = grBase;

  if (data.highDividendScore && data.highDividendScore.bonus != null) {
    document.getElementById('inputHdBonus').value = data.highDividendScore.bonus;
  }
  if (data.growthScore && data.growthScore.bonus != null) {
    document.getElementById('inputGrBonus').value = data.growthScore.bonus;
  }
}

function showJsonPreview(data) {
  const preview = document.getElementById('jsonPreview');
  const items = [];
  if (data.code) items.push(`<div class="preview-item"><span class="preview-key">コード</span><span class="preview-value">${data.code}</span></div>`);
  if (data.name) items.push(`<div class="preview-item"><span class="preview-key">社名</span><span class="preview-value">${data.name}</span></div>`);
  if (data.dividendYield) items.push(`<div class="preview-item"><span class="preview-key">配当利回り</span><span class="preview-value">${data.dividendYield}%</span></div>`);
  if (data.per) items.push(`<div class="preview-item"><span class="preview-key">PER</span><span class="preview-value">${data.per}倍</span></div>`);
  if (data.pbr) items.push(`<div class="preview-item"><span class="preview-key">PBR</span><span class="preview-value">${data.pbr}倍</span></div>`);
  if (data.equityRatio) items.push(`<div class="preview-item"><span class="preview-key">自己資本比率</span><span class="preview-value">${data.equityRatio}%</span></div>`);

  if (items.length > 0) {
    preview.innerHTML = '<div style="font-weight:600;color:var(--color-positive);margin-bottom:4px;">✅ 解析結果</div>' + items.join('');
    preview.classList.add('active');
  }
}

// ============================================================
// Stock Code Input (Supabase Auto-suggest)
// ============================================================
function initCodeInput() {
  const input = document.getElementById('inputCode');
  const nameInput = document.getElementById('inputName');
  const suggestions = document.getElementById('suggestionList');

  input.addEventListener('input', async () => {
    const code = input.value.trim();
    await updateStockNameDisplay(code);

    const detail = await lookupBrandDetail(code);
    if (detail) {
      // 社名は常に自動補完
      nameInput.value = detail.name || '';
      // 業種は現在フィールドが空の場合のみ補完（編集モード時に既存値を消さない）
      const industryEl = document.getElementById('inputIndustry');
      if (!industryEl.value && detail.industry) {
        industryEl.value = detail.industry;
      }
    }

    if (code.length >= 1) {
      const results = await searchBrandFromDb(code);
      if (results.length > 0) {
        suggestions.innerHTML = results.map(r =>
          `<div class="suggestion-item" data-code="${r.code}">
            <span class="suggestion-code">${r.code}</span>
            <span class="suggestion-name">${r.name}</span>
          </div>`
        ).join('');
        suggestions.classList.add('active');

        suggestions.querySelectorAll('.suggestion-item').forEach(item => {
          item.addEventListener('click', async () => {
            input.value = item.dataset.code;
            const dbDetail = await lookupBrandDetail(item.dataset.code);
            nameInput.value = dbDetail ? dbDetail.name : '';
            // サジェストからの選択時は業種を上書き（新規選択なので上書きOK）
            if (dbDetail && dbDetail.industry) {
              document.getElementById('inputIndustry').value = dbDetail.industry;
            }
            await updateStockNameDisplay(item.dataset.code);
            suggestions.classList.remove('active');
          });
        });
      } else {
        suggestions.classList.remove('active');
      }
    } else {
      suggestions.classList.remove('active');
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => suggestions.classList.remove('active'), 250);
  });
}

async function updateStockNameDisplay(code) {
  const display = document.getElementById('stockNameDisplay');
  if (!code) {
    display.textContent = 'コードを入力してください';
    display.className = 'stock-name-display empty';
    return;
  }
  const name = await lookupBrandName(code);
  if (name) {
    display.textContent = name;
    display.className = 'stock-name-display';
  } else {
    display.textContent = '未登録の銘柄コード';
    display.className = 'stock-name-display not-found';
  }
}

// ============================================================
// Export / Import
// ============================================================
async function openExport() {
  const modal = document.getElementById('exportModal');
  document.getElementById('exportModalTitle').textContent = '📤 データエクスポート';
  document.getElementById('exportContent').style.display = 'block';
  document.getElementById('importContent').style.display = 'none';
  document.getElementById('btnCopyExport').style.display = '';
  document.getElementById('btnDoImport').style.display = 'none';
  document.getElementById('exportTextarea').value = await DataStore.exportAll();
  modal.classList.add('active');
}

function openImport() {
  const modal = document.getElementById('exportModal');
  document.getElementById('exportModalTitle').textContent = '📥 データインポート';
  document.getElementById('exportContent').style.display = 'none';
  document.getElementById('importContent').style.display = 'block';
  document.getElementById('btnCopyExport').style.display = 'none';
  document.getElementById('btnDoImport').style.display = '';
  document.getElementById('importTextarea').value = '';
  modal.classList.add('active');
}

function closeExportModal() {
  document.getElementById('exportModal').classList.remove('active');
}

function doExportCopy() {
  const textarea = document.getElementById('exportTextarea');
  textarea.select();
  navigator.clipboard.writeText(textarea.value).then(() => {
    showToast('📋 クリップボードにコピーしました');
  }).catch(() => {
    document.execCommand('copy');
    showToast('📋 コピーしました');
  });
}

async function doImport() {
  const text = document.getElementById('importTextarea').value.trim();
  if (!text) {
    showToast('⚠️ データを入力してください');
    return;
  }
  try {
    await DataStore.importAll(text);
    showToast('✅ インポート完了');
    closeExportModal();
    await renderTable();
  } catch (e) {
    showToast('❌ インポート失敗: ' + e.message);
  }
}

// ============================================================
// Confirm Dialog
// ============================================================
let confirmCallback = null;

function showConfirm(message, callback) {
  document.getElementById('confirmMessage').textContent = message;
  confirmCallback = callback;
  document.getElementById('confirmOverlay').classList.add('active');
}

function hideConfirm() {
  document.getElementById('confirmOverlay').classList.remove('active');
  confirmCallback = null;
}

// ============================================================
// Toast
// ============================================================
let toastTimer;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
  }, 2500);
}

// ============================================================
// Google Spreadsheet Sync Logic & Parsing
// ============================================================
function parseCSV(text) {
  const lines = [];
  let row = [""];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i+1];
    if (inQuotes) {
      if (c === '"') {
        if (next === '"') {
          row[row.length - 1] += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        row[row.length - 1] += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push("");
      } else if (c === '\r' || c === '\n') {
        if (c === '\r' && next === '\n') {
          i++;
        }
        lines.push(row);
        row = [""];
      } else {
        row[row.length - 1] += c;
      }
    }
  }
  if (row.length > 1 || row[0] !== "") {
    lines.push(row);
  }
  return lines;
}

async function syncMasterData() {
  alert('GAS（スプレッドシート版）に移行したため、マスタ同期ボタンは不要になりました。スプレッドシートの brand_master シートを直接編集してください。');
}


// ============================================================
// Event Bindings
// ============================================================
function initEvents() {
  // FAB
  document.getElementById('fabAdd').addEventListener('click', () => openRegisterModal());

  // Register modal
  document.getElementById('registerModalClose').addEventListener('click', closeRegisterModal);
  document.getElementById('btnCancelForm').addEventListener('click', closeRegisterModal);
  document.getElementById('btnSaveForm').addEventListener('click', saveForm);
  document.getElementById('btnParseJson').addEventListener('click', parseJsonInput);

  // Detail
  document.getElementById('detailClose').addEventListener('click', hideDetail);
  document.getElementById('detailOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('detailOverlay')) hideDetail();
  });
  document.getElementById('btnDetailEdit').addEventListener('click', () => {
    if (AppState.selectedId) {
      hideDetail();
      openRegisterModal(AppState.selectedId);
    }
  });
  document.getElementById('btnDetailDelete').addEventListener('click', () => {
    if (AppState.selectedId) {
      showConfirm('この銘柄を削除してもよろしいですか？', async () => {
        await DataStore.remove(AppState.selectedId);
        hideDetail();
        await renderTable();
        showToast('🗑️ 削除しました');
      });
    }
  });

  // Confirm
  document.getElementById('btnConfirmCancel').addEventListener('click', hideConfirm);
  document.getElementById('btnConfirmOk').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    hideConfirm();
  });

  // Export / Import
  document.getElementById('btnExport').addEventListener('click', openExport);
  document.getElementById('btnImport').addEventListener('click', openImport);
  document.getElementById('exportModalClose').addEventListener('click', closeExportModal);
  document.getElementById('btnExportClose').addEventListener('click', closeExportModal);
  document.getElementById('btnCopyExport').addEventListener('click', doExportCopy);
  document.getElementById('btnDoImport').addEventListener('click', doImport);

  // Sync Button
  document.getElementById('btnSyncMaster').addEventListener('click', syncMasterData);

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.getElementById('confirmOverlay').classList.contains('active')) {
        hideConfirm();
      } else if (document.getElementById('registerModal').classList.contains('active')) {
        closeRegisterModal();
      } else if (document.getElementById('detailOverlay').classList.contains('active')) {
        hideDetail();
      } else if (document.getElementById('exportModal').classList.contains('active')) {
        closeExportModal();
      }
    }
  });

  // Modal overlay clicks
  document.getElementById('registerModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('registerModal')) closeRegisterModal();
  });
  document.getElementById('exportModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('exportModal')) closeExportModal();
  });
  
  setupDynamicScoreEvents();
}

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await DataStore.init();
  initIssueSelector();
  initSort();
  initSearch();
  initCodeInput();
  initEvents();
  await renderTable();
});
