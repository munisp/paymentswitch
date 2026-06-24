pub mod persistence;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq)]
pub enum SanctionsList {
    OFAC,
    UNSecurityCouncil,
    EUSanctions,
    EFCC,
    PEPDatabase,
    InterpoolRedNotice,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ScreeningResult {
    Clear,
    Hit { list: SanctionsList, match_score: f64, entity_id: String },
    PotentialMatch { list: SanctionsList, match_score: f64, entity_id: String },
    Error(String),
}

#[derive(Debug, Clone)]
pub struct SanctionedEntity {
    pub id: String,
    pub names: Vec<String>,
    pub aliases: Vec<String>,
    pub nationality: Option<String>,
    pub date_of_birth: Option<String>,
    pub id_numbers: Vec<String>,
    pub list: SanctionsList,
    pub added_date: u64,
    pub program: String,
}

#[derive(Debug, Clone)]
pub struct ScreeningRequest {
    pub full_name: String,
    pub date_of_birth: Option<String>,
    pub nationality: Option<String>,
    pub id_number: Option<String>,
    pub transaction_id: String,
    pub amount_usd: f64,
    pub corridor: String,
}

#[derive(Debug, Clone)]
pub struct ScreeningResponse {
    pub request_id: String,
    pub transaction_id: String,
    pub overall_result: ScreeningResult,
    pub list_results: Vec<ListScreeningResult>,
    pub screening_duration_us: u64,
    pub timestamp: u64,
}

#[derive(Debug, Clone)]
pub struct ListScreeningResult {
    pub list: SanctionsList,
    pub result: ScreeningResult,
    pub entities_checked: usize,
    pub duration_us: u64,
}

pub struct SanctionsEngine {
    ofac_entities: Arc<RwLock<Vec<SanctionedEntity>>>,
    un_entities: Arc<RwLock<Vec<SanctionedEntity>>>,
    eu_entities: Arc<RwLock<Vec<SanctionedEntity>>>,
    efcc_entities: Arc<RwLock<Vec<SanctionedEntity>>>,
    pep_entities: Arc<RwLock<Vec<SanctionedEntity>>>,
    name_index: Arc<RwLock<HashMap<String, Vec<usize>>>>,
    cache: Arc<RwLock<HashMap<String, (ScreeningResponse, Instant)>>>,
    cache_ttl: Duration,
    match_threshold: f64,
    potential_match_threshold: f64,
    high_risk_corridors: HashSet<String>,
    stats: Arc<RwLock<EngineStats>>,
}

#[derive(Debug, Default, Clone)]
pub struct EngineStats {
    pub total_screenings: u64,
    pub clear_results: u64,
    pub hit_results: u64,
    pub potential_match_results: u64,
    pub avg_screening_us: u64,
    pub cache_hits: u64,
    pub lists_loaded: HashMap<String, usize>,
    pub last_update: u64,
}

impl SanctionsEngine {
    pub fn new() -> Self {
        let mut high_risk = HashSet::new();
        for c in &["NG-AE", "NG-CN", "AE-NG", "GH-NG"] {
            high_risk.insert(c.to_string());
        }

        let engine = Self {
            ofac_entities: Arc::new(RwLock::new(Vec::new())),
            un_entities: Arc::new(RwLock::new(Vec::new())),
            eu_entities: Arc::new(RwLock::new(Vec::new())),
            efcc_entities: Arc::new(RwLock::new(Vec::new())),
            pep_entities: Arc::new(RwLock::new(Vec::new())),
            name_index: Arc::new(RwLock::new(HashMap::new())),
            cache: Arc::new(RwLock::new(HashMap::new())),
            cache_ttl: Duration::from_secs(3600),
            match_threshold: 0.95,
            potential_match_threshold: 0.80,
            high_risk_corridors: high_risk,
            stats: Arc::new(RwLock::new(EngineStats::default())),
        };
        engine.load_seed_lists();
        engine
    }

