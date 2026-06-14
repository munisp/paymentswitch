package webhooks

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sync"
	"time"
)

type WebhookEvent struct {
	ID           string                 `json:"id"`
	RemittanceID string                 `json:"remittanceId"`
	Event        string                 `json:"event"`
	Data         map[string]interface{} `json:"data"`
	Timestamp    time.Time              `json:"timestamp"`
	Signature    string                 `json:"signature,omitempty"`
}

type WebhookDelivery struct {
	ID             string    `json:"id"`
	WebhookEventID string    `json:"webhookEventId"`
	URL            string    `json:"url"`
	Status         string    `json:"status"`
	Attempts       int       `json:"attempts"`
	LastAttemptAt  time.Time `json:"lastAttemptAt,omitempty"`
	NextRetryAt    time.Time `json:"nextRetryAt,omitempty"`
	ResponseCode   int       `json:"responseCode,omitempty"`
	ResponseBody   string    `json:"responseBody,omitempty"`
	Error          string    `json:"error,omitempty"`
}

type WebhookSubscription struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	URL       string    `json:"url"`
	Secret    string    `json:"secret"`
	Events    []string  `json:"events"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"createdAt"`
}

const (
	EventPaymentPending      = "payment.pending"
	EventPaymentConfirmed    = "payment.confirmed"
	EventPaymentFailed       = "payment.failed"
	EventConversionStarted   = "conversion.started"
	EventConversionCompleted = "conversion.completed"
	EventConversionFailed    = "conversion.failed"
	EventKYCInitiated        = "kyc.initiated"
	EventKYCApproved         = "kyc.approved"
	EventKYCRejected         = "kyc.rejected"
	EventAccountVerifying    = "account.verifying"
	EventAccountVerified     = "account.verified"
	EventAccountOpening      = "account.opening"
	EventAccountOpened       = "account.opened"
	EventTransferInitiated   = "transfer.initiated"
	EventTransferProcessing  = "transfer.processing"
	EventTransferCompleted   = "transfer.completed"
	EventTransferFailed      = "transfer.failed"
	EventRemittanceCreated   = "remittance.created"
	EventRemittanceCompleted = "remittance.completed"
	EventRemittanceFailed    = "remittance.failed"
	EventRemittanceCancelled = "remittance.cancelled"
)

type WebhookService struct {
	mu            sync.RWMutex
	subscriptions map[string]*WebhookSubscription
	events        map[string]*WebhookEvent
	deliveries    map[string]*WebhookDelivery
	httpClient    *http.Client
	maxRetries    int
	retryDelays   []int
	db            *sql.DB
}

func NewWebhookService() *WebhookService {
	return &WebhookService{
		subscriptions: make(map[string]*WebhookSubscription),
		events:        make(map[string]*WebhookEvent),
		deliveries:    make(map[string]*WebhookDelivery),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		maxRetries:  5,
		retryDelays: []int{60, 300, 900, 3600, 21600},
	}
}

func (s *WebhookService) CreateWebhookEvent(remittanceID, eventType string, data map[string]interface{}) (*WebhookEvent, error) {
	eventID := s.generateID("evt")

	event := &WebhookEvent{
		ID:           eventID,
		RemittanceID: remittanceID,
		Event:        eventType,
		Data:         data,
		Timestamp:    time.Now(),
	}

	s.mu.Lock()
	s.events[eventID] = event
	s.mu.Unlock()

	go s.persistEvent(event)
	go s.deliverWebhookEvent(event)

	return event, nil
}

func (s *WebhookService) deliverWebhookEvent(event *WebhookEvent) {
	subscriptions := s.getMatchingSubscriptions(event.Event)

	for _, sub := range subscriptions {
		delivery := &WebhookDelivery{
			ID:             s.generateID("del"),
			WebhookEventID: event.ID,
			URL:            sub.URL,
			Status:         "pending",
			Attempts:       0,
		}

		s.mu.Lock()
		s.deliveries[delivery.ID] = delivery
		s.mu.Unlock()

		go s.persistDelivery(delivery)
		s.attemptWebhookDelivery(event, delivery, sub)
	}
}

