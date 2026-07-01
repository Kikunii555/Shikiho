/**
 * ShikihoAI - 四季報AI評価ツール
 * メインアプリケーション (Supabase & Googleスプレッドシート連携版 - 重複エラー修正済)
 */

// ============================================================
// Constants & Config
// ============================================================
let supabaseClient = null; // window.supabase との競合を避けるため別名で定義
let scoreSettingsMap = {}; // 配点マスタキャッシュ用

const DEFAULT_SCORE_SETTINGS = {
  '④': { item_name: '将来性・成長ストーリー①', dividend_base_score: 3, growth_base_score: 12 },
  '⑤': { item_name: '将来性・成長ストーリー②', dividend_base_score: 3, growth_base_score: 12 },
  '⑥': { item_name: '財務健全性', dividend_base_score: 20, growth_base_score: 10 },
  '⑦': { item_name: '将来性・成長ストーリー③', dividend_base_score: 2, growth_base_score: 13 },
  '⑧': { item_name: '配当・還元方針', dividend_base_score: 50, growth_base_score: 10 },
  '⑨': { item_name: '稼ぐ力・収益性', dividend_base_score: 10, growth_base_score: 20 },
  '⑩': { item_name: '将来性・成長ストーリー④', dividend_base_score: 2, growth_base_score: 13 },
  '⑪': { item_name: '割安度・株価位置', dividend_base_score: 10, growth_base_score: 10 }
};


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
  filterIndustries: [],
  filterSettlement: '',
  filterStatus: '',
  selectedId: null,
  uncheckedCodes: new Set()
};

function loadUncheckedCodes() {
  try {
    const saved = localStorage.getItem('shikiho_unchecked_codes');
    if (saved) {
      AppState.uncheckedCodes = new Set(JSON.parse(saved));
    } else {
      AppState.uncheckedCodes = new Set();
    }
  } catch (e) {
    console.error('Failed to load unchecked codes:', e);
    AppState.uncheckedCodes = new Set();
  }
}

function saveUncheckedCodes() {
  try {
    localStorage.setItem('shikiho_unchecked_codes', JSON.stringify(Array.from(AppState.uncheckedCodes)));
  } catch (e) {
    console.error('Failed to save unchecked codes:', e);
  }
}

// ============================================================
// Supabase Mapping Utilities
// ============================================================
function safeNumVal(val) {
  if (val === null || val === undefined || val === '') return null;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? null : parsed;
}

