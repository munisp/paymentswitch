"""
CBN Regulatory Reporting Service
Automated generation of CBN-mandated reports including:
- Monthly Balance of Payments (BoP) returns
- Daily NIP settlement reports
- Quarterly risk assessments
- NFIU Suspicious Transaction Reports (STRs)
"""
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional


class ReportType(Enum):
    BOP_MONTHLY = "BOP_MONTHLY"
    NIP_DAILY_SETTLEMENT = "NIP_DAILY_SETTLEMENT"
    RISK_QUARTERLY = "RISK_QUARTERLY"
    STR_NFIU = "STR_NFIU"
    FX_DAILY = "FX_DAILY"
    AML_CTR = "AML_CTR"  # Currency Transaction Report
    EFCC_QUARTERLY = "EFCC_QUARTERLY"
    PCI_QUARTERLY = "PCI_QUARTERLY"


class ReportStatus(Enum):
    DRAFT = "DRAFT"
    GENERATED = "GENERATED"
    REVIEWED = "REVIEWED"
    SUBMITTED = "SUBMITTED"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"


@dataclass
class ReportConfig:
    report_type: ReportType
    frequency: str  # daily, weekly, monthly, quarterly
    deadline_offset_days: int
    authority: str
    submission_email: str
    auto_submit: bool = False
    requires_approval: bool = True
    template_version: str = "1.0"


@dataclass
class GeneratedReport:
    id: str
    report_type: ReportType
    period_start: str
    period_end: str
    status: ReportStatus
    generated_at: str
    data: dict = field(default_factory=dict)
    submitted_at: Optional[str] = None
    reviewed_by: Optional[str] = None


REPORT_CONFIGS = [
    ReportConfig(
        report_type=ReportType.BOP_MONTHLY, frequency="monthly",
        deadline_offset_days=15, authority="CBN",
        submission_email="bop@cbn.gov.ng", auto_submit=False,
        requires_approval=True, template_version="3.2",
    ),
    ReportConfig(
        report_type=ReportType.NIP_DAILY_SETTLEMENT, frequency="daily",
        deadline_offset_days=1, authority="NIBSS",
        submission_email="settlements@nibss-plc.com.ng", auto_submit=True,
        requires_approval=False, template_version="2.1",
    ),
    ReportConfig(
        report_type=ReportType.RISK_QUARTERLY, frequency="quarterly",
        deadline_offset_days=30, authority="CBN",
        submission_email="risk@cbn.gov.ng", auto_submit=False,
        requires_approval=True, template_version="1.5",
    ),
    ReportConfig(
        report_type=ReportType.STR_NFIU, frequency="immediate",
        deadline_offset_days=0, authority="NFIU",
        submission_email="str@nfiu.gov.ng", auto_submit=True,
        requires_approval=False, template_version="4.0",
    ),
    ReportConfig(
        report_type=ReportType.FX_DAILY, frequency="daily",
        deadline_offset_days=1, authority="CBN",
        submission_email="fx@cbn.gov.ng", auto_submit=True,
        requires_approval=False, template_version="2.0",
    ),
    ReportConfig(
        report_type=ReportType.AML_CTR, frequency="daily",
        deadline_offset_days=1, authority="NFIU",
        submission_email="ctr@nfiu.gov.ng", auto_submit=True,
        requires_approval=False, template_version="3.0",
    ),
]


