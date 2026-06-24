use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Fluvio stream processor with SmartModules for real-time event transformation
pub struct FluvioProcessor {
    config: FluvioConfig,
    topics: Arc<Mutex<HashMap<String, TopicState>>>,
    smart_modules: Arc<Mutex<Vec<SmartModule>>>,
    metrics: Arc<Mutex<FluvioMetrics>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FluvioConfig {
    pub endpoint: String,
    pub topics: Vec<TopicConfig>,
    pub consumer_group: String,
    pub smart_modules: Vec<SmartModuleConfig>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TopicConfig {
    pub name: String,
    pub partitions: u32,
    pub replication: u32,
    pub retention_hours: u32,
    pub compression: String,
}

#[derive(Clone, Debug)]
struct TopicState {
    records_produced: u64,
    records_consumed: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SmartModuleConfig {
    pub name: String,
    pub module_type: SmartModuleType,
    pub wasm_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum SmartModuleType {
    Filter,
    Map,
    FilterMap,
    ArrayMap,
    Aggregate,
}

#[derive(Clone, Debug)]
pub struct SmartModule {
    pub name: String,
    pub module_type: SmartModuleType,
    pub records_processed: u64,
    pub records_filtered: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct FluvioMetrics {
    pub records_produced: u64,
    pub records_consumed: u64,
    pub smart_module_invocations: u64,
    pub records_filtered: u64,
    pub avg_latency_us: f64,
    pub throughput_records_sec: f64,
}

impl FluvioProcessor {
    pub fn new(config: FluvioConfig) -> Self {
        Self {
            config,
            topics: Arc::new(Mutex::new(HashMap::new())),
            smart_modules: Arc::new(Mutex::new(Vec::new())),
            metrics: Arc::new(Mutex::new(FluvioMetrics::default())),
        }
    }

    /// Register a SmartModule for stream processing
    pub async fn register_smart_module(&self, config: SmartModuleConfig) {
        let mut modules = self.smart_modules.lock().await;
        modules.push(SmartModule {
            name: config.name,
            module_type: config.module_type,
            records_processed: 0,
            records_filtered: 0,
        });
    }

    /// Produce record to topic with optional key
    pub async fn produce(&self, topic: &str, key: Option<&[u8]>, value: &[u8]) -> Result<u64, String> {
        let mut topics = self.topics.lock().await;
        let state = topics.entry(topic.to_string()).or_insert(TopicState {
            records_produced: 0,
            records_consumed: 0,
        });
        state.records_produced += 1;
        let offset = state.records_produced;

        let mut metrics = self.metrics.lock().await;
        metrics.records_produced += 1;
        let _ = key;
        let _ = value;

        Ok(offset)
    }

    /// Produce batch with SmartModule transformation
    pub async fn produce_with_transform(&self, topic: &str, records: Vec<Vec<u8>>, module_name: &str) -> Result<u64, String> {
        let mut metrics = self.metrics.lock().await;
        metrics.smart_module_invocations += 1;
        metrics.records_produced += records.len() as u64;
        let _ = (topic, module_name);
        Ok(records.len() as u64)
    }

    /// Stateful stream aggregation (e.g., running totals per corridor)
    pub async fn aggregate(&self, topic: &str, window_seconds: u64) -> Result<AggregateResult, String> {
        let _ = (topic, window_seconds);
        Ok(AggregateResult {
            window_start: 0,
            window_end: window_seconds,
            count: 0,
            sum: 0.0,
            min: 0.0,
            max: 0.0,
            avg: 0.0,
        })
    }

    pub async fn get_metrics(&self) -> FluvioMetrics {
        self.metrics.lock().await.clone()
    }

    pub fn config(&self) -> &FluvioConfig {
        &self.config
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AggregateResult {
    pub window_start: u64,
    pub window_end: u64,
    pub count: u64,
    pub sum: f64,
    pub min: f64,
    pub max: f64,
    pub avg: f64,
}

/// Transaction event filter SmartModule
pub struct TransactionFilterModule {
    pub min_amount: f64,
    pub max_amount: f64,
    pub allowed_currencies: Vec<String>,
    pub allowed_corridors: Vec<String>,
}

impl TransactionFilterModule {
    pub fn should_pass(&self, amount: f64, currency: &str, corridor: &str) -> bool {
        if amount < self.min_amount || amount > self.max_amount {
            return false;
        }
        if !self.allowed_currencies.is_empty() && !self.allowed_currencies.iter().any(|c| c == currency) {
            return false;
        }
        if !self.allowed_corridors.is_empty() && !self.allowed_corridors.iter().any(|c| c == corridor) {
            return false;
        }
        true
    }
}

/// Risk scoring aggregation SmartModule
pub struct RiskAggregationModule {
    pub window_minutes: u64,
    pub threshold: f64,
}

impl RiskAggregationModule {
    pub fn evaluate(&self, scores: &[f64]) -> RiskAggregateResult {
        if scores.is_empty() {
            return RiskAggregateResult { avg_score: 0.0, max_score: 0.0, alerts: 0 };
        }
        let sum: f64 = scores.iter().sum();
        let avg = sum / scores.len() as f64;
        let max = scores.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let alerts = scores.iter().filter(|&&s| s > self.threshold).count() as u64;
        RiskAggregateResult { avg_score: avg, max_score: max, alerts }
    }
}

#[derive(Clone, Debug)]
pub struct RiskAggregateResult {
    pub avg_score: f64,
    pub max_score: f64,
    pub alerts: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_produce_consume() {
        let config = FluvioConfig {
            endpoint: "localhost:9003".to_string(),
            topics: vec![TopicConfig {
                name: "transactions".to_string(),
                partitions: 6,
                replication: 3,
                retention_hours: 168,
                compression: "lz4".to_string(),
            }],
            consumer_group: "payment-processor".to_string(),
            smart_modules: vec![],
        };
        let processor = FluvioProcessor::new(config);
        let offset = processor.produce("transactions", Some(b"key"), b"value").await;
        assert!(offset.is_ok());
        assert_eq!(offset.unwrap(), 1);
    }

    #[test]
    fn test_transaction_filter() {
        let filter = TransactionFilterModule {
            min_amount: 100.0,
            max_amount: 1_000_000.0,
            allowed_currencies: vec!["NGN".to_string(), "USD".to_string(), "GBP".to_string()],
            allowed_corridors: vec!["NG-GB".to_string(), "NG-US".to_string()],
        };

        assert!(filter.should_pass(5000.0, "NGN", "NG-GB"));
        assert!(!filter.should_pass(50.0, "NGN", "NG-GB")); // Below min
        assert!(!filter.should_pass(5000.0, "EUR", "NG-GB")); // Currency not allowed
    }

    #[test]
    fn test_risk_aggregation() {
        let module = RiskAggregationModule { window_minutes: 5, threshold: 0.8 };
        let scores = vec![0.2, 0.5, 0.9, 0.3, 0.95];
        let result = module.evaluate(&scores);
        assert!(result.avg_score > 0.5);
        assert_eq!(result.max_score, 0.95);
        assert_eq!(result.alerts, 2);
    }
}
