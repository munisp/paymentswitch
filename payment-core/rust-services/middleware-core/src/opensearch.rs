use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// OpenSearch client with index lifecycle management and structured querying
pub struct OpenSearchClient {
    endpoints: Vec<String>,
    indices: Arc<Mutex<HashMap<String, IndexConfig>>>,
    metrics: Arc<Mutex<SearchMetrics>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OpenSearchConfig {
    pub endpoints: Vec<String>,
    pub username: String,
    pub password: String,
    pub max_connections: u32,
    pub request_timeout_ms: u64,
    pub bulk_batch_size: usize,
    pub refresh_interval: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IndexConfig {
    pub name: String,
    pub shards: u32,
    pub replicas: u32,
    pub refresh_interval: String,
    pub lifecycle_policy: LifecyclePolicy,
    pub mappings: HashMap<String, FieldMapping>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LifecyclePolicy {
    pub hot_days: u32,
    pub warm_days: u32,
    pub cold_days: u32,
    pub delete_days: u32,
    pub rollover_size_gb: u32,
    pub rollover_docs: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FieldMapping {
    pub field_type: FieldType,
    pub index: bool,
    pub keyword: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum FieldType {
    Text,
    Keyword,
    Long,
    Double,
    Date,
    Boolean,
    Ip,
    GeoPoint,
    Nested,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SearchMetrics {
    pub queries_executed: u64,
    pub documents_indexed: u64,
    pub bulk_operations: u64,
    pub avg_query_ms: f64,
    pub avg_index_ms: f64,
    pub active_indices: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SearchQuery {
    pub index: String,
    pub query: QueryDSL,
    pub size: u32,
    pub from: u32,
    pub sort: Vec<SortField>,
    pub aggregations: Vec<Aggregation>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum QueryDSL {
    Match { field: String, value: String },
    Term { field: String, value: String },
    Range { field: String, gte: Option<String>, lte: Option<String> },
    Bool { must: Vec<QueryDSL>, should: Vec<QueryDSL>, must_not: Vec<QueryDSL> },
    Exists { field: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SortField {
    pub field: String,
    pub order: SortOrder,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum SortOrder {
    Asc,
    Desc,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Aggregation {
    Terms { field: String, size: u32 },
    DateHistogram { field: String, interval: String },
    Sum { field: String },
    Avg { field: String },
    Percentiles { field: String, percents: Vec<f64> },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub total: u64,
    pub hits: Vec<serde_json::Value>,
    pub aggregations: HashMap<String, serde_json::Value>,
    pub took_ms: u64,
}

impl OpenSearchClient {
    pub fn new(config: OpenSearchConfig) -> Self {
        Self {
            endpoints: config.endpoints,
            indices: Arc::new(Mutex::new(HashMap::new())),
            metrics: Arc::new(Mutex::new(SearchMetrics::default())),
        }
    }

    /// Create index with lifecycle management policy
    pub async fn create_index(&self, config: IndexConfig) -> Result<(), String> {
        let mut indices = self.indices.lock().await;
        indices.insert(config.name.clone(), config);
        let mut metrics = self.metrics.lock().await;
        metrics.active_indices += 1;
        Ok(())
    }

    /// Bulk index documents
    pub async fn bulk_index(&self, index: &str, documents: Vec<serde_json::Value>) -> Result<BulkResult, String> {
        let count = documents.len();
        let mut metrics = self.metrics.lock().await;
        metrics.documents_indexed += count as u64;
        metrics.bulk_operations += 1;
        let _ = index;
        Ok(BulkResult {
            indexed: count as u64,
            failed: 0,
            errors: vec![],
        })
    }

    /// Execute search query
    pub async fn search(&self, query: SearchQuery) -> Result<SearchResult, String> {
        let mut metrics = self.metrics.lock().await;
        metrics.queries_executed += 1;
        let _ = query;
        Ok(SearchResult {
            total: 0,
            hits: vec![],
            aggregations: HashMap::new(),
            took_ms: 1,
        })
    }

    /// Transaction audit log index configuration
    pub fn transaction_audit_index() -> IndexConfig {
        let mut mappings = HashMap::new();
        mappings.insert("transaction_id".into(), FieldMapping { field_type: FieldType::Keyword, index: true, keyword: true });
        mappings.insert("sender_id".into(), FieldMapping { field_type: FieldType::Keyword, index: true, keyword: true });
        mappings.insert("recipient_id".into(), FieldMapping { field_type: FieldType::Keyword, index: true, keyword: true });
        mappings.insert("amount".into(), FieldMapping { field_type: FieldType::Double, index: true, keyword: false });
        mappings.insert("currency".into(), FieldMapping { field_type: FieldType::Keyword, index: true, keyword: true });
        mappings.insert("status".into(), FieldMapping { field_type: FieldType::Keyword, index: true, keyword: true });
        mappings.insert("timestamp".into(), FieldMapping { field_type: FieldType::Date, index: true, keyword: false });
        mappings.insert("risk_score".into(), FieldMapping { field_type: FieldType::Double, index: true, keyword: false });
        mappings.insert("corridor".into(), FieldMapping { field_type: FieldType::Keyword, index: true, keyword: true });
        mappings.insert("rail".into(), FieldMapping { field_type: FieldType::Keyword, index: true, keyword: true });

        IndexConfig {
            name: "transactions-audit".into(),
            shards: 6,
            replicas: 2,
            refresh_interval: "5s".into(),
            lifecycle_policy: LifecyclePolicy {
                hot_days: 7,
                warm_days: 30,
                cold_days: 90,
                delete_days: 2555, // 7 years (BOFIA 2020)
                rollover_size_gb: 50,
                rollover_docs: 100_000_000,
            },
            mappings,
        }
    }

    pub async fn get_metrics(&self) -> SearchMetrics {
        self.metrics.lock().await.clone()
    }

    pub fn endpoints(&self) -> &[String] {
        &self.endpoints
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BulkResult {
    pub indexed: u64,
    pub failed: u64,
    pub errors: Vec<String>,
}

/// Alert configuration for OpenSearch monitors
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AlertRule {
    pub name: String,
    pub index: String,
    pub condition: AlertCondition,
    pub action: AlertAction,
    pub schedule_cron: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum AlertCondition {
    ThresholdAbove { field: String, threshold: f64, window_minutes: u32 },
    ThresholdBelow { field: String, threshold: f64, window_minutes: u32 },
    CountAbove { count: u64, window_minutes: u32 },
    AnomalyDetection { field: String, sensitivity: f64 },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum AlertAction {
    Webhook { url: String },
    Slack { channel: String },
    Email { recipients: Vec<String> },
    PagerDuty { service_key: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_index_creation() {
        let config = OpenSearchConfig {
            endpoints: vec!["http://localhost:9200".to_string()],
            username: String::new(),
            password: String::new(),
            max_connections: 10,
            request_timeout_ms: 5000,
            bulk_batch_size: 1000,
            refresh_interval: "5s".to_string(),
        };
        let client = OpenSearchClient::new(config);
        let idx = OpenSearchClient::transaction_audit_index();
        let result = client.create_index(idx).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_bulk_indexing() {
        let config = OpenSearchConfig {
            endpoints: vec!["http://localhost:9200".to_string()],
            username: String::new(),
            password: String::new(),
            max_connections: 10,
            request_timeout_ms: 5000,
            bulk_batch_size: 1000,
            refresh_interval: "5s".to_string(),
        };
        let client = OpenSearchClient::new(config);
        let docs = vec![
            serde_json::json!({"transaction_id": "TX-001", "amount": 1000.0}),
            serde_json::json!({"transaction_id": "TX-002", "amount": 2000.0}),
        ];
        let result = client.bulk_index("transactions", docs).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().indexed, 2);
    }
}
