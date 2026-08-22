"""
Compliance Engine - AML/CTR/SAR processing for payment switch platform.
Integrates with OpenSearch for transaction monitoring and pattern detection.
"""

import json
import hashlib
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional
import os


class RiskLevel(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AlertType(Enum):
    SAR = "suspicious_activity_report"
    CTR = "currency_transaction_report"
    STRUCTURING = "structuring_detection"
    VELOCITY = "velocity_anomaly"
    GEO_ANOMALY = "geographic_anomaly"
    SANCTIONS_HIT = "sanctions_hit"
    PEP_MATCH = "pep_match"


@dataclass
class Transaction:
    id: str
    sender_id: str
    recipient_id: str
    amount: float
    currency: str
    country: str
    timestamp: datetime
    payment_method: str
    ip_address: str = ""
    device_fingerprint: str = ""


@dataclass
class ComplianceAlert:
    id: str
    alert_type: AlertType
    risk_level: RiskLevel
    transaction_id: str
    description: str
    details: dict = field(default_factory=dict)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    reviewed: bool = False
    reviewer_id: Optional[str] = None
    resolution: Optional[str] = None


class ComplianceEngine:
    """Core compliance engine for AML/CTR/SAR processing."""

    # CTR threshold (US: $10,000, Nigeria: NGN 5,000,000)
    CTR_THRESHOLDS = {
        "USD": 10000,
        "NGN": 5000000,
        "GBP": 8000,
        "EUR": 9000,
    }

    # Structuring detection window (multiple transactions just below threshold)
    STRUCTURING_WINDOW_HOURS = 24
    STRUCTURING_PERCENTAGE = 0.80

    # Velocity thresholds
    MAX_TRANSACTIONS_PER_HOUR = 20
    MAX_TRANSACTIONS_PER_DAY = 100

    def __init__(self):
        self.opensearch_url = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
        self.alerts: list[ComplianceAlert] = []
        self.transaction_history: dict[str, list[Transaction]] = {}
        self.sanctions_list: set[str] = set()
        self.pep_list: set[str] = set()
        self.high_risk_countries: set[str] = {"KP", "IR", "SY", "CU", "VE"}

    def process_transaction(self, txn: Transaction) -> list[ComplianceAlert]:
        """Process a transaction through all compliance checks."""
        alerts = []
        alerts.extend(self._check_ctr(txn))
        alerts.extend(self._check_structuring(txn))
        alerts.extend(self._check_velocity(txn))
        alerts.extend(self._check_geographic_risk(txn))
        alerts.extend(self._check_sanctions(txn))
        alerts.extend(self._check_pep(txn))

        # Store transaction in history
        if txn.sender_id not in self.transaction_history:
            self.transaction_history[txn.sender_id] = []
        self.transaction_history[txn.sender_id].append(txn)

        self.alerts.extend(alerts)
        return alerts

    def _check_ctr(self, txn: Transaction) -> list[ComplianceAlert]:
        """Check if transaction exceeds CTR threshold."""
        threshold = self.CTR_THRESHOLDS.get(txn.currency, 10000)
        if txn.amount >= threshold:
            return [ComplianceAlert(
                id=self._generate_id("CTR", txn.id),
                alert_type=AlertType.CTR,
                risk_level=RiskLevel.MEDIUM,
                transaction_id=txn.id,
                description=f"Transaction of {txn.currency} {txn.amount:,.2f} exceeds CTR threshold of {txn.currency} {threshold:,.2f}",
                details={"amount": txn.amount, "threshold": threshold, "currency": txn.currency},
            )]
        return []

    def _check_structuring(self, txn: Transaction) -> list[ComplianceAlert]:
        """Detect structuring: multiple transactions just below reporting threshold."""
        threshold = self.CTR_THRESHOLDS.get(txn.currency, 10000)
        structuring_floor = threshold * self.STRUCTURING_PERCENTAGE
        if txn.amount < structuring_floor:
            return []

        history = self.transaction_history.get(txn.sender_id, [])
        window_start = txn.timestamp - timedelta(hours=self.STRUCTURING_WINDOW_HOURS)
        recent = [t for t in history if t.timestamp >= window_start and structuring_floor <= t.amount < threshold]

        if len(recent) >= 3:
            total = sum(t.amount for t in recent) + txn.amount
            return [ComplianceAlert(
                id=self._generate_id("STR", txn.id),
                alert_type=AlertType.STRUCTURING,
                risk_level=RiskLevel.HIGH,
                transaction_id=txn.id,
                description=f"Potential structuring detected: {len(recent) + 1} transactions totaling {txn.currency} {total:,.2f} within {self.STRUCTURING_WINDOW_HOURS}h",
                details={"transaction_count": len(recent) + 1, "total_amount": total, "window_hours": self.STRUCTURING_WINDOW_HOURS},
            )]
        return []

    def _check_velocity(self, txn: Transaction) -> list[ComplianceAlert]:
        """Check transaction velocity anomalies."""
        history = self.transaction_history.get(txn.sender_id, [])
        one_hour_ago = txn.timestamp - timedelta(hours=1)
        one_day_ago = txn.timestamp - timedelta(days=1)

        hourly_count = sum(1 for t in history if t.timestamp >= one_hour_ago)
        daily_count = sum(1 for t in history if t.timestamp >= one_day_ago)

        alerts = []
        if hourly_count >= self.MAX_TRANSACTIONS_PER_HOUR:
            alerts.append(ComplianceAlert(
                id=self._generate_id("VEL-H", txn.id),
                alert_type=AlertType.VELOCITY,
                risk_level=RiskLevel.HIGH,
                transaction_id=txn.id,
                description=f"Velocity anomaly: {hourly_count + 1} transactions in the last hour (threshold: {self.MAX_TRANSACTIONS_PER_HOUR})",
                details={"count": hourly_count + 1, "window": "1h", "threshold": self.MAX_TRANSACTIONS_PER_HOUR},
            ))
        if daily_count >= self.MAX_TRANSACTIONS_PER_DAY:
            alerts.append(ComplianceAlert(
                id=self._generate_id("VEL-D", txn.id),
                alert_type=AlertType.VELOCITY,
                risk_level=RiskLevel.MEDIUM,
                transaction_id=txn.id,
                description=f"Velocity anomaly: {daily_count + 1} transactions in the last 24h (threshold: {self.MAX_TRANSACTIONS_PER_DAY})",
                details={"count": daily_count + 1, "window": "24h", "threshold": self.MAX_TRANSACTIONS_PER_DAY},
            ))
        return alerts

    def _check_geographic_risk(self, txn: Transaction) -> list[ComplianceAlert]:
        """Check for high-risk geographic patterns."""
        if txn.country in self.high_risk_countries:
            return [ComplianceAlert(
                id=self._generate_id("GEO", txn.id),
                alert_type=AlertType.GEO_ANOMALY,
                risk_level=RiskLevel.CRITICAL,
                transaction_id=txn.id,
                description=f"Transaction involves sanctioned/high-risk country: {txn.country}",
                details={"country": txn.country},
            )]
        return []

    def _check_sanctions(self, txn: Transaction) -> list[ComplianceAlert]:
        """Check sender/recipient against sanctions lists."""
        for entity_id in [txn.sender_id, txn.recipient_id]:
            if entity_id in self.sanctions_list:
                return [ComplianceAlert(
                    id=self._generate_id("SAN", txn.id),
                    alert_type=AlertType.SANCTIONS_HIT,
                    risk_level=RiskLevel.CRITICAL,
                    transaction_id=txn.id,
                    description=f"Sanctions list match for entity {entity_id}",
                    details={"matched_entity": entity_id},
                )]
        return []

    def _check_pep(self, txn: Transaction) -> list[ComplianceAlert]:
        """Check sender/recipient against PEP (Politically Exposed Persons) lists."""
        for entity_id in [txn.sender_id, txn.recipient_id]:
            if entity_id in self.pep_list:
                return [ComplianceAlert(
                    id=self._generate_id("PEP", txn.id),
                    alert_type=AlertType.PEP_MATCH,
                    risk_level=RiskLevel.HIGH,
                    transaction_id=txn.id,
                    description=f"PEP match for entity {entity_id}",
                    details={"matched_entity": entity_id},
                )]
        return []

    def generate_sar(self, alert_id: str) -> dict:
        """Generate a Suspicious Activity Report from an alert."""
        alert = next((a for a in self.alerts if a.id == alert_id), None)
        if not alert:
            return {"error": "Alert not found"}
        return {
            "report_type": "SAR",
            "filing_date": datetime.now(timezone.utc).isoformat(),
            "alert_id": alert.id,
            "transaction_id": alert.transaction_id,
            "risk_level": alert.risk_level.value,
            "narrative": alert.description,
            "details": alert.details,
            "status": "draft",
        }

    def get_risk_score(self, user_id: str) -> dict:
        """Calculate overall risk score for a user."""
        user_alerts = [a for a in self.alerts if not a.reviewed]
        history = self.transaction_history.get(user_id, [])

        score = 0
        for alert in user_alerts:
            if alert.risk_level == RiskLevel.CRITICAL:
                score += 40
            elif alert.risk_level == RiskLevel.HIGH:
                score += 25
            elif alert.risk_level == RiskLevel.MEDIUM:
                score += 10
            else:
                score += 5

        score = min(score, 100)
        level = (
            RiskLevel.CRITICAL if score >= 80 else
            RiskLevel.HIGH if score >= 60 else
            RiskLevel.MEDIUM if score >= 30 else
            RiskLevel.LOW
        )

        return {
            "user_id": user_id,
            "score": score,
            "level": level.value,
            "total_transactions": len(history),
            "active_alerts": len(user_alerts),
        }

    @staticmethod
    def _generate_id(prefix: str, txn_id: str) -> str:
        hash_input = f"{prefix}-{txn_id}-{datetime.now(timezone.utc).isoformat()}"
        return f"{prefix}-{hashlib.sha256(hash_input.encode()).hexdigest()[:12]}"