func (s *WebhookService) attemptWebhookDelivery(event *WebhookEvent, delivery *WebhookDelivery, subscription *WebhookSubscription) {
	delivery.Attempts++
	delivery.LastAttemptAt = time.Now()

	signature := s.generateWebhookSignature(event, subscription.Secret)

	payload := map[string]interface{}{
		"id":           event.ID,
		"event":        event.Event,
		"remittanceId": event.RemittanceID,
		"data":         event.Data,
		"timestamp":    event.Timestamp.Format(time.RFC3339),
	}

	jsonData, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", subscription.URL, bytes.NewBuffer(jsonData))
	if err != nil {
		delivery.Status = "failed"
		delivery.Error = fmt.Sprintf("Failed to create request: %v", err)
		s.scheduleRetry(delivery)
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Signature", signature)
	req.Header.Set("X-Webhook-Event", event.Event)
	req.Header.Set("X-Webhook-ID", event.ID)
	req.Header.Set("User-Agent", "PaymentSwitch-Webhooks/1.0")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		delivery.Status = "failed"
		delivery.Error = fmt.Sprintf("Request failed: %v", err)
		s.scheduleRetry(delivery)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	delivery.ResponseCode = resp.StatusCode
	delivery.ResponseBody = string(body)

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		delivery.Status = "delivered"
	} else {
		delivery.Status = "failed"
		delivery.Error = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, resp.Status)
		s.scheduleRetry(delivery)
	}
}

func (s *WebhookService) scheduleRetry(delivery *WebhookDelivery) {
	if delivery.Attempts >= s.maxRetries {
		return
	}

	delayIndex := delivery.Attempts - 1
	if delayIndex >= len(s.retryDelays) {
		delayIndex = len(s.retryDelays) - 1
	}

	delay := s.retryDelays[delayIndex]
	delivery.NextRetryAt = time.Now().Add(time.Duration(delay) * time.Second)
	delivery.Status = "pending"
}

func (s *WebhookService) generateWebhookSignature(event *WebhookEvent, secret string) string {
	payload := map[string]interface{}{
		"id":           event.ID,
		"event":        event.Event,
		"remittanceId": event.RemittanceID,
		"data":         event.Data,
		"timestamp":    event.Timestamp.Format(time.RFC3339),
	}

	jsonData, _ := json.Marshal(payload)

	h := hmac.New(sha256.New, []byte(secret))
	h.Write(jsonData)
	return hex.EncodeToString(h.Sum(nil))
}

func (s *WebhookService) VerifyWebhookSignature(payload, signature, secret string) bool {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(payload))
	expectedSignature := hex.EncodeToString(h.Sum(nil))

	return hmac.Equal([]byte(signature), []byte(expectedSignature))
}

func (s *WebhookService) getMatchingSubscriptions(eventType string) []*WebhookSubscription {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var matching []*WebhookSubscription
	for _, sub := range s.subscriptions {
		if sub.Active && s.matchesEventPattern(eventType, sub.Events) {
			matching = append(matching, sub)
		}
	}
	return matching
}

func (s *WebhookService) matchesEventPattern(event string, patterns []string) bool {
	for _, pattern := range patterns {
		regexPattern := regexp.QuoteMeta(pattern)
		regexPattern = regexp.MustCompile(`\\\*`).ReplaceAllString(regexPattern, ".+")
		regex := regexp.MustCompile("^" + regexPattern + "$")
		if regex.MatchString(event) {
			return true
		}
	}
	return false
}

func (s *WebhookService) CreateSubscription(userID, url string, events []string) (*WebhookSubscription, error) {
	secretBytes := make([]byte, 32)
	rand.Read(secretBytes)
	secret := hex.EncodeToString(secretBytes)

	subscription := &WebhookSubscription{
		ID:        s.generateID("sub"),
		UserID:    userID,
		URL:       url,
		Secret:    secret,
		Events:    events,
		Active:    true,
		CreatedAt: time.Now(),
	}

	s.mu.Lock()
	s.subscriptions[subscription.ID] = subscription
	s.mu.Unlock()

	go s.persistSubscription(subscription)
	return subscription, nil
}

func (s *WebhookService) UpdateSubscription(subscriptionID string, url *string, events []string, active *bool) (*WebhookSubscription, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	sub, exists := s.subscriptions[subscriptionID]
	if !exists {
		return nil, fmt.Errorf("subscription not found")
	}

	if url != nil {
		sub.URL = *url
	}
	if events != nil {
		sub.Events = events
	}
	if active != nil {
		sub.Active = *active
	}

	return sub, nil
}

func (s *WebhookService) DeleteSubscription(subscriptionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.subscriptions[subscriptionID]; !exists {
		return fmt.Errorf("subscription not found")
	}

	delete(s.subscriptions, subscriptionID)
	go s.deleteSubscriptionFromDB(subscriptionID)
	return nil
}

func (s *WebhookService) GetWebhookDeliveries(eventID string) []*WebhookDelivery {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var deliveries []*WebhookDelivery
	for _, d := range s.deliveries {
		if d.WebhookEventID == eventID {
			deliveries = append(deliveries, d)
		}
	}
	return deliveries
}

