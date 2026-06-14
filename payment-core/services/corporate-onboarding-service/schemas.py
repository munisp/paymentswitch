from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum


class OnboardingStatus(str, Enum):
    INITIATED = "initiated"
    DOCUMENTS_SUBMITTED = "documents_submitted"
    UNDER_REVIEW = "under_review"
    KYB_PENDING = "kyb_pending"
    KYB_VERIFIED = "kyb_verified"
    APPROVED = "approved"
    REJECTED = "rejected"


class BusinessType(str, Enum):
    SOLE_PROPRIETOR = "sole_proprietor"
    PARTNERSHIP = "partnership"
    LLC = "llc"
    CORPORATION = "corporation"
    NGO = "ngo"


class CorporateApplication(BaseModel):
    business_name: str = Field(..., max_length=256)
    business_type: BusinessType
    registration_number: str = Field(..., description="CAC/BN registration number")
    tax_id: Optional[str] = None
    industry: str = Field(..., max_length=128)
    contact_email: str
    contact_phone: str
    address: str
    city: str
    state: str
    country: str = Field(default="NG")
    directors: Optional[List[Dict[str, str]]] = None
    annual_revenue_estimate: Optional[float] = None


class DocumentSubmission(BaseModel):
    application_id: str
    document_type: str = Field(..., description="cac_certificate, memorandum, utility_bill, director_id")
    document_url: str
    document_hash: Optional[str] = None
