from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum


class ReportType(str, Enum):
    TRANSACTION_VOLUME = "transaction_volume"
    REVENUE_BREAKDOWN = "revenue_breakdown"
    USER_COHORT = "user_cohort"
    FRAUD_DETECTION = "fraud_detection"
    CORRIDOR_ANALYSIS = "corridor_analysis"
    SETTLEMENT_PERFORMANCE = "settlement_performance"


class TimeGranularity(str, Enum):
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class AnalyticsQuery(BaseModel):
    report_type: ReportType
    date_from: str = Field(..., description="Start date YYYY-MM-DD")
    date_to: str = Field(..., description="End date YYYY-MM-DD")
    granularity: TimeGranularity = Field(default=TimeGranularity.DAILY)
    filters: Optional[Dict[str, Any]] = None
    group_by: Optional[List[str]] = None


class AnomalyDetectionRequest(BaseModel):
    metric: str = Field(..., description="Metric to analyze")
    lookback_days: int = Field(default=30, ge=7, le=365)
    sensitivity: float = Field(default=2.0, gt=0, le=5, description="Standard deviation threshold")
