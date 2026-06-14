// Package tracing provides distributed tracing and correlation ID functionality
// Recommendation #15: Tracing & Correlation IDs
package tracing

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/rand/v2"
	"net/http"
	"strings"
	"sync"
	"time"
)

// TraceID represents a unique trace identifier
type TraceID [16]byte

// SpanID represents a unique span identifier
type SpanID [8]byte

// String returns the hex string representation of TraceID
func (t TraceID) String() string {
	return hex.EncodeToString(t[:])
}

// String returns the hex string representation of SpanID
func (s SpanID) String() string {
	return hex.EncodeToString(s[:])
}

// ParseTraceID parses a hex string into a TraceID
func ParseTraceID(s string) (TraceID, error) {
	var t TraceID
	if len(s) != 32 {
		return t, fmt.Errorf("invalid trace ID length: %d", len(s))
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return t, err
	}
	copy(t[:], b)
	return t, nil
}

// ParseSpanID parses a hex string into a SpanID
func ParseSpanID(s string) (SpanID, error) {
	var sp SpanID
	if len(s) != 16 {
		return sp, fmt.Errorf("invalid span ID length: %d", len(s))
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return sp, err
	}
	copy(sp[:], b)
	return sp, nil
}

// SpanContext holds the context for a span
type SpanContext struct {
	TraceID       TraceID
	SpanID        SpanID
	ParentSpanID  SpanID
	CorrelationID string
	Sampled       bool
	Baggage       map[string]string
}

// Span represents a single operation within a trace
type Span struct {
	Name          string
	Context       SpanContext
	StartTime     time.Time
	EndTime       time.Time
	Status        SpanStatus
	StatusMessage string
	Attributes    map[string]interface{}
	Events        []SpanEvent
	mu            sync.Mutex
}

// SpanStatus represents the status of a span
type SpanStatus int

const (
	SpanStatusUnset SpanStatus = iota
	SpanStatusOK
	SpanStatusError
)

// SpanEvent represents an event within a span
type SpanEvent struct {
	Name       string
	Timestamp  time.Time
	Attributes map[string]interface{}
}

// SpanExporter exports spans to a backend
type SpanExporter interface {
	Export(ctx context.Context, spans []*Span) error
	Shutdown(ctx context.Context) error
}

// Tracer creates and manages spans
type Tracer struct {
	serviceName string
	exporter    SpanExporter
	sampler     Sampler
	spans       []*Span
	mu          sync.Mutex
}

// Sampler determines whether a trace should be sampled
type Sampler interface {
	ShouldSample(traceID TraceID) bool
}

// AlwaysSampler always samples traces
type AlwaysSampler struct{}

func (s *AlwaysSampler) ShouldSample(traceID TraceID) bool {
	return true
}

// ProbabilitySampler samples traces based on probability
type ProbabilitySampler struct {
	probability float64
	rng         *rand.Rand
	mu          sync.Mutex
}

// NewProbabilitySampler creates a new probability sampler
func NewProbabilitySampler(probability float64) *ProbabilitySampler {
	return &ProbabilitySampler{
		probability: probability,
		rng:         rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), 0)),
	}
}

func (s *ProbabilitySampler) ShouldSample(traceID TraceID) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rng.Float64() < s.probability
}

// TracerConfig holds configuration for the tracer
type TracerConfig struct {
	ServiceName string
	Exporter    SpanExporter
	Sampler     Sampler
}

// NewTracer creates a new tracer
func NewTracer(config *TracerConfig) *Tracer {
	sampler := config.Sampler
	if sampler == nil {
		sampler = &AlwaysSampler{}
	}
	return &Tracer{
		serviceName: config.ServiceName,
		exporter:    config.Exporter,
		sampler:     sampler,
		spans:       make([]*Span, 0),
	}
}

// contextKey is used for storing values in context
type contextKey string

const (
	spanContextKey contextKey = "span_context"
	spanKey        contextKey = "span"
)

