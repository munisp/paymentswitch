// Package national implements national payment switch components
package national

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"math/big"
	"sync"
	"time"
)

// HSMProvider represents the type of HSM/KMS provider
type HSMProvider string

const (
	HSMProviderAWS        HSMProvider = "AWS_CLOUDHSM"
	HSMProviderAzure      HSMProvider = "AZURE_KEYVAULT"
	HSMProviderGCP        HSMProvider = "GCP_CLOUDKMS"
	HSMProviderThales     HSMProvider = "THALES_LUNA"
	HSMProviderUtimaco    HSMProvider = "UTIMACO"
	HSMProviderSoftHSM    HSMProvider = "SOFTHSM" // For development/testing
	HSMProviderHashiVault HSMProvider = "HASHICORP_VAULT"
)

// KeyPurpose defines the purpose of a cryptographic key
type KeyPurpose string

const (
	KeyPurposeSchemeSignature   KeyPurpose = "SCHEME_SIGNATURE"   // Scheme-level JWS signing
	KeyPurposeParticipantAuth   KeyPurpose = "PARTICIPANT_AUTH"   // Participant authentication
	KeyPurposeSettlementSigning KeyPurpose = "SETTLEMENT_SIGNING" // Settlement instruction signing
	KeyPurposeDataEncryption    KeyPurpose = "DATA_ENCRYPTION"    // PII/sensitive data encryption
	KeyPurposeTokenization      KeyPurpose = "TOKENIZATION"       // Card/account tokenization
	KeyPurposeAuditSigning      KeyPurpose = "AUDIT_SIGNING"      // Audit log signing
	KeyPurposeTLSCertificate    KeyPurpose = "TLS_CERTIFICATE"    // mTLS certificates
)

// KeyAlgorithm defines the cryptographic algorithm
type KeyAlgorithm string

const (
	KeyAlgorithmRSA2048   KeyAlgorithm = "RSA_2048"
	KeyAlgorithmRSA4096   KeyAlgorithm = "RSA_4096"
	KeyAlgorithmECDSAP256 KeyAlgorithm = "ECDSA_P256"
	KeyAlgorithmECDSAP384 KeyAlgorithm = "ECDSA_P384"
	KeyAlgorithmAES256    KeyAlgorithm = "AES_256"
)

// HSMKeyManager manages cryptographic keys via HSM/KMS
type HSMKeyManager struct {
	provider HSMProvider
	db       *sql.DB
	config   *HSMConfig
	keyCache map[string]*CachedKey
	cacheTTL time.Duration
	mu       sync.RWMutex

	// Provider-specific clients (interfaces)
	awsClient   AWSCloudHSMClient
	azureClient AzureKeyVaultClient
	gcpClient   GCPCloudKMSClient
	vaultClient HashiCorpVaultClient
}

// HSMConfig holds HSM/KMS configuration
type HSMConfig struct {
	Provider       HSMProvider
	Region         string
	KeyRingID      string            // GCP key ring, AWS key store, etc.
	Credentials    map[string]string // Provider-specific credentials
	RotationPeriod time.Duration     // Key rotation period
	CacheTTL       time.Duration
	EnableAudit    bool
}

// CachedKey holds a cached key reference
type CachedKey struct {
	KeyID     string
	PublicKey crypto.PublicKey
	CachedAt  time.Time
	ExpiresAt time.Time
}

// KeyMetadata holds metadata about a managed key
type KeyMetadata struct {
	KeyID        string       `json:"key_id"`
	KeyAlias     string       `json:"key_alias"`
	Purpose      KeyPurpose   `json:"purpose"`
	Algorithm    KeyAlgorithm `json:"algorithm"`
	Version      int          `json:"version"`
	State        KeyState     `json:"state"`
	CreatedAt    time.Time    `json:"created_at"`
	RotatedAt    *time.Time   `json:"rotated_at,omitempty"`
	ExpiresAt    *time.Time   `json:"expires_at,omitempty"`
	HSMKeyHandle string       `json:"hsm_key_handle"`
	PublicKeyPEM string       `json:"public_key_pem,omitempty"`
}

