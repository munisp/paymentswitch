// Paymentswitch Permify authorization model v1.
// Tenant identity is represented by the tenant relation on every resource.

entity user {}

entity tenant {
  relation member @user
  relation admin @user

  permission read = member or admin
  permission manage = admin
}

entity organization {
  relation tenant @tenant

  permission read = tenant.read
  permission manage = tenant.manage
}

entity merchant {
  relation tenant @tenant
  relation owner @user
  relation operator @user

  permission read = owner or operator or tenant.read
  permission write = owner or operator or tenant.manage
  permission manage = owner or tenant.manage
}

entity payment {
  relation merchant @merchant
  relation reviewer @user

  permission read = merchant.read or reviewer
  permission process = merchant.write
  permission approve = reviewer and merchant.manage
}

entity payout {
  relation merchant @merchant
  relation approver @user

  permission read = merchant.read
  permission create = merchant.write
  permission approve = approver and merchant.manage
  permission release = approver and merchant.manage
}

entity kyc_case {
  relation merchant @merchant
  relation reviewer @user

  permission read = merchant.read or reviewer
  permission submit = merchant.write
  permission override = reviewer and merchant.manage
}

entity report {
  relation merchant @merchant

  permission read = merchant.read
  permission export = merchant.manage
}

entity settlement {
  relation merchant @merchant

  permission read = merchant.read
  permission initiate = merchant.write
  permission approve = merchant.manage
}

entity api_credential {
  relation merchant @merchant
  relation owner @user

  permission read = owner or merchant.manage
  permission rotate = owner or merchant.manage
  permission revoke = merchant.manage
}

entity break_glass {
  relation security_admin @user

  permission activate = security_admin
}

// Example tuples:
// tenant:tenant-a#member@user:user-a
// tenant:tenant-a#admin@user:security-a
// merchant:merchant-a#tenant@tenant:tenant-a
// merchant:merchant-a#owner@user:user-a
// payment:payment-a#merchant@merchant:merchant-a
// payment:payment-a#reviewer@user:security-a