function mapEvaluationToDb(item) {
  const issueYear = item.issueYear !== undefined ? item.issueYear : item.issue_year;
  const issueNumber = item.issueNumber !== undefined ? item.issueNumber : item.issue_number;
  const issueLabel = item.issueLabel !== undefined ? item.issueLabel : item.issue_label;
  const issueKey = item.issueKey !== undefined ? item.issueKey : item.issue_key;
  const businessArticle = item.businessArticle !== undefined ? item.businessArticle : item.business_article;
  const materialArticle = item.materialArticle !== undefined ? item.materialArticle : item.material_article;
  const equityRatio = item.equityRatio !== undefined ? item.equityRatio : item.equity_ratio;
  const retainedEarnings = item.retainedEarnings !== undefined ? item.retainedEarnings : item.retained_earnings;
  const interestBearingDebt = item.interestBearingDebt !== undefined ? item.interestBearingDebt : item.interest_bearing_debt;
  const dividendCurrent = item.dividendCurrent !== undefined ? item.dividendCurrent : item.dividend_current;
  const dividendNext = item.dividendNext !== undefined ? item.dividendNext : item.dividend_next;
  const dividendYield = item.dividendYield !== undefined ? item.dividendYield : item.dividend_yield;
  const payoutRatio = item.payoutRatio !== undefined ? item.payoutRatio : item.payout_ratio;
  const highDividendScore = item.highDividendScore !== undefined ? item.highDividendScore : item.high_dividend_score;
  const growthScore = item.growthScore !== undefined ? item.growthScore : item.growth_score;
  const dividendScore = item.dividendScore !== undefined ? item.dividendScore : item.dividend_score;
  const financialScore = item.financialScore !== undefined ? item.financialScore : item.financial_score;
  const earningScore = item.earningScore !== undefined ? item.earningScore : item.earning_score;
  const futureScore = item.futureScore !== undefined ? item.futureScore : item.future_score;
  const valuationScore = item.valuationScore !== undefined ? item.valuationScore : item.valuation_score;
  const shikihoComment = item.shikihoComment !== undefined ? item.shikihoComment : item.shikiho_comment;
  const opMargin = item.opMargin !== undefined ? item.opMargin : item.op_margin;
  const ordinaryMargin = item.ordinaryMargin !== undefined ? item.ordinaryMargin : item.ordinary_margin;
  const revenueGrowth = item.revenueGrowth !== undefined ? item.revenueGrowth : item.revenue_growth;
  const opProfitGrowth = item.opProfitGrowth !== undefined ? item.opProfitGrowth : item.op_profit_growth;
  const epsGrowth = item.epsGrowth !== undefined ? item.epsGrowth : item.eps_growth;
  const opCashflow = item.opCashflow !== undefined ? item.opCashflow : item.op_cashflow;
  const invCashflow = item.invCashflow !== undefined ? item.invCashflow : item.inv_cashflow;
  const freeCashflow = item.freeCashflow !== undefined ? item.freeCashflow : item.free_cashflow;
  const cashEquiv = item.cashEquiv !== undefined ? item.cashEquiv : item.cash_equiv;
  const consecDivYears = item.consecDivYears !== undefined ? item.consecDivYears : item.consec_div_years;
  const rndExpense = item.rndExpense !== undefined ? item.rndExpense : item.rnd_expense;
  const overseasRatio = item.overseasRatio !== undefined ? item.overseasRatio : item.overseas_ratio;

  return {
    id: item.id || undefined,
    issue_year: safeNumVal(issueYear),
    issue_number: safeNumVal(issueNumber),
    issue_label: issueLabel ? (String(issueLabel).startsWith("'") ? issueLabel : "'" + issueLabel) : '',
    issue_key: issueKey ? (String(issueKey).startsWith("'") ? issueKey : "'" + issueKey) : '',
    code: item.code,
    name: item.name,
    business_article: businessArticle,
    material_article: materialArticle,
    shareholders: item.shareholders,
    equity_ratio: safeNumVal(equityRatio),
    retained_earnings: safeNumVal(retainedEarnings),
    interest_bearing_debt: safeNumVal(interestBearingDebt),
    roe: safeNumVal(item.roe),
    dividend_current: safeNumVal(dividendCurrent),
    dividend_next: safeNumVal(dividendNext),
    dividend_yield: safeNumVal(dividendYield),
    payout_ratio: safeNumVal(payoutRatio),
    earnings: item.earnings,
    per: safeNumVal(item.per),
    pbr: safeNumVal(item.pbr),
    market_cap: safeNumVal(item.marketCap),
    high_dividend_score: highDividendScore,
    growth_score: growthScore,
    ratings: item.ratings,
    keywords: item.keywords ? String(item.keywords).replace(/^'([\+-]?)/, '$1') : '',
    industry: item.industry,
    market: item.market,
    status: item.status,
    dividend_score: safeNumVal(dividendScore),
    financial_score: safeNumVal(financialScore),
    earning_score: safeNumVal(earningScore),
    future_score: safeNumVal(futureScore),
    valuation_score: safeNumVal(valuationScore),
    shikiho_comment: shikihoComment,
    op_margin: safeNumVal(opMargin),
    ordinary_margin: safeNumVal(ordinaryMargin),
    eps: safeNumVal(item.eps),
    bps: safeNumVal(item.bps),
    revenue_growth: safeNumVal(revenueGrowth),
    op_profit_growth: safeNumVal(opProfitGrowth),
    eps_growth: safeNumVal(epsGrowth),
    op_cashflow: safeNumVal(opCashflow),
    inv_cashflow: safeNumVal(invCashflow),
    free_cashflow: safeNumVal(freeCashflow),
    cash_equiv: safeNumVal(cashEquiv),
    consec_div_years: safeNumVal(consecDivYears),
    doe: safeNumVal(item.doe),
    rnd_expense: safeNumVal(rndExpense),
    capex: safeNumVal(item.capex),
    employees: safeNumVal(item.employees),
    overseas_ratio: safeNumVal(overseasRatio),
    settlement: item.settlement || '',
    updated_at: new Date().toISOString()
  };
}

function safeParseFloat(val) {
  if (val == null || val === '') return null;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? null : parsed;
}

function safeParseInt(val) {
  if (val == null || val === '') return null;
  const parsed = parseInt(val);
  return isNaN(parsed) ? null : parsed;
}

function mapEvaluationFromDb(row) {
  // まず基本データをオブジェクトとして構築します
  const item = {
    id: row.id,
    issueYear: row.issue_year,
    issueNumber: row.issue_number,
    issueLabel: row.issue_label ? String(row.issue_label).replace(/^'/, '') : '',
    issueKey: row.issue_key ? String(row.issue_key).replace(/^'/, '') : '',
    code: row.code,
    name: row.name,
    businessArticle: row.business_article,
    materialArticle: row.material_article,
    shareholders: row.shareholders,
    equityRatio: safeParseFloat(row.equity_ratio),
    retainedEarnings: safeParseFloat(row.retained_earnings),
    interestBearingDebt: safeParseFloat(row.interest_bearing_debt),
    roe: safeParseFloat(row.roe),
    dividendCurrent: safeParseFloat(row.dividend_current),
    dividendNext: safeParseFloat(row.dividend_next),
    dividendYield: safeParseFloat(row.dividend_yield),
    payoutRatio: safeParseFloat(row.payout_ratio),
    earnings: row.earnings || [],
    per: safeParseFloat(row.per),
    pbr: safeParseFloat(row.pbr),
    marketCap: safeParseFloat(row.market_cap),
    keywords: row.keywords ? String(row.keywords).replace(/^'([\+-]?)/, '$1') : '',
    industry: row.industry || '',
    market: row.market || '',
    status: row.status || '',
    dividendScore: safeParseInt(row.dividend_score),
    financialScore: safeParseInt(row.financial_score),
    earningScore: safeParseInt(row.earning_score),
    futureScore: safeParseInt(row.future_score),
    valuationScore: safeParseInt(row.valuation_score),
    shikihoComment: row.shikiho_comment || '',
    opMargin: safeParseFloat(row.op_margin),
    ordinaryMargin: safeParseFloat(row.ordinary_margin),
    eps: safeParseFloat(row.eps),
    bps: safeParseFloat(row.bps),
    revenueGrowth: safeParseFloat(row.revenue_growth),
    opProfitGrowth: safeParseFloat(row.op_profit_growth),
    epsGrowth: safeParseFloat(row.eps_growth),
    opCashflow: safeParseFloat(row.op_cashflow),
    invCashflow: safeParseFloat(row.inv_cashflow),
    freeCashflow: safeParseFloat(row.free_cashflow),
    cashEquiv: safeParseFloat(row.cash_equiv),
    consecDivYears: safeParseInt(row.consec_div_years),
    doe: safeParseFloat(row.doe),
    rndExpense: safeParseFloat(row.rnd_expense),
    capex: safeParseFloat(row.capex),
    employees: safeParseInt(row.employees),
    overseasRatio: safeParseFloat(row.overseas_ratio),
    settlement: row.settlement || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

  // 1. 読み込んだ生データから、常に最新のルールで5大評価を自動計算して反映します
  item.ratings = autoCalculateRatings(item);

  // 2. 高配当/成長株のベーススコアも再計算
  const hdBase = calculateBaseScore(item.ratings, 'highDividend');
  const grBase = calculateBaseScore(item.ratings, 'growth');

  let hdBonus = 0;
  try {
    let rawHd = row.high_dividend_score;
    if (rawHd) {
      if (typeof rawHd === 'string') rawHd = JSON.parse(rawHd);
      hdBonus = (rawHd && rawHd.bonus != null) ? safeParseInt(rawHd.bonus) : 0;
    }
  } catch(e) {}
  item.highDividendScore = { base: hdBase, bonus: hdBonus || 0, total: hdBase + (hdBonus || 0) };

  let grBonus = 0;
  try {
    let rawGr = row.growth_score;
    if (rawGr) {
      if (typeof rawGr === 'string') rawGr = JSON.parse(rawGr);
      grBonus = (rawGr && rawGr.bonus != null) ? safeParseInt(rawGr.bonus) : 0;
    }
  } catch(e) {}
  item.growthScore = { base: grBase, bonus: grBonus || 0, total: grBase + (grBonus || 0) };

  return item;
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
      if (config.SUPABASE_URL && config.SUPABASE_KEY) {
        if (window.supabase) {
          supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_KEY);
          console.log('✅ Supabase initialized');
        } else {
          console.error('❌ Supabase SDK (window.supabase) が読み込まれていません。index.html を確認してください。');
        }
      } else {
        console.error('❌ config.json に SUPABASE_URL または SUPABASE_KEY が未設定です。');
      }
    } catch (e) {
      console.error('❌ Failed to initialize config:', e);
    }
  },

  async getAll() {
    if (!supabaseClient) return [];
    try {
      const { data, error } = await supabaseClient
        .from('shikiho_evaluations')
        .select('*')
        .order('code');
      if (error) throw error;
      return data.map(mapEvaluationFromDb).sort((a,b) => String(a.code || '').localeCompare(String(b.code || '')));
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
    if (!supabaseClient) return null;
    try {
      const dbRow = mapEvaluationToDb(item);
      delete dbRow.id; // DB側で自動生成 (UUID)
      const { data, error } = await supabaseClient
        .from('shikiho_evaluations')
        .insert([dbRow])
        .select()
        .single();
      if (error) throw error;
      return mapEvaluationFromDb(data);
    } catch (e) {
      console.error('Failed to add evaluation:', e);
      return null;
    }
  },

  async update(id, updates) {
    if (!supabaseClient) return null;
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
        market: 'market',
        status: 'status',
        dividendScore: 'dividend_score',
        financialScore: 'financial_score',
        earningScore: 'earning_score',
        futureScore: 'future_score',
        valuationScore: 'valuation_score',
        shikihoComment: 'shikiho_comment',
        opMargin: 'op_margin',
        ordinaryMargin: 'ordinary_margin',
        eps: 'eps',
        bps: 'bps',
        revenueGrowth: 'revenue_growth',
        opProfitGrowth: 'op_profit_growth',
        epsGrowth: 'eps_growth',
        opCashflow: 'op_cashflow',
        invCashflow: 'inv_cashflow',
        freeCashflow: 'free_cashflow',
        cashEquiv: 'cash_equiv',
        consecDivYears: 'consec_div_years',
        doe: 'doe',
        rndExpense: 'rnd_expense',
        capex: 'capex',
        employees: 'employees',
        overseasRatio: 'overseas_ratio',
        settlement: 'settlement'
      };

      for (const [jsKey, dbKey] of Object.entries(keyMapping)) {
        if (updates[jsKey] !== undefined) {
          let val = updates[jsKey];
          if ((jsKey === 'issueKey' || jsKey === 'issueLabel' || jsKey === 'keywords') && val) {
            if (typeof val === 'string' && !val.startsWith("'")) {
              val = "'" + val;
            }
          }
          dbRow[dbKey] = val;
        }
      }

      const { error } = await supabaseClient
        .from('shikiho_evaluations')
        .update(dbRow)
        .eq('id', id);
      if (error) throw error;
      return true;
    } catch (e) {
      console.error('Failed to update evaluation:', e);
      return null;
    }
  },

  async remove(id) {
    if (!supabaseClient) return;
    try {
      const { error } = await supabaseClient
        .from('shikiho_evaluations')
        .delete()
        .eq('id', id);
      if (error) throw error;
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
    if (!supabaseClient) return;
    try {
      const items = JSON.parse(jsonStr);
      if (!Array.isArray(items)) throw new Error('JSON data must be an array');
      
      const { error: delError } = await supabaseClient
        .from('shikiho_evaluations')
        .delete()
        .neq('code', '0000'); // code が '0000' でないものを全削除（全件削除）
      if (delError) throw delError;

      const dbRows = items.map(mapEvaluationToDb).map(row => {
        if (!row.id) delete row.id;
        return row;
      });

      const { error: insError } = await supabaseClient
        .from('shikiho_evaluations')
        .insert(dbRows);
      if (insError) throw insError;
    } catch(e) {
      throw new Error('インポートに失敗しました: ' + e.message);
    }
  }
};

async function loadScoreSettings() {
  if (!gasAppUrl) return;
  try {
    const res = await fetch(`${gasAppUrl}?sheet=score_settings&t=${new Date().getTime()}`, {
      cache: 'no-store'
    });
    const json = await res.json();
    if (json.success && Array.isArray(json.data) && json.data.length > 0) {
      // Validate that returned data actually contains score settings
      const firstItem = json.data[0];
      if (firstItem && 'item_no' in firstItem) {
        scoreSettingsMap = {};
        json.data.forEach(item => {
          scoreSettingsMap[item.item_no] = {
            item_name: item.item_name,
            dividend_base_score: parseInt(item.dividend_base_score) || 0,
            growth_base_score: parseInt(item.growth_base_score) || 0,
            description: item.description || ''
          };
        });
        console.log('✅ Score settings loaded:', scoreSettingsMap);
        return;
      }
    }
    console.warn('⚠️ Invalid or empty score settings from GAS, falling back to default settings.');
  } catch (e) {
    console.error('❌ Failed to load score settings:', e);
  }
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
  if (!ratings) {
    return 100;
  }
  const settings = (scoreSettingsMap && Object.keys(scoreSettingsMap).length > 0)
    ? scoreSettingsMap
    : DEFAULT_SCORE_SETTINGS;

  let totalBase = 0;
  for (const [itemNo, setting] of Object.entries(settings)) {
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
function normalizeMarketValue(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (s === '東証P' || s === '東P' || s === '東証一部' || s === 'プライム' || s.toLowerCase().includes('東p') || s.toLowerCase().includes('東証p') || s.toLowerCase().includes('prime') || s.toLowerCase() === 'p') return '東証P';
  if (s === '東証S' || s === '東S' || s === '東証二部' || s === 'スタンダード' || s.toLowerCase().includes('東s') || s.toLowerCase().includes('東証s') || s.toLowerCase().includes('standard') || s.toLowerCase() === 's') return '東証S';
  if (s === '東証G' || s === '東G' || s === 'マザーズ' || s === 'グロース' || s.toLowerCase().includes('東g') || s.toLowerCase().includes('東証g') || s.toLowerCase().includes('growth') || s.toLowerCase() === 'g') return '東証G';
  return 'その他';
}

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

function formatSettlement(val) {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  if (!str) return '';

  if (str.includes('/') || str.includes(',') || str.includes('中間') || str.includes('・')) {
    return str;
  }

  const match = str.match(/^(\d+)(?:月)?$/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num >= 1 && num <= 12) {
      const interim = (num + 6) > 12 ? (num + 6 - 12) : (num + 6);
      return `${num}月 (中間: ${interim}月)`;
    }
  }

  return str;
}

function calculateGrowthFromEarnings(earnings) {
  if (!Array.isArray(earnings) || earnings.length < 2) return null;

  const actuals = [];
  const forecasts = [];

  earnings.forEach(e => {
    const period = String(e.period || '').trim();
    if (!period) return;
    if (period.includes('予') || period.includes('会') || period.includes('cast')) {
      forecasts.push(e);
    } else {
      actuals.push(e);
    }
  });

  let actual = null;
  let forecast = null;

  if (actuals.length > 0 && forecasts.length > 0) {
    actual = actuals[actuals.length - 1];
    forecast = forecasts[0];
  } else {
    const sorted = [...earnings].sort((a, b) => String(a.period).localeCompare(String(b.period)));
    actual = sorted[sorted.length - 2];
    forecast = sorted[sorted.length - 1];
  }

  if (!actual || !forecast) return null;

  const result = {};

  if (actual.revenue && forecast.revenue) {
    const actRev = parseFloat(actual.revenue);
    const foreRev = parseFloat(forecast.revenue);
    if (actRev > 0) {
      result.revenueGrowth = Math.round(((foreRev - actRev) / actRev * 100) * 10) / 10;
    }
  }

  if (actual.opProfit !== undefined && actual.opProfit !== null && forecast.opProfit !== undefined && forecast.opProfit !== null) {
    const actOp = parseFloat(actual.opProfit);
    const foreOp = parseFloat(forecast.opProfit);
    if (actOp > 0) {
      result.opProfitGrowth = Math.round(((foreOp - actOp) / actOp * 100) * 10) / 10;
    }
  }

  if (actual.netProfit !== undefined && actual.netProfit !== null && forecast.netProfit !== undefined && forecast.netProfit !== null) {
    const actNet = parseFloat(actual.netProfit);
    const foreNet = parseFloat(forecast.netProfit);
    if (actNet > 0) {
      result.epsGrowth = Math.round(((foreNet - actNet) / actNet * 100) * 10) / 10;
    }
  }

  return result;
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
    case 'settlement': return item.settlement || '';
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

  // チェックボックスが外れている行（非表示リストに入っているもの）は非表示
  data = data.filter(d => !AppState.uncheckedCodes.has(d.code));

  // フィルター用の選択肢を元のデータから抽出して動的生成
  updateFilterOptions(data);

  // Search filter
  if (AppState.searchQuery) {
    const q = AppState.searchQuery.toLowerCase();
    data = data.filter(d =>
      (d.code && String(d.code).includes(q)) ||
      (d.name && d.name.toLowerCase().includes(q))
    );
  }

  // 業種フィルター（複数選択）
  if (AppState.filterIndustries && AppState.filterIndustries.length > 0) {
    data = data.filter(d => AppState.filterIndustries.includes(d.industry));
  }

  // 決算月フィルター
  if (AppState.filterSettlement) {
    data = data.filter(d => d.settlement === AppState.filterSettlement);
  }

  // ステータスフィルター
  if (AppState.filterStatus) {
    data = data.filter(d => d.status === AppState.filterStatus);
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
    
    // ヘッダーの全選択チェックボックスの状態を更新
    const headerSelectAll = document.getElementById('headerSelectAll');
    if (headerSelectAll) {
      const allData = await DataStore.getByIssue(AppState.currentIssueKey);
      const hasUnchecked = allData.some(d => AppState.uncheckedCodes.has(d.code));
      headerSelectAll.checked = !hasUnchecked;
    }
    return;
  }

  emptyState.classList.remove('visible');

  tbody.innerHTML = data.map(item => {
    const overall = computeOverallGrade(item);
    const isChecked = !AppState.uncheckedCodes.has(item.code) ? 'checked' : '';
    
    // 決算月の色分け（12月・6月は青、3月以外は赤）
    let settlementStyle = '';
    const sett = item.settlement || '';
    if (sett) {
      if (sett.includes('12月') || sett.includes('6月')) {
        settlementStyle = 'style="color: #2563eb;"';
      } else if (!sett.includes('3月')) {
        settlementStyle = 'style="color: #dc2626;"';
      }
    }

    return `
      <tr data-id="${item.id}">
        <td class="col-checkbox"><input type="checkbox" class="row-checkbox" data-code="${item.code}" ${isChecked}></td>
        <td class="col-code">${item.code || '-'}</td>
        <td class="col-name" title="${item.name || ''}">${item.name || '-'}</td>
        <td class="col-settlement" ${settlementStyle}>${item.settlement || '-'}</td>
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

  // Row checkbox click & change handlers
  tbody.querySelectorAll('.row-checkbox').forEach(cb => {
    cb.addEventListener('click', (e) => {
      e.stopPropagation(); // 詳細画面が開かないようにする
    });
    cb.addEventListener('change', () => {
      const code = cb.dataset.code;
      if (cb.checked) {
        AppState.uncheckedCodes.delete(code);
      } else {
        AppState.uncheckedCodes.add(code);
      }
      saveUncheckedCodes();
      renderTable();
    });
  });

  // Row click handlers
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      // ステータスセレクトボックスのクリック時は詳細を開かないようにガード
      if (e.target.classList.contains('status-select') || e.target.classList.contains('row-checkbox')) {
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

  // ヘッダーの全選択チェックボックスの状態を更新
  const headerSelectAll = document.getElementById('headerSelectAll');
  if (headerSelectAll) {
    const allData = await DataStore.getByIssue(AppState.currentIssueKey);
    const hasUnchecked = allData.some(d => AppState.uncheckedCodes.has(d.code));
    headerSelectAll.checked = !hasUnchecked;
  }
}

function renderStatusSelect(status) {
  const options = [
    { value: '', label: '- 未設定 -' },
    { value: '配当保有', label: '配当保有' },
    { value: '成長保有', label: '成長保有' },
    { value: '優待保有', label: '優待保有' },
    { value: '要注目', label: '要注目' },
    { value: '様子見', label: '様子見' },
    { value: '新規', label: '新規' },
    { value: '保留', label: '保留' },
    { value: '売却候補', label: '売却候補' }
  ];
  
  return `
    <select class="status-select" data-status="${status || ''}">
      ${options.map(opt => `<option value="${opt.value}" ${status === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
    </select>
  `;
}

function renderKeywords(keywords) {
  if (!keywords || typeof keywords !== 'string' || keywords.startsWith('#')) return '<span style="color:var(--color-text-tertiary)">-</span>';
  const parts = keywords.split(/[,，]/).map(kw => kw.trim()).filter(Boolean);
  if (parts.length === 0) return '<span style="color:var(--color-text-tertiary)">-</span>';

  const posKws = [];
  const negKws = [];

  parts.forEach(kw => {
    if (kw.startsWith('+')) {
      posKws.push(kw.substring(1));
    } else if (kw.startsWith('-')) {
      negKws.push(kw.substring(1));
    } else {
      posKws.push(kw);
    }
  });

  const renderLine = (kws, prefixClass) => {
    const showKws = kws.slice(0, 2);
    let lineHtml = showKws.map(kw => {
      return `<span class="${prefixClass}" title="${escapeHtml(kw)}">${escapeHtml(kw)}</span>`;
    }).join('');
    
    if (kws.length > 2) {
      lineHtml += '<span style="color:var(--color-text-muted); font-size:0.65rem; margin-left:2px; vertical-align:middle;">...</span>';
    }
    return lineHtml;
  };

  let html = '';
  if (posKws.length > 0) {
    html += `<div style="display:inline-flex; flex-wrap:nowrap; align-items:center; vertical-align:middle;">${renderLine(posKws, 'keyword-tag-positive')}</div>`;
  }
  if (negKws.length > 0) {
    if (html) html += '<br>';
    html += `<div style="display:inline-flex; flex-wrap:nowrap; align-items:center; vertical-align:middle;">${renderLine(negKws, 'keyword-tag-negative')}</div>`;
  }

  return html || '<span style="color:var(--color-text-tertiary)">-</span>';
}

function renderScoreCell(score) {
  if (!score) return '<span style="color:var(--color-text-tertiary)">-</span>';
  const total = score.total != null ? score.total : 0;
  
  let colorStyle = '';
  if (total >= 80) {
    colorStyle = 'style="color: #dc2626; font-weight: 700;"';
  } else if (total <= 40) {
    colorStyle = 'style="color: #2563eb; font-weight: 700;"';
  }

  return `
    <div class="score-cell">
      <span class="score-total-large" ${colorStyle}>${total}</span>
    </div>
  `;
}

function renderRatingBadge(rating) {
  if (!rating) return '<span style="color:var(--color-text-muted)">-</span>';
  return `<span class="rating-badge rating-${rating}">${rating}</span>`;
}

function updateFilterOptions(allDataInIssue) {
  const indOptionsContainer = document.getElementById('multiselectIndustryOptions');
  const settSelect = document.getElementById('filterSettlement');
  const statSelect = document.getElementById('filterStatus');

  if (!indOptionsContainer || !settSelect || !statSelect) return;

  const selectedSett = settSelect.value;
  const selectedStat = statSelect.value;

  const industries = new Set();
  const settlements = new Set();
  const statuses = new Set();

  allDataInIssue.forEach(item => {
    if (item.industry) industries.add(item.industry);
    if (item.settlement) settlements.add(item.settlement);
    if (item.status) statuses.add(item.status);
  });

  const indList = Array.from(industries).sort();
  const settList = Array.from(settlements).sort();
  const statList = Array.from(statuses).sort();

  // 業種リストの更新（現在有効なもののみ残す）
  AppState.filterIndustries = AppState.filterIndustries.filter(val => indList.includes(val));

  // チェックボックス一覧の生成
  indOptionsContainer.innerHTML = indList.map(val => {
    const checked = AppState.filterIndustries.includes(val) ? 'checked' : '';
    return `
      <label class="multiselect-option">
        <input type="checkbox" value="${val}" ${checked}>
        <span class="multiselect-option-text">${val}</span>
      </label>
    `;
  }).join('');

  // トリガーボタンテキストの更新
  updateMultiselectTriggerText();

  settSelect.innerHTML = '<option value="">- 全決算 -</option>' + 
    settList.map(val => `<option value="${val}">${val}</option>`).join('');
  statSelect.innerHTML = '<option value="">- 全ステータス -</option>' + 
    statList.map(val => `<option value="${val}">${val}</option>`).join('');

  if (settList.includes(selectedSett)) {
    settSelect.value = selectedSett;
  } else {
    AppState.filterSettlement = '';
  }

  if (statList.includes(selectedStat)) {
    statSelect.value = selectedStat;
  } else {
    AppState.filterStatus = '';
  }
}

function updateMultiselectTriggerText() {
  const triggerText = document.getElementById('multiselectIndustryText');
  if (!triggerText) return;

  if (!AppState.filterIndustries || AppState.filterIndustries.length === 0) {
    triggerText.textContent = '- 全業種 -';
    triggerText.style.color = '';
  } else {
    triggerText.textContent = AppState.filterIndustries.join(', ');
    triggerText.style.color = 'var(--color-text)'; // 選択中であることを強調
  }
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
    
    // フィルター状態とセレクトボックスをリセット
    const settSelect = document.getElementById('filterSettlement');
    const statSelect = document.getElementById('filterStatus');
    if (settSelect) settSelect.value = '';
    if (statSelect) statSelect.value = '';
    
    AppState.filterIndustries = [];
    AppState.filterSettlement = '';
    AppState.filterStatus = '';
    updateMultiselectTriggerText();
    
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

  const settEl = document.getElementById('detailSettlement');
  if (item.settlement) {
    settEl.textContent = '決算: ' + item.settlement;
    settEl.style.display = '';
  } else {
    settEl.textContent = '';
    settEl.style.display = 'none';
  }

  const indEl = document.getElementById('detailIndustry');
  if (item.industry) {
    indEl.textContent = item.industry;
    indEl.style.display = '';
  } else {
    indEl.textContent = '';
    indEl.style.display = 'none';
  }

  const marketEl = document.getElementById('detailMarket');
  if (item.market) {
    marketEl.textContent = item.market;
    marketEl.style.display = '';
  } else {
    marketEl.textContent = '';
    marketEl.style.display = 'none';
  }

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

  // Status Badge at top
  if (item.status) {
    html += `
      <div class="detail-section" style="margin-bottom: var(--spacing-sm); display: flex; align-items: center; gap: var(--spacing-sm); flex-wrap: wrap;">
        <span class="status-badge status-${item.status}">${escapeHtml(item.status)}</span>
      </div>
    `;
  }

  // Keywords tags at top (divided into positive & negative lines)
  if (item.keywords && typeof item.keywords === 'string' && !item.keywords.startsWith('#')) {
    const kws = item.keywords.split(/[,，]/).map(k => k.trim()).filter(Boolean);
    const posKws = [];
    const negKws = [];
    
    kws.forEach(kw => {
      if (kw.startsWith('+')) {
        posKws.push(kw.substring(1));
      } else if (kw.startsWith('-')) {
        negKws.push(kw.substring(1));
      } else {
        posKws.push(kw); // デフォルトはポジティブ扱い
      }
    });

    html += `
      <div class="detail-section" style="margin-bottom: var(--spacing-sm); display: flex; flex-direction: column; gap: 8px;">
    `;

    if (posKws.length > 0) {
      html += `
        <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
          ${posKws.map(kw => `<span class="keyword-tag-positive" style="font-size:0.75rem; padding:3px 10px; margin: 0 4px 4px 0;">👍 ${escapeHtml(kw)}</span>`).join('')}
        </div>
      `;
    }

    if (negKws.length > 0) {
      html += `
        <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
          ${negKws.map(kw => `<span class="keyword-tag-negative" style="font-size:0.75rem; padding:3px 10px; margin: 0 4px 4px 0;">👎 ${escapeHtml(kw)}</span>`).join('')}
        </div>
      `;
    }

    html += `
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

  // 財務比率計算
  const debtRatio = (item.retainedEarnings && item.interestBearingDebt) ? item.interestBearingDebt / item.retainedEarnings : null;
  const debtStatusClass = getFinancialStatusClass('debtRatio', debtRatio);

  // Financial Data
  html += `
    <div class="detail-section">
      <div class="detail-section-title">財務・配当データ</div>
      <div class="detail-data-grid">
        ${buildDataItem('自己資本比率', item.equityRatio != null ? item.equityRatio + '%' : '-', getFinancialStatusClass('equityRatio', item.equityRatio))}
        ${buildDataItem('利益剰余金', item.retainedEarnings != null ? item.retainedEarnings.toLocaleString() + '億円' : '-', debtStatusClass)}
        ${buildDataItem('有利子負債', item.interestBearingDebt != null ? item.interestBearingDebt.toLocaleString() + '億円' : '-', debtStatusClass)}
        ${buildDataItem('ROE', item.roe != null ? item.roe + '%' : '-', getFinancialStatusClass('roe', item.roe))}
        ${buildDataItem('配当利回り', item.dividendYield != null ? item.dividendYield + '%' : '-', getFinancialStatusClass('dividendYield', item.dividendYield))}
        ${buildDataItem('配当性向', item.payoutRatio != null ? item.payoutRatio + '%' : '-', getFinancialStatusClass('payoutRatio', item.payoutRatio))}
        ${buildDataItem('今期配当', item.dividendCurrent != null ? item.dividendCurrent + '円' : '-')}
        ${buildDataItem('来期配当', item.dividendNext != null ? item.dividendNext + '円' : '-')}
        ${buildDataItem('PER', item.per != null ? item.per + '倍' : '-', getFinancialStatusClass('per', item.per))}
        ${buildDataItem('PBR', item.pbr != null ? item.pbr + '倍' : '-', getFinancialStatusClass('pbr', item.pbr))}
        ${buildDataItem('時価総額', item.marketCap != null ? item.marketCap.toLocaleString() + '億円' : '-')}
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">収益性・成長性</div>
      <div class="detail-data-grid">
        ${buildDataItem('営業利益率', item.opMargin != null ? item.opMargin + '%' : '-', getFinancialStatusClass('opMargin', item.opMargin))}
        ${buildDataItem('経常利益率', item.ordinaryMargin != null ? item.ordinaryMargin + '%' : '-', getFinancialStatusClass('ordinaryMargin', item.ordinaryMargin))}
        ${buildDataItem('EPS', item.eps != null ? item.eps + '円' : '-')}
        ${buildDataItem('BPS', item.bps != null ? item.bps + '円' : '-')}
        ${buildDataItem('売上成長率', item.revenueGrowth != null ? item.revenueGrowth + '%' : '-', getFinancialStatusClass('revenueGrowth', item.revenueGrowth))}
        ${buildDataItem('営業利益成長率', item.opProfitGrowth != null ? item.opProfitGrowth + '%' : '-', getFinancialStatusClass('opProfitGrowth', item.opProfitGrowth))}
        ${buildDataItem('EPS成長率', item.epsGrowth != null ? item.epsGrowth + '%' : '-', getFinancialStatusClass('epsGrowth', item.epsGrowth))}
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">キャッシュフロー</div>
      <div class="detail-data-grid">
        ${buildDataItem('営業CF', item.opCashflow != null ? item.opCashflow.toLocaleString() + '億円' : '-', getFinancialStatusClass('opCashflow', item.opCashflow))}
        ${buildDataItem('投資CF', item.invCashflow != null ? item.invCashflow.toLocaleString() + '億円' : '-')}
        ${buildDataItem('フリーCF', item.freeCashflow != null ? item.freeCashflow.toLocaleString() + '億円' : '-', getFinancialStatusClass('freeCashflow', item.freeCashflow))}
        ${buildDataItem('現金等', item.cashEquiv != null ? item.cashEquiv.toLocaleString() + '億円' : '-')}
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">配当関連（拡充）</div>
      <div class="detail-data-grid">
        ${buildDataItem('連続増配年数', item.consecDivYears != null ? item.consecDivYears + '年' : '-')}
        ${buildDataItem('DOE', item.doe != null ? item.doe + '%' : '-')}
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">その他</div>
      <div class="detail-data-grid">
        ${buildDataItem('研究開発費', item.rndExpense != null ? item.rndExpense.toLocaleString() + '億円' : '-')}
        ${buildDataItem('設備投資', item.capex != null ? item.capex.toLocaleString() + '億円' : '-')}
        ${buildDataItem('従業員数', item.employees != null ? item.employees.toLocaleString() + '人' : '-')}
        ${buildDataItem('海外売上比率', item.overseasRatio != null ? item.overseasRatio + '%' : '-')}
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
    </div>
  `;
}

function buildDataItem(label, value, statusClass = '') {
  return `
    <div class="detail-data-item">
      <div class="detail-data-label">${label}</div>
      <div class="detail-data-value ${statusClass}">${value}</div>
    </div>
  `;
}

function getFinancialStatusClass(key, value) {
  if (value == null || isNaN(value)) return '';
  
  switch (key) {
    case 'equityRatio': // 自己資本比率
      if (value >= 70) return 'val-status-good';
      if (value < 15) return 'val-status-bad';
      break;
    case 'roe': // ROE
      if (value >= 15) return 'val-status-good';
      if (value < 3) return 'val-status-bad';
      break;
    case 'dividendYield': // 配当利回り
      if (value >= 4.0) return 'val-status-good';
      if (value < 1.0) return 'val-status-bad';
      break;
    case 'payoutRatio': // 配当性向
      if (value > 0 && value <= 40) return 'val-status-good';
      if (value > 80 || value <= 0) return 'val-status-bad';
      break;
    case 'per': // PER
      if (value > 0 && value <= 8.0) return 'val-status-good';
      if (value > 25.0 || value <= 0) return 'val-status-bad';
      break;
    case 'pbr': // PBR
      if (value > 0 && value <= 0.5) return 'val-status-good';
      if (value > 2.5 || value <= 0) return 'val-status-bad';
      break;
    case 'opMargin': // 営業利益率
      if (value >= 20.0) return 'val-status-good';
      if (value < 3.0) return 'val-status-bad';
      break;
    case 'ordinaryMargin': // 経常利益率
      if (value >= 20.0) return 'val-status-good';
      if (value < 3.0) return 'val-status-bad';
      break;
    case 'revenueGrowth': // 売上成長率
      if (value >= 20.0) return 'val-status-good';
      if (value < 0) return 'val-status-bad';
      break;
    case 'opProfitGrowth': // 営業利益成長率
      if (value >= 25.0) return 'val-status-good';
      if (value < 0) return 'val-status-bad';
      break;
    case 'epsGrowth': // EPS成長率
      if (value >= 20.0) return 'val-status-good';
      if (value < 0) return 'val-status-bad';
      break;
    case 'debtRatio': // 有利子負債/利益剰余金比率
      if (value <= 0.3) return 'val-status-good';
      if (value >= 2.0) return 'val-status-bad';
      break;
    case 'freeCashflow': // フリーCF (単位: 億円)
      if (value > 50) return 'val-status-good';
      if (value < 0) return 'val-status-bad';
      break;
    case 'opCashflow': // 営業CF (単位: 億円)
      if (value > 100) return 'val-status-good';
      if (value < 0) return 'val-status-bad';
      break;
  }
  return '';
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
  // 1. 🏢 銘柄基本情報
  if (item.issueYear !== undefined && item.issueYear !== null) document.getElementById('regIssueYear').value = item.issueYear;
  if (item.issueNumber !== undefined && item.issueNumber !== null) document.getElementById('regIssueNumber').value = item.issueNumber;
  if (item.code) {
    document.getElementById('inputCode').value = item.code;
    updateStockNameDisplay(item.code);
  }
  document.getElementById('inputName').value = item.name || '';
  document.getElementById('inputSettlement').value = item.settlement || '';
  document.getElementById('inputIndustry').value = item.industry || '';
  document.getElementById('inputMarket').value = normalizeMarketValue(item.market);
  if (!item.industry && item.code) {
    lookupBrandDetail(item.code).then(detail => {
      const el = document.getElementById('inputIndustry');
      if (detail && detail.industry && !el.value) {
        el.value = detail.industry;
      }
      const marketEl = document.getElementById('inputMarket');
      if (detail && detail.market && !marketEl.value) {
        marketEl.value = normalizeMarketValue(detail.market);
      }
    });
  }
  document.getElementById('inputStatus').value = item.status || '';
  
  let posKws = [];
  let negKws = [];
  if (item.keywords && typeof item.keywords === 'string' && !item.keywords.startsWith('#')) {
    item.keywords.split(/[,，]/).forEach(kw => {
      const trimKw = kw.trim();
      if (!trimKw) return;
      if (trimKw.startsWith('+')) {
        posKws.push(trimKw.substring(1));
      } else if (trimKw.startsWith('-')) {
        negKws.push(trimKw.substring(1));
      } else {
        // デフォルトはプラスキーワード扱い
        posKws.push(trimKw);
      }
    });
  }
  document.getElementById('inputPositiveKeywords').value = posKws.join(', ');
  document.getElementById('inputNegativeKeywords').value = negKws.join(', ');
  
  // 2. 📝 【特色・連結事業】
  document.getElementById('inputShareholders').value = item.shareholders || '';
  if (item.employees != null) document.getElementById('inputEmployees').value = item.employees;
  if (item.overseasRatio != null) document.getElementById('inputOverseasRatio').value = item.overseasRatio;

  // 3. 📰 【業績】
  document.getElementById('inputBusinessArticle').value = item.businessArticle || '';
  document.getElementById('inputMaterialArticle').value = item.materialArticle || '';
  if (item.earnings && Array.isArray(item.earnings) && item.earnings.length > 0) {
    document.getElementById('inputEarnings').value = JSON.stringify(item.earnings, null, 2);
  } else {
    document.getElementById('inputEarnings').value = '';
  }
  if (item.eps != null) document.getElementById('inputEps').value = item.eps;
  if (item.bps != null) document.getElementById('inputBps').value = item.bps;
  if (item.revenueGrowth != null) document.getElementById('inputRevenueGrowth').value = item.revenueGrowth;
  if (item.opProfitGrowth != null) document.getElementById('inputOpProfitGrowth').value = item.opProfitGrowth;
  if (item.epsGrowth != null) document.getElementById('inputEpsGrowth').value = item.epsGrowth;
  
  // 4. 💰 【財務・キャッシュフロー】
  if (item.equityRatio != null) document.getElementById('inputEquityRatio').value = item.equityRatio;
  if (item.retainedEarnings != null) document.getElementById('inputRetainedEarnings').value = item.retainedEarnings;
  if (item.interestBearingDebt != null) document.getElementById('inputDebt').value = item.interestBearingDebt;
  if (item.cashEquiv != null) document.getElementById('inputCashEquiv').value = item.cashEquiv;
  if (item.opCashflow != null) document.getElementById('inputOpCashflow').value = item.opCashflow;
  if (item.invCashflow != null) document.getElementById('inputInvCashflow').value = item.invCashflow;
  if (item.freeCashflow != null) document.getElementById('inputFreeCashflow').value = item.freeCashflow;
  
  // 5. 📊 【株価・指標・配当】
  if (item.marketCap != null) document.getElementById('inputMarketCap').value = item.marketCap;
  if (item.per != null) document.getElementById('inputPer').value = item.per;
  if (item.pbr != null) document.getElementById('inputPbr').value = item.pbr;
  if (item.roe != null) document.getElementById('inputRoe').value = item.roe;
  if (item.opMargin != null) document.getElementById('inputOpMargin').value = item.opMargin;
  if (item.ordinaryMargin != null) document.getElementById('inputOrdinaryMargin').value = item.ordinaryMargin;
  if (item.dividendYield != null) document.getElementById('inputDividendYield').value = item.dividendYield;
  if (item.payoutRatio != null) document.getElementById('inputPayoutRatio').value = item.payoutRatio;
  if (item.dividendCurrent != null) document.getElementById('inputDividendCurrent').value = item.dividendCurrent;
  if (item.dividendNext != null) document.getElementById('inputDividendNext').value = item.dividendNext;
  if (item.consecDivYears != null) document.getElementById('inputConsecDivYears').value = item.consecDivYears;
  if (item.doe != null) document.getElementById('inputDoe').value = item.doe;
  if (item.rndExpense != null) document.getElementById('inputRndExpense').value = item.rndExpense;
  if (item.capex != null) document.getElementById('inputCapex').value = item.capex;
  
  // 6. 💬 ユーザーメモ
  document.getElementById('inputShikihoComment').value = item.shikihoComment || '';
}

// setupDynamicScoreEvents は手動レーティング廃止により不要（互換性のため空関数として残す）
function setupDynamicScoreEvents() {
  // no-op: scores and ratings are now auto-calculated from raw data
}

// ============================================================
// Auto-Rating Calculation (5大評価の自動算出)
// ============================================================
function autoCalculateRatings(data) {
  const ratings = {
    dividendPower: calcDividendPowerRating(data),
    financialSafety: calcFinancialSafetyRating(data),
    earningsPower: calcEarningsPowerRating(data),
    futureScenario: calcFutureScenarioRating(data),
    valueGap: calcValueGapRating(data)
  };
  return ratings;
}

function ratingFromScore(score) {
  if (score >= 90) return 'S';
  if (score >= 75) return 'A';
  if (score >= 55) return 'B';
  if (score >= 35) return 'C';
  if (score >= 15) return 'D';
  return 'E';
}

// 配当力: 配当利回りによるベース点（最大60点）＋増配据置加点（最大40点）＋一発アウト判定
function calcDividendPowerRating(d) {
  if (d.dividendYield == null) {
    return null;
  }

  // 1. ベース点 (利回りベース、最大60点)
  let baseScore = 0;
  if (d.dividendYield >= 4.0) {
    baseScore = 60;
  } else if (d.dividendYield >= 3.0) {
    baseScore = 48;
  } else if (d.dividendYield >= 2.5) {
    baseScore = 36;
  } else if (d.dividendYield >= 2.0) {
    baseScore = 24;
  } else {
    baseScore = 12;
  }

  // 2. 加点ルール (来期予想、最大40点)
  let addScore = 0;
  let hasGrowthData = false;
  let divGrowth = 0;
  if (d.dividendNext != null && d.dividendCurrent != null && d.dividendCurrent > 0) {
    hasGrowthData = true;
    divGrowth = ((d.dividendNext - d.dividendCurrent) / d.dividendCurrent) * 100;
    
    if (divGrowth >= 10.0) {
      addScore = 40;
    } else if (divGrowth >= 5.0) {
      addScore = 32;
    } else if (divGrowth >= 1.0) {
      addScore = 24;
    } else if (divGrowth === 0.0) {
      addScore = 16;
    }
  }

  let totalScore = baseScore + addScore;

  // 3. 一発アウト判定 (強制的に合計0点)
  // - 「無配」「減配」の記載がある（記事テキスト）
  // - または、来期予想が今期を下回る（減配予想）
  let isOut = false;
  
  // 記事テキストチェック
  const checkText = (d.businessArticle || '') + ' ' + (d.materialArticle || '') + ' ' + (d.shikihoComment || '');
  if (checkText.includes('無配') || checkText.includes('減配')) {
    isOut = true;
  }
  
  // 数値上の減配予想
  if (hasGrowthData && divGrowth < 0) {
    isOut = true;
  }
  
  // 来期が今期より少ない
  if (d.dividendNext != null && d.dividendCurrent != null && d.dividendNext < d.dividendCurrent) {
    isOut = true;
  }

  if (isOut) {
    totalScore = 0;
  }

  return ratingFromScore(totalScore);
}

// 財務安全性: 自己資本比率・有利子負債/利益剰余金比率・現金等
function calcFinancialSafetyRating(d) {
  let score = 0, count = 0;
  if (d.equityRatio != null) { count++; score += d.equityRatio >= 70 ? 100 : d.equityRatio >= 50 ? 80 : d.equityRatio >= 30 ? 60 : d.equityRatio >= 15 ? 40 : 20; }
  if (d.retainedEarnings != null && d.interestBearingDebt != null && d.retainedEarnings > 0) {
    count++;
    const debtRatio = d.interestBearingDebt / d.retainedEarnings;
    score += debtRatio <= 0.3 ? 100 : debtRatio <= 0.7 ? 80 : debtRatio <= 1.2 ? 60 : debtRatio <= 2 ? 40 : 20;
  }
  if (d.cashEquiv != null && d.interestBearingDebt != null && d.interestBearingDebt > 0) {
    count++;
    const cashCover = d.cashEquiv / d.interestBearingDebt;
    score += cashCover >= 2 ? 100 : cashCover >= 1 ? 80 : cashCover >= 0.5 ? 60 : 30;
  } else if (d.cashEquiv != null) {
    count++; score += 90; // 無借金+現金保有
  }
  return count > 0 ? ratingFromScore(score / count) : null;
}

// 稼ぐ力: 営業利益率・ROE・EPS・営業CF
function calcEarningsPowerRating(d) {
  let score = 0, count = 0;
  if (d.opMargin != null) { count++; score += d.opMargin >= 20 ? 100 : d.opMargin >= 12 ? 80 : d.opMargin >= 7 ? 60 : d.opMargin >= 3 ? 40 : 20; }
  if (d.roe != null) { count++; score += d.roe >= 15 ? 100 : d.roe >= 10 ? 80 : d.roe >= 7 ? 60 : d.roe >= 3 ? 40 : 20; }
  if (d.eps != null) { count++; score += d.eps >= 300 ? 100 : d.eps >= 150 ? 80 : d.eps >= 50 ? 60 : d.eps > 0 ? 40 : 15; }
  if (d.opCashflow != null) { count++; score += d.opCashflow > 0 ? 80 : 20; }
  return count > 0 ? ratingFromScore(score / count) : null;
}

// 将来性: 売上成長率・営業利益成長率・EPS成長率・記事の有無
function calcFutureScenarioRating(d) {
  let score = 0, count = 0;
  if (d.revenueGrowth != null) { count++; score += d.revenueGrowth >= 20 ? 100 : d.revenueGrowth >= 10 ? 80 : d.revenueGrowth >= 5 ? 60 : d.revenueGrowth >= 0 ? 45 : 20; }
  if (d.opProfitGrowth != null) { count++; score += d.opProfitGrowth >= 25 ? 100 : d.opProfitGrowth >= 10 ? 80 : d.opProfitGrowth >= 0 ? 55 : 20; }
  if (d.epsGrowth != null) { count++; score += d.epsGrowth >= 20 ? 100 : d.epsGrowth >= 10 ? 80 : d.epsGrowth >= 0 ? 55 : 20; }
  if (d.rndExpense != null && d.rndExpense > 0) { count++; score += 70; } // R&D投資ありは加点
  return count > 0 ? ratingFromScore(score / count) : null;
}

// 割安度: PER・PBR
function calcValueGapRating(d) {
  let score = 0, count = 0;
  if (d.per != null && d.per > 0) { count++; score += d.per <= 8 ? 100 : d.per <= 12 ? 80 : d.per <= 18 ? 60 : d.per <= 25 ? 40 : 20; }
  if (d.pbr != null && d.pbr > 0) { count++; score += d.pbr <= 0.5 ? 100 : d.pbr <= 1.0 ? 80 : d.pbr <= 1.5 ? 60 : d.pbr <= 2.5 ? 40 : 20; }
  return count > 0 ? ratingFromScore(score / count) : null;
}

function collectFormData() {
  const year = parseInt(document.getElementById('regIssueYear').value);
  const number = parseInt(document.getElementById('regIssueNumber').value);

  let earnings = [];
  try {
    const earningsStr = document.getElementById('inputEarnings').value.trim();
    if (earningsStr) earnings = JSON.parse(earningsStr);
  } catch (e) { /* ignore */ }

  const rawData = {
    // 1. 🏢 銘柄基本情報
    issueYear: year,
    issueNumber: number,
    issueLabel: getIssueLabel(year, number),
    issueKey: getIssueKey(year, number),
    code: document.getElementById('inputCode').value.trim(),
    name: document.getElementById('inputName').value.trim(),
    settlement: formatSettlement(document.getElementById('inputSettlement').value.trim()),
    industry: document.getElementById('inputIndustry').value.trim(),
    market: document.getElementById('inputMarket').value.trim(),
    status: document.getElementById('inputStatus').value,
    keywords: (() => {
      const posText = document.getElementById('inputPositiveKeywords').value.trim();
      const negText = document.getElementById('inputNegativeKeywords').value.trim();
      const kws = [];
      if (posText) {
        posText.split(/[,，]/).forEach(kw => {
          const trimKw = kw.trim();
          if (trimKw) kws.push('+' + trimKw);
        });
      }
      if (negText) {
        negText.split(/[,，]/).forEach(kw => {
          const trimKw = kw.trim();
          if (trimKw) kws.push('-' + trimKw);
        });
      }
      return kws.join(', ');
    })(),

    // 2. 📝 【特色・連結事業】
    shareholders: document.getElementById('inputShareholders').value.trim(),
    employees: parseInt(document.getElementById('inputEmployees').value) || null,
    overseasRatio: parseFloat(document.getElementById('inputOverseasRatio').value) || null,

    // 3. 📰 【業績】
    businessArticle: document.getElementById('inputBusinessArticle').value.trim(),
    materialArticle: document.getElementById('inputMaterialArticle').value.trim(),
    earnings: earnings,
    eps: parseFloat(document.getElementById('inputEps').value) || null,
    bps: parseFloat(document.getElementById('inputBps').value) || null,
    revenueGrowth: parseFloat(document.getElementById('inputRevenueGrowth').value) || null,
    opProfitGrowth: parseFloat(document.getElementById('inputOpProfitGrowth').value) || null,
    epsGrowth: parseFloat(document.getElementById('inputEpsGrowth').value) || null,

    // 4. 💰 【財務・キャッシュフロー】
    equityRatio: parseFloat(document.getElementById('inputEquityRatio').value) || null,
    retainedEarnings: parseFloat(document.getElementById('inputRetainedEarnings').value) || null,
    interestBearingDebt: parseFloat(document.getElementById('inputDebt').value) || null,
    cashEquiv: parseFloat(document.getElementById('inputCashEquiv').value) || null,
    opCashflow: parseFloat(document.getElementById('inputOpCashflow').value) || null,
    invCashflow: parseFloat(document.getElementById('inputInvCashflow').value) || null,
    freeCashflow: parseFloat(document.getElementById('inputFreeCashflow').value) || null,

    // 5. 📊 【株価・指標・配当】
    marketCap: parseFloat(document.getElementById('inputMarketCap').value) || null,
    per: parseFloat(document.getElementById('inputPer').value) || null,
    pbr: parseFloat(document.getElementById('inputPbr').value) || null,
    roe: parseFloat(document.getElementById('inputRoe').value) || null,
    opMargin: parseFloat(document.getElementById('inputOpMargin').value) || null,
    ordinaryMargin: parseFloat(document.getElementById('inputOrdinaryMargin').value) || null,
    dividendYield: parseFloat(document.getElementById('inputDividendYield').value) || null,
    payoutRatio: parseFloat(document.getElementById('inputPayoutRatio').value) || null,
    dividendCurrent: parseFloat(document.getElementById('inputDividendCurrent').value) || null,
    dividendNext: parseFloat(document.getElementById('inputDividendNext').value) || null,
    consecDivYears: parseInt(document.getElementById('inputConsecDivYears').value) || null,
    doe: parseFloat(document.getElementById('inputDoe').value) || null,
    rndExpense: parseFloat(document.getElementById('inputRndExpense').value) || null,
    capex: parseFloat(document.getElementById('inputCapex').value) || null,

    // 6. 💬 ユーザーメモ
    shikihoComment: document.getElementById('inputShikihoComment').value.trim()
  };

  // 自動計算: 5大評価レーティング
  const ratings = autoCalculateRatings(rawData);
  rawData.ratings = ratings;

  // 自動計算: 高配当/成長スコア（レーティングベース。互換性のため残す）
  const hdBase = calculateBaseScore(ratings, 'highDividend');
  const grBase = calculateBaseScore(ratings, 'growth');
  rawData.highDividendScore = { base: hdBase, bonus: 0, total: hdBase };
  rawData.growthScore = { base: grBase, bonus: 0, total: grBase };

  return rawData;
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
    // 1. 🏢 銘柄基本情報
    code: 'inputCode',
    name: 'inputName',
    settlement: 'inputSettlement',
    industry: 'inputIndustry',
    market: 'inputMarket',
    status: 'inputStatus',

    // 2. 📝 【特色・連結事業】
    shareholders: 'inputShareholders',
    employees: 'inputEmployees',
    overseasRatio: 'inputOverseasRatio',

    // 3. 📰 【業績】
    businessArticle: 'inputBusinessArticle',
    materialArticle: 'inputMaterialArticle',
    eps: 'inputEps',
    bps: 'inputBps',
    revenueGrowth: 'inputRevenueGrowth',
    opProfitGrowth: 'inputOpProfitGrowth',
    epsGrowth: 'inputEpsGrowth',

    // 4. 💰 【財務・キャッシュフロー】
    equityRatio: 'inputEquityRatio',
    retainedEarnings: 'inputRetainedEarnings',
    interestBearingDebt: 'inputDebt',
    cashEquiv: 'inputCashEquiv',
    opCashflow: 'inputOpCashflow',
    invCashflow: 'inputInvCashflow',
    freeCashflow: 'inputFreeCashflow',

    // 5. 📊 【株価・指標・配当】
    marketCap: 'inputMarketCap',
    per: 'inputPer',
    pbr: 'inputPbr',
    roe: 'inputRoe',
    opMargin: 'inputOpMargin',
    ordinaryMargin: 'inputOrdinaryMargin',
    dividendYield: 'inputDividendYield',
    payoutRatio: 'inputPayoutRatio',
    dividendCurrent: 'inputDividendCurrent',
    dividendNext: 'inputDividendNext',
    consecDivYears: 'inputConsecDivYears',
    doe: 'inputDoe',
    rndExpense: 'inputRndExpense',
    capex: 'inputCapex',

    // 6. 💬 ユーザーメモ
    shikihoComment: 'inputShikihoComment'
  };

  for (const [key, inputId] of Object.entries(mapping)) {
    if (data[key] !== undefined && data[key] !== null) {
      if (key === 'settlement') {
        document.getElementById(inputId).value = formatSettlement(data[key]);
      } else {
        document.getElementById(inputId).value = data[key];
      }
    }
  }

  if (data.keywords && typeof data.keywords === 'string' && !data.keywords.startsWith('#')) {
    const kws = Array.isArray(data.keywords) ? data.keywords : String(data.keywords).split(/[,，]/);
    let posKws = [];
    let negKws = [];
    kws.forEach(kw => {
      const trimKw = kw.trim();
      if (!trimKw) return;
      if (trimKw.startsWith('+')) {
        posKws.push(trimKw.substring(1));
      } else if (trimKw.startsWith('-')) {
        negKws.push(trimKw.substring(1));
      } else {
        posKws.push(trimKw);
      }
    });
    document.getElementById('inputPositiveKeywords').value = posKws.join(', ');
    document.getElementById('inputNegativeKeywords').value = negKws.join(', ');
  }

  if (data.positiveKeywords) {
    const pkws = Array.isArray(data.positiveKeywords) ? data.positiveKeywords : String(data.positiveKeywords).split(/[,，]/);
    document.getElementById('inputPositiveKeywords').value = pkws.map(k => k.trim()).join(', ');
  }
  if (data.negativeKeywords) {
    const nkws = Array.isArray(data.negativeKeywords) ? data.negativeKeywords : String(data.negativeKeywords).split(/[,，]/);
    document.getElementById('inputNegativeKeywords').value = nkws.map(k => k.trim()).join(', ');
  }

  if (data.industry) {
    document.getElementById('inputIndustry').value = data.industry;
  }
  if (data.market) {
    document.getElementById('inputMarket').value = normalizeMarketValue(data.market);
  }
  if (data.status) {
    document.getElementById('inputStatus').value = data.status;
  }

  if (data.code) {
    await updateStockNameDisplay(data.code);
  }

  if (data.earnings && Array.isArray(data.earnings)) {
    document.getElementById('inputEarnings').value = JSON.stringify(data.earnings);

    // 業績データ（earnings）から成長率を自動計算して補完する
    const growth = calculateGrowthFromEarnings(data.earnings);
    if (growth) {
      const revEl = document.getElementById('inputRevenueGrowth');
      const opEl = document.getElementById('inputOpProfitGrowth');
      const epsEl = document.getElementById('inputEpsGrowth');

      if ((!revEl.value || data.revenueGrowth === null) && growth.revenueGrowth !== undefined) {
        revEl.value = growth.revenueGrowth;
      }
      if ((!opEl.value || data.opProfitGrowth === null) && growth.opProfitGrowth !== undefined) {
        opEl.value = growth.opProfitGrowth;
      }
      if ((!epsEl.value || data.epsGrowth === null) && growth.epsGrowth !== undefined) {
        epsEl.value = growth.epsGrowth;
      }
    }
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
  document.getElementById('inputSettlement').addEventListener('blur', (e) => {
    e.target.value = formatSettlement(e.target.value);
  });
  document.getElementById('inputEarnings').addEventListener('blur', (e) => {
    try {
      const val = e.target.value.trim();
      if (!val) return;
      const earnings = JSON.parse(val);
      if (Array.isArray(earnings) && earnings.length >= 2) {
        const growth = calculateGrowthFromEarnings(earnings);
        if (growth) {
          const revEl = document.getElementById('inputRevenueGrowth');
          const opEl = document.getElementById('inputOpProfitGrowth');
          const epsEl = document.getElementById('inputEpsGrowth');
          
          if (!revEl.value && growth.revenueGrowth !== undefined) revEl.value = growth.revenueGrowth;
          if (!opEl.value && growth.opProfitGrowth !== undefined) opEl.value = growth.opProfitGrowth;
          if (!epsEl.value && growth.epsGrowth !== undefined) epsEl.value = growth.epsGrowth;
        }
      }
    } catch(err) { /* 無効なJSONは無視 */ }
  });

  // Custom Multiselect (Industry) Handlers
  const multiselect = document.getElementById('multiselectIndustry');
  const triggerBtn = document.getElementById('multiselectIndustryBtn');
  const dropdown = document.getElementById('multiselectIndustryDropdown');
  const optionsContainer = document.getElementById('multiselectIndustryOptions');
  const btnSelectAll = document.getElementById('btnSelectAllIndustry');
  const btnClear = document.getElementById('btnClearIndustry');

  if (multiselect && triggerBtn && dropdown && optionsContainer) {
    // 開閉
    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      multiselect.classList.toggle('active');
    });

    // 外側クリックで閉じる
    document.addEventListener('click', (e) => {
      if (!multiselect.contains(e.target)) {
        multiselect.classList.remove('active');
      }
    });

    // チェックボックス選択変更
    optionsContainer.addEventListener('change', (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') {
        const val = e.target.value;
        if (e.target.checked) {
          if (!AppState.filterIndustries.includes(val)) {
            AppState.filterIndustries.push(val);
          }
        } else {
          AppState.filterIndustries = AppState.filterIndustries.filter(v => v !== val);
        }
        updateMultiselectTriggerText();
        renderTable();
      }
    });

    // すべて選択
    if (btnSelectAll) {
      btnSelectAll.addEventListener('click', () => {
        const checkboxes = optionsContainer.querySelectorAll('input[type="checkbox"]');
        const newFilters = [];
        checkboxes.forEach(cb => {
          cb.checked = true;
          newFilters.push(cb.value);
        });
        AppState.filterIndustries = newFilters;
        updateMultiselectTriggerText();
        renderTable();
      });
    }

    // クリア
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        const checkboxes = optionsContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
          cb.checked = false;
        });
        AppState.filterIndustries = [];
        updateMultiselectTriggerText();
        renderTable();
      });
    }
  }

  const filterSett = document.getElementById('filterSettlement');
  const filterStat = document.getElementById('filterStatus');
  if (filterSett) {
    filterSett.addEventListener('change', (e) => {
      AppState.filterSettlement = e.target.value;
      renderTable();
    });
  }
  if (filterStat) {
    filterStat.addEventListener('change', (e) => {
      AppState.filterStatus = e.target.value;
      renderTable();
    });
  }

  // Detail
  document.getElementById('detailClose').addEventListener('click', hideDetail);
  document.getElementById('detailOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('detailOverlay')) hideDetail();
  });
  document.getElementById('btnDetailEdit').addEventListener('click', () => {
    if (AppState.selectedId) {
      const id = AppState.selectedId;
      hideDetail();
      openRegisterModal(id);
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

  // Sync Button (optional - only attach if element exists)
  const btnSync = document.getElementById('btnSyncMaster');
  if (btnSync) btnSync.addEventListener('click', syncMasterData);

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

  // Header Select All checkbox change handler
  const headerSelectAll = document.getElementById('headerSelectAll');
  if (headerSelectAll) {
    headerSelectAll.addEventListener('change', async () => {
      const allData = await DataStore.getByIssue(AppState.currentIssueKey);
      if (headerSelectAll.checked) {
        // すべてチェックON（非表示リストからすべて削除）
        allData.forEach(d => AppState.uncheckedCodes.delete(d.code));
      } else {
        // すべてチェックOFF（非表示リストにすべて追加）
        allData.forEach(d => AppState.uncheckedCodes.add(d.code));
      }
      saveUncheckedCodes();
      renderTable();
    });
  }
  
  setupDynamicScoreEvents();
}

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  loadUncheckedCodes();
  await DataStore.init();
  await loadScoreSettings();
  initIssueSelector();
  initSort();
  initSearch();
  initCodeInput();
  initEvents();
  await renderTable();
});