// StartSpan starts a new span
func (t *Tracer) StartSpan(ctx context.Context, name string, opts ...SpanOption) (context.Context, *Span) {
	parentCtx := SpanFromContext(ctx)

	var spanCtx SpanContext
	if parentCtx != nil {
		spanCtx = SpanContext{
			TraceID:       parentCtx.Context.TraceID,
			SpanID:        generateSpanID(),
			ParentSpanID:  parentCtx.Context.SpanID,
			CorrelationID: parentCtx.Context.CorrelationID,
			Sampled:       parentCtx.Context.Sampled,
			Baggage:       copyBaggage(parentCtx.Context.Baggage),
		}
	} else {
		traceID := generateTraceID()
		spanCtx = SpanContext{
			TraceID:       traceID,
			SpanID:        generateSpanID(),
			CorrelationID: generateCorrelationID(),
			Sampled:       t.sampler.ShouldSample(traceID),
			Baggage:       make(map[string]string),
		}
	}

	span := &Span{
		Name:       name,
		Context:    spanCtx,
		StartTime:  time.Now(),
		Status:     SpanStatusUnset,
		Attributes: make(map[string]interface{}),
		Events:     make([]SpanEvent, 0),
	}

	// Apply options
	for _, opt := range opts {
		opt(span)
	}

	// Add service name attribute
	span.Attributes["service.name"] = t.serviceName

	return context.WithValue(ctx, spanKey, span), span
}

// SpanOption is a function that modifies a span
type SpanOption func(*Span)

// WithAttribute adds an attribute to the span
func WithAttribute(key string, value interface{}) SpanOption {
	return func(s *Span) {
		s.Attributes[key] = value
	}
}

// WithCorrelationID sets the correlation ID
func WithCorrelationID(correlationID string) SpanOption {
	return func(s *Span) {
		s.Context.CorrelationID = correlationID
	}
}

// End ends the span
func (s *Span) End() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.EndTime = time.Now()
}

// SetStatus sets the span status
func (s *Span) SetStatus(status SpanStatus, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Status = status
	s.StatusMessage = message
}

// SetAttribute sets an attribute on the span
func (s *Span) SetAttribute(key string, value interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Attributes[key] = value
}

// AddEvent adds an event to the span
func (s *Span) AddEvent(name string, attrs map[string]interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Events = append(s.Events, SpanEvent{
		Name:       name,
		Timestamp:  time.Now(),
		Attributes: attrs,
	})
}

// RecordError records an error on the span
func (s *Span) RecordError(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Status = SpanStatusError
	s.StatusMessage = err.Error()
	s.Events = append(s.Events, SpanEvent{
		Name:      "exception",
		Timestamp: time.Now(),
		Attributes: map[string]interface{}{
			"exception.type":    fmt.Sprintf("%T", err),
			"exception.message": err.Error(),
		},
	})
}

// Duration returns the duration of the span
func (s *Span) Duration() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.EndTime.IsZero() {
		return time.Since(s.StartTime)
	}
	return s.EndTime.Sub(s.StartTime)
}

// SpanFromContext retrieves the current span from context
func SpanFromContext(ctx context.Context) *Span {
	if span, ok := ctx.Value(spanKey).(*Span); ok {
		return span
	}
	return nil
}

// CorrelationIDFromContext retrieves the correlation ID from context
func CorrelationIDFromContext(ctx context.Context) string {
	if span := SpanFromContext(ctx); span != nil {
		return span.Context.CorrelationID
	}
	return ""
}

// TraceIDFromContext retrieves the trace ID from context
func TraceIDFromContext(ctx context.Context) string {
	if span := SpanFromContext(ctx); span != nil {
		return span.Context.TraceID.String()
	}
	return ""
}

// TracingMiddleware creates HTTP middleware for distributed tracing
type TracingMiddleware struct {
	tracer *Tracer
}

// NewTracingMiddleware creates a new tracing middleware
func NewTracingMiddleware(tracer *Tracer) *TracingMiddleware {
	return &TracingMiddleware{tracer: tracer}
}

