import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from .schemas import AnalyticsQuery, ReportType, TimeGranularity, AnomalyDetectionRequest

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/analytics")
db = DatabaseManager()


async def _ensure_tables():
    await db.execute("""
        CREATE TABLE IF NOT EXISTS analytics_reports (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            report_type VARCHAR(64) NOT NULL,
            date_from DATE NOT NULL,
            date_to DATE NOT NULL,
            granularity VARCHAR(20) NOT NULL DEFAULT 'daily',
            filters JSONB,
            result JSONB,
            generated_by VARCHAR(128),
            execution_time_ms INT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS analytics_anomalies (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            metric VARCHAR(128) NOT NULL,
            value NUMERIC(18,4) NOT NULL,
            expected_value NUMERIC(18,4) NOT NULL,
            deviation NUMERIC(8,4) NOT NULL,
            severity VARCHAR(20) NOT NULL DEFAULT 'medium',
            detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)


@router.on_event("startup")
async def startup():
    await db.connect()
    await _ensure_tables()


@router.on_event("shutdown")
async def shutdown():
    await db.close()


@router.post("/query")
async def run_analytics_query(query: AnalyticsQuery, x_user_id: Optional[str] = Header(None)):
    import json
    import time
    start = time.monotonic()

    filters_json = json.dumps(query.filters) if query.filters else None

    if query.report_type == ReportType.TRANSACTION_VOLUME:
        result = await db.fetch(
            """SELECT date_trunc($1, created_at) as period, COUNT(*) as count,
               COALESCE(SUM(amount), 0) as total_amount, currency
               FROM p2p_transactions
               WHERE created_at >= $2::date AND created_at <= $3::date
               GROUP BY period, currency ORDER BY period""",
            query.granularity.value, query.date_from, query.date_to
        )
    elif query.report_type == ReportType.REVENUE_BREAKDOWN:
        result = await db.fetch(
            """SELECT date_trunc($1, created_at) as period,
               COALESCE(SUM(fee), 0) as total_fees, COUNT(*) as txn_count
               FROM p2p_transactions
               WHERE created_at >= $2::date AND created_at <= $3::date
               GROUP BY period ORDER BY period""",
            query.granularity.value, query.date_from, query.date_to
        )
    else:
        result = []

    elapsed = int((time.monotonic() - start) * 1000)
    serialized = [
        {k: (v.isoformat() if hasattr(v, 'isoformat') else float(v) if hasattr(v, '__float__') else v) for k, v in row.items()}
        for row in result
    ]

    report_id = uuid.uuid4()
    await db.execute(
        """INSERT INTO analytics_reports (id, report_type, date_from, date_to, granularity, filters, result, generated_by, execution_time_ms)
           VALUES ($1, $2, $3::date, $4::date, $5, $6::jsonb, $7::jsonb, $8, $9)""",
        report_id, query.report_type.value, query.date_from, query.date_to,
        query.granularity.value, filters_json, json.dumps(serialized),
        x_user_id, elapsed
    )

    return {
        "report_id": str(report_id),
        "report_type": query.report_type.value,
        "date_range": {"from": query.date_from, "to": query.date_to},
        "granularity": query.granularity.value,
        "data": serialized,
        "execution_time_ms": elapsed
    }


@router.post("/anomalies/detect")
async def detect_anomalies(req: AnomalyDetectionRequest, x_user_id: Optional[str] = Header(None)):
    stats = await db.fetchrow(
        """SELECT AVG(amount) as avg_val, STDDEV(amount) as stddev_val
           FROM p2p_transactions
           WHERE created_at >= now() - make_interval(days => $1)""",
        req.lookback_days
    )

    if not stats or not stats.get("stddev_val"):
        return {"anomalies": [], "message": "Insufficient data for anomaly detection"}

    avg = float(stats["avg_val"])
    stddev = float(stats["stddev_val"])
    threshold_upper = avg + (req.sensitivity * stddev)
    threshold_lower = max(0, avg - (req.sensitivity * stddev))

    anomalies = await db.fetch(
        """SELECT id, amount, created_at FROM p2p_transactions
           WHERE (amount > $1 OR amount < $2)
           AND created_at >= now() - make_interval(days => $3)
           ORDER BY ABS(amount - $4) DESC LIMIT 50""",
        threshold_upper, threshold_lower, req.lookback_days, avg
    )

    results = []
    for a in anomalies:
        deviation = (float(a["amount"]) - avg) / stddev if stddev > 0 else 0
        severity = "high" if abs(deviation) > 3 else "medium"
        await db.execute(
            """INSERT INTO analytics_anomalies (metric, value, expected_value, deviation, severity)
               VALUES ($1, $2, $3, $4, $5)""",
            req.metric, float(a["amount"]), avg, deviation, severity
        )
        results.append({
            "transaction_id": str(a["id"]),
            "value": float(a["amount"]),
            "expected": round(avg, 2),
            "deviation": round(deviation, 2),
            "severity": severity,
            "date": a["created_at"].isoformat()
        })

    return {
        "metric": req.metric,
        "baseline": {"mean": round(avg, 2), "stddev": round(stddev, 2)},
        "threshold": {"upper": round(threshold_upper, 2), "lower": round(threshold_lower, 2)},
        "anomalies_found": len(results),
        "anomalies": results
    }


@router.get("/reports")
async def list_reports(report_type: Optional[str] = None, limit: int = 20):
    if report_type:
        rows = await db.fetch(
            "SELECT id, report_type, date_from, date_to, granularity, execution_time_ms, created_at FROM analytics_reports WHERE report_type = $1 ORDER BY created_at DESC LIMIT $2",
            report_type, limit
        )
    else:
        rows = await db.fetch(
            "SELECT id, report_type, date_from, date_to, granularity, execution_time_ms, created_at FROM analytics_reports ORDER BY created_at DESC LIMIT $1",
            limit
        )
    return {"reports": [
        {
            "report_id": str(r["id"]),
            "report_type": r["report_type"],
            "date_from": str(r["date_from"]),
            "date_to": str(r["date_to"]),
            "execution_time_ms": r["execution_time_ms"],
            "created_at": r["created_at"].isoformat()
        } for r in rows
    ]}