// KeyState represents the state of a key
type KeyState string

const (
	KeyStateActive          KeyState = "ACTIVE"
	KeyStatePendingRotation KeyState = "PENDING_ROTATION"
	KeyStateRotated         KeyState = "ROTATED"
	KeyStateDisabled        KeyState = "DISABLED"
	KeyStateDestroyed       KeyState = "DESTROYED"
)

// Provider client interfaces
type AWSCloudHSMClient interface {
	GenerateKey(ctx context.Context, algorithm KeyAlgorithm, label string) (string, error)
	Sign(ctx context.Context, keyHandle string, data []byte) ([]byte, error)
	Verify(ctx context.Context, keyHandle string, data, signature []byte) (bool, error)
	Encrypt(ctx context.Context, keyHandle string, plaintext []byte) ([]byte, error)
	Decrypt(ctx context.Context, keyHandle string, ciphertext []byte) ([]byte, error)
	GetPublicKey(ctx context.Context, keyHandle string) (crypto.PublicKey, error)
	DestroyKey(ctx context.Context, keyHandle string) error
}

type AzureKeyVaultClient interface {
	GenerateKey(ctx context.Context, algorithm KeyAlgorithm, name string) (string, error)
	Sign(ctx context.Context, keyName string, data []byte) ([]byte, error)
	Verify(ctx context.Context, keyName string, data, signature []byte) (bool, error)
	Encrypt(ctx context.Context, keyName string, plaintext []byte) ([]byte, error)
	Decrypt(ctx context.Context, keyName string, ciphertext []byte) ([]byte, error)
	GetPublicKey(ctx context.Context, keyName string) (crypto.PublicKey, error)
}

type GCPCloudKMSClient interface {
	GenerateKey(ctx context.Context, algorithm KeyAlgorithm, keyRing, keyID string) (string, error)
	Sign(ctx context.Context, keyPath string, data []byte) ([]byte, error)
	Verify(ctx context.Context, keyPath string, data, signature []byte) (bool, error)
	Encrypt(ctx context.Context, keyPath string, plaintext []byte) ([]byte, error)
	Decrypt(ctx context.Context, keyPath string, ciphertext []byte) ([]byte, error)
	GetPublicKey(ctx context.Context, keyPath string) (crypto.PublicKey, error)
}

type HashiCorpVaultClient interface {
	GenerateKey(ctx context.Context, algorithm KeyAlgorithm, name string) (string, error)
	Sign(ctx context.Context, keyName string, data []byte) ([]byte, error)
	Verify(ctx context.Context, keyName string, data, signature []byte) (bool, error)
	Encrypt(ctx context.Context, keyName string, plaintext []byte) ([]byte, error)
	Decrypt(ctx context.Context, keyName string, ciphertext []byte) ([]byte, error)
	GetPublicKey(ctx context.Context, keyName string) (crypto.PublicKey, error)
	RotateKey(ctx context.Context, keyName string) error
}

// NewHSMKeyManager creates a new HSM key manager
func NewHSMKeyManager(db *sql.DB, config *HSMConfig) (*HSMKeyManager, error) {
	if config.CacheTTL == 0 {
		config.CacheTTL = 5 * time.Minute
	}
	if config.RotationPeriod == 0 {
		config.RotationPeriod = 90 * 24 * time.Hour // 90 days default
	}

	mgr := &HSMKeyManager{
		provider: config.Provider,
		db:       db,
		config:   config,
		keyCache: make(map[string]*CachedKey),
		cacheTTL: config.CacheTTL,
	}

	// Initialize provider-specific client
	if err := mgr.initializeProvider(config); err != nil {
		return nil, fmt.Errorf("failed to initialize HSM provider: %w", err)
	}

	return mgr, nil
}

