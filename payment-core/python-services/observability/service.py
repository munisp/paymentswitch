"""
Observability Stack Service
Recommendation #24: Observability Stack (Metrics, Logging, Alerting)

This service provides:
- Metrics collection and aggregation
- Structured logging with correlation IDs
- Alert management and routing
- SLO/SLI tracking
- Dashboard data aggregation
"""

import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Callable
from dataclasses import dataclass, field, asdict
from collections import defaultdict
import threading
import logging


class MetricType(str, Enum):
    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"
    SUMMARY = "summary"


class AlertSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class AlertStatus(str, Enum):
    FIRING = "firing"
    RESOLVED = "resolved"
    ACKNOWLEDGED = "acknowledged"
    SILENCED = "silenced"


class LogLevel(str, Enum):
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


@dataclass
class Metric:
    """Represents a metric data point"""
    name: str
    type: MetricType
    value: float
    labels: Dict[str, str] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    unit: str = ""
    description: str = ""


@dataclass
class MetricSeries:
    """Represents a time series of metrics"""
    name: str
    type: MetricType
    labels: Dict[str, str]
    values: List[tuple]  # (timestamp, value)
    unit: str = ""


@dataclass
class LogEntry:
    """Represents a structured log entry"""
    timestamp: datetime
    level: LogLevel
    message: str
    service: str
    correlation_id: str = ""
    trace_id: str = ""
    span_id: str = ""
    user_id: str = ""
    request_id: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    stack_trace: Optional[str] = None


@dataclass
class Alert:
    """Represents an alert"""
    id: str
    name: str
    severity: AlertSeverity
    status: AlertStatus
    message: str
    source: str
    labels: Dict[str, str] = field(default_factory=dict)
    annotations: Dict[str, str] = field(default_factory=dict)
    starts_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    ends_at: Optional[datetime] = None
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    fingerprint: str = ""


@dataclass
class SLO:
    """Service Level Objective"""
    id: str
    name: str
    description: str
    target: float  # e.g., 99.9 for 99.9%
    window_days: int  # e.g., 30 for 30-day rolling window
    metric_name: str
    metric_query: str
    current_value: float = 0.0
    error_budget_remaining: float = 100.0
    status: str = "healthy"  # healthy, warning, critical
    last_calculated: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class SLI:
    """Service Level Indicator"""
    id: str
    name: str
    description: str
    metric_name: str
    good_events: int = 0
    total_events: int = 0
    value: float = 0.0  # Percentage
    window_start: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    window_end: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class MetricsCollector:
    """Collects and aggregates metrics"""
    
    def __init__(self):
        self._metrics: Dict[str, List[Metric]] = defaultdict(list)
        self._counters: Dict[str, float] = defaultdict(float)
        self._gauges: Dict[str, float] = {}
        self._histograms: Dict[str, List[float]] = defaultdict(list)
        self._lock = threading.Lock()
    
    def _make_key(self, name: str, labels: Dict[str, str]) -> str:
        """Create a unique key for a metric with labels"""
        label_str = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        return f"{name}{{{label_str}}}"
    
    def increment_counter(
        self,
        name: str,
        value: float = 1.0,
        labels: Dict[str, str] = None,
    ) -> None:
        """Increment a counter metric"""
        labels = labels or {}
        key = self._make_key(name, labels)
        with self._lock:
            self._counters[key] += value
            self._metrics[name].append(Metric(
                name=name,
                type=MetricType.COUNTER,
                value=self._counters[key],
                labels=labels,
            ))
    
    def set_gauge(
        self,
        name: str,
        value: float,
        labels: Dict[str, str] = None,
    ) -> None:
        """Set a gauge metric"""
        labels = labels or {}
        key = self._make_key(name, labels)
        with self._lock:
            self._gauges[key] = value
            self._metrics[name].append(Metric(
                name=name,
                type=MetricType.GAUGE,
                value=value,
                labels=labels,
            ))
    
    def observe_histogram(
        self,
        name: str,
        value: float,
        labels: Dict[str, str] = None,
    ) -> None:
        """Record a histogram observation"""
        labels = labels or {}
        key = self._make_key(name, labels)
        with self._lock:
            self._histograms[key].append(value)
            self._metrics[name].append(Metric(
                name=name,
                type=MetricType.HISTOGRAM,
                value=value,
                labels=labels,
            ))
    
    def get_counter(self, name: str, labels: Dict[str, str] = None) -> float:
        """Get current counter value"""
        labels = labels or {}
        key = self._make_key(name, labels)
        return self._counters.get(key, 0.0)
    
    def get_gauge(self, name: str, labels: Dict[str, str] = None) -> float:
        """Get current gauge value"""
        labels = labels or {}
        key = self._make_key(name, labels)
        return self._gauges.get(key, 0.0)
    
    def get_histogram_stats(
        self,
        name: str,
        labels: Dict[str, str] = None,
    ) -> Dict[str, float]:
        """Get histogram statistics"""
        labels = labels or {}
        key = self._make_key(name, labels)
        values = self._histograms.get(key, [])
        
        if not values:
            return {"count": 0, "sum": 0, "avg": 0, "min": 0, "max": 0, "p50": 0, "p95": 0, "p99": 0}
        
        sorted_values = sorted(values)
        count = len(values)
        
        return {
            "count": count,
            "sum": sum(values),
            "avg": sum(values) / count,
            "min": min(values),
            "max": max(values),
            "p50": sorted_values[int(count * 0.5)],
            "p95": sorted_values[int(count * 0.95)] if count > 20 else sorted_values[-1],
            "p99": sorted_values[int(count * 0.99)] if count > 100 else sorted_values[-1],
        }
    
    def get_metrics(self, name: str = None) -> List[Metric]:
        """Get all metrics or metrics by name"""
        if name:
            return self._metrics.get(name, [])
        all_metrics = []
        for metrics in self._metrics.values():
            all_metrics.extend(metrics)
        return all_metrics
    
    def export_prometheus(self) -> str:
        """Export metrics in Prometheus format"""
        lines = []
        
        # Export counters
        for key, value in self._counters.items():
            lines.append(f"{key} {value}")
        
        # Export gauges
        for key, value in self._gauges.items():
            lines.append(f"{key} {value}")
        
        # Export histogram summaries
        for key, values in self._histograms.items():
            if values:
                stats = self.get_histogram_stats(key.split("{")[0])
                base_key = key.split("{")[0]
                labels = key[len(base_key):]
                lines.append(f"{base_key}_count{labels} {stats['count']}")
                lines.append(f"{base_key}_sum{labels} {stats['sum']}")
        
        return "\n".join(lines)


