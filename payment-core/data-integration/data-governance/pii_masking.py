"""
PII Masking and Data Governance Module

This module provides PII (Personally Identifiable Information) detection,
masking, and data governance capabilities for the lakehouse.

Features:
- PII field detection and classification
- Multiple masking strategies (hash, redact, tokenize, encrypt)
- Column-level access control
- Audit logging for PII access
- Data retention policy enforcement
- GDPR/CCPA compliance helpers
"""

import hashlib
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
import json
import base64
import os

logger = logging.getLogger(__name__)


class PIICategory(Enum):
    """Categories of PII data"""
    DIRECT_IDENTIFIER = "direct_identifier"
    QUASI_IDENTIFIER = "quasi_identifier"
    SENSITIVE = "sensitive"
    FINANCIAL = "financial"
    BIOMETRIC = "biometric"
    HEALTH = "health"
    LOCATION = "location"
    BEHAVIORAL = "behavioral"


class PIIType(Enum):
    """Specific types of PII"""
    FULL_NAME = "full_name"
    FIRST_NAME = "first_name"
    LAST_NAME = "last_name"
    EMAIL = "email"
    PHONE = "phone"
    SSN = "ssn"
    NATIONAL_ID = "national_id"
    BVN = "bvn"
    NIN = "nin"
    PASSPORT = "passport"
    DRIVERS_LICENSE = "drivers_license"
    DATE_OF_BIRTH = "date_of_birth"
    ADDRESS = "address"
    CITY = "city"
    POSTAL_CODE = "postal_code"
    IP_ADDRESS = "ip_address"
    DEVICE_ID = "device_id"
    BANK_ACCOUNT = "bank_account"
    CARD_NUMBER = "card_number"
    CVV = "cvv"
    BIOMETRIC_TEMPLATE = "biometric_template"
    FACE_IMAGE = "face_image"
    FINGERPRINT = "fingerprint"
    GPS_COORDINATES = "gps_coordinates"
    SALARY = "salary"
    MEDICAL_RECORD = "medical_record"


class MaskingStrategy(Enum):
    """Strategies for masking PII"""
    REDACT = "redact"
    HASH = "hash"
    TOKENIZE = "tokenize"
    ENCRYPT = "encrypt"
    PARTIAL_MASK = "partial_mask"
    GENERALIZE = "generalize"
    PSEUDONYMIZE = "pseudonymize"
    SUPPRESS = "suppress"


@dataclass
class PIIField:
    """Definition of a PII field"""
    field_name: str
    pii_type: PIIType
    category: PIICategory
    masking_strategy: MaskingStrategy
    retention_days: int = 365
    requires_consent: bool = True
    audit_access: bool = True
    encryption_required: bool = False


@dataclass
class PIIAccessLog:
    """Log entry for PII access"""
    timestamp: str
    user_id: str
    service_name: str
    table_name: str
    fields_accessed: List[str]
    purpose: str
    correlation_id: str
    access_granted: bool
    reason: Optional[str] = None


@dataclass
class DataRetentionPolicy:
    """Data retention policy definition"""
    table_name: str
    retention_days: int
    archive_before_delete: bool = True
    deletion_strategy: str = "soft_delete"
    pii_fields: List[str] = field(default_factory=list)
    last_cleanup: Optional[str] = None