// initializeProvider initializes the HSM provider client
func (m *HSMKeyManager) initializeProvider(config *HSMConfig) error {
	switch config.Provider {
	case HSMProviderAWS:
		if config.Region == "" || config.KeyRingID == "" {
			return fmt.Errorf("AWS CloudHSM requires Region and KeyRingID")
		}
		return nil
	case HSMProviderAzure:
		if config.KeyRingID == "" {
			return fmt.Errorf("Azure Key Vault requires KeyRingID (vault URL)")
		}
		return nil
	case HSMProviderGCP:
		if config.KeyRingID == "" {
			return fmt.Errorf("GCP Cloud KMS requires KeyRingID")
		}
		return nil
	case HSMProviderHashiVault:
		if config.Credentials["address"] == "" {
			return fmt.Errorf("HashiCorp Vault requires Credentials[\"address\"]")
		}
		return nil
	case HSMProviderSoftHSM:
		return nil
	default:
		return fmt.Errorf("unsupported HSM provider: %s", config.Provider)
	}
}

// GenerateKey generates a new key in the HSM
func (m *HSMKeyManager) GenerateKey(ctx context.Context, purpose KeyPurpose, algorithm KeyAlgorithm, alias string) (*KeyMetadata, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Generate unique key ID
	keyID := generateKeyID()

	var hsmKeyHandle string
	var publicKey crypto.PublicKey
	var err error

	switch m.provider {
	case HSMProviderSoftHSM:
		// For development: generate key locally
		hsmKeyHandle, publicKey, err = m.generateSoftKey(algorithm, keyID)
	case HSMProviderHashiVault:
		hsmKeyHandle, err = m.vaultClient.GenerateKey(ctx, algorithm, alias)
		if err == nil {
			publicKey, err = m.vaultClient.GetPublicKey(ctx, hsmKeyHandle)
		}
	case HSMProviderAWS:
		hsmKeyHandle, err = m.awsClient.GenerateKey(ctx, algorithm, alias)
		if err == nil {
			publicKey, err = m.awsClient.GetPublicKey(ctx, hsmKeyHandle)
		}
	case HSMProviderGCP:
		hsmKeyHandle, err = m.gcpClient.GenerateKey(ctx, algorithm, m.config.KeyRingID, alias)
		if err == nil {
			publicKey, err = m.gcpClient.GetPublicKey(ctx, hsmKeyHandle)
		}
	default:
		return nil, fmt.Errorf("unsupported provider: %s", m.provider)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to generate key: %w", err)
	}

	// Encode public key to PEM
	publicKeyPEM := ""
	if publicKey != nil {
		publicKeyPEM, _ = encodePublicKeyToPEM(publicKey)
	}

	// Create metadata
	metadata := &KeyMetadata{
		KeyID:        keyID,
		KeyAlias:     alias,
		Purpose:      purpose,
		Algorithm:    algorithm,
		Version:      1,
		State:        KeyStateActive,
		CreatedAt:    time.Now(),
		HSMKeyHandle: hsmKeyHandle,
		PublicKeyPEM: publicKeyPEM,
	}

	// Save to database
	if err := m.saveKeyMetadata(ctx, metadata); err != nil {
		return nil, fmt.Errorf("failed to save key metadata: %w", err)
	}

	// Audit log
	if m.config.EnableAudit {
		m.auditKeyOperation(ctx, "KEY_GENERATED", metadata)
	}

	return metadata, nil
}

