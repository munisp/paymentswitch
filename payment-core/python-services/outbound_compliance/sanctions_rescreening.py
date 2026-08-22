"""
Continuous Sanctions Re-Screening Service
Re-screens existing beneficiaries when sanctions lists are updated.
Ensures ongoing compliance beyond point-of-transaction screening.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional
import difflib
import hashlib


class ListUpdateType(Enum):
    """Type of sanctions list update"""
    ADDITION = "addition"       # New entry added to list
    REMOVAL = "removal"         # Entry removed from list
    MODIFICATION = "modification"  # Entry details changed
    FULL_REFRESH = "full_refresh"  # Complete list replacement


class RescreeningStatus(Enum):
    """Status of a re-screening batch"""
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


class MatchAction(Enum):
    """Action to take on a re-screening match"""
    BLOCK_FUTURE = "block_future"        # Block future transfers to this beneficiary
    FREEZE_PENDING = "freeze_pending"    # Freeze any pending transfers
    ALERT_ONLY = "alert_only"            # Generate alert, no automatic action
    ESCALATE = "escalate"                # Escalate to compliance officer


@dataclass
class SanctionsListUpdate:
    """Represents an update to a sanctions list"""
    id: str
    list_name: str                    # OFAC SDN, UN, EU, CBN, etc.
    update_type: ListUpdateType
    entries_affected: int
    published_at: datetime
    ingested_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    checksum: str = ""
    source_url: str = ""


@dataclass
class BeneficiaryRecord:
    """A known beneficiary that needs re-screening"""
    id: str
    name: str
    account: str
    country: str
    participant_id: int
    first_transfer_at: datetime
    last_transfer_at: datetime
    total_transfers: int
    total_amount_ngn: float
    last_screening_at: Optional[datetime] = None
    last_screening_score: float = 0.0
    blocked: bool = False


@dataclass
class RescreeningResult:
    """Result of re-screening a beneficiary against updated lists"""
    beneficiary_id: str
    beneficiary_name: str
    participant_id: int
    list_name: str
    match_score: float
    matched_entity: str
    action: MatchAction
    previous_score: float
    score_delta: float
    screened_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    acknowledged: bool = False
    
    @property
    def is_new_match(self) -> bool:
        """True if this beneficiary was previously clear but now matches"""
        return self.previous_score < 0.75 and self.match_score >= 0.75


@dataclass
class RescreeningBatch:
    """A batch re-screening run triggered by a list update"""
    id: str
    list_update_id: str
    list_name: str
    status: RescreeningStatus
    total_beneficiaries: int
    screened_count: int = 0
    new_matches: int = 0
    score_changes: int = 0
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    results: list = field(default_factory=list)


class SanctionsRescreeningService:
    """
    Monitors sanctions list updates and re-screens all known beneficiaries.
    
    Flow:
    1. List update detected (via OFAC RSS, UN API, CBN portal, etc.)
    2. All beneficiaries in affected corridors are queued for re-screening
    3. Fuzzy matching runs against updated list
    4. New matches trigger alerts, blocks, or escalations
    5. Results reported to compliance officer and regulatory dashboard
    """
    
    SANCTIONS_LISTS = [
        {"name": "OFAC SDN", "url": "https://www.treasury.gov/ofac/downloads/sdn.xml", "frequency_hours": 24},
        {"name": "OFAC Non-SDN", "url": "https://www.treasury.gov/ofac/downloads/consolidated.xml", "frequency_hours": 24},
        {"name": "UN Consolidated", "url": "https://scsanctions.un.org/resources/xml/en/consolidated.xml", "frequency_hours": 48},
        {"name": "EU Sanctions", "url": "https://data.europa.eu/api/hub/store/data/consolidated-sanctions.xml", "frequency_hours": 48},
        {"name": "CBN Designated", "url": "internal://cbn-sanctions-list", "frequency_hours": 12},
        {"name": "INTERPOL", "url": "internal://interpol-notices", "frequency_hours": 72},
        {"name": "CBN PEP List", "url": "internal://cbn-pep-list", "frequency_hours": 168},
    ]
    
    def __init__(self):
        self.list_updates: list[SanctionsListUpdate] = []
        self.beneficiaries: list[BeneficiaryRecord] = []
        self.batches: list[RescreeningBatch] = []
        self.results: list[RescreeningResult] = []
        self._list_checksums: dict[str, str] = {}
    
    def ingest_list_update(self, list_name: str, entries: list[dict], update_type: ListUpdateType = ListUpdateType.FULL_REFRESH) -> SanctionsListUpdate:
        """
        Ingest an updated sanctions list and detect changes.
        
        Args:
            list_name: Name of the sanctions list
            entries: List of entity records from the sanctions list
            update_type: Type of update detected
        """
        # Compute checksum to detect actual changes
        content_hash = hashlib.sha256(str(entries).encode()).hexdigest()
        
        if content_hash == self._list_checksums.get(list_name):
            return None  # No actual changes
        
        self._list_checksums[list_name] = content_hash
        
        update = SanctionsListUpdate(
            id=f"update-{list_name.lower().replace(' ', '-')}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M')}",
            list_name=list_name,
            update_type=update_type,
            entries_affected=len(entries),
            published_at=datetime.now(timezone.utc),
            checksum=content_hash,
        )
        
        self.list_updates.append(update)
        return update
    
    def trigger_rescreening(self, list_update: SanctionsListUpdate) -> RescreeningBatch:
        """
        Trigger re-screening of all beneficiaries against an updated list.
        """
        # Determine which beneficiaries to re-screen
        # For targeted lists (OFAC, UN), screen all beneficiaries
        # For regional lists, only screen beneficiaries in relevant corridors
        beneficiaries_to_screen = self._select_beneficiaries(list_update.list_name)
        
        batch = RescreeningBatch(
            id=f"batch-{list_update.id}",
            list_update_id=list_update.id,
            list_name=list_update.list_name,
            status=RescreeningStatus.QUEUED,
            total_beneficiaries=len(beneficiaries_to_screen),
        )
        
        self.batches.append(batch)
        return batch
    
    def execute_batch(self, batch_id: str, list_entries: list[dict]) -> RescreeningBatch:
        """
        Execute a re-screening batch against provided list entries.
        """
        batch = self._find_batch(batch_id)
        if not batch:
            raise ValueError(f"Batch {batch_id} not found")
        
        batch.status = RescreeningStatus.IN_PROGRESS
        batch.started_at = datetime.now(timezone.utc)
        
        beneficiaries = self._select_beneficiaries(batch.list_name)
        
        for bene in beneficiaries:
            result = self._screen_beneficiary(bene, batch.list_name, list_entries)
            if result:
                batch.results.append(result)
                self.results.append(result)
                
                if result.is_new_match:
                    batch.new_matches += 1
                if abs(result.score_delta) > 0.1:
                    batch.score_changes += 1
            
            batch.screened_count += 1
        
        batch.status = RescreeningStatus.COMPLETED
        batch.completed_at = datetime.now(timezone.utc)
        
        return batch
    
    def get_new_matches(self, since: Optional[datetime] = None) -> list[RescreeningResult]:
        """Get all new matches detected since a given time"""
        cutoff = since or (datetime.now(timezone.utc) - timedelta(days=7))
        return [
            r for r in self.results
            if r.is_new_match and r.screened_at >= cutoff
        ]
    
    def get_batch_summary(self) -> dict:
        """Get summary statistics across all batches"""
        total_screened = sum(b.screened_count for b in self.batches)
        total_new_matches = sum(b.new_matches for b in self.batches)
        total_score_changes = sum(b.score_changes for b in self.batches)
        
        return {
            "total_batches": len(self.batches),
            "total_beneficiaries_screened": total_screened,
            "total_new_matches": total_new_matches,
            "total_score_changes": total_score_changes,
            "last_run": self.batches[-1].completed_at.isoformat() if self.batches else None,
            "lists_monitored": len(self.SANCTIONS_LISTS),
        }
    
    def _find_batch(self, batch_id: str) -> Optional[RescreeningBatch]:
        for b in self.batches:
            if b.id == batch_id:
                return b
        return None
    
    def _select_beneficiaries(self, list_name: str) -> list[BeneficiaryRecord]:
        """Select beneficiaries to re-screen based on list type"""
        # All beneficiaries for global lists (OFAC, UN)
        # Corridor-specific for regional lists
        return [b for b in self.beneficiaries if not b.blocked]
    
    def _screen_beneficiary(self, beneficiary: BeneficiaryRecord, list_name: str, list_entries: list[dict]) -> Optional[RescreeningResult]:
        """Screen a single beneficiary against list entries"""
        best_score = 0.0
        best_match = ""
        
        for entry in list_entries:
            entry_name = entry.get("name", "")
            # Fuzzy matching using sequence matcher
            score = difflib.SequenceMatcher(None, beneficiary.name.lower(), entry_name.lower()).ratio()
            
            if score > best_score:
                best_score = score
                best_match = entry_name
        
        # Only report if score is noteworthy (>= 0.60)
        if best_score >= 0.60:
            score_delta = best_score - beneficiary.last_screening_score
            
            # Determine action
            action = MatchAction.ALERT_ONLY
            if best_score >= 0.95:
                action = MatchAction.FREEZE_PENDING
            elif best_score >= 0.80:
                action = MatchAction.ESCALATE
            elif best_score >= 0.70:
                action = MatchAction.BLOCK_FUTURE
            
            result = RescreeningResult(
                beneficiary_id=beneficiary.id,
                beneficiary_name=beneficiary.name,
                participant_id=beneficiary.participant_id,
                list_name=list_name,
                match_score=best_score,
                matched_entity=best_match,
                action=action,
                previous_score=beneficiary.last_screening_score,
                score_delta=score_delta,
            )
            
            # Update beneficiary record
            beneficiary.last_screening_at = datetime.now(timezone.utc)
            beneficiary.last_screening_score = best_score
            if best_score >= 0.95:
                beneficiary.blocked = True
            
            return result
        
        return None