class PIIDetector:
    """
    Detects PII in data based on field names and patterns.
    """
    
    # Field name patterns that indicate PII
    FIELD_PATTERNS = {
        PIIType.FULL_NAME: [r".*name.*", r".*customer.*name.*", r".*user.*name.*"],
        PIIType.FIRST_NAME: [r".*first.*name.*", r".*given.*name.*", r"fname"],
        PIIType.LAST_NAME: [r".*last.*name.*", r".*surname.*", r".*family.*name.*", r"lname"],
        PIIType.EMAIL: [r".*email.*", r".*e_mail.*", r".*mail.*address.*"],
        PIIType.PHONE: [r".*phone.*", r".*mobile.*", r".*tel.*", r".*cell.*"],
        PIIType.SSN: [r".*ssn.*", r".*social.*security.*"],
        PIIType.NATIONAL_ID: [r".*national.*id.*", r".*nin.*", r".*bvn.*"],
        PIIType.BVN: [r".*bvn.*", r".*bank.*verification.*"],
        PIIType.NIN: [r".*nin.*", r".*national.*identification.*"],
        PIIType.PASSPORT: [r".*passport.*"],
        PIIType.DRIVERS_LICENSE: [r".*driver.*license.*", r".*driving.*license.*"],
        PIIType.DATE_OF_BIRTH: [r".*dob.*", r".*birth.*date.*", r".*date.*birth.*", r".*birthday.*"],
        PIIType.ADDRESS: [r".*address.*", r".*street.*", r".*residence.*"],
        PIIType.POSTAL_CODE: [r".*postal.*code.*", r".*zip.*code.*", r".*postcode.*"],
        PIIType.IP_ADDRESS: [r".*ip.*address.*", r".*ip_addr.*", r".*client.*ip.*"],
        PIIType.DEVICE_ID: [r".*device.*id.*", r".*imei.*", r".*udid.*"],
        PIIType.BANK_ACCOUNT: [r".*account.*number.*", r".*bank.*account.*", r".*iban.*"],
        PIIType.CARD_NUMBER: [r".*card.*number.*", r".*pan.*", r".*credit.*card.*"],
        PIIType.CVV: [r".*cvv.*", r".*cvc.*", r".*security.*code.*"],
        PIIType.GPS_COORDINATES: [r".*latitude.*", r".*longitude.*", r".*geo.*", r".*coordinates.*"],
        PIIType.SALARY: [r".*salary.*", r".*income.*", r".*wage.*"],
    }
    
    # Value patterns for detection
    VALUE_PATTERNS = {
        PIIType.EMAIL: r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$",
        PIIType.PHONE: r"^[\+]?[(]?[0-9]{1,3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$",
        PIIType.SSN: r"^\d{3}-?\d{2}-?\d{4}$",
        PIIType.BVN: r"^\d{11}$",
        PIIType.NIN: r"^\d{11}$",
        PIIType.IP_ADDRESS: r"^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$",
        PIIType.CARD_NUMBER: r"^\d{13,19}$",
        PIIType.POSTAL_CODE: r"^\d{5}(-\d{4})?$",
    }
    
    @classmethod
    def detect_pii_type(cls, field_name: str, value: Optional[str] = None) -> Optional[PIIType]:
        """
        Detect PII type based on field name and optionally value.
        
        Args:
            field_name: Name of the field
            value: Optional value to check patterns against
        
        Returns:
            PIIType if detected, None otherwise
        """
        field_lower = field_name.lower()
        
        # Check field name patterns
        for pii_type, patterns in cls.FIELD_PATTERNS.items():
            for pattern in patterns:
                if re.match(pattern, field_lower, re.IGNORECASE):
                    return pii_type
        
        # Check value patterns if value provided
        if value:
            for pii_type, pattern in cls.VALUE_PATTERNS.items():
                if re.match(pattern, str(value)):
                    return pii_type
        
        return None
    
    @classmethod
    def get_category(cls, pii_type: PIIType) -> PIICategory:
        """Get the category for a PII type"""
        category_mapping = {
            PIIType.FULL_NAME: PIICategory.DIRECT_IDENTIFIER,
            PIIType.FIRST_NAME: PIICategory.DIRECT_IDENTIFIER,
            PIIType.LAST_NAME: PIICategory.DIRECT_IDENTIFIER,
            PIIType.EMAIL: PIICategory.DIRECT_IDENTIFIER,
            PIIType.PHONE: PIICategory.DIRECT_IDENTIFIER,
            PIIType.SSN: PIICategory.SENSITIVE,
            PIIType.NATIONAL_ID: PIICategory.SENSITIVE,
            PIIType.BVN: PIICategory.SENSITIVE,
            PIIType.NIN: PIICategory.SENSITIVE,
            PIIType.PASSPORT: PIICategory.SENSITIVE,
            PIIType.DRIVERS_LICENSE: PIICategory.SENSITIVE,
            PIIType.DATE_OF_BIRTH: PIICategory.QUASI_IDENTIFIER,
            PIIType.ADDRESS: PIICategory.QUASI_IDENTIFIER,
            PIIType.POSTAL_CODE: PIICategory.QUASI_IDENTIFIER,
            PIIType.IP_ADDRESS: PIICategory.QUASI_IDENTIFIER,
            PIIType.DEVICE_ID: PIICategory.BEHAVIORAL,
            PIIType.BANK_ACCOUNT: PIICategory.FINANCIAL,
            PIIType.CARD_NUMBER: PIICategory.FINANCIAL,
            PIIType.CVV: PIICategory.FINANCIAL,
            PIIType.BIOMETRIC_TEMPLATE: PIICategory.BIOMETRIC,
            PIIType.FACE_IMAGE: PIICategory.BIOMETRIC,
            PIIType.FINGERPRINT: PIICategory.BIOMETRIC,
            PIIType.GPS_COORDINATES: PIICategory.LOCATION,
            PIIType.SALARY: PIICategory.FINANCIAL,
            PIIType.MEDICAL_RECORD: PIICategory.HEALTH,
        }
        return category_mapping.get(pii_type, PIICategory.QUASI_IDENTIFIER)