// Sign signs data using the specified key
func (m *HSMKeyManager) Sign(ctx context.Context, keyAlias string, data []byte) ([]byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Get key metadata
	metadata, err := m.getKeyMetadata(ctx, keyAlias)
	if err != nil {
		return nil, fmt.Errorf("key not found: %w", err)
	}

	if metadata.State != KeyStateActive {
		return nil, fmt.Errorf("key is not active: %s", metadata.State)
	}

	// Hash the data
	hash := sha256.Sum256(data)

	var signature []byte
	switch m.provider {
	case HSMProviderSoftHSM:
		signature, err = m.signSoft(metadata.HSMKeyHandle, hash[:])
	case HSMProviderHashiVault:
		signature, err = m.vaultClient.Sign(ctx, metadata.HSMKeyHandle, hash[:])
	case HSMProviderAWS:
		signature, err = m.awsClient.Sign(ctx, metadata.HSMKeyHandle, hash[:])
	case HSMProviderGCP:
		signature, err = m.gcpClient.Sign(ctx, metadata.HSMKeyHandle, hash[:])
	default:
		return nil, fmt.Errorf("unsupported provider: %s", m.provider)
	}

	if err != nil {
		return nil, fmt.Errorf("signing failed: %w", err)
	}

	// Audit log
	if m.config.EnableAudit {
		m.auditKeyOperation(ctx, "KEY_USED_SIGN", metadata)
	}

	return signature, nil
}

// Verify verifies a signature using the specified key
func (m *HSMKeyManager) Verify(ctx context.Context, keyAlias string, data, signature []byte) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Get key metadata
	metadata, err := m.getKeyMetadata(ctx, keyAlias)
	if err != nil {
		return false, fmt.Errorf("key not found: %w", err)
	}

	// Hash the data
	hash := sha256.Sum256(data)

	var valid bool
	switch m.provider {
	case HSMProviderSoftHSM:
		valid, err = m.verifySoft(metadata.HSMKeyHandle, hash[:], signature)
	case HSMProviderHashiVault:
		valid, err = m.vaultClient.Verify(ctx, metadata.HSMKeyHandle, hash[:], signature)
	case HSMProviderAWS:
		valid, err = m.awsClient.Verify(ctx, metadata.HSMKeyHandle, hash[:], signature)
	case HSMProviderGCP:
		valid, err = m.gcpClient.Verify(ctx, metadata.HSMKeyHandle, hash[:], signature)
	default:
		return false, fmt.Errorf("unsupported provider: %s", m.provider)
	}

	return valid, err
}

// Encrypt encrypts data using the specified key
func (m *HSMKeyManager) Encrypt(ctx context.Context, keyAlias string, plaintext []byte) ([]byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	metadata, err := m.getKeyMetadata(ctx, keyAlias)
	if err != nil {
		return nil, fmt.Errorf("key not found: %w", err)
	}

	if metadata.State != KeyStateActive {
		return nil, fmt.Errorf("key is not active: %s", metadata.State)
	}

	var ciphertext []byte
	switch m.provider {
	case HSMProviderSoftHSM:
		ciphertext, err = m.encryptSoft(metadata.HSMKeyHandle, plaintext)
	case HSMProviderHashiVault:
		ciphertext, err = m.vaultClient.Encrypt(ctx, metadata.HSMKeyHandle, plaintext)
	case HSMProviderAWS:
		ciphertext, err = m.awsClient.Encrypt(ctx, metadata.HSMKeyHandle, plaintext)
	case HSMProviderGCP:
		ciphertext, err = m.gcpClient.Encrypt(ctx, metadata.HSMKeyHandle, plaintext)
	default:
		return nil, fmt.Errorf("unsupported provider: %s", m.provider)
	}

	if err != nil {
		return nil, fmt.Errorf("encryption failed: %w", err)
	}

	// Audit log
	if m.config.EnableAudit {
		m.auditKeyOperation(ctx, "KEY_USED_ENCRYPT", metadata)
	}

	return ciphertext, nil
}