func (s *WebhookService) RetryWebhookDelivery(deliveryID string) (*WebhookDelivery, error) {
	s.mu.Lock()
	delivery, exists := s.deliveries[deliveryID]
	if !exists {
		s.mu.Unlock()
		return nil, fmt.Errorf("delivery not found")
	}

	event, eventExists := s.events[delivery.WebhookEventID]
	s.mu.Unlock()

	if !eventExists {
		return nil, fmt.Errorf("event not found")
	}

	var subscription *WebhookSubscription
	s.mu.RLock()
	for _, sub := range s.subscriptions {
		if sub.URL == delivery.URL {
			subscription = sub
			break
		}
	}
	s.mu.RUnlock()

	if subscription == nil {
		return nil, fmt.Errorf("subscription not found")
	}

	s.attemptWebhookDelivery(event, delivery, subscription)
	return delivery, nil
}

func (s *WebhookService) ProcessPendingWebhooks() (processed, succeeded, failed int) {
	s.mu.RLock()
	var pendingDeliveries []*WebhookDelivery
	now := time.Now()

	for _, d := range s.deliveries {
		if d.Status == "pending" && (d.NextRetryAt.IsZero() || now.After(d.NextRetryAt)) {
			pendingDeliveries = append(pendingDeliveries, d)
		}
	}
	s.mu.RUnlock()

	for _, delivery := range pendingDeliveries {
		s.mu.RLock()
		event := s.events[delivery.WebhookEventID]
		var subscription *WebhookSubscription
		for _, sub := range s.subscriptions {
			if sub.URL == delivery.URL {
				subscription = sub
				break
			}
		}
		s.mu.RUnlock()

		if event == nil || subscription == nil {
			continue
		}

		s.attemptWebhookDelivery(event, delivery, subscription)
		processed++

		if delivery.Status == "delivered" {
			succeeded++
		} else {
			failed++
		}
	}

	return processed, succeeded, failed
}

func (s *WebhookService) GetWebhookEvent(eventID string) (*WebhookEvent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	event, exists := s.events[eventID]
	if !exists {
		return nil, fmt.Errorf("event not found")
	}
	return event, nil
}

func (s *WebhookService) ListWebhookEvents(remittanceID string, limit, offset int) ([]*WebhookEvent, int) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var events []*WebhookEvent
	for _, e := range s.events {
		if e.RemittanceID == remittanceID {
			events = append(events, e)
		}
	}

	total := len(events)

	if offset >= len(events) {
		return []*WebhookEvent{}, total
	}

	end := offset + limit
	if end > len(events) {
		end = len(events)
	}

	return events[offset:end], total
}

func (s *WebhookService) TestWebhookEndpoint(url, secret string) (success bool, responseCode int, responseTime int64, err error) {
	startTime := time.Now()

	testEvent := &WebhookEvent{
		ID:           "evt_test",
		RemittanceID: "rem_test",
		Event:        "webhook.test",
		Data:         map[string]interface{}{"message": "This is a test webhook"},
		Timestamp:    time.Now(),
	}

	signature := s.generateWebhookSignature(testEvent, secret)

	payload := map[string]interface{}{
		"id":           testEvent.ID,
		"event":        testEvent.Event,
		"remittanceId": testEvent.RemittanceID,
		"data":         testEvent.Data,
		"timestamp":    testEvent.Timestamp.Format(time.RFC3339),
	}

	jsonData, _ := json.Marshal(payload)

	req, reqErr := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if reqErr != nil {
		return false, 0, time.Since(startTime).Milliseconds(), reqErr
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Signature", signature)
	req.Header.Set("X-Webhook-Event", testEvent.Event)
	req.Header.Set("X-Webhook-ID", testEvent.ID)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, respErr := client.Do(req)
	responseTime = time.Since(startTime).Milliseconds()

	if respErr != nil {
		return false, 0, responseTime, respErr
	}
	defer resp.Body.Close()

	return resp.StatusCode >= 200 && resp.StatusCode < 300, resp.StatusCode, responseTime, nil
}

func (s *WebhookService) GetSubscription(subscriptionID string) (*WebhookSubscription, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	sub, exists := s.subscriptions[subscriptionID]
	if !exists {
		return nil, fmt.Errorf("subscription not found")
	}
	return sub, nil
}

func (s *WebhookService) GetUserSubscriptions(userID string) []*WebhookSubscription {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var subs []*WebhookSubscription
	for _, sub := range s.subscriptions {
		if sub.UserID == userID {
			subs = append(subs, sub)
		}
	}
	return subs
}

func (s *WebhookService) generateID(prefix string) string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(bytes))
}
