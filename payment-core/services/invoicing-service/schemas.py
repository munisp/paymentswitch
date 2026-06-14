from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum


class InvoiceStatus(str, Enum):
    DRAFT = "draft"
    SENT = "sent"
    VIEWED = "viewed"
    PAID = "paid"
    OVERDUE = "overdue"
    CANCELLED = "cancelled"
    PARTIALLY_PAID = "partially_paid"


class InvoiceLineItem(BaseModel):
    description: str = Field(..., max_length=256)
    quantity: float = Field(..., gt=0)
    unit_price: float = Field(..., ge=0)
    tax_rate: float = Field(default=0.0, ge=0, le=100)


class Invoice(BaseModel):
    customer_id: str = Field(..., description="Customer/payee identifier")
    merchant_id: str = Field(..., description="Issuing merchant")
    amount: float = Field(..., gt=0)
    currency: str = Field(default="NGN")
    due_date: str = Field(..., description="Due date in YYYY-MM-DD format")
    line_items: Optional[List[InvoiceLineItem]] = None
    notes: Optional[str] = Field(None, max_length=1024)
    reference: Optional[str] = None
    tax_amount: float = Field(default=0.0, ge=0)


class InvoicePayment(BaseModel):
    invoice_id: str
    amount: float = Field(..., gt=0)
    payment_method: str = Field(default="bank_transfer")
    reference: Optional[str] = None