// Decrypt decrypts data using the specified key
func (m *HSMKeyManager) Decrypt(ctx context.Context, keyAlias string, ciphertext []byte) ([]byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	metadata, err := m.getKeyMetadata(ctx, keyAlias)
	if err != nil {
		return nil, fmt.Errorf("key not found: %w", err)
	}

	var plaintext []byte
	switch m.provider {
	case HSMProviderSoftHSM:
		plaintext, err = m.decryptSoft(metadata.HSMKeyHandle, ciphertext)
	case HSMProviderHashiVault:
		plaintext, err = m.vaultClient.Decrypt(ctx, metadata.HSMKeyHandle, ciphertext)
	case HSMProviderAWS:
		plaintext, err = m.awsClient.Decrypt(ctx, metadata.HSMKeyHandle, ciphertext)
	case HSMProviderGCP:
		plaintext, err = m.gcpClient.Decrypt(ctx, metadata.HSMKeyHandle, ciphertext)
	default:
		return nil, fmt.Errorf("unsupported provider: %s", m.provider)
	}

	if err != nil {
		return nil, fmt.Errorf("decryption failed: %w", err)
	}

	// Audit log
	if m.config.EnableAudit {
		m.auditKeyOperation(ctx, "KEY_USED_DECRYPT", metadata)
	}

	return plaintext, nil
}

// RotateKey rotates a key to a new version
func (m *HSMKeyManager) RotateKey(ctx context.Context, keyAlias string) (*KeyMetadata, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Get current key metadata
	oldMetadata, err := m.getKeyMetadata(ctx, keyAlias)
	if err != nil {
		return nil, fmt.Errorf("key not found: %w", err)
	}

	// Mark old key as pending rotation
	oldMetadata.State = KeyStatePendingRotation
	if err := m.saveKeyMetadata(ctx, oldMetadata); err != nil {
		return nil, fmt.Errorf("failed to update old key state: %w", err)
	}

	// Generate new key with same purpose and algorithm
	newKeyID := generateKeyID()
	var hsmKeyHandle string
	var publicKey crypto.PublicKey

	switch m.provider {
	case HSMProviderSoftHSM:
		hsmKeyHandle, publicKey, err = m.generateSoftKey(oldMetadata.Algorithm, newKeyID)
	case HSMProviderHashiVault:
		err = m.vaultClient.RotateKey(ctx, oldMetadata.HSMKeyHandle)
		hsmKeyHandle = oldMetadata.HSMKeyHandle
		if err == nil {
			publicKey, err = m.vaultClient.GetPublicKey(ctx, hsmKeyHandle)
		}
	default:
		return nil, fmt.Errorf("rotation not supported for provider: %s", m.provider)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to rotate key: %w", err)
	}

	// Encode public key to PEM
	publicKeyPEM := ""
	if publicKey != nil {
		publicKeyPEM, _ = encodePublicKeyToPEM(publicKey)
	}

	// Create new metadata
	now := time.Now()
	newMetadata := &KeyMetadata{
		KeyID:        newKeyID,
		KeyAlias:     keyAlias,
		Purpose:      oldMetadata.Purpose,
		Algorithm:    oldMetadata.Algorithm,
		Version:      oldMetadata.Version + 1,
		State:        KeyStateActive,
		CreatedAt:    now,
		RotatedAt:    &now,
		HSMKeyHandle: hsmKeyHandle,
		PublicKeyPEM: publicKeyPEM,
	}

	// Save new key metadata
	if err := m.saveKeyMetadata(ctx, newMetadata); err != nil {
		return nil, fmt.Errorf("failed to save new key metadata: %w", err)
	}

	// Mark old key as rotated
	oldMetadata.State = KeyStateRotated
	if err := m.saveKeyMetadata(ctx, oldMetadata); err != nil {
		return nil, fmt.Errorf("failed to update old key state: %w", err)
	}

	// Invalidate cache
	delete(m.keyCache, keyAlias)

	// Audit log
	if m.config.EnableAudit {
		m.auditKeyOperation(ctx, "KEY_ROTATED", newMetadata)
	}

	return newMetadata, nil
}

