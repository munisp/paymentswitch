package integration

import (
	"encoding/base64"
	"testing"
	"time"
)

func TestValidateClaimsRequiresExpiration(t *testing.T) {
	validator := &KeycloakJWTValidator{config: &KeycloakConfig{
		RequiredIssuer:   "https://issuer.example/realms/payment-switch",
		RequiredAudience: "payment-switch-api",
		ClockSkew:        30 * time.Second,
	}}

	err := validator.validateClaims(&JWTClaims{
		Issuer:   "https://issuer.example/realms/payment-switch",
		Audience: "payment-switch-api",
	})
	if err == nil {
		t.Fatal("expected missing exp claim to be rejected")
	}
}

func TestValidateClaimsAcceptsFutureExpiration(t *testing.T) {
	validator := &KeycloakJWTValidator{config: &KeycloakConfig{
		RequiredIssuer:   "https://issuer.example/realms/payment-switch",
		RequiredAudience: "payment-switch-api",
		ClockSkew:        30 * time.Second,
	}}

	err := validator.validateClaims(&JWTClaims{
		Issuer:    "https://issuer.example/realms/payment-switch",
		Audience:  "payment-switch-api",
		ExpiresAt: time.Now().Add(time.Minute).Unix(),
	})
	if err != nil {
		t.Fatalf("expected valid claims to pass: %v", err)
	}
}

func TestParseRSAPublicKeyRejectsEncryptionUseAndInvalidExponent(t *testing.T) {
	validator := &KeycloakJWTValidator{}
	validModulus := base64.RawURLEncoding.EncodeToString([]byte{0xC1, 0x01})
	validExponent := base64.RawURLEncoding.EncodeToString([]byte{0x01, 0x00, 0x01})

	if _, err := validator.parseRSAPublicKey(&JWK{Kty: "RSA", Alg: "RS256", Use: "enc", N: validModulus, E: validExponent}); err == nil {
		t.Fatal("expected encryption JWK to be rejected")
	}
	if _, err := validator.parseRSAPublicKey(&JWK{Kty: "RSA", Alg: "RS256", Use: "sig", N: validModulus, E: base64.RawURLEncoding.EncodeToString([]byte{0x02})}); err == nil {
		t.Fatal("expected even RSA exponent to be rejected")
	}
}
