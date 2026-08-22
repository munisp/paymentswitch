package payment.authorization

import future.keywords.if
import future.keywords.in

# Defense-in-depth policy. The Go adapter must independently verify the
# signature, issuer, audience, expiry, and token shape before creating
# input.verified_jwt. This policy never parses Authorization or trusts client
# identity headers.
default allow := false

default deny_reason := "authorization_denied"

# The bundle must provide this value through data.payment.authorization_config.
required_audience := data.payment.authorization_config.required_audience

required_issuer := data.payment.authorization_config.required_issuer

required_roles := data.payment.authorization_config.required_roles

allow if {
	not spoofable_identity_header_present
	verified_claims_valid
	request_permission
}

verified_claims_valid if {
	input.verified_jwt.valid == true
	input.verified_jwt.sub != ""
	input.verified_jwt.iss == required_issuer
	input.verified_jwt.exp > time.now_ns() / 1000000000
	audience_matches
}

audience_matches if {
	is_array(input.verified_jwt.aud)
	required_audience in input.verified_jwt.aud
}

audience_matches if {
	is_string(input.verified_jwt.aud)
	input.verified_jwt.aud == required_audience
}

request_permission if {
	input.request.method == "POST"
	input.request.path == "/api/v1/payments/process"
	role_matches("payment:process")
}

request_permission if {
	input.request.method == "GET"
	startswith(input.request.path, "/api/v1/payments/status/")
	role_matches("payment:query")
}

role_matches(role) if {
	role in input.verified_jwt.roles
	role in required_roles
}

deny_reason := "invalid_verified_claims" if {
	not verified_claims_valid
}

deny_reason := "insufficient_permissions" if {
	verified_claims_valid
	not request_permission
}

# Explicitly reject identity headers if they are present in the request input.
# APISIX must not allow a client to manufacture identity through these headers.
spoofable_identity_header_present if {
	lower(input.request.headers["x-userinfo"]) != ""
}

spoofable_identity_header_present if {
	lower(input.request.headers["x-id-token"]) != ""
}

spoofable_identity_header_present if {
	lower(input.request.headers["x-user-id"]) != ""
}