// GetPublicKey retrieves the public key for a key alias
func (m *HSMKeyManager) GetPublicKey(ctx context.Context, keyAlias string) (crypto.PublicKey, error) {
	// Check cache
	m.mu.RLock()
	if cached, ok := m.keyCache[keyAlias]; ok {
		if time.Now().Before(cached.ExpiresAt) {
			m.mu.RUnlock()
			return cached.PublicKey, nil
		}
	}
	m.mu.RUnlock()

	// Get from HSM
	metadata, err := m.getKeyMetadata(ctx, keyAlias)
	if err != nil {
		return nil, err
	}

	// Parse public key from PEM
	if metadata.PublicKeyPEM != "" {
		block, _ := pem.Decode([]byte(metadata.PublicKeyPEM))
		if block != nil {
			publicKey, err := x509.ParsePKIXPublicKey(block.Bytes)
			if err == nil {
				// Cache
				m.mu.Lock()
				m.keyCache[keyAlias] = &CachedKey{
					KeyID:     metadata.KeyID,
					PublicKey: publicKey,
					CachedAt:  time.Now(),
					ExpiresAt: time.Now().Add(m.cacheTTL),
				}
				m.mu.Unlock()
				return publicKey, nil
			}
		}
	}

	return nil, fmt.Errorf("public key not available")
}

// DisableKey disables a key
func (m *HSMKeyManager) DisableKey(ctx context.Context, keyAlias string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	metadata, err := m.getKeyMetadata(ctx, keyAlias)
	if err != nil {
		return fmt.Errorf("key not found: %w", err)
	}

	metadata.State = KeyStateDisabled
	if err := m.saveKeyMetadata(ctx, metadata); err != nil {
		return fmt.Errorf("failed to disable key: %w", err)
	}

	// Invalidate cache
	delete(m.keyCache, keyAlias)

	// Audit log
	if m.config.EnableAudit {
		m.auditKeyOperation(ctx, "KEY_DISABLED", metadata)
	}

	return nil
}

// ListKeys lists all keys with optional filtering
func (m *HSMKeyManager) ListKeys(ctx context.Context, purpose *KeyPurpose, state *KeyState) ([]*KeyMetadata, error) {
	query := `
		SELECT key_id, key_alias, purpose, algorithm, version, state, 
		       created_at, rotated_at, expires_at, hsm_key_handle, public_key_pem
		FROM hsm_keys WHERE 1=1
	`
	var args []interface{}
	argIndex := 1

	if purpose != nil {
		query += fmt.Sprintf(" AND purpose = $%d", argIndex)
		args = append(args, string(*purpose))
		argIndex++
	}

	if state != nil {
		query += fmt.Sprintf(" AND state = $%d", argIndex)
		args = append(args, string(*state))
		argIndex++
	}

	query += " ORDER BY created_at DESC"

	rows, err := m.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []*KeyMetadata
	for rows.Next() {
		k := &KeyMetadata{}
		var purpose, algorithm, state string
		var rotatedAt, expiresAt sql.NullTime

		err := rows.Scan(
			&k.KeyID, &k.KeyAlias, &purpose, &algorithm, &k.Version, &state,
			&k.CreatedAt, &rotatedAt, &expiresAt, &k.HSMKeyHandle, &k.PublicKeyPEM,
		)
		if err != nil {
			continue
		}

		k.Purpose = KeyPurpose(purpose)
		k.Algorithm = KeyAlgorithm(algorithm)
		k.State = KeyState(state)
		if rotatedAt.Valid {
			k.RotatedAt = &rotatedAt.Time
		}
		if expiresAt.Valid {
			k.ExpiresAt = &expiresAt.Time
		}

		keys = append(keys, k)
	}

	return keys, nil
}

// Helper methods

