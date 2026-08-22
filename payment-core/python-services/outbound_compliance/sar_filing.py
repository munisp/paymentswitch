"""
Automated Suspicious Activity Report (SAR) Filing Service
Generates and submits SARs to NFIU (Nigerian Financial Intelligence Unit)
from escalated compliance screenings.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional
import hashlib
import json
import uuid


class SARPriority(Enum):
    """SAR urgency classification per CBN AML/CFT guidelines"""
    CRITICAL = "critical"     # File within 24 hours (terrorism financing)
    HIGH = "high"             # File within 3 days (confirmed sanctions match)
    MEDIUM = "medium"         # File within 7 days (pattern-based detection)
    LOW = "low"               # File within 15 days (below threshold aggregation)


class SARStatus(Enum):
    """SAR lifecycle states"""
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    SUBMITTED = "submitted"
    ACKNOWLEDGED = "acknowledged"
    REJECTED = "rejected"
    REQUIRES_INFO = "requires_info"


class SARCategory(Enum):
    """NFIU SAR classification categories"""
    TERRORISM_FINANCING = "terrorism_financing"
    MONEY_LAUNDERING = "money_laundering"
    SANCTIONS_EVASION = "sanctions_evasion"
    FRAUD = "fraud"
    TAX_EVASION = "tax_evasion"
    PROLIFERATION_FINANCING = "proliferation_financing"
    PROCEEDS_OF_CRIME = "proceeds_of_crime"
    STRUCTURING = "structuring"
    UNUSUAL_PATTERN = "unusual_pattern"


@dataclass
class SARSubject:
    """Subject of the suspicious activity"""
    name: str
    account_number: str
    participant_id: int
    participant_name: str
    bvn: Optional[str] = None
    nin: Optional[str] = None
    date_of_birth: Optional[str] = None
    nationality: str = "NG"
    address: Optional[str] = None
    phone: Optional[str] = None
    relationship: str = "customer"  # customer, beneficiary, both


@dataclass
class SARTransaction:
    """Transaction details included in the SAR"""
    transfer_ref: str
    amount_ngn: float
    corridor: str
    beneficiary_name: str
    beneficiary_account: str
    dest_country: str
    purpose: str
    timestamp: datetime
    status: str
    screening_score: float
    matched_list: Optional[str] = None
    matched_entity: Optional[str] = None


@dataclass
class SuspiciousActivityReport:
    """Complete SAR document for NFIU submission"""
    id: str = field(default_factory=lambda: f"SAR-{uuid.uuid4().hex[:12].upper()}")
    reference: str = ""
    category: SARCategory = SARCategory.UNUSUAL_PATTERN
    priority: SARPriority = SARPriority.MEDIUM
    status: SARStatus = SARStatus.DRAFT
    
    # Subjects
    subjects: list = field(default_factory=list)
    
    # Transactions
    transactions: list = field(default_factory=list)
    
    # Narrative
    narrative: str = ""
    indicators: list = field(default_factory=list)
    
    # Metadata
    filing_institution: str = "National Outbound Remittance Platform"
    filing_officer: str = ""
    compliance_officer: str = ""
    
    # Timestamps
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    submitted_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None
    deadline: Optional[datetime] = None
    
    # NFIU response
    nfiu_reference: Optional[str] = None
    nfiu_feedback: Optional[str] = None
    
    def __post_init__(self):
        if not self.reference:
            self.reference = f"NORP-SAR-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{self.id[-6:]}"
        if not self.deadline:
            days = {
                SARPriority.CRITICAL: 1,
                SARPriority.HIGH: 3,
                SARPriority.MEDIUM: 7,
                SARPriority.LOW: 15,
            }
            self.deadline = datetime.now(timezone.utc) + timedelta(days=days[self.priority])


class SARFilingService:
    """
    Automated SAR generation and filing service.
    Integrates with NFIU GoAML portal for electronic submission.
    """
    
    def __init__(self):
        self.reports: list[SuspiciousActivityReport] = []
        self.nfiu_endpoint = "https://goaml.nfiu.gov.ng/api/v2/reports"
        self.institution_code = "NORP-001"
        
    def generate_from_escalation(
        self,
        transfer_ref: str,
        participant_id: int,
        participant_name: str,
        screening_result: dict,
        transfer_details: dict,
    ) -> SuspiciousActivityReport:
        """
        Auto-generate a SAR from an escalated compliance screening.
        
        Args:
            transfer_ref: The transfer reference that triggered escalation
            participant_id: Submitting participant
            participant_name: Participant organization name
            screening_result: Sanctions screening output (score, list, matched_entity)
            transfer_details: Full transfer details (amount, corridor, beneficiary, etc.)
        """
        # Determine category based on matched list
        category = self._classify_category(screening_result)
        priority = self._determine_priority(screening_result, transfer_details)
        
        # Build subject
        subject = SARSubject(
            name=transfer_details.get("beneficiary_name", "Unknown"),
            account_number=transfer_details.get("beneficiary_account", ""),
            participant_id=participant_id,
            participant_name=participant_name,
            nationality=transfer_details.get("dest_country", ""),
            relationship="beneficiary",
        )
        
        # Build transaction record
        transaction = SARTransaction(
            transfer_ref=transfer_ref,
            amount_ngn=transfer_details.get("amount_ngn", 0),
            corridor=transfer_details.get("corridor", ""),
            beneficiary_name=transfer_details.get("beneficiary_name", ""),
            beneficiary_account=transfer_details.get("beneficiary_account", ""),
            dest_country=transfer_details.get("dest_country", ""),
            purpose=transfer_details.get("purpose", ""),
            timestamp=datetime.fromisoformat(transfer_details.get("timestamp", datetime.now(timezone.utc).isoformat())),
            status=transfer_details.get("status", "blocked"),
            screening_score=screening_result.get("score", 0),
            matched_list=screening_result.get("list", ""),
            matched_entity=screening_result.get("matched_entity", ""),
        )
        
        # Generate narrative
        narrative = self._generate_narrative(subject, transaction, screening_result)
        
        # Identify indicators
        indicators = self._identify_indicators(screening_result, transfer_details)
        
        sar = SuspiciousActivityReport(
            category=category,
            priority=priority,
            subjects=[subject],
            transactions=[transaction],
            narrative=narrative,
            indicators=indicators,
        )
        
        self.reports.append(sar)
        return sar
    
    def submit_to_nfiu(self, sar_id: str) -> dict:
        """
        Submit a SAR to NFIU GoAML portal.
        Returns submission receipt.
        """
        sar = self._find_report(sar_id)
        if not sar:
            return {"error": f"SAR {sar_id} not found"}
        
        if sar.status not in (SARStatus.APPROVED, SARStatus.DRAFT):
            return {"error": f"SAR cannot be submitted in status {sar.status.value}"}
        
        # Build GoAML-compatible payload
        payload = self._build_goaml_payload(sar)
        
        # In production, this would POST to NFIU API
        # For now, simulate submission
        sar.status = SARStatus.SUBMITTED
        sar.submitted_at = datetime.now(timezone.utc)
        sar.nfiu_reference = f"NFIU-{datetime.now(timezone.utc).strftime('%Y')}-{hashlib.md5(sar.id.encode()).hexdigest()[:8].upper()}"
        
        return {
            "success": True,
            "nfiu_reference": sar.nfiu_reference,
            "submitted_at": sar.submitted_at.isoformat(),
            "expected_acknowledgement": "24-48 hours",
        }
    
    def get_pending_sars(self, priority: Optional[SARPriority] = None) -> list:
        """Get SARs pending submission, optionally filtered by priority"""
        results = []
        for sar in self.reports:
            if sar.status in (SARStatus.DRAFT, SARStatus.PENDING_REVIEW, SARStatus.APPROVED):
                if priority is None or sar.priority == priority:
                    results.append(sar)
        return results
    
    def get_overdue_sars(self) -> list:
        """Get SARs past their filing deadline"""
        now = datetime.now(timezone.utc)
        overdue = []
        for sar in self.reports:
            if not sar.deadline:
                continue
            deadline = sar.deadline
            if deadline.tzinfo is None:
                deadline = deadline.replace(tzinfo=timezone.utc)
            if now > deadline and sar.status not in (SARStatus.SUBMITTED, SARStatus.ACKNOWLEDGED):
                overdue.append(sar)
        return overdue
    
    def _classify_category(self, screening_result: dict) -> SARCategory:
        matched_list = screening_result.get("list", "").upper()
        if "OFAC" in matched_list:
            return SARCategory.SANCTIONS_EVASION
        if "UN" in matched_list:
            return SARCategory.PROLIFERATION_FINANCING
        if "PEP" in matched_list:
            return SARCategory.PROCEEDS_OF_CRIME
        if "INTERPOL" in matched_list:
            return SARCategory.FRAUD
        return SARCategory.UNUSUAL_PATTERN
    
    def _determine_priority(self, screening_result: dict, transfer_details: dict) -> SARPriority:
        score = screening_result.get("score", 0)
        amount = transfer_details.get("amount_ngn", 0)
        
        if score >= 0.95:
            return SARPriority.CRITICAL
        if score >= 0.85 or amount >= 50_000_000:
            return SARPriority.HIGH
        if score >= 0.75:
            return SARPriority.MEDIUM
        return SARPriority.LOW
    
    def _generate_narrative(self, subject: SARSubject, transaction: SARTransaction, screening: dict) -> str:
        return (
            f"On {transaction.timestamp.strftime('%Y-%m-%d at %H:%M UTC')}, "
            f"a cross-border transfer of NGN {transaction.amount_ngn:,.2f} to {transaction.dest_country} "
            f"via corridor {transaction.corridor} was flagged during automated compliance screening. "
            f"The beneficiary '{subject.name}' (account: {subject.account_number}) "
            f"matched against {screening.get('list', 'unknown list')} with a confidence score of "
            f"{screening.get('score', 0)*100:.1f}%. "
            f"Matched entity: {screening.get('matched_entity', 'N/A')}. "
            f"The transfer was submitted by {subject.participant_name} (Participant ID: {subject.participant_id}) "
            f"with stated purpose: {transaction.purpose}. "
            f"The transfer has been blocked pending investigation."
        )
    
    def _identify_indicators(self, screening: dict, transfer: dict) -> list:
        indicators = []
        score = screening.get("score", 0)
        
        if score >= 0.95:
            indicators.append("Near-exact match on designated sanctions list")
        elif score >= 0.80:
            indicators.append("High-confidence partial match on sanctions list")
        
        amount = transfer.get("amount_ngn", 0)
        if amount >= 50_000_000:
            indicators.append(f"High-value transaction (NGN {amount:,.0f})")
        
        if transfer.get("corridor", "").endswith(("-CN", "-AE", "-TR")):
            indicators.append("High-risk corridor destination")
        
        return indicators
    
    def _find_report(self, sar_id: str) -> Optional[SuspiciousActivityReport]:
        for sar in self.reports:
            if sar.id == sar_id:
                return sar
        return None
    
    def _build_goaml_payload(self, sar: SuspiciousActivityReport) -> dict:
        """Build GoAML XML-compatible payload structure"""
        return {
            "report_type": "STR",
            "institution_code": self.institution_code,
            "reference": sar.reference,
            "category": sar.category.value,
            "priority": sar.priority.value,
            "narrative": sar.narrative,
            "indicators": sar.indicators,
            "subjects": [
                {
                    "name": s.name,
                    "account": s.account_number,
                    "nationality": s.nationality,
                    "bvn": s.bvn,
                    "nin": s.nin,
                }
                for s in sar.subjects
            ],
            "transactions": [
                {
                    "reference": t.transfer_ref,
                    "amount": t.amount_ngn,
                    "currency": "NGN",
                    "corridor": t.corridor,
                    "beneficiary": t.beneficiary_name,
                    "dest_country": t.dest_country,
                    "timestamp": t.timestamp.isoformat(),
                }
                for t in sar.transactions
            ],
        }
