"""Verified CPU-local fraud scoring service.

The live scoring path is deliberately narrow: it starts only when the approved
model bundle verifies, requires the exact model feature contract, scores with the
local trained ensemble, and reports model provenance with every response.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import redis.asyncio as aioredis
import uvicorn
from fastapi import FastAPI
from prometheus_client import generate_latest

try:
    from .model_runtime import CpuFraudModelBundle, load_cpu_fraud_model
    from .routers import router as fraud_router
    from .schemas import RiskLevel, TransactionRequest
except ImportError:
    from model_runtime import CpuFraudModelBundle, load_cpu_fraud_model
    from routers import router as fraud_router
    from schemas import RiskLevel, TransactionRequest

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fraud-detection-service")


@dataclass
class FraudScore:
    transaction_id: str
    fraud_score: float
    risk_level: RiskLevel
    gnn_score: Optional[float]
    ml_score: float
    rule_score: float
    model_id: str
    model_version: str
    model_decision: str
    features: Dict[str, Any]
    explanation: List[str]
    processing_time_ms: float


class FraudDetectionService:
    """Hybrid rule plus approved CPU-ensemble fraud scoring service."""

    def __init__(self, redis_client: aioredis.Redis):
        self.redis = redis_client
        self.cpu_model: CpuFraudModelBundle = load_cpu_fraud_model()
        self.total_requests = 0
        self.total_processing_time_ms = 0.0

    async def _optional_history(self, payer_id: str) -> Optional[Dict[str, Any]]:
        """Read optional operational context without pretending it exists on failure."""
        try:
            raw = await self.redis.get(f"user_history:{payer_id}")
            return json.loads(raw) if raw else None
        except Exception as exc:
            logger.warning("Operational fraud context is unavailable: %s", exc)
            return None

    async def _extract_rule_features(self, request: TransactionRequest) -> Dict[str, Any]:
        history = await self._optional_history(request.payer_id)
        return {
            "amount": request.amount,
            "is_large_amount": request.amount > 50_000,
            "is_round_amount": request.amount % 1_000 == 0,
            "is_new_payer": request.sender_age_days < 30,
            "sender_is_mule": request.sender_is_mule,
            "is_night": request.timestamp.hour < 6 or request.timestamp.hour >= 22,
            "history_available": history is not None,
            "payer_txn_count_1h": history.get("txn_count_1h") if history else None,
            "payer_txn_count_24h": history.get("txn_count_24h") if history else None,
        }

    @staticmethod
    def _score_rules(features: Dict[str, Any]) -> tuple[float, List[str]]:
        score = 0.0
        explanations: List[str] = []
        if features["is_large_amount"] and features["is_round_amount"]:
            score += 0.40
            explanations.append("Large round-value transaction")
        if features["is_new_payer"] and features["is_large_amount"]:
            score += 0.35
            explanations.append("New payer initiating a high-value transaction")
        if features["sender_is_mule"]:
            score += 0.80
            explanations.append("Sender is marked as a confirmed mule account")
        if features["is_night"]:
            score += 0.15
            explanations.append("Transaction occurred in the night-risk window")
        if features["history_available"] and (features["payer_txn_count_1h"] or 0) > 15:
            score += 0.50
            explanations.append("Observed one-hour payment velocity exceeds policy threshold")
        return min(score, 1.0), explanations

    @staticmethod
    def _risk_level(score: float) -> RiskLevel:
        if score >= 0.80:
            return RiskLevel.CRITICAL
        if score >= 0.60:
            return RiskLevel.HIGH
        if score >= 0.30:
            return RiskLevel.MEDIUM
        return RiskLevel.LOW

    async def score_transaction(self, request: TransactionRequest) -> FraudScore:
        started = time.perf_counter()
        rule_features = await self._extract_rule_features(request)
        prediction = self.cpu_model.predict({
            "amount": request.amount,
            "channel": request.channel,
            "narration": request.narration,
            "occurred_at": request.timestamp,
            "source_bank_code": request.source_bank_code,
            "destination_bank_code": request.destination_bank_code,
            "sender_balance": request.sender_balance,
            "sender_age": request.sender_age_days,
            "sender_is_mule": int(request.sender_is_mule),
        })
        rule_score, rule_explanations = self._score_rules(rule_features)
        # Rules are policy overrides. They may increase, never dilute, the
        # approved model probability.
        fraud_score = max(prediction.probability, rule_score)
        risk_level = self._risk_level(fraud_score)
        explanations = [
            f"Approved CPU ensemble {prediction.model_version} probability: {prediction.probability:.4f}",
            *rule_explanations,
        ] or ["Approved CPU ensemble produced a low-risk score"]
        processing_time_ms = round((time.perf_counter() - started) * 1000, 3)

        self.total_requests += 1
        self.total_processing_time_ms += processing_time_ms
        return FraudScore(
            transaction_id=request.transaction_id,
            fraud_score=fraud_score,
            risk_level=risk_level,
            gnn_score=None,
            ml_score=prediction.probability,
            rule_score=rule_score,
            model_id=prediction.model_id,
            model_version=prediction.model_version,
            model_decision=prediction.decision,
            features=rule_features,
            explanation=explanations,
            processing_time_ms=processing_time_ms,
        )

    async def get_stats(self) -> Dict[str, Any]:
        return {
            "gnn_model_loaded": False,
            "gnn_model_version": "not-enabled-in-approved-cpu-bundle",
            "ml_model_loaded": self.cpu_model.ready,
            "ml_model_version": self.cpu_model.manifest.get("model_version", "unknown"),
            "total_requests": self.total_requests,
            "avg_processing_time_ms": self.total_processing_time_ms / self.total_requests if self.total_requests else 0.0,
            "cache_hit_rate": 0.0,
        }

    async def health_check(self) -> Dict[str, Any]:
        redis_connected = False
        try:
            await self.redis.ping()
            redis_connected = True
        except Exception:
            redis_connected = False
        return {
            "healthy": self.cpu_model.ready,
            "redis_connected": redis_connected,
            "models_loaded": self.cpu_model.ready,
        }


app = FastAPI(title="Fraud Detection Service", version="2.0.0")
app.include_router(fraud_router)


@app.on_event("startup")
async def startup_event() -> None:
    redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
    redis_client = aioredis.from_url(redis_url, encoding="utf-8", decode_responses=True)
    # Loading is intentionally part of startup. A missing manifest, invalid hash,
    # dependency incompatibility, or feature-contract mismatch prevents readiness.
    app.state.fraud_service = FraudDetectionService(redis_client)
    logger.info("Verified CPU fraud model loaded and public fraud router mounted")


@app.on_event("shutdown")
async def shutdown_event() -> None:
    service = getattr(app.state, "fraud_service", None)
    if service:
        await service.redis.aclose()


@app.get("/healthz")
async def healthz() -> Dict[str, Any]:
    service = getattr(app.state, "fraud_service", None)
    if not service:
        return {"status": "unhealthy", "cpu_model_ready": False}
    health = await service.health_check()
    return {"status": "ok" if health["healthy"] else "unhealthy", "cpu_model_ready": health["models_loaded"], "redis_connected": health["redis_connected"]}


@app.get("/metrics")
async def metrics():
    return generate_latest()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002)