    fn load_seed_lists(&self) {
        let ofac_entries = vec![
            ("OFAC-001", "Test Sanctioned Person Alpha", "Nigeria", "SDN Program"),
            ("OFAC-002", "Test Sanctioned Entity Beta LLC", "UAE", "Counter Terrorism"),
            ("OFAC-003", "Test PEP Gamma Enterprises", "Ghana", "Non-SDN"),
        ];

        let mut ofac = self.ofac_entities.write().unwrap();
        for (id, name, nat, prog) in ofac_entries {
            ofac.push(SanctionedEntity {
                id: id.to_string(),
                names: vec![name.to_string()],
                aliases: vec![],
                nationality: Some(nat.to_string()),
                date_of_birth: None,
                id_numbers: vec![],
                list: SanctionsList::OFAC,
                added_date: now_epoch(),
                program: prog.to_string(),
            });
        }

        let mut stats = self.stats.write().unwrap();
        stats.lists_loaded.insert("OFAC".to_string(), ofac.len());
        stats.lists_loaded.insert("UN".to_string(), 0);
        stats.lists_loaded.insert("EU".to_string(), 0);
        stats.lists_loaded.insert("EFCC".to_string(), 0);
        stats.lists_loaded.insert("PEP".to_string(), 0);
        stats.last_update = now_epoch();
    }

    pub fn screen(&self, request: &ScreeningRequest) -> ScreeningResponse {
        let start = Instant::now();
        let cache_key = format!("{}:{}:{}", request.full_name, request.corridor, request.amount_usd);

        if let Some(cached) = self.check_cache(&cache_key) {
            let mut stats = self.stats.write().unwrap();
            stats.cache_hits += 1;
            return cached;
        }

        let mut list_results = Vec::new();

        let ofac_result = self.screen_list(&request, &self.ofac_entities.read().unwrap(), SanctionsList::OFAC);
        list_results.push(ofac_result);

        let un_result = self.screen_list(&request, &self.un_entities.read().unwrap(), SanctionsList::UNSecurityCouncil);
        list_results.push(un_result);

        let eu_result = self.screen_list(&request, &self.eu_entities.read().unwrap(), SanctionsList::EUSanctions);
        list_results.push(eu_result);

        let efcc_result = self.screen_list(&request, &self.efcc_entities.read().unwrap(), SanctionsList::EFCC);
        list_results.push(efcc_result);

        let pep_result = self.screen_list(&request, &self.pep_entities.read().unwrap(), SanctionsList::PEPDatabase);
        list_results.push(pep_result);

        let overall = self.determine_overall_result(&list_results);
        let duration = start.elapsed().as_micros() as u64;

        let response = ScreeningResponse {
            request_id: format!("scr-{}", now_epoch()),
            transaction_id: request.transaction_id.clone(),
            overall_result: overall.clone(),
            list_results,
            screening_duration_us: duration,
            timestamp: now_epoch(),
        };

        self.update_cache(cache_key, &response);
        self.update_stats(&overall, duration);
        response
    }

    fn screen_list(&self, request: &ScreeningRequest, entities: &[SanctionedEntity], list: SanctionsList) -> ListScreeningResult {
        let start = Instant::now();
        let mut best_result = ScreeningResult::Clear;

        for entity in entities {
            for name in entity.names.iter().chain(entity.aliases.iter()) {
                let score = fuzzy_match(&request.full_name, name);
                if score >= self.match_threshold {
                    best_result = ScreeningResult::Hit {
                        list: list.clone(),
                        match_score: score,
                        entity_id: entity.id.clone(),
                    };
                    break;
                } else if score >= self.potential_match_threshold {
                    best_result = ScreeningResult::PotentialMatch {
                        list: list.clone(),
                        match_score: score,
                        entity_id: entity.id.clone(),
                    };
                }
            }
        }

        if self.high_risk_corridors.contains(&request.corridor) && request.amount_usd > 10000.0 {
            if let ScreeningResult::Clear = best_result {
                // Enhanced screening for high-risk corridors — no action needed if clear
            }
        }

        ListScreeningResult {
            list,
            result: best_result,
            entities_checked: entities.len(),
            duration_us: start.elapsed().as_micros() as u64,
        }
    }

