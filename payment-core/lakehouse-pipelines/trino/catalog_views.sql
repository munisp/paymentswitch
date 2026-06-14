-- Trino catalog views for the payment switch lakehouse
-- These views provide a unified query layer across bronze/silver/gold tiers

-- ==========================================
-- Bronze tier: raw CDC event access
-- ==========================================

CREATE OR REPLACE VIEW bronze.cdc_events AS
SELECT
    cdc_operation,
    cdc_table,
    from_unixtime(cdc_timestamp_ms / 1000) AS event_time,
    cdc_lsn,
    json_parse(raw_data) AS payload,
    ingested_at,
    partition_date
FROM delta.bronze.cdc_raw_events;

-- ==========================================
-- Silver tier: validated business entities
-- ==========================================

CREATE OR REPLACE VIEW silver.transactions AS
SELECT
    CAST(id AS VARCHAR) AS transaction_id,
    payer_id,
    payee_id,
    CAST(amount AS DECIMAL(18,2)) AS amount,
    currency,
    status,
    payment_rail,
    corridor,
    CAST(fee_amount AS DECIMAL(18,2)) AS fee_amount,
    created_at,
    updated_at,
    _operation AS last_cdc_op,
    _processed_at
FROM delta.silver.transactions
WHERE _operation != 'd';

CREATE OR REPLACE VIEW silver.settlements AS
SELECT
    CAST(id AS VARCHAR) AS settlement_id,
    window_id,
    participant_id,
    CAST(gross_amount AS DECIMAL(18,2)) AS gross_amount,
    CAST(fee_amount AS DECIMAL(18,2)) AS fee_amount,
    CAST(net_amount AS DECIMAL(18,2)) AS net_amount,
    status,
    settlement_model,
    settled_at,
    _processed_at
FROM delta.silver.settlements
WHERE _operation != 'd';

CREATE OR REPLACE VIEW silver.participants AS
SELECT
    CAST(id AS VARCHAR) AS participant_id,
    name,
    participant_type,
    tier,
    status,
    onboarding_status,
    _processed_at
FROM delta.silver.participants
WHERE _operation != 'd';

CREATE OR REPLACE VIEW silver.disputes AS
SELECT
    CAST(id AS VARCHAR) AS dispute_id,
    transaction_id,
    reason,
    CAST(amount AS DECIMAL(18,2)) AS disputed_amount,
    status,
    resolution,
    created_at,
    resolved_at,
    _processed_at
FROM delta.silver.disputes
WHERE _operation != 'd';

-- ==========================================
-- Gold tier: pre-aggregated analytics
-- ==========================================

CREATE OR REPLACE VIEW gold.daily_transaction_volume AS
SELECT
    metric_date,
    currency,
    count AS transaction_count,
    CAST(total_amount AS DECIMAL(18,2)) AS total_volume,
    CAST(avg_amount AS DECIMAL(18,2)) AS avg_transaction_size,
    success_count,
    failed_count,
    ROUND(success_rate * 100, 2) AS success_rate_pct
FROM delta.gold.transaction_daily_metrics;

CREATE OR REPLACE VIEW gold.daily_settlement_summary AS
SELECT
    metric_date,
    settlement_count,
    settled_count,
    CAST(total_settled_amount AS DECIMAL(18,2)) AS total_settled,
    ROUND(settlement_rate * 100, 2) AS settlement_rate_pct
FROM delta.gold.settlement_daily_metrics;

CREATE OR REPLACE VIEW gold.corridor_performance AS
SELECT
    metric_date,
    corridor,
    transaction_count,
    CAST(total_volume AS DECIMAL(18,2)) AS total_volume,
    CAST(avg_latency_ms AS DECIMAL(10,2)) AS avg_latency_ms,
    ROUND(success_rate * 100, 2) AS success_rate_pct,
    dominant_rail
FROM delta.gold.corridor_daily_metrics;

-- ==========================================
-- Materialized aggregation queries
-- ==========================================

-- Top corridors by volume (last 30 days)
CREATE OR REPLACE VIEW gold.top_corridors_30d AS
SELECT
    corridor,
    SUM(transaction_count) AS total_transactions,
    SUM(total_volume) AS total_volume,
    AVG(success_rate_pct) AS avg_success_rate
FROM gold.corridor_performance
WHERE metric_date >= CURRENT_DATE - INTERVAL '30' DAY
GROUP BY corridor
ORDER BY total_volume DESC;

-- Participant settlement health
CREATE OR REPLACE VIEW gold.participant_settlement_health AS
SELECT
    s.participant_id,
    p.name AS participant_name,
    p.tier,
    COUNT(*) AS settlement_count,
    SUM(CASE WHEN s.status = 'SETTLED' THEN 1 ELSE 0 END) AS settled_count,
    SUM(s.net_amount) AS total_net_settled,
    ROUND(100.0 * SUM(CASE WHEN s.status = 'SETTLED' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS settlement_rate_pct
FROM silver.settlements s
JOIN silver.participants p ON s.participant_id = p.participant_id
GROUP BY s.participant_id, p.name, p.tier;
