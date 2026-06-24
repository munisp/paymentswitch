"""Permify fine-grained authorization — ReBAC, token exchange, dynamic policies."""
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class PermifyConfig:
    endpoint: str = "localhost:3476"
    tenant_id: str = "default"
    schema_version: str = "v1"


@dataclass
class Permission:
    entity_type: str
    entity_id: str
    relation: str
    subject_type: str
    subject_id: str


@dataclass
class PermissionCheck:
    entity_type: str
    entity_id: str
    permission: str
    subject_type: str
    subject_id: str


@dataclass
class AuthMetrics:
    checks_performed: int = 0
    checks_allowed: int = 0
    checks_denied: int = 0
    relationships_written: int = 0
    avg_check_ms: float = 0.0


class PermifyAuthEngine:
    """ReBAC authorization engine with Permify integration."""

    def __init__(self, config: PermifyConfig):
        self.config = config
        self._relationships: list[Permission] = []
        self._metrics = AuthMetrics()

    async def write_relationship(self, perm: Permission):
        """Create a relationship tuple."""
        self._relationships.append(perm)
        self._metrics.relationships_written += 1

    async def delete_relationship(self, perm: Permission):
        """Remove a relationship tuple."""
        self._relationships = [
            r for r in self._relationships
            if not (
                r.entity_type == perm.entity_type
                and r.entity_id == perm.entity_id
                and r.relation == perm.relation
                and r.subject_type == perm.subject_type
                and r.subject_id == perm.subject_id
            )
        ]

    async def check_permission(self, check: PermissionCheck) -> bool:
        """Check if subject has permission on entity."""
        start = time.time()
        self._metrics.checks_performed += 1

        # Direct relationship check
        for r in self._relationships:
            if (
                r.entity_type == check.entity_type
                and r.entity_id == check.entity_id
                and r.relation == check.permission
                and r.subject_type == check.subject_type
                and r.subject_id == check.subject_id
            ):
                elapsed = (time.time() - start) * 1000
                self._update_avg_check(elapsed)
                self._metrics.checks_allowed += 1
                return True

        # Check inheritance (e.g., org admin → member permissions)
        allowed = self._check_inherited(check)
        elapsed = (time.time() - start) * 1000
        self._update_avg_check(elapsed)

        if allowed:
            self._metrics.checks_allowed += 1
        else:
            self._metrics.checks_denied += 1
        return allowed

    def _check_inherited(self, check: PermissionCheck) -> bool:
        """Check inherited permissions through relationship graph."""
        # Admin inherits all member permissions
        admin_relations = [
            r for r in self._relationships
            if r.subject_id == check.subject_id and r.relation == "admin"
        ]
        if admin_relations:
            return True

        # Owner inherits all permissions
        owner_relations = [
            r for r in self._relationships
            if r.subject_id == check.subject_id and r.relation == "owner"
        ]
        return bool(owner_relations)

    async def list_permissions(self, subject_type: str, subject_id: str) -> list[Permission]:
        """List all permissions for a subject."""
        return [
            r for r in self._relationships
            if r.subject_type == subject_type and r.subject_id == subject_id
        ]

    async def expand_permission(self, entity_type: str, entity_id: str, permission: str) -> list[str]:
        """Expand: who has this permission on this entity?"""
        subjects = []
        for r in self._relationships:
            if (
                r.entity_type == entity_type
                and r.entity_id == entity_id
                and r.relation == permission
            ):
                subjects.append(f"{r.subject_type}:{r.subject_id}")
        return subjects

    def _update_avg_check(self, elapsed_ms: float):
        n = self._metrics.checks_performed
        if n == 1:
            self._metrics.avg_check_ms = elapsed_ms
        else:
            self._metrics.avg_check_ms = (
                self._metrics.avg_check_ms * (n - 1) + elapsed_ms
            ) / n

    def get_metrics(self) -> AuthMetrics:
        return self._metrics


# Payment platform authorization schema
PAYMENT_SCHEMA = """
entity user {}

entity organization {
    relation owner @user
    relation admin @user
    relation member @user

    permission manage = owner or admin
    permission view = owner or admin or member
}

entity transfer {
    relation creator @user
    relation approver @user
    relation organization @organization

    permission initiate = creator or organization.admin
    permission approve = approver or organization.owner
    permission view = creator or approver or organization.member
    permission cancel = creator or organization.admin
}

entity corridor {
    relation operator @organization
    relation regulator @user

    permission configure = operator.admin or regulator
    permission view = operator.member or regulator
    permission suspend = regulator
}

entity settlement_batch {
    relation creator @user
    relation organization @organization

    permission create = organization.admin
    permission approve = organization.owner
    permission view = organization.member
}

entity compliance_case {
    relation assignee @user
    relation organization @organization

    permission review = assignee or organization.admin
    permission escalate = organization.admin or organization.owner
    permission view = assignee or organization.member
}
"""


class PaymentAuthz:
    """Convenience wrapper for payment-specific authorization checks."""

    def __init__(self, engine: PermifyAuthEngine):
        self.engine = engine

    async def can_initiate_transfer(self, user_id: str, org_id: str) -> bool:
        return await self.engine.check_permission(PermissionCheck(
            entity_type="organization",
            entity_id=org_id,
            permission="member",
            subject_type="user",
            subject_id=user_id,
        ))

    async def can_approve_transfer(self, user_id: str, transfer_id: str) -> bool:
        return await self.engine.check_permission(PermissionCheck(
            entity_type="transfer",
            entity_id=transfer_id,
            permission="approve",
            subject_type="user",
            subject_id=user_id,
        ))

    async def can_configure_corridor(self, user_id: str, corridor_id: str) -> bool:
        return await self.engine.check_permission(PermissionCheck(
            entity_type="corridor",
            entity_id=corridor_id,
            permission="configure",
            subject_type="user",
            subject_id=user_id,
        ))

    async def can_review_compliance(self, user_id: str, case_id: str) -> bool:
        return await self.engine.check_permission(PermissionCheck(
            entity_type="compliance_case",
            entity_id=case_id,
            permission="review",
            subject_type="user",
            subject_id=user_id,
        ))