class StructuredLogger:
    """Structured logging with correlation IDs"""
    
    def __init__(self, service_name: str, min_level: LogLevel = LogLevel.INFO):
        self.service_name = service_name
        self.min_level = min_level
        self._logs: List[LogEntry] = []
        self._handlers: List[Callable[[LogEntry], None]] = []
        self._lock = threading.Lock()
        
        # Configure Python logging
        self._logger = logging.getLogger(service_name)
        self._logger.setLevel(logging.DEBUG)
    
    def add_handler(self, handler: Callable[[LogEntry], None]) -> None:
        """Add a log handler"""
        self._handlers.append(handler)
    
    def _should_log(self, level: LogLevel) -> bool:
        """Check if the log level should be logged"""
        levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARNING, LogLevel.ERROR, LogLevel.CRITICAL]
        return levels.index(level) >= levels.index(self.min_level)
    
    def _log(
        self,
        level: LogLevel,
        message: str,
        correlation_id: str = "",
        trace_id: str = "",
        span_id: str = "",
        user_id: str = "",
        request_id: str = "",
        error: str = None,
        stack_trace: str = None,
        **extra,
    ) -> LogEntry:
        """Internal logging method"""
        if not self._should_log(level):
            return None
        
        entry = LogEntry(
            timestamp=datetime.now(timezone.utc),
            level=level,
            message=message,
            service=self.service_name,
            correlation_id=correlation_id or str(uuid.uuid4())[:8],
            trace_id=trace_id,
            span_id=span_id,
            user_id=user_id,
            request_id=request_id,
            extra=extra,
            error=error,
            stack_trace=stack_trace,
        )
        
        with self._lock:
            self._logs.append(entry)
            # Keep only last 10000 logs in memory
            if len(self._logs) > 10000:
                self._logs = self._logs[-10000:]
        
        # Call handlers
        for handler in self._handlers:
            try:
                handler(entry)
            except Exception:
                pass
        
        # Also log to Python logger
        log_data = {
            "timestamp": entry.timestamp.isoformat(),
            "level": entry.level.value,
            "message": entry.message,
            "service": entry.service,
            "correlation_id": entry.correlation_id,
        }
        if entry.trace_id:
            log_data["trace_id"] = entry.trace_id
        if entry.user_id:
            log_data["user_id"] = entry.user_id
        if entry.error:
            log_data["error"] = entry.error
        log_data.update(entry.extra)
        
        self._logger.log(
            getattr(logging, level.value.upper()),
            json.dumps(log_data),
        )
        
        return entry
    
    def debug(self, message: str, **kwargs) -> LogEntry:
        return self._log(LogLevel.DEBUG, message, **kwargs)
    
    def info(self, message: str, **kwargs) -> LogEntry:
        return self._log(LogLevel.INFO, message, **kwargs)
    
    def warning(self, message: str, **kwargs) -> LogEntry:
        return self._log(LogLevel.WARNING, message, **kwargs)
    
    def error(self, message: str, **kwargs) -> LogEntry:
        return self._log(LogLevel.ERROR, message, **kwargs)
    
    def critical(self, message: str, **kwargs) -> LogEntry:
        return self._log(LogLevel.CRITICAL, message, **kwargs)
    
    def get_logs(
        self,
        level: LogLevel = None,
        correlation_id: str = None,
        since: datetime = None,
        limit: int = 100,
    ) -> List[LogEntry]:
        """Query logs"""
        logs = self._logs.copy()
        
        if level:
            logs = [l for l in logs if l.level == level]
        if correlation_id:
            logs = [l for l in logs if l.correlation_id == correlation_id]
        if since:
            logs = [l for l in logs if l.timestamp >= since]
        
        return logs[-limit:]


