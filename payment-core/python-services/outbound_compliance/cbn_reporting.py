"""
CBN Regulatory Reporting Automation
Auto-generates daily and monthly regulatory returns in CBN-prescribed formats.
Covers:
- Daily Transaction Report (DTR)
- Monthly Corridor Analysis
- Quarterly AML/CFT Returns
- Annual Participant Performance Summary
"""

from dataclasses import dataclass, field
from datetime import datetime, date, timedelta, timezone
from enum import Enum
from typing import Optional
import csv
import io
import json


class ReportType(Enum):
    """CBN report types with prescribed filing frequency"""
    DAILY_TRANSACTION = "daily_transaction"           # Due by T+1 09:00
    DAILY_FX_UTILIZATION = "daily_fx_utilization"     # Due by T+1 10:00
    WEEKLY_CORRIDOR_SUMMARY = "weekly_corridor_summary"  # Due Monday 12:00
    MONTHLY_PARTICIPANT_METRICS = "monthly_participant"    # Due M+5 business days
    MONTHLY_COMPLIANCE = "monthly_compliance"          # Due M+10 business days
    QUARTERLY_AML_CFT = "quarterly_aml_cft"           # Due Q+15 business days
    ANNUAL_PERFORMANCE = "annual_performance"          # Due Jan 31


class ReportStatus(Enum):
    """Report lifecycle status"""
    GENERATING = "generating"
    GENERATED = "generated"
    VALIDATING = "validating"
    VALIDATED = "validated"
    SUBMITTED = "submitted"
    ACKNOWLEDGED = "acknowledged"
    REVISION_REQUIRED = "revision_required"


@dataclass
class CBNReportConfig:
    """Configuration for a specific report type"""
    report_type: ReportType
    frequency: str  # daily, weekly, monthly, quarterly, annual
    deadline_description: str
    format: str  # csv, xml, json, pdf
    submission_portal: str
    fields: list = field(default_factory=list)


@dataclass
class GeneratedReport:
    """A generated regulatory report"""
    id: str
    report_type: ReportType
    period_start: date
    period_end: date
    status: ReportStatus
    content: str  # Serialized report content
    format: str
    row_count: int
    generated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    submitted_at: Optional[datetime] = None
    cbn_reference: Optional[str] = None
    validation_errors: list = field(default_factory=list)
    metadata: dict = field(default_factory=dict)