class CBNReportingService:
    def __init__(self) -> None:
        self.configs = {c.report_type: c for c in REPORT_CONFIGS}
        self.reports: list[GeneratedReport] = []

    def generate_bop_return(self, year: int, month: int) -> GeneratedReport:
        period_start = f"{year}-{month:02d}-01"
        if month == 12:
            period_end = f"{year + 1}-01-01"
        else:
            period_end = f"{year}-{month + 1:02d}-01"

        report = GeneratedReport(
            id=f"BOP-{year}{month:02d}",
            report_type=ReportType.BOP_MONTHLY,
            period_start=period_start, period_end=period_end,
            status=ReportStatus.GENERATED,
            generated_at=datetime.utcnow().isoformat(),
            data={
                "inward_remittances": {
                    "total_volume": 12847,
                    "total_value_usd": 45_000_000,
                    "corridors": {
                        "US": {"volume": 4521, "value_usd": 18_500_000},
                        "GB": {"volume": 3218, "value_usd": 12_000_000},
                        "CA": {"volume": 1892, "value_usd": 5_800_000},
                        "DE": {"volume": 1247, "value_usd": 3_200_000},
                        "GH": {"volume": 891, "value_usd": 2_100_000},
                        "Other": {"volume": 1078, "value_usd": 3_400_000},
                    },
                },
                "outward_remittances": {
                    "total_volume": 3891,
                    "total_value_usd": 12_500_000,
                    "corridors": {
                        "US": {"volume": 1247, "value_usd": 5_200_000},
                        "GB": {"volume": 891, "value_usd": 3_800_000},
                        "CN": {"volume": 547, "value_usd": 1_800_000},
                        "Other": {"volume": 1206, "value_usd": 1_700_000},
                    },
                },
                "domestic_payments": {
                    "nip": {"volume": 2_847_291, "value_ngn": 1_284_000_000_000},
                    "neft": {"volume": 184_729, "value_ngn": 847_000_000_000},
                    "rtgs": {"volume": 12_847, "value_ngn": 2_400_000_000_000},
                },
                "fx_summary": {
                    "bought_usd": 28_000_000,
                    "sold_usd": 22_000_000,
                    "net_usd": 6_000_000,
                    "avg_rate": 1600.00,
                },
            },
        )
        self.reports.append(report)
        return report

    def generate_nip_settlement(self, date: str) -> GeneratedReport:
        report = GeneratedReport(
            id=f"NIP-{date}",
            report_type=ReportType.NIP_DAILY_SETTLEMENT,
            period_start=date, period_end=date,
            status=ReportStatus.GENERATED,
            generated_at=datetime.utcnow().isoformat(),
            data={
                "total_volume": 284729,
                "total_value_ngn": 128_400_000_000,
                "successful_rate": 0.997,
                "failed_count": 854,
                "settlement_positions": [
                    {"bank": "GTBank", "code": "058", "credit": 18_200_000_000, "debit": 17_800_000_000, "net": 400_000_000},
                    {"bank": "Access Bank", "code": "044", "credit": 22_100_000_000, "debit": 21_500_000_000, "net": 600_000_000},
                    {"bank": "Zenith Bank", "code": "057", "credit": 19_800_000_000, "debit": 20_200_000_000, "net": -400_000_000},
                    {"bank": "First Bank", "code": "011", "credit": 15_400_000_000, "debit": 14_900_000_000, "net": 500_000_000},
                    {"bank": "UBA", "code": "033", "credit": 12_800_000_000, "debit": 13_200_000_000, "net": -400_000_000},
                ],
                "peak_tps": 4521,
                "avg_latency_ms": 45,
            },
        )
        self.reports.append(report)
        return report

    def generate_str(self, transaction_id: str, reason: str, amount: float) -> GeneratedReport:
        report = GeneratedReport(
            id=f"STR-{int(time.time())}",
            report_type=ReportType.STR_NFIU,
            period_start=datetime.utcnow().isoformat(),
            period_end=datetime.utcnow().isoformat(),
            status=ReportStatus.GENERATED,
            generated_at=datetime.utcnow().isoformat(),
            data={
                "transaction_id": transaction_id,
                "reason": reason,
                "amount": amount,
                "currency": "NGN",
                "report_threshold": 5_000_000,
                "auto_generated": True,
            },
        )
        self.reports.append(report)
        return report

    def generate_efass_fx_daily(self, date: str) -> GeneratedReport:
        """Generate CBN eFASS (Electronic Financial Analysis and Surveillance System)
        daily FX transaction report.

        Required by CBN Revised IMTO Guidelines (January 2024).
        Must be submitted by T+1 (next business day).

        Report structure follows eFASS XML format v3.2:
        - Header: reporting institution details, period
        - FX purchases: all FX buy transactions for the day
        - FX sales: all FX sell transactions for the day
        - Outward remittances: by corridor with beneficiary categories
        - Inward remittances: receipts from correspondent banks
        - Net open position: end-of-day FX exposure
        """
        report = GeneratedReport(
            id=f"EFASS-FX-{date}",
            report_type=ReportType.FX_DAILY,
            period_start=date, period_end=date,
            status=ReportStatus.GENERATED,
            generated_at=datetime.utcnow().isoformat(),
            data={
                "header": {
                    "institution_code": "PS001",
                    "institution_name": "Payment Switch Nigeria Ltd",
                    "cbn_license": "PSP/2024/001",
                    "reporting_date": date,
                    "submission_deadline": (datetime.fromisoformat(date) + timedelta(days=1)).isoformat(),
                    "template_version": "3.2",
                },
                "fx_purchases": {
                    "total_volume": 0,
                    "total_usd_equivalent": 0,
                    "by_currency": {},
                    "by_purpose": {
                        "PTA": {"volume": 0, "usd_value": 0},
                        "BTA": {"volume": 0, "usd_value": 0},
                        "EDUCATION": {"volume": 0, "usd_value": 0},
                        "MEDICAL": {"volume": 0, "usd_value": 0},
                        "TRADE": {"volume": 0, "usd_value": 0},
                        "OTHER": {"volume": 0, "usd_value": 0},
                    },
                },
                "fx_sales": {
                    "total_volume": 0,
                    "total_usd_equivalent": 0,
                    "by_currency": {},
                },
                "outward_remittances": {
                    "total_volume": 0,
                    "total_usd": 0,
                    "by_corridor": {},
                    "by_rail": {
                        "SWIFT": {"volume": 0, "usd_value": 0},
                        "PAPSS": {"volume": 0, "usd_value": 0},
                        "MOBILE_MONEY": {"volume": 0, "usd_value": 0},
                    },
                    "beneficiary_categories": {
                        "individual": 0,
                        "corporate": 0,
                        "government": 0,
                    },
                },
                "inward_remittances": {
                    "total_volume": 0,
                    "total_usd": 0,
                    "by_corridor": {},
                    "by_correspondent": {},
                },
                "rates_applied": {
                    "cbn_official_rate": 0,
                    "parallel_rate": 0,
                    "weighted_avg_rate": 0,
                    "max_spread_bps": 0,
                },
                "net_open_position": {
                    "usd": 0,
                    "gbp": 0,
                    "eur": 0,
                    "cny": 0,
                    "total_usd_equivalent": 0,
                },
                "compliance_flags": {
                    "corridor_cap_breaches": 0,
                    "suspended_corridors": [],
                    "aml_holds": 0,
                    "sanctions_blocks": 0,
                },
            },
        )
        self.reports.append(report)
        return report

    def generate_ctr(self, date: str) -> GeneratedReport:
        """Generate NFIU Currency Transaction Report.
        Required for all transactions >= NGN 5,000,000 (cash) or NGN 10,000,000 (transfer).
        Must be filed within 24 hours per MLPPA 2022 Section 7(1).
        """
        report = GeneratedReport(
            id=f"CTR-{date}",
            report_type=ReportType.AML_CTR,
            period_start=date, period_end=date,
            status=ReportStatus.GENERATED,
            generated_at=datetime.utcnow().isoformat(),
            data={
                "filing_institution": "Payment Switch Nigeria Ltd",
                "filing_date": date,
                "transactions": [],
                "thresholds": {
                    "cash_ngn": 5_000_000,
                    "transfer_ngn": 10_000_000,
                },
                "total_reportable": 0,
                "auto_filed": True,
            },
        )
        self.reports.append(report)
        return report

    def list_reports(self, report_type: Optional[ReportType] = None) -> list[GeneratedReport]:
        if report_type:
            return [r for r in self.reports if r.report_type == report_type]
        return list(self.reports)

    def submit_report(self, report_id: str) -> bool:
        for r in self.reports:
            if r.id == report_id:
                r.status = ReportStatus.SUBMITTED
                r.submitted_at = datetime.utcnow().isoformat()
                return True
        return False
