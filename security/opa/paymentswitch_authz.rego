package paymentswitch.authz

default allow := false

# Deny by default. Production actions require an explicitly mapped role,
# the same tenant, and an MFA-backed identity for privileged operations.
allow if {
  input.subject.id != ""
  input.tenantId != ""
  input.resource.id != ""
  same_tenant
  input.action in allowed_actions[input.subject.roles[_]]
  input.source in {"api", "worker", "admin"}
  not privileged_action[input.action]
}

allow if {
  input.subject.id != ""
  input.tenantId != ""
  input.resource.id != ""
  same_tenant
  input.action in allowed_actions[input.subject.roles[_]]
  privileged_action[input.action]
  input.subject.mfa_verified == true
}

same_tenant if {
  input.subject.tenant_id == input.tenantId
  input.resource.tenant_id == input.tenantId
}

same_tenant if {
  input.subject.tenantId == input.tenantId
  input.resource.tenantId == input.tenantId
}

privileged_action := {
  "approve_payment",
  "approve_payout",
  "release_hold",
  "change_credentials",
  "manage_roles",
  "override_kyc",
}

allowed_actions := {
  "admin": ["read", "write", "approve_payment", "approve_payout", "release_hold", "change_credentials", "manage_roles", "override_kyc"],
  "security": ["read", "write", "override_kyc"],
  "operations": ["read", "write", "approve_payment", "approve_payout", "release_hold"],
  "merchant": ["read", "write"],
  "participant": ["read"],
}