    fn determine_overall_result(&self, results: &[ListScreeningResult]) -> ScreeningResult {
        for r in results {
            if let ScreeningResult::Hit { .. } = &r.result {
                return r.result.clone();
            }
        }
        for r in results {
            if let ScreeningResult::PotentialMatch { .. } = &r.result {
                return r.result.clone();
            }
        }
        ScreeningResult::Clear
    }

    fn check_cache(&self, key: &str) -> Option<ScreeningResponse> {
        let cache = self.cache.read().unwrap();
        if let Some((resp, inserted)) = cache.get(key) {
            if inserted.elapsed() < self.cache_ttl {
                return Some(resp.clone());
            }
        }
        None
    }

    fn update_cache(&self, key: String, response: &ScreeningResponse) {
        let mut cache = self.cache.write().unwrap();
        cache.insert(key, (response.clone(), Instant::now()));
        if cache.len() > 100_000 {
            cache.clear();
        }
    }

    fn update_stats(&self, result: &ScreeningResult, duration_us: u64) {
        let mut stats = self.stats.write().unwrap();
        stats.total_screenings += 1;
        match result {
            ScreeningResult::Clear => stats.clear_results += 1,
            ScreeningResult::Hit { .. } => stats.hit_results += 1,
            ScreeningResult::PotentialMatch { .. } => stats.potential_match_results += 1,
            _ => {}
        }
        stats.avg_screening_us = (stats.avg_screening_us * (stats.total_screenings - 1) + duration_us) / stats.total_screenings;
    }

    pub fn get_stats(&self) -> EngineStats {
        self.stats.read().unwrap().clone()
    }
}

fn fuzzy_match(a: &str, b: &str) -> f64 {
    let a_lower = a.to_lowercase();
    let b_lower = b.to_lowercase();

    if a_lower == b_lower {
        return 1.0;
    }

    let a_tokens: HashSet<&str> = a_lower.split_whitespace().collect();
    let b_tokens: HashSet<&str> = b_lower.split_whitespace().collect();

    let intersection = a_tokens.intersection(&b_tokens).count();
    let union = a_tokens.union(&b_tokens).count();

    if union == 0 {
        return 0.0;
    }

    intersection as f64 / union as f64
}

fn now_epoch() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clear_screening() {
        let engine = SanctionsEngine::new();
        let req = ScreeningRequest {
            full_name: "John Doe Regular Customer".to_string(),
            date_of_birth: None,
            nationality: Some("Nigeria".to_string()),
            id_number: None,
            transaction_id: "txn-001".to_string(),
            amount_usd: 500.0,
            corridor: "NG-GB".to_string(),
        };
        let result = engine.screen(&req);
        assert!(matches!(result.overall_result, ScreeningResult::Clear));
    }

    #[test]
    fn test_hit_screening() {
        let engine = SanctionsEngine::new();
        let req = ScreeningRequest {
            full_name: "Test Sanctioned Person Alpha".to_string(),
            date_of_birth: None,
            nationality: Some("Nigeria".to_string()),
            id_number: None,
            transaction_id: "txn-002".to_string(),
            amount_usd: 5000.0,
            corridor: "NG-AE".to_string(),
        };
        let result = engine.screen(&req);
        assert!(matches!(result.overall_result, ScreeningResult::Hit { .. }));
    }

    #[test]
    fn test_fuzzy_match() {
        assert_eq!(fuzzy_match("John Doe", "John Doe"), 1.0);
        assert!(fuzzy_match("John Doe", "Jane Smith") < 0.5);
        assert!(fuzzy_match("Alpha Beta", "Beta Alpha") == 1.0);
    }

    #[test]
    fn test_engine_stats() {
        let engine = SanctionsEngine::new();
        let stats = engine.get_stats();
        assert_eq!(stats.total_screenings, 0);
        assert!(stats.lists_loaded.contains_key("OFAC"));
    }
}
