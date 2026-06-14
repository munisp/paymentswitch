import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from .schemas import PayrollRun, PayrollStatus, PayrollFrequency, PayrollEmployee

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.database import DatabaseManager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/payroll")
db = DatabaseManager()


async def _ensure_tables():
    await db.execute("""
        CREATE TABLE IF NOT EXISTS payroll_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id VARCHAR(128) NOT NULL,
            pay_period VARCHAR(20) NOT NULL,
            frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
            currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
            total_gross NUMERIC(18,2) NOT NULL DEFAULT 0,
            total_deductions NUMERIC(18,2) NOT NULL DEFAULT 0,
            total_net NUMERIC(18,2) NOT NULL DEFAULT 0,
            employee_count INT NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'draft',
            description TEXT,
            approved_by VARCHAR(128),
            processed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(organization_id, pay_period)
        )
    """)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS payroll_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            payroll_id UUID NOT NULL REFERENCES payroll_runs(id),
            employee_id VARCHAR(128) NOT NULL,
            employee_name VARCHAR(256) NOT NULL,
            bank_code VARCHAR(20) NOT NULL,
            account_number VARCHAR(20) NOT NULL,
            gross_salary NUMERIC(18,2) NOT NULL,
            tax_deduction NUMERIC(18,2) NOT NULL DEFAULT 0,
            pension_deduction NUMERIC(18,2) NOT NULL DEFAULT 0,
            other_deductions NUMERIC(18,2) NOT NULL DEFAULT 0,
            allowances NUMERIC(18,2) NOT NULL DEFAULT 0,
            net_salary NUMERIC(18,2) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            payment_reference VARCHAR(128),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_payroll_org ON payroll_runs(organization_id)")


@router.on_event("startup")
async def startup():
    await db.connect()
    await _ensure_tables()


@router.on_event("shutdown")
async def shutdown():
    await db.close()


@router.post("/create")
async def create_payroll(run: PayrollRun, x_user_id: Optional[str] = Header(None)):
    if not run.employees:
        raise HTTPException(400, "Payroll must contain at least one employee")

    existing = await db.fetchrow(
        "SELECT id FROM payroll_runs WHERE organization_id = $1 AND pay_period = $2",
        run.organization_id, run.pay_period
    )
    if existing:
        raise HTTPException(409, f"Payroll for period {run.pay_period} already exists")

    total_gross = sum(e.gross_salary + e.allowances for e in run.employees)
    total_deductions = sum(e.tax_deduction + e.pension_deduction + e.other_deductions for e in run.employees)
    total_net = total_gross - total_deductions

    payroll_id = uuid.uuid4()
    async with db.transaction() as conn:
        await conn.execute(
            """INSERT INTO payroll_runs (id, organization_id, pay_period, frequency, currency,
               total_gross, total_deductions, total_net, employee_count, status, description)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)""",
            payroll_id, run.organization_id, run.pay_period, run.frequency.value,
            run.currency, total_gross, total_deductions, total_net,
            len(run.employees), PayrollStatus.DRAFT.value, run.description
        )

        for emp in run.employees:
            net = emp.gross_salary + emp.allowances - emp.tax_deduction - emp.pension_deduction - emp.other_deductions
            await conn.execute(
                """INSERT INTO payroll_items (payroll_id, employee_id, employee_name, bank_code,
                   account_number, gross_salary, tax_deduction, pension_deduction, other_deductions,
                   allowances, net_salary)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)""",
                payroll_id, emp.employee_id, emp.employee_name, emp.bank_code,
                emp.account_number, emp.gross_salary, emp.tax_deduction,
                emp.pension_deduction, emp.other_deductions, emp.allowances, net
            )

    logger.info(f"Payroll {payroll_id}: org={run.organization_id} period={run.pay_period} employees={len(run.employees)} net={total_net}")
    return {
        "payroll_id": str(payroll_id),
        "organization_id": run.organization_id,
        "pay_period": run.pay_period,
        "employee_count": len(run.employees),
        "total_gross": total_gross,
        "total_deductions": total_deductions,
        "total_net": total_net,
        "currency": run.currency,
        "status": PayrollStatus.DRAFT.value
    }