class AlertManager:
    """Manages alerts and notifications"""
    
    def __init__(self):
        self._alerts: Dict[str, Alert] = {}
        self._alert_rules: List[Dict[str, Any]] = []
        self._notification_channels: List[Callable[[Alert], None]] = []
        self._lock = threading.Lock()
    
    def add_notification_channel(self, channel: Callable[[Alert], None]) -> None:
        """Add a notification channel"""
        self._notification_channels.append(channel)
    
    def add_alert_rule(
        self,
        name: str,
        condition: Callable[[], bool],
        severity: AlertSeverity,
        message: str,
        labels: Dict[str, str] = None,
    ) -> None:
        """Add an alert rule"""
        self._alert_rules.append({
            "name": name,
            "condition": condition,
            "severity": severity,
            "message": message,
            "labels": labels or {},
        })
    
    def _generate_fingerprint(self, name: str, labels: Dict[str, str]) -> str:
        """Generate a unique fingerprint for an alert"""
        label_str = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        return f"{name}:{label_str}"
    
    def fire_alert(
        self,
        name: str,
        severity: AlertSeverity,
        message: str,
        source: str,
        labels: Dict[str, str] = None,
        annotations: Dict[str, str] = None,
    ) -> Alert:
        """Fire a new alert"""
        labels = labels or {}
        annotations = annotations or {}
        fingerprint = self._generate_fingerprint(name, labels)
        
        with self._lock:
            # Check if alert already exists
            if fingerprint in self._alerts:
                existing = self._alerts[fingerprint]
                if existing.status == AlertStatus.FIRING:
                    return existing
            
            alert = Alert(
                id=str(uuid.uuid4()),
                name=name,
                severity=severity,
                status=AlertStatus.FIRING,
                message=message,
                source=source,
                labels=labels,
                annotations=annotations,
                fingerprint=fingerprint,
            )
            
            self._alerts[fingerprint] = alert
        
        # Send notifications
        for channel in self._notification_channels:
            try:
                channel(alert)
            except Exception:
                pass
        
        return alert
    
    def resolve_alert(self, fingerprint: str) -> Optional[Alert]:
        """Resolve an alert"""
        with self._lock:
            if fingerprint not in self._alerts:
                return None
            
            alert = self._alerts[fingerprint]
            alert.status = AlertStatus.RESOLVED
            alert.resolved_at = datetime.now(timezone.utc)
            alert.ends_at = datetime.now(timezone.utc)
        
        # Send resolution notification
        for channel in self._notification_channels:
            try:
                channel(alert)
            except Exception:
                pass
        
        return alert
    
    def acknowledge_alert(self, fingerprint: str, user: str) -> Optional[Alert]:
        """Acknowledge an alert"""
        with self._lock:
            if fingerprint not in self._alerts:
                return None
            
            alert = self._alerts[fingerprint]
            alert.status = AlertStatus.ACKNOWLEDGED
            alert.acknowledged_by = user
            alert.acknowledged_at = datetime.now(timezone.utc)
        
        return alert
    
    def get_alerts(
        self,
        status: AlertStatus = None,
        severity: AlertSeverity = None,
    ) -> List[Alert]:
        """Get alerts with optional filters"""
        alerts = list(self._alerts.values())
        
        if status:
            alerts = [a for a in alerts if a.status == status]
        if severity:
            alerts = [a for a in alerts if a.severity == severity]
        
        return sorted(alerts, key=lambda a: a.starts_at, reverse=True)
    
    def evaluate_rules(self) -> List[Alert]:
        """Evaluate all alert rules"""
        fired_alerts = []
        
        for rule in self._alert_rules:
            try:
                if rule["condition"]():
                    alert = self.fire_alert(
                        name=rule["name"],
                        severity=rule["severity"],
                        message=rule["message"],
                        source="alert_rule",
                        labels=rule["labels"],
                    )
                    fired_alerts.append(alert)
            except Exception:
                pass
        
        return fired_alerts


