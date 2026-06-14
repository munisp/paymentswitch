from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum


class PayrollStatus(str, Enum):
    DRAFT = "draft"
    APPROVED = "approved"
    PROCESSING = "processing"
    COMPLETED = "completed"
    PARTIALLY_COMPLETED = "partially_completed"
    FAILED = "failed"


class PayrollFrequency(str, Enum):
    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    MONTHLY = "monthly"


class PayrollEmployee(BaseModel):
    employee_id: str
    employee_name: str
    bank_code: str
    account_number: str
    gross_salary: float = Field(..., gt=0)
    tax_deduction: float = Field(default=0, ge=0)
    pension_deduction: float = Field(default=0, ge=0)
    other_deductions: float = Field(default=0, ge=0)
    allowances: float = Field(default=0, ge=0)


class PayrollRun(BaseModel):
    organization_id: str
    pay_period: str = Field(..., description="Pay period identifier e.g. 2025-01")
    frequency: PayrollFrequency = Field(default=PayrollFrequency.MONTHLY)
    currency: str = Field(default="NGN")
    employees: List[PayrollEmployee]
    description: Optional[str] = None
