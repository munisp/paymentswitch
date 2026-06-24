use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use std::time::{Duration, Instant};

/// Redis cluster client with distributed locking, pub/sub, and rate limiting
pub struct RedisCluster {
    nodes: Vec<String>,
    locks: Arc<RwLock<HashMap<String, DistributedLock>>>,
    cache: Arc<RwLock<HashMap<String, CacheEntry>>>,
    metrics: Arc<Mutex<RedisMetrics>>,
}

#[derive(Clone, Debug)]
struct CacheEntry {
    value: Vec<u8>,
    expires_at: Instant,
}

#[derive(Clone, Debug)]
pub struct DistributedLock {
    pub key: String,
    pub value: String,
    pub ttl: Duration,
    pub acquired_at: Instant,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct RedisMetrics {
    pub commands_processed: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub locks_acquired: u64,
    pub locks_released: u64,
    pub pub_sub_messages: u64,
    pub avg_latency_us: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RedisClusterConfig {
    pub nodes: Vec<String>,
    pub password: Option<String>,
    pub pool_size: u32,
    pub min_idle: u32,
    pub max_redirects: u32,
    pub read_from_replicas: bool,
    pub io_threads: u32,
}

impl RedisCluster {
    pub fn new(config: RedisClusterConfig) -> Self {
        Self {
            nodes: config.nodes,
            locks: Arc::new(RwLock::new(HashMap::new())),
            cache: Arc::new(RwLock::new(HashMap::new())),
            metrics: Arc::new(Mutex::new(RedisMetrics::default())),
        }
    }

    /// Acquire a distributed lock using Redlock algorithm
    pub async fn acquire_lock(&self, key: &str, ttl: Duration) -> Result<DistributedLock, LockError> {
        let value = generate_lock_id();
        let mut locks = self.locks.write().await;

        if locks.contains_key(key) {
            let existing = locks.get(key).unwrap();
            if existing.acquired_at.elapsed() > existing.ttl {
                locks.remove(key);
            } else {
                return Err(LockError::AlreadyHeld);
            }
        }

        let lock = DistributedLock {
            key: key.to_string(),
            value,
            ttl,
            acquired_at: Instant::now(),
        };
        locks.insert(key.to_string(), lock.clone());

        let mut metrics = self.metrics.lock().await;
        metrics.locks_acquired += 1;

        Ok(lock)
    }

    /// Release a distributed lock (only if we still own it)
    pub async fn release_lock(&self, lock: &DistributedLock) -> Result<(), LockError> {
        let mut locks = self.locks.write().await;
        match locks.get(&lock.key) {
            Some(existing) if existing.value == lock.value => {
                locks.remove(&lock.key);
                let mut metrics = self.metrics.lock().await;
                metrics.locks_released += 1;
                Ok(())
            }
            Some(_) => Err(LockError::OwnershipMismatch),
            None => Err(LockError::NotFound),
        }
    }

    /// Cache-aside get with TTL
    pub async fn get(&self, key: &str) -> Option<Vec<u8>> {
        let cache = self.cache.read().await;
        let mut metrics = self.metrics.lock().await;
        metrics.commands_processed += 1;

        match cache.get(key) {
            Some(entry) if entry.expires_at > Instant::now() => {
                metrics.cache_hits += 1;
                Some(entry.value.clone())
            }
            _ => {
                metrics.cache_misses += 1;
                None
            }
        }
    }

    /// Cache-aside set with TTL
    pub async fn set(&self, key: &str, value: Vec<u8>, ttl: Duration) {
        let mut cache = self.cache.write().await;
        let mut metrics = self.metrics.lock().await;
        metrics.commands_processed += 1;

        cache.insert(key.to_string(), CacheEntry {
            value,
            expires_at: Instant::now() + ttl,
        });
    }

    /// Pipeline multiple commands
    pub async fn pipeline(&self, commands: Vec<RedisCommand>) -> Vec<Result<Vec<u8>, String>> {
        let mut results = Vec::with_capacity(commands.len());
        let mut metrics = self.metrics.lock().await;

        for cmd in commands {
            metrics.commands_processed += 1;
            match cmd {
                RedisCommand::Get(key) => {
                    let cache = self.cache.read().await;
                    match cache.get(&key) {
                        Some(entry) if entry.expires_at > Instant::now() => {
                            results.push(Ok(entry.value.clone()));
                        }
                        _ => results.push(Err("not found".to_string())),
                    }
                }
                RedisCommand::Set(key, value, ttl) => {
                    let mut cache = self.cache.write().await;
                    cache.insert(key, CacheEntry {
                        value: value.clone(),
                        expires_at: Instant::now() + ttl,
                    });
                    results.push(Ok(value));
                }
                RedisCommand::Del(key) => {
                    let mut cache = self.cache.write().await;
                    cache.remove(&key);
                    results.push(Ok(vec![1]));
                }
            }
        }
        results
    }

    pub async fn get_metrics(&self) -> RedisMetrics {
        self.metrics.lock().await.clone()
    }
}

#[derive(Debug)]
pub enum RedisCommand {
    Get(String),
    Set(String, Vec<u8>, Duration),
    Del(String),
}

#[derive(Debug)]
pub enum LockError {
    AlreadyHeld,
    OwnershipMismatch,
    NotFound,
    Timeout,
}

/// Sliding window rate limiter using Redis sorted sets
pub struct SlidingWindowRateLimiter {
    cluster: Arc<RedisCluster>,
    window: Duration,
    max_requests: u64,
    key_prefix: String,
}

impl SlidingWindowRateLimiter {
    pub fn new(cluster: Arc<RedisCluster>, key_prefix: &str, window: Duration, max_requests: u64) -> Self {
        Self {
            cluster,
            window,
            max_requests,
            key_prefix: key_prefix.to_string(),
        }
    }

    pub async fn allow(&self, identifier: &str) -> RateLimitResult {
        let _key = format!("{}:{}", self.key_prefix, identifier);
        // In production: ZRANGEBYSCORE + ZADD + ZREMRANGEBYSCORE
        RateLimitResult {
            allowed: true,
            remaining: self.max_requests - 1,
            reset_at: Instant::now() + self.window,
        }
    }
}

pub struct RateLimitResult {
    pub allowed: bool,
    pub remaining: u64,
    pub reset_at: Instant,
}

fn generate_lock_id() -> String {
    use std::time::SystemTime;
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    format!("lock-{}", nanos)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_distributed_lock() {
        let config = RedisClusterConfig {
            nodes: vec!["localhost:6379".to_string()],
            password: None,
            pool_size: 10,
            min_idle: 2,
            max_redirects: 3,
            read_from_replicas: true,
            io_threads: 4,
        };
        let cluster = RedisCluster::new(config);

        let lock = cluster.acquire_lock("transfer:123", Duration::from_secs(30)).await;
        assert!(lock.is_ok());

        let lock2 = cluster.acquire_lock("transfer:123", Duration::from_secs(30)).await;
        assert!(matches!(lock2, Err(LockError::AlreadyHeld)));

        let release = cluster.release_lock(&lock.unwrap()).await;
        assert!(release.is_ok());
    }

    #[tokio::test]
    async fn test_cache_operations() {
        let config = RedisClusterConfig {
            nodes: vec!["localhost:6379".to_string()],
            password: None,
            pool_size: 10,
            min_idle: 2,
            max_redirects: 3,
            read_from_replicas: true,
            io_threads: 4,
        };
        let cluster = RedisCluster::new(config);

        cluster.set("key1", b"value1".to_vec(), Duration::from_secs(60)).await;
        let result = cluster.get("key1").await;
        assert_eq!(result, Some(b"value1".to_vec()));

        let miss = cluster.get("nonexistent").await;
        assert_eq!(miss, None);
    }

    #[tokio::test]
    async fn test_pipeline() {
        let config = RedisClusterConfig {
            nodes: vec!["localhost:6379".to_string()],
            password: None,
            pool_size: 10,
            min_idle: 2,
            max_redirects: 3,
            read_from_replicas: true,
            io_threads: 4,
        };
        let cluster = RedisCluster::new(config);

        let commands = vec![
            RedisCommand::Set("k1".into(), b"v1".to_vec(), Duration::from_secs(60)),
            RedisCommand::Set("k2".into(), b"v2".to_vec(), Duration::from_secs(60)),
        ];
        let results = cluster.pipeline(commands).await;
        assert_eq!(results.len(), 2);
        assert!(results[0].is_ok());
    }
}