// Handler returns the HTTP middleware handler
func (m *TracingMiddleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract trace context from headers
		var opts []SpanOption

		// Check for existing trace context
		traceParent := r.Header.Get("traceparent")
		if traceParent != "" {
			if spanCtx, err := parseTraceParent(traceParent); err == nil {
				opts = append(opts, func(s *Span) {
					s.Context.TraceID = spanCtx.TraceID
					s.Context.ParentSpanID = spanCtx.SpanID
					s.Context.Sampled = spanCtx.Sampled
				})
			}
		}

		// Check for correlation ID
		correlationID := r.Header.Get("X-Correlation-ID")
		if correlationID == "" {
			correlationID = r.Header.Get("X-Request-ID")
		}
		if correlationID != "" {
			opts = append(opts, WithCorrelationID(correlationID))
		}

		// Start span
		spanName := fmt.Sprintf("%s %s", r.Method, r.URL.Path)
		ctx, span := m.tracer.StartSpan(r.Context(), spanName, opts...)
		defer span.End()

		// Add HTTP attributes
		span.SetAttribute("http.method", r.Method)
		span.SetAttribute("http.url", r.URL.String())
		span.SetAttribute("http.host", r.Host)
		span.SetAttribute("http.user_agent", r.UserAgent())
		span.SetAttribute("http.remote_addr", r.RemoteAddr)

		// Set response headers
		w.Header().Set("X-Trace-ID", span.Context.TraceID.String())
		w.Header().Set("X-Span-ID", span.Context.SpanID.String())
		w.Header().Set("X-Correlation-ID", span.Context.CorrelationID)

		// Wrap response writer to capture status code
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		// Call next handler
		next.ServeHTTP(wrapped, r.WithContext(ctx))

		// Record response attributes
		span.SetAttribute("http.status_code", wrapped.statusCode)
		if wrapped.statusCode >= 400 {
			span.SetStatus(SpanStatusError, fmt.Sprintf("HTTP %d", wrapped.statusCode))
		} else {
			span.SetStatus(SpanStatusOK, "")
		}
	})
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *responseWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

// parseTraceParent parses a W3C traceparent header
func parseTraceParent(header string) (*SpanContext, error) {
	parts := strings.Split(header, "-")
	if len(parts) != 4 {
		return nil, fmt.Errorf("invalid traceparent format")
	}

	traceID, err := ParseTraceID(parts[1])
	if err != nil {
		return nil, err
	}

	spanID, err := ParseSpanID(parts[2])
	if err != nil {
		return nil, err
	}

	sampled := parts[3] == "01"

	return &SpanContext{
		TraceID: traceID,
		SpanID:  spanID,
		Sampled: sampled,
	}, nil
}

// Helper functions

func generateTraceID() TraceID {
	var t TraceID
	rng := rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), 0))
	for i := range t {
		t[i] = byte(rng.IntN(256))
	}
	return t
}

func generateSpanID() SpanID {
	var s SpanID
	rng := rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), 0))
	for i := range s {
		s[i] = byte(rng.IntN(256))
	}
	return s
}

func generateCorrelationID() string {
	return fmt.Sprintf("corr-%s", generateSpanID().String())
}

func copyBaggage(baggage map[string]string) map[string]string {
	if baggage == nil {
		return make(map[string]string)
	}
	copy := make(map[string]string, len(baggage))
	for k, v := range baggage {
		copy[k] = v
	}
	return copy
}

// ConsoleExporter exports spans to console (for development)
type ConsoleExporter struct{}

func (e *ConsoleExporter) Export(ctx context.Context, spans []*Span) error {
	for _, span := range spans {
		fmt.Printf("[TRACE] %s | trace_id=%s span_id=%s correlation_id=%s duration=%v status=%d\n",
			span.Name,
			span.Context.TraceID.String(),
			span.Context.SpanID.String(),
			span.Context.CorrelationID,
			span.Duration(),
			span.Status,
		)
	}
	return nil
}

func (e *ConsoleExporter) Shutdown(ctx context.Context) error {
	return nil
}

// InjectTraceContext injects trace context into outgoing HTTP requests
func InjectTraceContext(ctx context.Context, req *http.Request) {
	span := SpanFromContext(ctx)
	if span == nil {
		return
	}

	// W3C Trace Context
	traceParent := fmt.Sprintf("00-%s-%s-%s",
		span.Context.TraceID.String(),
		span.Context.SpanID.String(),
		map[bool]string{true: "01", false: "00"}[span.Context.Sampled],
	)
	req.Header.Set("traceparent", traceParent)

	// Correlation ID
	req.Header.Set("X-Correlation-ID", span.Context.CorrelationID)
	req.Header.Set("X-Request-ID", span.Context.CorrelationID)
}