class CBNReportingService:
    """
    Automated CBN regulatory reporting service.
    Generates, validates, and submits prescribed reports.
    """
    
    REPORT_CONFIGS = {
        ReportType.DAILY_TRANSACTION: CBNReportConfig(
            report_type=ReportType.DAILY_TRANSACTION,
            frequency="daily",
            deadline_description="T+1 by 09:00 WAT",
            format="csv",
            submission_portal="https://cbn-efass.gov.ng/returns/outbound",
            fields=[
                "date", "transfer_ref", "participant_code", "participant_name",
                "corridor", "amount_ngn", "amount_dest", "dest_currency",
                "fx_rate", "cbn_spread_bps", "beneficiary_country",
                "purpose_code", "status", "provider", "settlement_time_hrs",
            ],
        ),
        ReportType.DAILY_FX_UTILIZATION: CBNReportConfig(
            report_type=ReportType.DAILY_FX_UTILIZATION,
            frequency="daily",
            deadline_description="T+1 by 10:00 WAT",
            format="csv",
            submission_portal="https://cbn-efass.gov.ng/returns/fx",
            fields=[
                "date", "corridor", "total_ngn_volume", "total_dest_volume",
                "dest_currency", "avg_rate", "cbn_rate", "spread_bps",
                "spread_cap_bps", "utilization_pct", "transaction_count",
            ],
        ),
        ReportType.MONTHLY_PARTICIPANT_METRICS: CBNReportConfig(
            report_type=ReportType.MONTHLY_PARTICIPANT_METRICS,
            frequency="monthly",
            deadline_description="M+5 business days",
            format="csv",
            submission_portal="https://cbn-efass.gov.ng/returns/participants",
            fields=[
                "month", "participant_code", "participant_name", "tier",
                "total_transactions", "total_volume_ngn", "avg_transaction_ngn",
                "success_rate_pct", "avg_settlement_hours", "corridors_active",
                "compliance_flags", "disputes_raised", "disputes_resolved",
                "prefund_avg_balance_ngn", "subscription_tier",
            ],
        ),
        ReportType.MONTHLY_COMPLIANCE: CBNReportConfig(
            report_type=ReportType.MONTHLY_COMPLIANCE,
            frequency="monthly",
            deadline_description="M+10 business days",
            format="json",
            submission_portal="https://cbn-efass.gov.ng/returns/compliance",
            fields=[
                "month", "total_screenings", "auto_cleared", "escalated",
                "blocked", "sars_filed", "avg_screening_time_ms",
                "false_positive_rate", "lists_updated_count",
                "beneficiaries_rescreened", "new_matches_detected",
            ],
        ),
    }
    
    def __init__(self):
        self.reports: list[GeneratedReport] = []
    
    def generate_daily_transaction_report(self, report_date: date, transactions: list[dict]) -> GeneratedReport:
        """
        Generate the Daily Transaction Report (DTR) for CBN.
        
        Args:
            report_date: The business date being reported
            transactions: List of all transfers for that date
        """
        config = self.REPORT_CONFIGS[ReportType.DAILY_TRANSACTION]
        
        # Build CSV content
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=config.fields)
        writer.writeheader()
        
        for txn in transactions:
            writer.writerow({
                "date": report_date.isoformat(),
                "transfer_ref": txn.get("transfer_ref", ""),
                "participant_code": txn.get("participant_code", ""),
                "participant_name": txn.get("participant_name", ""),
                "corridor": txn.get("corridor", ""),
                "amount_ngn": f"{txn.get('amount_ngn', 0):.2f}",
                "amount_dest": f"{txn.get('amount_dest', 0):.2f}",
                "dest_currency": txn.get("dest_currency", ""),
                "fx_rate": f"{txn.get('fx_rate', 0):.6f}",
                "cbn_spread_bps": txn.get("cbn_spread_bps", 0),
                "beneficiary_country": txn.get("beneficiary_country", ""),
                "purpose_code": txn.get("purpose_code", ""),
                "status": txn.get("status", ""),
                "provider": txn.get("provider", ""),
                "settlement_time_hrs": f"{txn.get('settlement_time_hrs', 0):.1f}",
            })
        
        content = output.getvalue()
        
        report = GeneratedReport(
            id=f"DTR-{report_date.isoformat()}",
            report_type=ReportType.DAILY_TRANSACTION,
            period_start=report_date,
            period_end=report_date,
            status=ReportStatus.GENERATED,
            content=content,
            format="csv",
            row_count=len(transactions),
            metadata={
                "total_volume_ngn": sum(t.get("amount_ngn", 0) for t in transactions),
                "total_transactions": len(transactions),
                "corridors": list(set(t.get("corridor", "") for t in transactions)),
                "participants": list(set(t.get("participant_code", "") for t in transactions)),
            },
        )
        
        self.reports.append(report)
        return report
    
    def generate_fx_utilization_report(self, report_date: date, corridor_data: list[dict]) -> GeneratedReport:
        """Generate Daily FX Utilization Report"""
        config = self.REPORT_CONFIGS[ReportType.DAILY_FX_UTILIZATION]
        
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=config.fields)
        writer.writeheader()
        
        for corridor in corridor_data:
            utilization = (corridor.get("spread_bps", 0) / corridor.get("spread_cap_bps", 1)) * 100
            writer.writerow({
                "date": report_date.isoformat(),
                "corridor": corridor.get("corridor", ""),
                "total_ngn_volume": f"{corridor.get('total_ngn_volume', 0):.2f}",
                "total_dest_volume": f"{corridor.get('total_dest_volume', 0):.2f}",
                "dest_currency": corridor.get("dest_currency", ""),
                "avg_rate": f"{corridor.get('avg_rate', 0):.6f}",
                "cbn_rate": f"{corridor.get('cbn_rate', 0):.6f}",
                "spread_bps": corridor.get("spread_bps", 0),
                "spread_cap_bps": corridor.get("spread_cap_bps", 0),
                "utilization_pct": f"{utilization:.1f}",
                "transaction_count": corridor.get("transaction_count", 0),
            })
        
        content = output.getvalue()
        
        report = GeneratedReport(
            id=f"FXU-{report_date.isoformat()}",
            report_type=ReportType.DAILY_FX_UTILIZATION,
            period_start=report_date,
            period_end=report_date,
            status=ReportStatus.GENERATED,
            content=content,
            format="csv",
            row_count=len(corridor_data),
        )
        
        self.reports.append(report)
        return report
    
    def generate_monthly_compliance_report(self, year: int, month: int, compliance_data: dict) -> GeneratedReport:
        """Generate Monthly Compliance Report"""
        period_start = date(year, month, 1)
        if month == 12:
            period_end = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            period_end = date(year, month + 1, 1) - timedelta(days=1)
        
        content = json.dumps({
            "report_type": "monthly_compliance",
            "period": f"{year}-{month:02d}",
            "metrics": compliance_data,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "institution": "National Outbound Remittance Platform",
        }, indent=2)
        
        report = GeneratedReport(
            id=f"MCR-{year}-{month:02d}",
            report_type=ReportType.MONTHLY_COMPLIANCE,
            period_start=period_start,
            period_end=period_end,
            status=ReportStatus.GENERATED,
            content=content,
            format="json",
            row_count=1,
            metadata=compliance_data,
        )
        
        self.reports.append(report)
        return report
    
    def validate_report(self, report_id: str) -> list[str]:
        """
        Validate a generated report against CBN format requirements.
        Returns list of validation errors (empty = valid).
        """
        report = self._find_report(report_id)
        if not report:
            return [f"Report {report_id} not found"]
        
        errors = []
        
        # Check row count
        if report.row_count == 0:
            errors.append("Report contains no data rows")
        
        # Check content not empty
        if not report.content or len(report.content) < 10:
            errors.append("Report content is empty or too short")
        
        # Type-specific validation
        if report.report_type == ReportType.DAILY_TRANSACTION:
            if report.format != "csv":
                errors.append("DTR must be in CSV format")
        
        if errors:
            report.status = ReportStatus.REVISION_REQUIRED
            report.validation_errors = errors
        else:
            report.status = ReportStatus.VALIDATED
        
        return errors
    
    def submit_report(self, report_id: str) -> dict:
        """Submit a validated report to CBN portal"""
        report = self._find_report(report_id)
        if not report:
            return {"error": f"Report {report_id} not found"}
        
        if report.status != ReportStatus.VALIDATED:
            return {"error": f"Report must be validated before submission (current: {report.status.value})"}
        
        # Simulate submission to CBN eFASS portal
        report.status = ReportStatus.SUBMITTED
        report.submitted_at = datetime.now(timezone.utc)
        report.cbn_reference = f"CBN-{report.report_type.value.upper()}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
        
        return {
            "success": True,
            "cbn_reference": report.cbn_reference,
            "submitted_at": report.submitted_at.isoformat(),
            "portal": self.REPORT_CONFIGS.get(report.report_type, CBNReportConfig(
                report_type=report.report_type,
                frequency="",
                deadline_description="",
                format="",
                submission_portal="https://cbn-efass.gov.ng",
            )).submission_portal,
        }
    
    def get_pending_reports(self) -> list[GeneratedReport]:
        """Get reports that are generated but not yet submitted"""
        return [
            r for r in self.reports
            if r.status in (ReportStatus.GENERATED, ReportStatus.VALIDATED)
        ]
    
    def get_overdue_reports(self) -> list[dict]:
        """Identify reports that should have been filed but haven't"""
        today = date.today()
        overdue = []
        
        # Check daily reports for yesterday
        yesterday = today - timedelta(days=1)
        daily_types = [ReportType.DAILY_TRANSACTION, ReportType.DAILY_FX_UTILIZATION]
        for rt in daily_types:
            existing = [r for r in self.reports if r.report_type == rt and r.period_start == yesterday]
            if not existing:
                overdue.append({
                    "report_type": rt.value,
                    "period": yesterday.isoformat(),
                    "deadline": f"{today.isoformat()} 09:00 WAT",
                    "status": "missing",
                })
        
        return overdue
    
    def _find_report(self, report_id: str) -> Optional[GeneratedReport]:
        for r in self.reports:
            if r.id == report_id:
                return r
        return None