func (m *HSMKeyManager) getKeyMetadata(ctx context.Context, keyAlias string) (*KeyMetadata, error) {
	row := m.db.QueryRowContext(ctx, `
		SELECT key_id, key_alias, purpose, algorithm, version, state,
		       created_at, rotated_at, expires_at, hsm_key_handle, public_key_pem
		FROM hsm_keys
		WHERE key_alias = $1 AND state IN ('ACTIVE', 'PENDING_ROTATION')
		ORDER BY version DESC LIMIT 1
	`, keyAlias)

	k := &KeyMetadata{}
	var purpose, algorithm, state string
	var rotatedAt, expiresAt sql.NullTime

	err := row.Scan(
		&k.KeyID, &k.KeyAlias, &purpose, &algorithm, &k.Version, &state,
		&k.CreatedAt, &rotatedAt, &expiresAt, &k.HSMKeyHandle, &k.PublicKeyPEM,
	)
	if err != nil {
		return nil, err
	}

	k.Purpose = KeyPurpose(purpose)
	k.Algorithm = KeyAlgorithm(algorithm)
	k.State = KeyState(state)
	if rotatedAt.Valid {
		k.RotatedAt = &rotatedAt.Time
	}
	if expiresAt.Valid {
		k.ExpiresAt = &expiresAt.Time
	}

	return k, nil
}

func (m *HSMKeyManager) saveKeyMetadata(ctx context.Context, k *KeyMetadata) error {
	_, err := m.db.ExecContext(ctx, `
		INSERT INTO hsm_keys (
			key_id, key_alias, purpose, algorithm, version, state,
			created_at, rotated_at, expires_at, hsm_key_handle, public_key_pem
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (key_id) DO UPDATE SET
			state = EXCLUDED.state,
			rotated_at = EXCLUDED.rotated_at,
			expires_at = EXCLUDED.expires_at
	`, k.KeyID, k.KeyAlias, string(k.Purpose), string(k.Algorithm), k.Version, string(k.State),
		k.CreatedAt, k.RotatedAt, k.ExpiresAt, k.HSMKeyHandle, k.PublicKeyPEM)
	return err
}

func (m *HSMKeyManager) auditKeyOperation(ctx context.Context, operation string, metadata *KeyMetadata) {
	m.db.ExecContext(ctx, `
		INSERT INTO hsm_key_audit (key_id, key_alias, operation, timestamp, details)
		VALUES ($1, $2, $3, $4, $5)
	`, metadata.KeyID, metadata.KeyAlias, operation, time.Now(),
		fmt.Sprintf("version=%d, state=%s", metadata.Version, metadata.State))
}

// SoftHSM implementation for development/testing
var softKeys = make(map[string]interface{})
var softKeysMu sync.RWMutex

func (m *HSMKeyManager) generateSoftKey(algorithm KeyAlgorithm, keyID string) (string, crypto.PublicKey, error) {
	softKeysMu.Lock()
	defer softKeysMu.Unlock()

	var privateKey interface{}
	var publicKey crypto.PublicKey
	var err error

	switch algorithm {
	case KeyAlgorithmRSA2048:
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			return "", nil, err
		}
		privateKey = key
		publicKey = &key.PublicKey
	case KeyAlgorithmRSA4096:
		key, err := rsa.GenerateKey(rand.Reader, 4096)
		if err != nil {
			return "", nil, err
		}
		privateKey = key
		publicKey = &key.PublicKey
	case KeyAlgorithmECDSAP256:
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return "", nil, err
		}
		privateKey = key
		publicKey = &key.PublicKey
	case KeyAlgorithmECDSAP384:
		key, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
		if err != nil {
			return "", nil, err
		}
		privateKey = key
		publicKey = &key.PublicKey
	default:
		return "", nil, fmt.Errorf("unsupported algorithm: %s", algorithm)
	}

	if err != nil {
		return "", nil, err
	}

	handle := fmt.Sprintf("soft:%s", keyID)
	softKeys[handle] = privateKey

	return handle, publicKey, nil
}

func (m *HSMKeyManager) signSoft(handle string, hash []byte) ([]byte, error) {
	softKeysMu.RLock()
	key, ok := softKeys[handle]
	softKeysMu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("key not found: %s", handle)
	}

	switch k := key.(type) {
	case *rsa.PrivateKey:
		return rsa.SignPKCS1v15(rand.Reader, k, crypto.SHA256, hash)
	case *ecdsa.PrivateKey:
		r, s, err := ecdsa.Sign(rand.Reader, k, hash)
		if err != nil {
			return nil, err
		}
		// Encode as R || S
		signature := make([]byte, 64)
		r.FillBytes(signature[:32])
		s.FillBytes(signature[32:])
		return signature, nil
	default:
		return nil, fmt.Errorf("unsupported key type")
	}
}