class PIIMasker:
    """
    Applies masking strategies to PII data.
    """
    
    def __init__(self, salt: Optional[str] = None, encryption_key: Optional[bytes] = None):
        """
        Initialize masker.
        
        Args:
            salt: Salt for hashing operations
            encryption_key: Key for encryption operations
        """
        self.salt = salt or os.environ.get("PII_MASKING_SALT", "default-salt-change-in-production")
        self.encryption_key = encryption_key
        self._token_map: Dict[str, str] = {}
        self._reverse_token_map: Dict[str, str] = {}
    
    def mask(
        self,
        value: Any,
        strategy: MaskingStrategy,
        pii_type: Optional[PIIType] = None
    ) -> str:
        """
        Mask a value using the specified strategy.
        
        Args:
            value: Value to mask
            strategy: Masking strategy to use
            pii_type: Type of PII (for strategy-specific handling)
        
        Returns:
            Masked value
        """
        if value is None:
            return None
        
        str_value = str(value)
        
        if strategy == MaskingStrategy.REDACT:
            return self._redact(str_value, pii_type)
        elif strategy == MaskingStrategy.HASH:
            return self._hash(str_value)
        elif strategy == MaskingStrategy.TOKENIZE:
            return self._tokenize(str_value)
        elif strategy == MaskingStrategy.ENCRYPT:
            return self._encrypt(str_value)
        elif strategy == MaskingStrategy.PARTIAL_MASK:
            return self._partial_mask(str_value, pii_type)
        elif strategy == MaskingStrategy.GENERALIZE:
            return self._generalize(str_value, pii_type)
        elif strategy == MaskingStrategy.PSEUDONYMIZE:
            return self._pseudonymize(str_value)
        elif strategy == MaskingStrategy.SUPPRESS:
            return "[SUPPRESSED]"
        else:
            return self._redact(str_value, pii_type)
    
    def _redact(self, value: str, pii_type: Optional[PIIType] = None) -> str:
        """Completely redact the value"""
        if pii_type == PIIType.EMAIL:
            return "[EMAIL_REDACTED]"
        elif pii_type == PIIType.PHONE:
            return "[PHONE_REDACTED]"
        elif pii_type in [PIIType.SSN, PIIType.BVN, PIIType.NIN]:
            return "[ID_REDACTED]"
        elif pii_type == PIIType.CARD_NUMBER:
            return "[CARD_REDACTED]"
        else:
            return "[REDACTED]"
    
    def _hash(self, value: str) -> str:
        """Hash the value with salt"""
        salted = f"{self.salt}{value}"
        return hashlib.sha256(salted.encode()).hexdigest()
    
    def _tokenize(self, value: str) -> str:
        """Replace value with a reversible token"""
        if value in self._token_map:
            return self._token_map[value]
        
        token = f"TOK_{hashlib.sha256(f'{self.salt}{value}'.encode()).hexdigest()[:12]}"
        self._token_map[value] = token
        self._reverse_token_map[token] = value
        return token
    
    def detokenize(self, token: str) -> Optional[str]:
        """Reverse a tokenized value"""
        return self._reverse_token_map.get(token)
    
    def _encrypt(self, value: str) -> str:
        """Encrypt the value (simplified - use proper encryption in production)"""
        if not self.encryption_key:
            # Fallback to base64 encoding (NOT secure - use proper encryption)
            return f"ENC_{base64.b64encode(value.encode()).decode()}"
        
        # In production, use proper AES encryption
        return f"ENC_{base64.b64encode(value.encode()).decode()}"
    
    def _partial_mask(self, value: str, pii_type: Optional[PIIType] = None) -> str:
        """Partially mask the value, keeping some characters visible"""
        if len(value) <= 4:
            return "*" * len(value)
        
        if pii_type == PIIType.EMAIL:
            parts = value.split("@")
            if len(parts) == 2:
                local = parts[0]
                domain = parts[1]
                masked_local = local[0] + "*" * (len(local) - 2) + local[-1] if len(local) > 2 else "*" * len(local)
                return f"{masked_local}@{domain}"
        
        elif pii_type == PIIType.PHONE:
            return value[:3] + "*" * (len(value) - 6) + value[-3:]
        
        elif pii_type == PIIType.CARD_NUMBER:
            return "*" * (len(value) - 4) + value[-4:]
        
        elif pii_type in [PIIType.SSN, PIIType.BVN, PIIType.NIN]:
            return "*" * (len(value) - 4) + value[-4:]
        
        # Default: show first and last 2 characters
        return value[:2] + "*" * (len(value) - 4) + value[-2:]
    
    def _generalize(self, value: str, pii_type: Optional[PIIType] = None) -> str:
        """Generalize the value to a less specific form"""
        if pii_type == PIIType.DATE_OF_BIRTH:
            # Generalize to year only
            try:
                if "-" in value:
                    return value.split("-")[0]
                elif "/" in value:
                    parts = value.split("/")
                    return parts[-1] if len(parts[-1]) == 4 else parts[0]
            except Exception:
                pass
            return value[:4] if len(value) >= 4 else value
        
        elif pii_type == PIIType.POSTAL_CODE:
            # Generalize to first 3 digits
            return value[:3] + "**" if len(value) >= 3 else value
        
        elif pii_type == PIIType.GPS_COORDINATES:
            # Reduce precision
            try:
                coord = float(value)
                return f"{coord:.2f}"
            except ValueError:
                return value
        
        elif pii_type == PIIType.SALARY:
            # Generalize to range
            try:
                amount = float(value)
                if amount < 50000:
                    return "0-50000"
                elif amount < 100000:
                    return "50000-100000"
                elif amount < 200000:
                    return "100000-200000"
                else:
                    return "200000+"
            except ValueError:
                return value
        
        return value
    
    def _pseudonymize(self, value: str) -> str:
        """Replace with a consistent pseudonym"""
        hash_val = hashlib.sha256(f"{self.salt}{value}".encode()).hexdigest()
        return f"PSEUDO_{hash_val[:8]}"


