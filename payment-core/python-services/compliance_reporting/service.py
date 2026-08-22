"""
Compliance Reporting Service
Recommendation #18: Compliance Reporting (SAR, CTR, regulatory reports)

This service handles generation of compliance reports including:
- Suspicious Activity Reports (SAR)
- Currency Transaction Reports (CTR)
- Daily/Weekly/Monthly transaction summaries
- Regulatory compliance reports
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field, asdict
import csv
import io


class ReportType(str, Enum):
    SAR = "sar"  # Suspicious Activity Report
    CTR = "ctr"  # Currency Transaction Report
    DAILY_SUMMARY = "daily_summary"
    WEEKLY_SUMMARY = "weekly_summary"
    MONTHLY_SUMMARY = "monthly_summary"
    QUARTERLY_SUMMARY = "quarterly_summary"
    ANNUAL_SUMMARY = "annual_summary"
    KYC_SUMMARY = "kyc_summary"
    KYB_SUMMARY = "kyb_summary"
    FRAUD_SUMMARY = "fraud_summary"
    AML_REPORT = "aml_report"


class ReportStatus(str, Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    SUBMITTED = "submitted"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class SARReason(str, Enum):
    STRUCTURING = "structuring"
    UNUSUAL_PATTERN = "unusual_pattern"
    HIGH_RISK_JURISDICTION = "high_risk_jurisdiction"
    IDENTITY_MISMATCH = "identity_mismatch"
    RAPID_MOVEMENT = "rapid_movement"
    SHELL_COMPANY = "shell_company"
    PEP_INVOLVEMENT = "pep_involvement"
    SANCTIONS_MATCH = "sanctions_match"
    FRAUD_INDICATOR = "fraud_indicator"
    OTHER = "other"


@dataclass
class Transaction:
    """Transaction data for compliance reporting"""
    id: str
    reference: str
    type: str
    status: str
    amount: float
    currency: str
    sender_id: str
    sender_name: str
    sender_country: str
    recipient_id: str
    recipient_name: str
    recipient_country: str
    created_at: datetime
    completed_at: Optional[datetime] = None
    risk_score: float = 0.0
    flags: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SARReport:
    """Suspicious Activity Report"""
    id: str
    filing_institution: str
    filing_date: datetime
    subject_type: str  # individual, business
    subject_name: str
    subject_id: str
    subject_address: str
    subject_country: str
    suspicious_activity_date_start: datetime
    suspicious_activity_date_end: datetime
    amount_involved: float
    currency: str
    reason: SARReason
    narrative: str
    supporting_transactions: List[str]
    status: ReportStatus
    created_by: str
    created_at: datetime
    updated_at: datetime
    submitted_at: Optional[datetime] = None
    fincen_bsa_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CTRReport:
    """Currency Transaction Report"""
    id: str
    filing_institution: str
    filing_date: datetime
    transaction_date: datetime
    transaction_type: str
    amount: float
    currency: str
    conductor_type: str  # individual, business
    conductor_name: str
    conductor_id: str
    conductor_address: str
    conductor_country: str
    conductor_occupation: str
    beneficiary_name: Optional[str] = None
    beneficiary_id: Optional[str] = None
    beneficiary_address: Optional[str] = None
    beneficiary_country: Optional[str] = None
    status: ReportStatus = ReportStatus.DRAFT
    created_by: str = ""
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    submitted_at: Optional[datetime] = None
    fincen_bsa_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ComplianceSummary:
    """Compliance summary report"""
    id: str
    report_type: ReportType
    period_start: datetime
    period_end: datetime
    total_transactions: int
    total_amount: float
    currency: str
    flagged_transactions: int
    flagged_amount: float
    sar_filed: int
    ctr_filed: int
    kyc_completed: int
    kyc_pending: int
    kyc_rejected: int
    kyb_completed: int
    kyb_pending: int
    kyb_rejected: int
    high_risk_transactions: int
    blocked_transactions: int
    average_risk_score: float
    top_risk_factors: List[Dict[str, Any]]
    country_breakdown: Dict[str, Dict[str, Any]]
    generated_at: datetime
    generated_by: str
    status: ReportStatus = ReportStatus.DRAFT
    metadata: Dict[str, Any] = field(default_factory=dict)


class ComplianceReportingService:
    """Service for generating compliance reports"""
    
    # CTR threshold (USD)
    CTR_THRESHOLD = 10000.0
    
    # SAR threshold for structuring detection
    STRUCTURING_THRESHOLD = 9000.0
    STRUCTURING_WINDOW_DAYS = 7
    
    def __init__(self, db_connection=None, config: Dict[str, Any] = None):
        self.db = db_connection
        self.config = config or {}
        self.filing_institution = self.config.get("filing_institution", "Payment Switch Platform")
    
    def generate_sar(
        self,
        subject_id: str,
        subject_name: str,
        subject_type: str,
        subject_address: str,
        subject_country: str,
        reason: SARReason,
        narrative: str,
        transactions: List[Transaction],
        created_by: str,
    ) -> SARReport:
        """Generate a Suspicious Activity Report"""
        
        if not transactions:
            raise ValueError("At least one transaction is required for SAR")
        
        # Calculate date range and amount
        dates = [t.created_at for t in transactions]
        amounts = [t.amount for t in transactions]
        
        now = datetime.now(timezone.utc)
        
        sar = SARReport(
            id=str(uuid.uuid4()),
            filing_institution=self.filing_institution,
            filing_date=now,
            subject_type=subject_type,
            subject_name=subject_name,
            subject_id=subject_id,
            subject_address=subject_address,
            subject_country=subject_country,
            suspicious_activity_date_start=min(dates),
            suspicious_activity_date_end=max(dates),
            amount_involved=sum(amounts),
            currency=transactions[0].currency,
            reason=reason,
            narrative=narrative,
            supporting_transactions=[t.id for t in transactions],
            status=ReportStatus.DRAFT,
            created_by=created_by,
            created_at=now,
            updated_at=now,
        )
        
        return sar
    
    def generate_ctr(
        self,
        transaction: Transaction,
        conductor_occupation: str,
        created_by: str,
        beneficiary_name: Optional[str] = None,
        beneficiary_id: Optional[str] = None,
        beneficiary_address: Optional[str] = None,
        beneficiary_country: Optional[str] = None,
    ) -> CTRReport:
        """Generate a Currency Transaction Report"""
        
        if transaction.amount < self.CTR_THRESHOLD:
            raise ValueError(f"Transaction amount {transaction.amount} is below CTR threshold {self.CTR_THRESHOLD}")
        
        now = datetime.now(timezone.utc)
        
        ctr = CTRReport(
            id=str(uuid.uuid4()),
            filing_institution=self.filing_institution,
            filing_date=now,
            transaction_date=transaction.created_at,
            transaction_type=transaction.type,
            amount=transaction.amount,
            currency=transaction.currency,
            conductor_type="individual",  # Default, should be determined from sender data
            conductor_name=transaction.sender_name,
            conductor_id=transaction.sender_id,
            conductor_address="",  # Should be populated from customer data
            conductor_country=transaction.sender_country,
            conductor_occupation=conductor_occupation,
            beneficiary_name=beneficiary_name or transaction.recipient_name,
            beneficiary_id=beneficiary_id or transaction.recipient_id,
            beneficiary_address=beneficiary_address,
            beneficiary_country=beneficiary_country or transaction.recipient_country,
            status=ReportStatus.DRAFT,
            created_by=created_by,
            created_at=now,
            updated_at=now,
        )
        
        return ctr
    
    def detect_structuring(
        self,
        customer_id: str,
        transactions: List[Transaction],
    ) -> List[Transaction]:
        """Detect potential structuring activity"""
        
        # Filter transactions for the customer within the window
        customer_txns = [
            t for t in transactions
            if t.sender_id == customer_id
            and self.STRUCTURING_THRESHOLD <= t.amount < self.CTR_THRESHOLD
        ]
        
        if not customer_txns:
            return []
        
        # Sort by date
        customer_txns.sort(key=lambda t: t.created_at)
        
        # Look for patterns within the window
        suspicious = []
        window_start = customer_txns[0].created_at
        window_txns = []
        window_total = 0.0
        
        for txn in customer_txns:
            # Check if transaction is within window
            if (txn.created_at - window_start).days <= self.STRUCTURING_WINDOW_DAYS:
                window_txns.append(txn)
                window_total += txn.amount
                
                # If total exceeds CTR threshold, flag as structuring
                if window_total >= self.CTR_THRESHOLD:
                    suspicious.extend(window_txns)
                    window_txns = []
                    window_total = 0.0
                    window_start = txn.created_at
            else:
                # Start new window
                window_start = txn.created_at
                window_txns = [txn]
                window_total = txn.amount
        
        return list(set(suspicious))  # Remove duplicates
    
    def generate_compliance_summary(
        self,
        report_type: ReportType,
        transactions: List[Transaction],
        kyc_data: Dict[str, Any],
        kyb_data: Dict[str, Any],
        generated_by: str,
        period_start: Optional[datetime] = None,
        period_end: Optional[datetime] = None,
    ) -> ComplianceSummary:
        """Generate a compliance summary report"""
        
        now = datetime.now(timezone.utc)
        
        # Determine period based on report type
        if period_start is None or period_end is None:
            period_end = now
            if report_type == ReportType.DAILY_SUMMARY:
                period_start = now - timedelta(days=1)
            elif report_type == ReportType.WEEKLY_SUMMARY:
                period_start = now - timedelta(weeks=1)
            elif report_type == ReportType.MONTHLY_SUMMARY:
                period_start = now - timedelta(days=30)
            elif report_type == ReportType.QUARTERLY_SUMMARY:
                period_start = now - timedelta(days=90)
            elif report_type == ReportType.ANNUAL_SUMMARY:
                period_start = now - timedelta(days=365)
            else:
                period_start = now - timedelta(days=30)
        
        # Filter transactions for period
        period_txns = [
            t for t in transactions
            if period_start <= t.created_at <= period_end
        ]
        
        # Calculate metrics
        total_amount = sum(t.amount for t in period_txns)
        flagged_txns = [t for t in period_txns if t.flags]
        flagged_amount = sum(t.amount for t in flagged_txns)
        high_risk_txns = [t for t in period_txns if t.risk_score >= 0.7]
        blocked_txns = [t for t in period_txns if t.status == "blocked"]
        
        # Calculate average risk score
        avg_risk = 0.0
        if period_txns:
            avg_risk = sum(t.risk_score for t in period_txns) / len(period_txns)
        
        # Analyze risk factors
        risk_factors: Dict[str, int] = {}
        for txn in period_txns:
            for flag in txn.flags:
                risk_factors[flag] = risk_factors.get(flag, 0) + 1
        
        top_risk_factors = [
            {"factor": k, "count": v}
            for k, v in sorted(risk_factors.items(), key=lambda x: x[1], reverse=True)[:10]
        ]
        
        # Country breakdown
        country_breakdown: Dict[str, Dict[str, Any]] = {}
        for txn in period_txns:
            for country in [txn.sender_country, txn.recipient_country]:
                if country not in country_breakdown:
                    country_breakdown[country] = {
                        "transaction_count": 0,
                        "total_amount": 0.0,
                        "flagged_count": 0,
                    }
                country_breakdown[country]["transaction_count"] += 1
                country_breakdown[country]["total_amount"] += txn.amount
                if txn.flags:
                    country_breakdown[country]["flagged_count"] += 1
        
        # Determine currency (use most common)
        currencies = [t.currency for t in period_txns]
        currency = max(set(currencies), key=currencies.count) if currencies else "USD"
        
        summary = ComplianceSummary(
            id=str(uuid.uuid4()),
            report_type=report_type,
            period_start=period_start,
            period_end=period_end,
            total_transactions=len(period_txns),
            total_amount=total_amount,
            currency=currency,
            flagged_transactions=len(flagged_txns),
            flagged_amount=flagged_amount,
            sar_filed=kyc_data.get("sar_filed", 0),
            ctr_filed=kyc_data.get("ctr_filed", 0),
            kyc_completed=kyc_data.get("completed", 0),
            kyc_pending=kyc_data.get("pending", 0),
            kyc_rejected=kyc_data.get("rejected", 0),
            kyb_completed=kyb_data.get("completed", 0),
            kyb_pending=kyb_data.get("pending", 0),
            kyb_rejected=kyb_data.get("rejected", 0),
            high_risk_transactions=len(high_risk_txns),
            blocked_transactions=len(blocked_txns),
            average_risk_score=avg_risk,
            top_risk_factors=top_risk_factors,
            country_breakdown=country_breakdown,
            generated_at=now,
            generated_by=generated_by,
            status=ReportStatus.DRAFT,
        )
        
        return summary
    
    def export_sar_to_csv(self, sar: SARReport) -> str:
        """Export SAR to CSV format"""
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Header
        writer.writerow([
            "SAR ID", "Filing Institution", "Filing Date", "Subject Type",
            "Subject Name", "Subject ID", "Subject Country",
            "Activity Start Date", "Activity End Date", "Amount Involved",
            "Currency", "Reason", "Status"
        ])
        
        # Data
        writer.writerow([
            sar.id,
            sar.filing_institution,
            sar.filing_date.isoformat(),
            sar.subject_type,
            sar.subject_name,
            sar.subject_id,
            sar.subject_country,
            sar.suspicious_activity_date_start.isoformat(),
            sar.suspicious_activity_date_end.isoformat(),
            sar.amount_involved,
            sar.currency,
            sar.reason.value,
            sar.status.value,
        ])
        
        return output.getvalue()
    
    def export_ctr_to_csv(self, ctr: CTRReport) -> str:
        """Export CTR to CSV format"""
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Header
        writer.writerow([
            "CTR ID", "Filing Institution", "Filing Date", "Transaction Date",
            "Transaction Type", "Amount", "Currency", "Conductor Name",
            "Conductor ID", "Conductor Country", "Beneficiary Name",
            "Beneficiary Country", "Status"
        ])
        
        # Data
        writer.writerow([
            ctr.id,
            ctr.filing_institution,
            ctr.filing_date.isoformat(),
            ctr.transaction_date.isoformat(),
            ctr.transaction_type,
            ctr.amount,
            ctr.currency,
            ctr.conductor_name,
            ctr.conductor_id,
            ctr.conductor_country,
            ctr.beneficiary_name or "",
            ctr.beneficiary_country or "",
            ctr.status.value,
        ])
        
        return output.getvalue()
    
    def export_summary_to_json(self, summary: ComplianceSummary) -> str:
        """Export compliance summary to JSON format"""
        data = asdict(summary)
        # Convert datetime objects to ISO format strings
        for key, value in data.items():
            if isinstance(value, datetime):
                data[key] = value.isoformat()
        return json.dumps(data, indent=2)
    
    def get_ctr_required_transactions(
        self,
        transactions: List[Transaction],
    ) -> List[Transaction]:
        """Get transactions that require CTR filing"""
        return [
            t for t in transactions
            if t.amount >= self.CTR_THRESHOLD
            and t.status == "completed"
        ]
    
    def calculate_risk_metrics(
        self,
        transactions: List[Transaction],
    ) -> Dict[str, Any]:
        """Calculate risk metrics for a set of transactions"""
        if not transactions:
            return {
                "total_transactions": 0,
                "average_risk_score": 0.0,
                "high_risk_percentage": 0.0,
                "flagged_percentage": 0.0,
                "risk_distribution": {},
            }
        
        total = len(transactions)
        high_risk = len([t for t in transactions if t.risk_score >= 0.7])
        flagged = len([t for t in transactions if t.flags])
        
        # Risk score distribution
        distribution = {
            "low": len([t for t in transactions if t.risk_score < 0.3]),
            "medium": len([t for t in transactions if 0.3 <= t.risk_score < 0.7]),
            "high": len([t for t in transactions if t.risk_score >= 0.7]),
        }
        
        return {
            "total_transactions": total,
            "average_risk_score": sum(t.risk_score for t in transactions) / total,
            "high_risk_percentage": (high_risk / total) * 100,
            "flagged_percentage": (flagged / total) * 100,
            "risk_distribution": distribution,
        }


# Example usage
if __name__ == "__main__":
    service = ComplianceReportingService()
    
    # Create sample transactions
    transactions = [
        Transaction(
            id="txn_001",
            reference="REF001",
            type="transfer",
            status="completed",
            amount=15000.0,
            currency="USD",
            sender_id="user_001",
            sender_name="John Doe",
            sender_country="US",
            recipient_id="user_002",
            recipient_name="Jane Smith",
            recipient_country="UK",
            created_at=datetime.now(timezone.utc),
            risk_score=0.3,
        ),
    ]
    
    # Generate CTR for large transaction
    ctr = service.generate_ctr(
        transaction=transactions[0],
        conductor_occupation="Business Owner",
        created_by="compliance_officer",
    )
    print(f"Generated CTR: {ctr.id}")
    
    # Generate compliance summary
    summary = service.generate_compliance_summary(
        report_type=ReportType.DAILY_SUMMARY,
        transactions=transactions,
        kyc_data={"completed": 10, "pending": 5, "rejected": 1},
        kyb_data={"completed": 3, "pending": 2, "rejected": 0},
        generated_by="system",
    )
    print(f"Generated Summary: {summary.id}")