class SLOTracker:
    """Tracks Service Level Objectives"""
    
    def __init__(self, metrics_collector: MetricsCollector):
        self.metrics = metrics_collector
        self._slos: Dict[str, SLO] = {}
        self._slis: Dict[str, SLI] = {}
    
    def define_slo(
        self,
        name: str,
        description: str,
        target: float,
        window_days: int,
        metric_name: str,
        metric_query: str,
    ) -> SLO:
        """Define a new SLO"""
        slo = SLO(
            id=str(uuid.uuid4()),
            name=name,
            description=description,
            target=target,
            window_days=window_days,
            metric_name=metric_name,
            metric_query=metric_query,
        )
        self._slos[name] = slo
        return slo
    
    def record_sli(
        self,
        name: str,
        good: bool,
    ) -> None:
        """Record an SLI event"""
        if name not in self._slis:
            self._slis[name] = SLI(
                id=str(uuid.uuid4()),
                name=name,
                description="",
                metric_name=name,
                window_start=datetime.now(timezone.utc),
                window_end=datetime.now(timezone.utc),
            )
        
        sli = self._slis[name]
        sli.total_events += 1
        if good:
            sli.good_events += 1
        sli.value = (sli.good_events / sli.total_events) * 100 if sli.total_events > 0 else 0
        sli.window_end = datetime.now(timezone.utc)
    
    def calculate_slo(self, name: str) -> Optional[SLO]:
        """Calculate current SLO status"""
        if name not in self._slos:
            return None
        
        slo = self._slos[name]
        
        # Get corresponding SLI
        if name in self._slis:
            sli = self._slis[name]
            slo.current_value = sli.value
        
        # Calculate error budget
        # Error budget = (100 - target) - (100 - current_value)
        allowed_errors = 100 - slo.target
        actual_errors = 100 - slo.current_value
        slo.error_budget_remaining = max(0, ((allowed_errors - actual_errors) / allowed_errors) * 100) if allowed_errors > 0 else 100
        
        # Determine status
        if slo.current_value >= slo.target:
            slo.status = "healthy"
        elif slo.error_budget_remaining > 20:
            slo.status = "warning"
        else:
            slo.status = "critical"
        
        slo.last_calculated = datetime.now(timezone.utc)
        return slo
    
    def get_all_slos(self) -> List[SLO]:
        """Get all SLOs with current status"""
        return [self.calculate_slo(name) for name in self._slos.keys()]
    
    def get_sli(self, name: str) -> Optional[SLI]:
        """Get an SLI by name"""
        return self._slis.get(name)


