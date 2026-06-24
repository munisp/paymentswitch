package middleware

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// APISIXDynamicRouter provides canary deployments and dynamic route management
type APISIXDynamicRouter struct {
	adminURL string
	adminKey string
	routes   map[string]*Route
	upstreams map[string]*Upstream
	mu       sync.RWMutex
	metrics  *APISIXMetrics
}

type Route struct {
	ID           string
	URI          string
	Methods      []string
	UpstreamID   string
	Plugins      map[string]interface{}
	Priority     int
	Labels       map[string]string
	Status       int // 1=enabled, 0=disabled
}

type Upstream struct {
	ID       string
	Type     string // roundrobin, chash, ewma
	Nodes    []UpstreamNode
	Retries  int
	Timeout  UpstreamTimeout
	Checks   HealthCheck
}

type UpstreamNode struct {
	Host   string
	Port   int
	Weight int
}

type UpstreamTimeout struct {
	ConnectMs int
	SendMs    int
	ReadMs    int
}

type HealthCheck struct {
	Active  ActiveHealthCheck
	Passive PassiveHealthCheck
}

type ActiveHealthCheck struct {
	Type       string // http, https, tcp
	HTTPPath   string
	IntervalS  int
	Timeout    int
	Healthy    HealthThreshold
	Unhealthy  HealthThreshold
}

type PassiveHealthCheck struct {
	Healthy   HealthThreshold
	Unhealthy HealthThreshold
}

type HealthThreshold struct {
	Successes    int
	HTTPStatuses []int
}

type CanaryConfig struct {
	RouteID       string
	StableWeight  int
	CanaryWeight  int
	CanaryUpstream string
	StableUpstream string
	Headers       map[string]string // Match headers for canary
}

type APISIXMetrics struct {
	RoutesActive      int
	UpstreamsActive   int
	RequestsRouted    int64
	CanaryDeployments int
	HealthChecksFailed int
	mu               sync.Mutex
}

func NewAPISIXDynamicRouter(adminURL, adminKey string) *APISIXDynamicRouter {
	return &APISIXDynamicRouter{
		adminURL:  adminURL,
		adminKey:  adminKey,
		routes:    make(map[string]*Route),
		upstreams: make(map[string]*Upstream),
		metrics:   &APISIXMetrics{},
	}
}

// CreateRoute registers a new API route
func (r *APISIXDynamicRouter) CreateRoute(_ context.Context, route *Route) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.routes[route.ID] = route
	r.metrics.mu.Lock()
	r.metrics.RoutesActive = len(r.routes)
	r.metrics.mu.Unlock()
	return nil
}

// CreateUpstream registers a new upstream with health checking
func (r *APISIXDynamicRouter) CreateUpstream(_ context.Context, upstream *Upstream) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.upstreams[upstream.ID] = upstream
	r.metrics.mu.Lock()
	r.metrics.UpstreamsActive = len(r.upstreams)
	r.metrics.mu.Unlock()
	return nil
}

// ConfigureCanary sets up weighted traffic split for canary deployments
func (r *APISIXDynamicRouter) ConfigureCanary(_ context.Context, cfg CanaryConfig) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	route, ok := r.routes[cfg.RouteID]
	if !ok {
		return fmt.Errorf("route not found: %s", cfg.RouteID)
	}

	// Set traffic-split plugin for canary
	route.Plugins["traffic-split"] = map[string]interface{}{
		"rules": []map[string]interface{}{
			{
				"weighted_upstreams": []map[string]interface{}{
					{"upstream_id": cfg.StableUpstream, "weight": cfg.StableWeight},
					{"upstream_id": cfg.CanaryUpstream, "weight": cfg.CanaryWeight},
				},
			},
		},
	}

	r.metrics.mu.Lock()
	r.metrics.CanaryDeployments++
	r.metrics.mu.Unlock()
	return nil
}

// PromoteCanary sets canary to 100% (full rollout)
func (r *APISIXDynamicRouter) PromoteCanary(_ context.Context, routeID, canaryUpstream string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	route, ok := r.routes[routeID]
	if !ok {
		return fmt.Errorf("route not found: %s", routeID)
	}

	route.UpstreamID = canaryUpstream
	delete(route.Plugins, "traffic-split")
	return nil
}

// RollbackCanary removes canary, reverts to stable
func (r *APISIXDynamicRouter) RollbackCanary(_ context.Context, routeID, stableUpstream string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	route, ok := r.routes[routeID]
	if !ok {
		return fmt.Errorf("route not found: %s", routeID)
	}

	route.UpstreamID = stableUpstream
	delete(route.Plugins, "traffic-split")
	return nil
}

// ApplyRateLimiting adds rate limit plugin to a route
func (r *APISIXDynamicRouter) ApplyRateLimiting(_ context.Context, routeID string, rps int, burstSize int) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	route, ok := r.routes[routeID]
	if !ok {
		return fmt.Errorf("route not found: %s", routeID)
	}

	route.Plugins["limit-req"] = map[string]interface{}{
		"rate":      rps,
		"burst":     burstSize,
		"key_type":  "var",
		"key":       "remote_addr",
		"rejected_code": 429,
	}
	return nil
}

// ApplyIPWhitelist restricts route to allowed IPs
func (r *APISIXDynamicRouter) ApplyIPWhitelist(_ context.Context, routeID string, allowedIPs []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	route, ok := r.routes[routeID]
	if !ok {
		return fmt.Errorf("route not found: %s", routeID)
	}

	route.Plugins["ip-restriction"] = map[string]interface{}{
		"whitelist": allowedIPs,
	}
	return nil
}

func (r *APISIXDynamicRouter) GetMetrics() (routes, upstreams, canary int) {
	r.metrics.mu.Lock()
	defer r.metrics.mu.Unlock()
	return r.metrics.RoutesActive, r.metrics.UpstreamsActive, r.metrics.CanaryDeployments
}

// PaymentRoutes returns default route configuration for payment services
func PaymentRoutes() []*Route {
	return []*Route{
		{ID: "transfer-api", URI: "/api/v1/transfers/*", Methods: []string{"GET", "POST", "PUT"}, Priority: 100, Status: 1, Plugins: make(map[string]interface{})},
		{ID: "settlement-api", URI: "/api/v1/settlements/*", Methods: []string{"GET", "POST"}, Priority: 100, Status: 1, Plugins: make(map[string]interface{})},
		{ID: "compliance-api", URI: "/api/v1/compliance/*", Methods: []string{"GET", "POST", "PUT"}, Priority: 100, Status: 1, Plugins: make(map[string]interface{})},
		{ID: "mojaloop-api", URI: "/api/v1/mojaloop/*", Methods: []string{"GET", "POST", "PUT"}, Priority: 90, Status: 1, Plugins: make(map[string]interface{})},
		{ID: "webhook-api", URI: "/api/v1/webhooks/*", Methods: []string{"POST"}, Priority: 80, Status: 1, Plugins: make(map[string]interface{})},
	}
}

// GracefulDrain stops accepting new requests during deployment
type GracefulDrain struct {
	draining bool
	mu       sync.RWMutex
	drainCh  chan struct{}
}

func NewGracefulDrain() *GracefulDrain {
	return &GracefulDrain{drainCh: make(chan struct{})}
}

func (d *GracefulDrain) StartDrain(waitDuration time.Duration) {
	d.mu.Lock()
	d.draining = true
	d.mu.Unlock()
	time.AfterFunc(waitDuration, func() {
		close(d.drainCh)
	})
}

func (d *GracefulDrain) IsDraining() bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.draining
}