func (m *HSMKeyManager) verifySoft(handle string, hash, signature []byte) (bool, error) {
	softKeysMu.RLock()
	key, ok := softKeys[handle]
	softKeysMu.RUnlock()

	if !ok {
		return false, fmt.Errorf("key not found: %s", handle)
	}

	switch k := key.(type) {
	case *rsa.PrivateKey:
		err := rsa.VerifyPKCS1v15(&k.PublicKey, crypto.SHA256, hash, signature)
		return err == nil, nil
	case *ecdsa.PrivateKey:
		if len(signature) != 64 {
			return false, fmt.Errorf("invalid signature length")
		}
		r := new(big.Int).SetBytes(signature[:32])
		s := new(big.Int).SetBytes(signature[32:])
		return ecdsa.Verify(&k.PublicKey, hash, r, s), nil
	default:
		return false, fmt.Errorf("unsupported key type")
	}
}

func (m *HSMKeyManager) encryptSoft(handle string, plaintext []byte) ([]byte, error) {
	softKeysMu.RLock()
	key, ok := softKeys[handle]
	softKeysMu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("key not found: %s", handle)
	}

	switch k := key.(type) {
	case *rsa.PrivateKey:
		return rsa.EncryptPKCS1v15(rand.Reader, &k.PublicKey, plaintext)
	default:
		return nil, fmt.Errorf("encryption not supported for key type")
	}
}

func (m *HSMKeyManager) decryptSoft(handle string, ciphertext []byte) ([]byte, error) {
	softKeysMu.RLock()
	key, ok := softKeys[handle]
	softKeysMu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("key not found: %s", handle)
	}

	switch k := key.(type) {
	case *rsa.PrivateKey:
		return rsa.DecryptPKCS1v15(rand.Reader, k, ciphertext)
	default:
		return nil, fmt.Errorf("decryption not supported for key type")
	}
}

func generateKeyID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func encodePublicKeyToPEM(publicKey crypto.PublicKey) (string, error) {
	publicKeyBytes, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		return "", err
	}
	return string(pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: publicKeyBytes,
	})), nil
}

// HSMSchema returns the PostgreSQL schema for HSM tables
func HSMSchema() string {
	return `
-- HSM keys table
CREATE TABLE IF NOT EXISTS hsm_keys (
    key_id VARCHAR(64) PRIMARY KEY,
    key_alias VARCHAR(128) NOT NULL,
    purpose VARCHAR(50) NOT NULL,
    algorithm VARCHAR(50) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    state VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    rotated_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    hsm_key_handle VARCHAR(256) NOT NULL,
    public_key_pem TEXT
);

-- Index for alias lookups
CREATE INDEX IF NOT EXISTS idx_hsm_keys_alias 
ON hsm_keys(key_alias, state);

-- Index for purpose lookups
CREATE INDEX IF NOT EXISTS idx_hsm_keys_purpose 
ON hsm_keys(purpose, state);

-- HSM key audit table
CREATE TABLE IF NOT EXISTS hsm_key_audit (
    id SERIAL PRIMARY KEY,
    key_id VARCHAR(64) NOT NULL,
    key_alias VARCHAR(128) NOT NULL,
    operation VARCHAR(50) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    details TEXT,
    operator VARCHAR(128)
);

-- Index for audit queries
CREATE INDEX IF NOT EXISTS idx_hsm_key_audit_key 
ON hsm_key_audit(key_id, timestamp DESC);

-- Index for audit by time
CREATE INDEX IF NOT EXISTS idx_hsm_key_audit_timestamp 
ON hsm_key_audit(timestamp DESC);
`
}