class ObservabilityService:
    """Main observability service combining all components"""
    
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.metrics = MetricsCollector()
        self.logger = StructuredLogger(service_name)
        self.alerts = AlertManager()
        self.slo_tracker = SLOTracker(self.metrics)
        
        # Define default SLOs
        self._setup_default_slos()
        
        # Define default alert rules
        self._setup_default_alerts()
    
    def _setup_default_slos(self):
        """Setup default SLOs"""
        self.slo_tracker.define_slo(
            name="api_availability",
            description="API availability SLO",
            target=99.9,
            window_days=30,
            metric_name="http_requests_total",
            metric_query="sum(rate(http_requests_total{status!~'5..'}[5m])) / sum(rate(http_requests_total[5m]))",
        )
        
        self.slo_tracker.define_slo(
            name="api_latency_p99",
            description="API latency P99 SLO",
            target=99.0,
            window_days=30,
            metric_name="http_request_duration_seconds",
            metric_query="histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) < 0.5",
        )
        
        self.slo_tracker.define_slo(
            name="transaction_success_rate",
            description="Transaction success rate SLO",
            target=99.5,
            window_days=30,
            metric_name="transactions_total",
            metric_query="sum(rate(transactions_total{status='completed'}[5m])) / sum(rate(transactions_total[5m]))",
        )
    
    def _setup_default_alerts(self):
        """Setup default alert rules"""
        # High error rate alert
        def high_error_rate():
            error_count = self.metrics.get_counter("http_errors_total")
            total_count = self.metrics.get_counter("http_requests_total")
            if total_count > 100:
                error_rate = error_count / total_count
                return error_rate > 0.05  # 5% error rate
            return False
        
        self.alerts.add_alert_rule(
            name="HighErrorRate",
            condition=high_error_rate,
            severity=AlertSeverity.ERROR,
            message="Error rate exceeds 5%",
            labels={"service": self.service_name},
        )
    
    def record_request(
        self,
        method: str,
        path: str,
        status_code: int,
        duration_ms: float,
        user_id: str = "",
    ) -> None:
        """Record an HTTP request"""
        labels = {"method": method, "path": path, "status": str(status_code)}
        
        # Increment request counter
        self.metrics.increment_counter("http_requests_total", labels=labels)
        
        # Record duration
        self.metrics.observe_histogram("http_request_duration_ms", duration_ms, labels=labels)
        
        # Track errors
        if status_code >= 500:
            self.metrics.increment_counter("http_errors_total", labels=labels)
        
        # Record SLI
        self.slo_tracker.record_sli("api_availability", status_code < 500)
        self.slo_tracker.record_sli("api_latency_p99", duration_ms < 500)
        
        # Log request
        self.logger.info(
            f"{method} {path} {status_code} {duration_ms:.2f}ms",
            user_id=user_id,
            method=method,
            path=path,
            status_code=status_code,
            duration_ms=duration_ms,
        )
    
    def record_transaction(
        self,
        transaction_id: str,
        status: str,
        amount: float,
        currency: str,
        duration_ms: float,
    ) -> None:
        """Record a transaction"""
        labels = {"status": status, "currency": currency}
        
        self.metrics.increment_counter("transactions_total", labels=labels)
        self.metrics.observe_histogram("transaction_duration_ms", duration_ms, labels=labels)
        
        if status == "completed":
            self.metrics.increment_counter("transaction_amount_total", amount, labels={"currency": currency})
        
        # Record SLI
        self.slo_tracker.record_sli("transaction_success_rate", status == "completed")
        
        self.logger.info(
            f"Transaction {transaction_id}: {status}",
            transaction_id=transaction_id,
            status=status,
            amount=amount,
            currency=currency,
            duration_ms=duration_ms,
        )
    
    def get_dashboard_data(self) -> Dict[str, Any]:
        """Get data for observability dashboard"""
        return {
            "service": self.service_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "metrics": {
                "requests_total": self.metrics.get_counter("http_requests_total"),
                "errors_total": self.metrics.get_counter("http_errors_total"),
                "transactions_total": self.metrics.get_counter("transactions_total"),
                "request_latency": self.metrics.get_histogram_stats("http_request_duration_ms"),
                "transaction_latency": self.metrics.get_histogram_stats("transaction_duration_ms"),
            },
            "slos": [asdict(slo) for slo in self.slo_tracker.get_all_slos()],
            "alerts": {
                "firing": len(self.alerts.get_alerts(status=AlertStatus.FIRING)),
                "acknowledged": len(self.alerts.get_alerts(status=AlertStatus.ACKNOWLEDGED)),
                "recent": [asdict(a) for a in self.alerts.get_alerts()[:10]],
            },
            "logs": {
                "error_count": len(self.logger.get_logs(level=LogLevel.ERROR)),
                "warning_count": len(self.logger.get_logs(level=LogLevel.WARNING)),
            },
        }


# Example usage
if __name__ == "__main__":
    service = ObservabilityService("payment-switch")
    
    # Record some requests
    service.record_request("GET", "/api/transactions", 200, 45.5, "user_001")
    service.record_request("POST", "/api/transfers", 201, 120.3, "user_002")
    service.record_request("GET", "/api/participants", 500, 5000.0, "user_001")
    
    # Record some transactions
    service.record_transaction("txn_001", "completed", 1000.0, "USD", 150.0)
    service.record_transaction("txn_002", "failed", 500.0, "EUR", 200.0)
    
    # Get dashboard data
    dashboard = service.get_dashboard_data()
    print(json.dumps(dashboard, indent=2, default=str))