class PIIGovernanceService:
    """
    Central service for PII governance across the lakehouse.
    """
    
    def __init__(
        self,
        masker: Optional[PIIMasker] = None,
        audit_enabled: bool = True
    ):
        """
        Initialize governance service.
        
        Args:
            masker: PIIMasker instance
            audit_enabled: Whether to log PII access
        """
        self.masker = masker or PIIMasker()
        self.audit_enabled = audit_enabled
        self._pii_registry: Dict[str, Dict[str, PIIField]] = {}
        self._retention_policies: Dict[str, DataRetentionPolicy] = {}
        self._access_logs: List[PIIAccessLog] = []
        self._register_default_fields()
    
    def _register_default_fields(self) -> None:
        """Register default PII field definitions"""
        
        # Customer table PII fields
        customer_fields = {
            "full_name": PIIField(
                field_name="full_name",
                pii_type=PIIType.FULL_NAME,
                category=PIICategory.DIRECT_IDENTIFIER,
                masking_strategy=MaskingStrategy.PARTIAL_MASK,
                retention_days=2555,  # 7 years for financial records
                requires_consent=True,
                audit_access=True
            ),
            "email": PIIField(
                field_name="email",
                pii_type=PIIType.EMAIL,
                category=PIICategory.DIRECT_IDENTIFIER,
                masking_strategy=MaskingStrategy.PARTIAL_MASK,
                retention_days=2555,
                requires_consent=True,
                audit_access=True
            ),
            "phone": PIIField(
                field_name="phone",
                pii_type=PIIType.PHONE,
                category=PIICategory.DIRECT_IDENTIFIER,
                masking_strategy=MaskingStrategy.PARTIAL_MASK,
                retention_days=2555,
                requires_consent=True,
                audit_access=True
            ),
            "bvn": PIIField(
                field_name="bvn",
                pii_type=PIIType.BVN,
                category=PIICategory.SENSITIVE,
                masking_strategy=MaskingStrategy.HASH,
                retention_days=2555,
                requires_consent=True,
                audit_access=True,
                encryption_required=True
            ),
            "nin": PIIField(
                field_name="nin",
                pii_type=PIIType.NIN,
                category=PIICategory.SENSITIVE,
                masking_strategy=MaskingStrategy.HASH,
                retention_days=2555,
                requires_consent=True,
                audit_access=True,
                encryption_required=True
            ),
            "date_of_birth": PIIField(
                field_name="date_of_birth",
                pii_type=PIIType.DATE_OF_BIRTH,
                category=PIICategory.QUASI_IDENTIFIER,
                masking_strategy=MaskingStrategy.GENERALIZE,
                retention_days=2555,
                requires_consent=True,
                audit_access=True
            ),
            "address": PIIField(
                field_name="address",
                pii_type=PIIType.ADDRESS,
                category=PIICategory.QUASI_IDENTIFIER,
                masking_strategy=MaskingStrategy.REDACT,
                retention_days=2555,
                requires_consent=True,
                audit_access=True
            ),
        }
        self._pii_registry["customers"] = customer_fields
        
        # Transaction table PII fields
        transaction_fields = {
            "sender_name": PIIField(
                field_name="sender_name",
                pii_type=PIIType.FULL_NAME,
                category=PIICategory.DIRECT_IDENTIFIER,
                masking_strategy=MaskingStrategy.PARTIAL_MASK,
                retention_days=2555,
                requires_consent=False,
                audit_access=True
            ),
            "recipient_name": PIIField(
                field_name="recipient_name",
                pii_type=PIIType.FULL_NAME,
                category=PIICategory.DIRECT_IDENTIFIER,
                masking_strategy=MaskingStrategy.PARTIAL_MASK,
                retention_days=2555,
                requires_consent=False,
                audit_access=True
            ),
            "sender_account": PIIField(
                field_name="sender_account",
                pii_type=PIIType.BANK_ACCOUNT,
                category=PIICategory.FINANCIAL,
                masking_strategy=MaskingStrategy.PARTIAL_MASK,
                retention_days=2555,
                requires_consent=False,
                audit_access=True,
                encryption_required=True
            ),
            "recipient_account": PIIField(
                field_name="recipient_account",
                pii_type=PIIType.BANK_ACCOUNT,
                category=PIICategory.FINANCIAL,
                masking_strategy=MaskingStrategy.PARTIAL_MASK,
                retention_days=2555,
                requires_consent=False,
                audit_access=True,
                encryption_required=True
            ),
            "ip_address": PIIField(
                field_name="ip_address",
                pii_type=PIIType.IP_ADDRESS,
                category=PIICategory.QUASI_IDENTIFIER,
                masking_strategy=MaskingStrategy.HASH,
                retention_days=90,
                requires_consent=False,
                audit_access=False
            ),
        }
        self._pii_registry["transactions"] = transaction_fields
        
        # KYC table PII fields
        kyc_fields = {
            "document_number": PIIField(
                field_name="document_number",
                pii_type=PIIType.NATIONAL_ID,
                category=PIICategory.SENSITIVE,
                masking_strategy=MaskingStrategy.HASH,
                retention_days=2555,
                requires_consent=True,
                audit_access=True,
                encryption_required=True
            ),
            "face_image": PIIField(
                field_name="face_image",
                pii_type=PIIType.FACE_IMAGE,
                category=PIICategory.BIOMETRIC,
                masking_strategy=MaskingStrategy.SUPPRESS,
                retention_days=365,
                requires_consent=True,
                audit_access=True,
                encryption_required=True
            ),
            "biometric_template": PIIField(
                field_name="biometric_template",
                pii_type=PIIType.BIOMETRIC_TEMPLATE,
                category=PIICategory.BIOMETRIC,
                masking_strategy=MaskingStrategy.SUPPRESS,
                retention_days=365,
                requires_consent=True,
                audit_access=True,
                encryption_required=True
            ),
        }
        self._pii_registry["kyc_records"] = kyc_fields
        
        logger.info(f"Registered PII fields for {len(self._pii_registry)} tables")
    
    def register_pii_field(self, table_name: str, field: PIIField) -> None:
        """Register a PII field for a table"""
        if table_name not in self._pii_registry:
            self._pii_registry[table_name] = {}
        self._pii_registry[table_name][field.field_name] = field
    
    def get_pii_fields(self, table_name: str) -> Dict[str, PIIField]:
        """Get all PII fields for a table"""
        return self._pii_registry.get(table_name, {})
    
    def mask_record(
        self,
        table_name: str,
        record: Dict[str, Any],
        user_role: str = "analyst",
        purpose: str = "analytics"
    ) -> Dict[str, Any]:
        """
        Mask PII fields in a record based on user role and purpose.
        
        Args:
            table_name: Name of the table
            record: Record to mask
            user_role: Role of the user accessing data
            purpose: Purpose of data access
        
        Returns:
            Masked record
        """
        pii_fields = self.get_pii_fields(table_name)
        masked_record = record.copy()
        
        # Roles that can see unmasked data
        privileged_roles = {"admin", "compliance_officer", "data_protection_officer"}
        
        for field_name, pii_field in pii_fields.items():
            if field_name in masked_record:
                # Check if user has privilege to see unmasked data
                if user_role in privileged_roles and purpose in ["compliance", "investigation"]:
                    continue
                
                # Apply masking
                masked_record[field_name] = self.masker.mask(
                    masked_record[field_name],
                    pii_field.masking_strategy,
                    pii_field.pii_type
                )
        
        return masked_record
    
    def mask_dataframe(
        self,
        table_name: str,
        df: Any,
        user_role: str = "analyst"
    ) -> Any:
        """
        Mask PII fields in a DataFrame (Spark or Pandas).
        
        Args:
            table_name: Name of the table
            df: DataFrame to mask
            user_role: Role of the user
        
        Returns:
            Masked DataFrame
        """
        pii_fields = self.get_pii_fields(table_name)
        
        # Check if it's a Spark DataFrame
        if hasattr(df, 'withColumn'):
            from pyspark.sql import functions as F
            from pyspark.sql.types import StringType
            
            for field_name, pii_field in pii_fields.items():
                if field_name in df.columns:
                    # Create UDF for masking
                    mask_udf = F.udf(
                        lambda x: self.masker.mask(x, pii_field.masking_strategy, pii_field.pii_type),
                        StringType()
                    )
                    df = df.withColumn(field_name, mask_udf(F.col(field_name)))
            
            return df
        
        # Assume Pandas DataFrame
        elif hasattr(df, 'apply'):
            for field_name, pii_field in pii_fields.items():
                if field_name in df.columns:
                    df[field_name] = df[field_name].apply(
                        lambda x: self.masker.mask(x, pii_field.masking_strategy, pii_field.pii_type)
                    )
            return df
        
        return df
    
    def log_access(
        self,
        user_id: str,
        service_name: str,
        table_name: str,
        fields_accessed: List[str],
        purpose: str,
        correlation_id: str,
        access_granted: bool,
        reason: Optional[str] = None
    ) -> None:
        """Log PII access for audit"""
        if not self.audit_enabled:
            return
        
        log_entry = PIIAccessLog(
            timestamp=datetime.utcnow().isoformat(),
            user_id=user_id,
            service_name=service_name,
            table_name=table_name,
            fields_accessed=fields_accessed,
            purpose=purpose,
            correlation_id=correlation_id,
            access_granted=access_granted,
            reason=reason
        )
        
        self._access_logs.append(log_entry)
        logger.info(f"PII access logged: {user_id} accessed {table_name}.{fields_accessed}")
    
    def get_access_logs(
        self,
        user_id: Optional[str] = None,
        table_name: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[PIIAccessLog]:
        """Query access logs"""
        logs = self._access_logs
        
        if user_id:
            logs = [l for l in logs if l.user_id == user_id]
        if table_name:
            logs = [l for l in logs if l.table_name == table_name]
        if start_date:
            logs = [l for l in logs if datetime.fromisoformat(l.timestamp) >= start_date]
        if end_date:
            logs = [l for l in logs if datetime.fromisoformat(l.timestamp) <= end_date]
        
        return logs
    
    def set_retention_policy(self, policy: DataRetentionPolicy) -> None:
        """Set data retention policy for a table"""
        self._retention_policies[policy.table_name] = policy
    
    def get_retention_policy(self, table_name: str) -> Optional[DataRetentionPolicy]:
        """Get retention policy for a table"""
        return self._retention_policies.get(table_name)
    
    def check_retention_compliance(self, table_name: str, record_date: datetime) -> Tuple[bool, str]:
        """
        Check if a record is within retention period.
        
        Returns:
            Tuple of (is_compliant, reason)
        """
        policy = self.get_retention_policy(table_name)
        if not policy:
            return True, "No retention policy defined"
        
        retention_cutoff = datetime.utcnow() - timedelta(days=policy.retention_days)
        
        if record_date < retention_cutoff:
            return False, f"Record exceeds retention period of {policy.retention_days} days"
        
        return True, "Within retention period"
    
    def generate_dsar_report(self, customer_id: str) -> Dict[str, Any]:
        """
        Generate a Data Subject Access Request (DSAR) report.
        
        Args:
            customer_id: ID of the customer requesting their data
        
        Returns:
            Report containing all PII data for the customer
        """
        report = {
            "customer_id": customer_id,
            "generated_at": datetime.utcnow().isoformat(),
            "data_categories": {},
            "processing_purposes": [
                "Payment processing",
                "Identity verification",
                "Fraud prevention",
                "Regulatory compliance"
            ],
            "retention_periods": {},
            "third_party_sharing": [
                "Banking partners (for payment processing)",
                "Identity verification providers",
                "Regulatory authorities (when required by law)"
            ]
        }
        
        # Add retention periods
        for table_name, policy in self._retention_policies.items():
            report["retention_periods"][table_name] = f"{policy.retention_days} days"
        
        # Add PII categories
        for table_name, fields in self._pii_registry.items():
            categories = set()
            for field in fields.values():
                categories.add(field.category.value)
            report["data_categories"][table_name] = list(categories)
        
        return report
    
    def process_deletion_request(self, customer_id: str) -> Dict[str, Any]:
        """
        Process a data deletion request (Right to be Forgotten).
        
        Args:
            customer_id: ID of the customer requesting deletion
        
        Returns:
            Status of deletion request
        """
        result = {
            "customer_id": customer_id,
            "request_date": datetime.utcnow().isoformat(),
            "status": "processed",
            "actions_taken": [],
            "data_retained": [],
            "retention_reasons": []
        }
        
        # Note: In production, this would actually delete/anonymize data
        # Here we just document what would happen
        
        for table_name, fields in self._pii_registry.items():
            policy = self.get_retention_policy(table_name)
            
            if policy and policy.retention_days > 0:
                # Some data must be retained for compliance
                result["data_retained"].append(table_name)
                result["retention_reasons"].append(
                    f"{table_name}: Retained for {policy.retention_days} days per regulatory requirements"
                )
            else:
                result["actions_taken"].append(f"Anonymized PII in {table_name}")
        
        return result


# Global governance service instance
_governance_service: Optional[PIIGovernanceService] = None


def get_governance_service() -> PIIGovernanceService:
    """Get the global governance service instance"""
    global _governance_service
    if _governance_service is None:
        _governance_service = PIIGovernanceService()
    return _governance_service