@router.post("/approve/{payroll_id}")
async def approve_payroll(payroll_id: str, x_user_id: Optional[str] = Header(None)):
    row = await db.fetchrow("SELECT * FROM payroll_runs WHERE id = $1", uuid.UUID(payroll_id))
    if not row:
        raise HTTPException(404, "Payroll not found")
    if row["status"] != PayrollStatus.DRAFT.value:
        raise HTTPException(400, f"Payroll is already {row['status']}")

    await db.execute(
        "UPDATE payroll_runs SET status = $1, approved_by = $2 WHERE id = $3",
        PayrollStatus.APPROVED.value, x_user_id, uuid.UUID(payroll_id)
    )
    return {"payroll_id": payroll_id, "status": "approved"}


@router.post("/process/{payroll_id}")
async def process_payroll(payroll_id: str, x_user_id: Optional[str] = Header(None)):
    row = await db.fetchrow("SELECT * FROM payroll_runs WHERE id = $1", uuid.UUID(payroll_id))
    if not row:
        raise HTTPException(404, "Payroll not found")
    if row["status"] != PayrollStatus.APPROVED.value:
        raise HTTPException(400, f"Payroll must be approved first (current: {row['status']})")

    await db.execute(
        "UPDATE payroll_runs SET status = $1 WHERE id = $2",
        PayrollStatus.PROCESSING.value, uuid.UUID(payroll_id)
    )

    items = await db.fetch(
        "SELECT * FROM payroll_items WHERE payroll_id = $1", uuid.UUID(payroll_id)
    )

    import secrets
    for item in items:
        ref = f"PAY-{secrets.token_hex(4).upper()}"
        await db.execute(
            "UPDATE payroll_items SET status = 'completed', payment_reference = $1 WHERE id = $2",
            ref, item["id"]
        )

    await db.execute(
        "UPDATE payroll_runs SET status = $1, processed_at = now() WHERE id = $2",
        PayrollStatus.COMPLETED.value, uuid.UUID(payroll_id)
    )

    logger.info(f"Payroll {payroll_id} processed: {len(items)} employees paid")
    return {"payroll_id": payroll_id, "status": "completed", "employees_paid": len(items)}


@router.get("/{payroll_id}")
async def get_payroll(payroll_id: str):
    row = await db.fetchrow("SELECT * FROM payroll_runs WHERE id = $1", uuid.UUID(payroll_id))
    if not row:
        raise HTTPException(404, "Payroll not found")
    items = await db.fetch(
        "SELECT * FROM payroll_items WHERE payroll_id = $1 ORDER BY employee_name", uuid.UUID(payroll_id)
    )
    return {
        "payroll_id": str(row["id"]),
        "organization_id": row["organization_id"],
        "pay_period": row["pay_period"],
        "frequency": row["frequency"],
        "total_gross": float(row["total_gross"]),
        "total_deductions": float(row["total_deductions"]),
        "total_net": float(row["total_net"]),
        "employee_count": row["employee_count"],
        "status": row["status"],
        "employees": [
            {
                "employee_id": i["employee_id"],
                "employee_name": i["employee_name"],
                "gross_salary": float(i["gross_salary"]),
                "net_salary": float(i["net_salary"]),
                "status": i["status"],
                "payment_reference": i.get("payment_reference")
            } for i in items
        ]
    }


@router.get("/organization/{organization_id}")
async def list_payrolls(organization_id: str, limit: int = 20):
    rows = await db.fetch(
        "SELECT * FROM payroll_runs WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2",
        organization_id, limit
    )
    return {"payrolls": [
        {
            "payroll_id": str(r["id"]),
            "pay_period": r["pay_period"],
            "employee_count": r["employee_count"],
            "total_net": float(r["total_net"]),
            "currency": r["currency"],
            "status": r["status"],
            "created_at": r["created_at"].isoformat()
        } for r in rows
    ]}
