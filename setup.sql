-- ① brand_master (銘柄マスタ)
create table if not exists brand_master (
  code varchar(4) primary key,
  name varchar(255) not null,
  market varchar(50),
  industry varchar(100),
  is_monitored boolean default false
);

-- ② score_settings (配点マスタ)
create table if not exists score_settings (
  item_no varchar(50) primary key,
  item_name varchar(255) not null,
  dividend_base_score integer default 0,
  growth_base_score integer default 0,
  description text
);

-- ③ rating_criteria (基準マスタ)
create table if not exists rating_criteria (
  id serial primary key,
  category varchar(100) not null,
  rank varchar(2) not null,
  condition_text text not null
);

-- ④ shikiho_evaluations (四季報評価データ本体)
create table if not exists shikiho_evaluations (
  id uuid primary key default gen_random_uuid(),
  issue_year integer not null,
  issue_number integer not null,
  issue_label varchar(255) not null,
  issue_key varchar(50) not null,
  code varchar(4) not null,
  name varchar(255) not null,
  business_article text,
  material_article text,
  shareholders text,
  equity_ratio numeric,
  retained_earnings numeric,
  interest_bearing_debt numeric,
  roe numeric,
  dividend_current numeric,
  dividend_next numeric,
  dividend_yield numeric,
  payout_ratio numeric,
  earnings jsonb,
  per numeric,
  pbr numeric,
  market_cap numeric,
  high_dividend_score jsonb,
  growth_score jsonb,
  ratings jsonb,
  keywords text,
  industry varchar(100),
  status varchar(50),
  market varchar(50),
  dividend_score integer,
  financial_score integer,
  earning_score integer,
  future_score integer,
  valuation_score integer,
  shikiho_comment text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 既存テーブルの移行用 (もしテーブルが既に存在する場合に実行してください)
-- alter table shikiho_evaluations add column if not exists market varchar(50);

-- RLS (Row Level Security) の設定
-- 今回は個人用の簡易ツールのため、RLSを無効化します（必要に応じてセキュリティ設定を行ってください）
alter table brand_master disable row level security;
alter table score_settings disable row level security;
alter table rating_criteria disable row level security;
alter table shikiho_evaluations disable row level security;

-- 【注意】もし上記を実行してもRLSエラー（new row violates row-level security policy）が出る場合、
-- またはSupabase側のセキュリティ要件でRLSを有効にしたまま全許可したい場合は、以下のSQLをSQL Editorで実行してください。
--
-- create policy "Allow public read" on brand_master for select using (true);
-- create policy "Allow public write" on brand_master for all using (true) with check (true);
--
-- create policy "Allow public read" on score_settings for select using (true);
-- create policy "Allow public write" on score_settings for all using (true) with check (true);
--
-- create policy "Allow public read" on rating_criteria for select using (true);
-- create policy "Allow public write" on rating_criteria for all using (true) with check (true);
--
-- create policy "Allow public read" on shikiho_evaluations for select using (true);
-- create policy "Allow public write" on shikiho_evaluations for all using (true) with check (true);

