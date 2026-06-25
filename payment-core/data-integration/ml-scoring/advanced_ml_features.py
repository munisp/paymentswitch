"""
Advanced ML Features for Fraud Detection
Priority 5: Feature Store, Model Calibration, Explainability, Graph Features
"""

import hashlib
import json
import logging
import math
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
import statistics

logger = logging.getLogger(__name__)


# =============================================================================
# Priority 5.1: Feature Store Integration
# =============================================================================

class FeatureStore:
    """Production feature store with online/offline consistency"""
    
    def __init__(self, db_connection=None, cache_ttl_seconds: int = 300):
        self.db = db_connection
        self.cache_ttl = cache_ttl_seconds
        self._online_cache: Dict[str, CachedFeature] = {}
        self._feature_definitions: Dict[str, FeatureDefinition] = {}
        self._lock = threading.RLock()
        self._initialize_features()
    
    def _initialize_features(self) -> None:
        """Initialize feature definitions"""
        # Transaction features
        self._register_feature(FeatureDefinition(
            name="velocity_1h",
            description="Transaction count in last 1 hour",
            data_type="int",
            source="transactions",
            aggregation="count",
            window_seconds=3600,
            default_value=0
        ))
        
        self._register_feature(FeatureDefinition(
            name="velocity_24h",
            description="Transaction count in last 24 hours",
            data_type="int",
            source="transactions",
            aggregation="count",
            window_seconds=86400,
            default_value=0
        ))
        
        self._register_feature(FeatureDefinition(
            name="amount_sum_24h",
            description="Total amount in last 24 hours",
            data_type="float",
            source="transactions",
            aggregation="sum",
            window_seconds=86400,
            default_value=0.0
        ))
        
        self._register_feature(FeatureDefinition(
            name="amount_avg_30d",
            description="Average transaction amount in last 30 days",
            data_type="float",
            source="transactions",
            aggregation="avg",
            window_seconds=2592000,
            default_value=0.0
        ))
        
        self._register_feature(FeatureDefinition(
            name="unique_recipients_24h",
            description="Unique recipients in last 24 hours",
            data_type="int",
            source="transactions",
            aggregation="count_distinct",
            window_seconds=86400,
            default_value=0
        ))
        
        # Account features
        self._register_feature(FeatureDefinition(
            name="account_age_days",
            description="Account age in days",
            data_type="int",
            source="accounts",
            aggregation="computed",
            default_value=0
        ))
        
        self._register_feature(FeatureDefinition(
            name="device_age_days",
            description="Device registration age in days",
            data_type="int",
            source="devices",
            aggregation="computed",
            default_value=0
        ))
        
        # Risk features
        self._register_feature(FeatureDefinition(
            name="merchant_risk_score",
            description="Merchant risk score",
            data_type="float",
            source="merchants",
            aggregation="lookup",
            default_value=0.5
        ))
        
        self._register_feature(FeatureDefinition(
            name="country_risk_score",
            description="Country risk score",
            data_type="float",
            source="countries",
            aggregation="lookup",
            default_value=0.5
        ))
    
    def _register_feature(self, definition: 'FeatureDefinition') -> None:
        """Register a feature definition"""
        self._feature_definitions[definition.name] = definition
    
    def get_features(self, entity_id: str, feature_names: List[str]) -> Dict[str, Any]:
        """Get features for an entity (online serving)"""
        with self._lock:
            result = {}
            missing_features = []
            
            # Check cache first
            for name in feature_names:
                cache_key = f"{entity_id}:{name}"
                if cache_key in self._online_cache:
                    cached = self._online_cache[cache_key]
                    if not cached.is_expired():
                        result[name] = cached.value
                        continue
                missing_features.append(name)
            
            # Fetch missing features
            if missing_features:
                fetched = self._fetch_features(entity_id, missing_features)
                for name, value in fetched.items():
                    result[name] = value
                    cache_key = f"{entity_id}:{name}"
                    self._online_cache[cache_key] = CachedFeature(
                        value=value,
                        expires_at=datetime.utcnow() + timedelta(seconds=self.cache_ttl)
                    )
            
            # Fill defaults for any still missing
            for name in feature_names:
                if name not in result:
                    definition = self._feature_definitions.get(name)
                    result[name] = definition.default_value if definition else None
            
            return result
    
    def _fetch_features(self, entity_id: str, feature_names: List[str]) -> Dict[str, Any]:
        """Fetch features from storage"""
        # In production, this would query the feature store database
        # For now, return computed/default values
        result = {}
        for name in feature_names:
            definition = self._feature_definitions.get(name)
            if definition:
                result[name] = definition.default_value
        return result
    
    def write_features(self, entity_id: str, features: Dict[str, Any], timestamp: datetime = None) -> None:
        """Write features to the store (offline/batch)"""
        if timestamp is None:
            timestamp = datetime.utcnow()
        
        with self._lock:
            for name, value in features.items():
                cache_key = f"{entity_id}:{name}"
                self._online_cache[cache_key] = CachedFeature(
                    value=value,
                    expires_at=timestamp + timedelta(seconds=self.cache_ttl)
                )
        
        # In production, also persist to database
        if self.db:
            self._persist_features(entity_id, features, timestamp)
    
    def _persist_features(self, entity_id: str, features: Dict[str, Any], timestamp: datetime) -> None:
        """Persist features to database"""
        if not self.db:
            return
        try:
            self.db.execute(
                """INSERT INTO feature_store (entity_id, features, computed_at)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (entity_id) DO UPDATE SET features = EXCLUDED.features, computed_at = EXCLUDED.computed_at""",
                (entity_id, json.dumps(features, default=str), timestamp)
            )
        except Exception as e:
            logger.warning(f"Failed to persist features for {entity_id}: {e}")
    
    def get_feature_metadata(self, feature_name: str) -> Optional['FeatureDefinition']:
        """Get feature metadata"""
        return self._feature_definitions.get(feature_name)
    
    def list_features(self) -> List[str]:
        """List all available features"""
        return list(self._feature_definitions.keys())
    
    def compute_feature_stats(self, feature_name: str) -> Dict[str, float]:
        """Compute statistics for a feature"""
        values = []
        with self._lock:
            for key, cached in self._online_cache.items():
                if key.endswith(f":{feature_name}") and not cached.is_expired():
                    if isinstance(cached.value, (int, float)):
                        values.append(cached.value)
        
        if not values:
            return {}
        
        return {
            "count": len(values),
            "mean": statistics.mean(values),
            "std": statistics.stdev(values) if len(values) > 1 else 0,
            "min": min(values),
            "max": max(values),
            "median": statistics.median(values)
        }


@dataclass
class FeatureDefinition:
    """Feature definition"""
    name: str
    description: str
    data_type: str  # int, float, string, bool
    source: str
    aggregation: str  # count, sum, avg, max, min, count_distinct, lookup, computed
    window_seconds: int = 0
    default_value: Any = None
    version: int = 1


@dataclass
class CachedFeature:
    """Cached feature value"""
    value: Any
    expires_at: datetime
    
    def is_expired(self) -> bool:
        return datetime.utcnow() > self.expires_at


# =============================================================================
# Priority 5.2: Model Calibration
# =============================================================================

class ModelCalibrator:
    """Calibrates model scores to true probabilities"""
    
    def __init__(self, method: str = "isotonic"):
        self.method = method  # isotonic, platt, histogram
        self._calibration_map: List[Tuple[float, float]] = []
        self._histogram_bins: List[float] = []
        self._histogram_probs: List[float] = []
        self._platt_a: float = 1.0
        self._platt_b: float = 0.0
        self._lock = threading.RLock()
        self._is_fitted = False
    
    def fit(self, scores: List[float], labels: List[int]) -> None:
        """Fit calibration model"""
        if len(scores) != len(labels) or len(scores) < 10:
            raise ValueError("Need at least 10 score-label pairs")
        
        with self._lock:
            if self.method == "isotonic":
                self._fit_isotonic(scores, labels)
            elif self.method == "platt":
                self._fit_platt(scores, labels)
            elif self.method == "histogram":
                self._fit_histogram(scores, labels)
            
            self._is_fitted = True
    
    def _fit_isotonic(self, scores: List[float], labels: List[int]) -> None:
        """Fit isotonic regression calibration"""
        # Sort by score
        pairs = sorted(zip(scores, labels), key=lambda x: x[0])
        
        # Pool Adjacent Violators Algorithm (PAVA)
        n = len(pairs)
        calibrated = [float(label) for _, label in pairs]
        weights = [1.0] * n
        
        # Forward pass
        i = 0
        while i < n - 1:
            if calibrated[i] > calibrated[i + 1]:
                # Pool
                total = calibrated[i] * weights[i] + calibrated[i + 1] * weights[i + 1]
                total_weight = weights[i] + weights[i + 1]
                calibrated[i] = total / total_weight
                weights[i] = total_weight
                calibrated.pop(i + 1)
                weights.pop(i + 1)
                n -= 1
                if i > 0:
                    i -= 1
            else:
                i += 1
        
        # Build calibration map
        self._calibration_map = []
        idx = 0
        for i, (score, _) in enumerate(pairs):
            while idx < len(calibrated) - 1 and i >= sum(int(w) for w in weights[:idx + 1]):
                idx += 1
            self._calibration_map.append((score, calibrated[idx]))
    
    def _fit_platt(self, scores: List[float], labels: List[int]) -> None:
        """Fit Platt scaling calibration"""
        # Logistic regression: P(y=1|s) = 1 / (1 + exp(A*s + B))
        # Use gradient descent to find A and B
        
        a, b = 0.0, 0.0
        learning_rate = 0.1
        
        for _ in range(1000):
            grad_a, grad_b = 0.0, 0.0
            
            for score, label in zip(scores, labels):
                p = 1.0 / (1.0 + math.exp(-(a * score + b)))
                error = p - label
                grad_a += error * score
                grad_b += error
            
            a -= learning_rate * grad_a / len(scores)
            b -= learning_rate * grad_b / len(scores)
        
        self._platt_a = a
        self._platt_b = b
    
    def _fit_histogram(self, scores: List[float], labels: List[int]) -> None:
        """Fit histogram binning calibration"""
        num_bins = 10
        
        # Create bins
        min_score = min(scores)
        max_score = max(scores)
        bin_width = (max_score - min_score) / num_bins
        
        self._histogram_bins = [min_score + i * bin_width for i in range(num_bins + 1)]
        
        # Calculate probability per bin
        bin_counts = [0] * num_bins
        bin_positives = [0] * num_bins
        
        for score, label in zip(scores, labels):
            bin_idx = min(int((score - min_score) / bin_width), num_bins - 1)
            bin_counts[bin_idx] += 1
            bin_positives[bin_idx] += label
        
        self._histogram_probs = [
            bin_positives[i] / max(bin_counts[i], 1)
            for i in range(num_bins)
        ]
    
    def calibrate(self, score: float) -> float:
        """Calibrate a single score"""
        if not self._is_fitted:
            return score
        
        with self._lock:
            if self.method == "isotonic":
                return self._calibrate_isotonic(score)
            elif self.method == "platt":
                return self._calibrate_platt(score)
            elif self.method == "histogram":
                return self._calibrate_histogram(score)
        
        return score
    
    def _calibrate_isotonic(self, score: float) -> float:
        """Calibrate using isotonic regression"""
        if not self._calibration_map:
            return score
        
        # Binary search for closest score
        left, right = 0, len(self._calibration_map) - 1
        
        while left < right:
            mid = (left + right) // 2
            if self._calibration_map[mid][0] < score:
                left = mid + 1
            else:
                right = mid
        
        # Interpolate
        if left == 0:
            return self._calibration_map[0][1]
        if left >= len(self._calibration_map):
            return self._calibration_map[-1][1]
        
        s1, p1 = self._calibration_map[left - 1]
        s2, p2 = self._calibration_map[left]
        
        if s2 == s1:
            return p1
        
        return p1 + (p2 - p1) * (score - s1) / (s2 - s1)
    
    def _calibrate_platt(self, score: float) -> float:
        """Calibrate using Platt scaling"""
        return 1.0 / (1.0 + math.exp(-(self._platt_a * score + self._platt_b)))
    
    def _calibrate_histogram(self, score: float) -> float:
        """Calibrate using histogram binning"""
        if not self._histogram_bins or not self._histogram_probs:
            return score
        
        min_score = self._histogram_bins[0]
        max_score = self._histogram_bins[-1]
        bin_width = (max_score - min_score) / len(self._histogram_probs)
        
        bin_idx = min(int((score - min_score) / bin_width), len(self._histogram_probs) - 1)
        bin_idx = max(0, bin_idx)
        
        return self._histogram_probs[bin_idx]
    
    def get_calibration_metrics(self, scores: List[float], labels: List[int]) -> Dict[str, float]:
        """Calculate calibration metrics"""
        if not scores or not labels:
            return {}
        
        calibrated = [self.calibrate(s) for s in scores]
        
        # Expected Calibration Error (ECE)
        num_bins = 10
        bin_counts = [0] * num_bins
        bin_correct = [0] * num_bins
        bin_confidence = [0.0] * num_bins
        
        for prob, label in zip(calibrated, labels):
            bin_idx = min(int(prob * num_bins), num_bins - 1)
            bin_counts[bin_idx] += 1
            bin_correct[bin_idx] += label
            bin_confidence[bin_idx] += prob
        
        ece = 0.0
        for i in range(num_bins):
            if bin_counts[i] > 0:
                accuracy = bin_correct[i] / bin_counts[i]
                confidence = bin_confidence[i] / bin_counts[i]
                ece += abs(accuracy - confidence) * bin_counts[i] / len(labels)
        
        # Brier score
        brier = sum((p - l) ** 2 for p, l in zip(calibrated, labels)) / len(labels)
        
        return {
            "ece": ece,
            "brier_score": brier,
            "mean_calibrated_prob": statistics.mean(calibrated),
            "actual_positive_rate": sum(labels) / len(labels)
        }


# =============================================================================
# Priority 5.3: Explainability Outputs
# =============================================================================

@dataclass
class FeatureContribution:
    """Feature contribution to prediction"""
    feature_name: str
    feature_value: Any
    contribution: float
    direction: str  # POSITIVE, NEGATIVE
    importance_rank: int


@dataclass
class ExplainabilityOutput:
    """Explainability output for a prediction"""
    prediction_id: str
    score: float
    decision: str
    top_features: List[FeatureContribution]
    rules_triggered: List[str]
    risk_factors: List[str]
    explanation_text: str
    confidence: float
    generated_at: datetime


class ModelExplainer:
    """Provides explainability for fraud model predictions"""
    
    def __init__(self, feature_importance: Dict[str, float] = None):
        self.feature_importance = feature_importance or {}
        self._baseline_values: Dict[str, float] = {}
        self._lock = threading.RLock()
    
    def set_baseline(self, baseline_features: Dict[str, float]) -> None:
        """Set baseline feature values for comparison"""
        with self._lock:
            self._baseline_values = baseline_features.copy()
    
    def set_feature_importance(self, importance: Dict[str, float]) -> None:
        """Set global feature importance"""
        with self._lock:
            self.feature_importance = importance.copy()
    
    def explain(self, features: Dict[str, Any], score: float, decision: str,
                rules_triggered: List[str] = None) -> ExplainabilityOutput:
        """Generate explainability output for a prediction"""
        with self._lock:
            # Calculate feature contributions
            contributions = self._calculate_contributions(features)
            
            # Sort by absolute contribution
            contributions.sort(key=lambda x: abs(x.contribution), reverse=True)
            
            # Assign ranks
            for i, contrib in enumerate(contributions):
                contrib.importance_rank = i + 1
            
            # Get top features
            top_features = contributions[:5]
            
            # Identify risk factors
            risk_factors = self._identify_risk_factors(features, contributions)
            
            # Generate explanation text
            explanation = self._generate_explanation(score, decision, top_features, risk_factors)
            
            return ExplainabilityOutput(
                prediction_id=f"exp_{int(time.time() * 1000000)}",
                score=score,
                decision=decision,
                top_features=top_features,
                rules_triggered=rules_triggered or [],
                risk_factors=risk_factors,
                explanation_text=explanation,
                confidence=self._calculate_confidence(contributions),
                generated_at=datetime.utcnow()
            )
    
    def _calculate_contributions(self, features: Dict[str, Any]) -> List[FeatureContribution]:
        """Calculate feature contributions using SHAP-like approach"""
        contributions = []
        
        for name, value in features.items():
            if not isinstance(value, (int, float)):
                continue
            
            # Get baseline
            baseline = self._baseline_values.get(name, 0)
            
            # Get importance weight
            importance = self.feature_importance.get(name, 0.1)
            
            # Calculate contribution
            diff = value - baseline
            contribution = diff * importance
            
            contributions.append(FeatureContribution(
                feature_name=name,
                feature_value=value,
                contribution=contribution,
                direction="POSITIVE" if contribution > 0 else "NEGATIVE",
                importance_rank=0
            ))
        
        return contributions
    
    def _identify_risk_factors(self, features: Dict[str, Any],
                               contributions: List[FeatureContribution]) -> List[str]:
        """Identify risk factors from features"""
        risk_factors = []
        
        # Check specific risk patterns
        if features.get("velocity_1h", 0) > 10:
            risk_factors.append("High transaction velocity (>10/hour)")
        
        if features.get("velocity_24h", 0) > 50:
            risk_factors.append("Very high daily transaction count (>50)")
        
        if features.get("amount", 0) > 10000:
            risk_factors.append("Large transaction amount")
        
        if features.get("device_age_days", 365) < 7:
            risk_factors.append("New device (less than 7 days)")
        
        if features.get("account_age_days", 365) < 30:
            risk_factors.append("New account (less than 30 days)")
        
        hour = features.get("hour_of_day", 12)
        if hour < 6 or hour > 22:
            risk_factors.append("Unusual transaction time")
        
        if features.get("unique_recipients_24h", 0) > 20:
            risk_factors.append("Many unique recipients")
        
        # Add top positive contributors
        for contrib in contributions[:3]:
            if contrib.contribution > 0.1:
                risk_factors.append(f"High {contrib.feature_name}: {contrib.feature_value}")
        
        return risk_factors
    
    def _generate_explanation(self, score: float, decision: str,
                             top_features: List[FeatureContribution],
                             risk_factors: List[str]) -> str:
        """Generate human-readable explanation"""
        parts = []
        
        # Decision summary
        if decision == "BLOCK":
            parts.append(f"Transaction blocked with high risk score ({score:.2f}).")
        elif decision == "REVIEW":
            parts.append(f"Transaction flagged for review with moderate risk score ({score:.2f}).")
        else:
            parts.append(f"Transaction allowed with low risk score ({score:.2f}).")
        
        # Top contributing factors
        if top_features:
            positive = [f for f in top_features if f.direction == "POSITIVE"]
            if positive:
                factors = ", ".join([f.feature_name for f in positive[:3]])
                parts.append(f"Main risk factors: {factors}.")
        
        # Risk factors
        if risk_factors:
            parts.append(f"Identified risks: {'; '.join(risk_factors[:3])}.")
        
        return " ".join(parts)
    
    def _calculate_confidence(self, contributions: List[FeatureContribution]) -> float:
        """Calculate confidence in the explanation"""
        if not contributions:
            return 0.5
        
        # Higher confidence if contributions are concentrated
        total = sum(abs(c.contribution) for c in contributions)
        if total == 0:
            return 0.5
        
        top_3 = sum(abs(c.contribution) for c in contributions[:3])
        concentration = top_3 / total
        
        return min(0.95, 0.5 + concentration * 0.45)


# =============================================================================
# Priority 5.4: Graph-Based Features (Community Detection)
# =============================================================================

class GraphFeatureExtractor:
    """Extracts graph-based features including community detection"""
    
    def __init__(self):
        self._nodes: Dict[str, GraphNode] = {}
        self._edges: Dict[str, List[GraphEdge]] = defaultdict(list)
        self._communities: Dict[str, int] = {}
        self._lock = threading.RLock()
    
    def add_node(self, node_id: str, node_type: str, attributes: Dict[str, Any] = None) -> None:
        """Add a node to the graph"""
        with self._lock:
            self._nodes[node_id] = GraphNode(
                node_id=node_id,
                node_type=node_type,
                attributes=attributes or {}
            )
    
    def add_edge(self, source_id: str, target_id: str, edge_type: str,
                 weight: float = 1.0, attributes: Dict[str, Any] = None) -> None:
        """Add an edge to the graph"""
        with self._lock:
            edge = GraphEdge(
                source_id=source_id,
                target_id=target_id,
                edge_type=edge_type,
                weight=weight,
                attributes=attributes or {},
                created_at=datetime.utcnow()
            )
            self._edges[source_id].append(edge)
            self._edges[target_id].append(edge)
    
    def extract_features(self, node_id: str) -> Dict[str, float]:
        """Extract graph features for a node"""
        with self._lock:
            features = {}
            
            # Degree features
            edges = self._edges.get(node_id, [])
            features["degree"] = len(edges)
            features["in_degree"] = sum(1 for e in edges if e.target_id == node_id)
            features["out_degree"] = sum(1 for e in edges if e.source_id == node_id)
            
            # Weighted degree
            features["weighted_degree"] = sum(e.weight for e in edges)
            
            # Neighbor features
            neighbors = self._get_neighbors(node_id)
            features["unique_neighbors"] = len(neighbors)
            
            # 2-hop neighbors
            two_hop = set()
            for neighbor in neighbors:
                two_hop.update(self._get_neighbors(neighbor))
            two_hop.discard(node_id)
            features["two_hop_neighbors"] = len(two_hop)
            
            # Clustering coefficient
            features["clustering_coefficient"] = self._calculate_clustering(node_id, neighbors)
            
            # Community features
            community = self._communities.get(node_id, -1)
            features["community_id"] = community
            features["community_size"] = self._get_community_size(community)
            
            # Centrality approximation
            features["degree_centrality"] = features["degree"] / max(len(self._nodes) - 1, 1)
            
            # Edge type distribution
            edge_types = defaultdict(int)
            for edge in edges:
                edge_types[edge.edge_type] += 1
            
            features["transfer_edges"] = edge_types.get("TRANSFER", 0)
            features["shared_device_edges"] = edge_types.get("SHARED_DEVICE", 0)
            features["shared_ip_edges"] = edge_types.get("SHARED_IP", 0)
            
            return features
    
    def _get_neighbors(self, node_id: str) -> Set[str]:
        """Get neighbors of a node"""
        neighbors = set()
        for edge in self._edges.get(node_id, []):
            if edge.source_id == node_id:
                neighbors.add(edge.target_id)
            else:
                neighbors.add(edge.source_id)
        return neighbors
    
    def _calculate_clustering(self, node_id: str, neighbors: Set[str]) -> float:
        """Calculate local clustering coefficient"""
        if len(neighbors) < 2:
            return 0.0
        
        # Count edges between neighbors
        neighbor_edges = 0
        neighbor_list = list(neighbors)
        
        for i, n1 in enumerate(neighbor_list):
            for n2 in neighbor_list[i + 1:]:
                for edge in self._edges.get(n1, []):
                    if edge.target_id == n2 or edge.source_id == n2:
                        neighbor_edges += 1
                        break
        
        max_edges = len(neighbors) * (len(neighbors) - 1) / 2
        return neighbor_edges / max_edges if max_edges > 0 else 0.0
    
    def _get_community_size(self, community_id: int) -> int:
        """Get size of a community"""
        if community_id < 0:
            return 0
        return sum(1 for c in self._communities.values() if c == community_id)
    
    def detect_communities(self, algorithm: str = "louvain") -> Dict[str, int]:
        """Detect communities in the graph"""
        with self._lock:
            if algorithm == "louvain":
                self._communities = self._louvain_communities()
            elif algorithm == "label_propagation":
                self._communities = self._label_propagation()
            else:
                self._communities = self._louvain_communities()
            
            return self._communities.copy()
    
    def _louvain_communities(self) -> Dict[str, int]:
        """Simplified Louvain community detection"""
        # Initialize each node in its own community
        communities = {node_id: i for i, node_id in enumerate(self._nodes.keys())}
        
        # Iterate until no improvement
        improved = True
        iteration = 0
        max_iterations = 100
        
        while improved and iteration < max_iterations:
            improved = False
            iteration += 1
            
            for node_id in self._nodes.keys():
                current_community = communities[node_id]
                
                # Find best community
                neighbor_communities = defaultdict(float)
                for edge in self._edges.get(node_id, []):
                    neighbor = edge.target_id if edge.source_id == node_id else edge.source_id
                    neighbor_community = communities.get(neighbor, -1)
                    if neighbor_community >= 0:
                        neighbor_communities[neighbor_community] += edge.weight
                
                # Find community with highest weight
                best_community = current_community
                best_weight = neighbor_communities.get(current_community, 0)
                
                for community, weight in neighbor_communities.items():
                    if weight > best_weight:
                        best_weight = weight
                        best_community = community
                
                if best_community != current_community:
                    communities[node_id] = best_community
                    improved = True
        
        # Renumber communities
        unique_communities = sorted(set(communities.values()))
        community_map = {old: new for new, old in enumerate(unique_communities)}
        
        return {node_id: community_map[c] for node_id, c in communities.items()}
    
    def _label_propagation(self) -> Dict[str, int]:
        """Label propagation community detection"""
        # Initialize labels
        labels = {node_id: i for i, node_id in enumerate(self._nodes.keys())}
        
        # Iterate
        for _ in range(100):
            changed = False
            
            for node_id in self._nodes.keys():
                # Count neighbor labels
                label_counts = defaultdict(int)
                for edge in self._edges.get(node_id, []):
                    neighbor = edge.target_id if edge.source_id == node_id else edge.source_id
                    label_counts[labels.get(neighbor, -1)] += 1
                
                if label_counts:
                    # Assign most common label
                    best_label = max(label_counts.keys(), key=lambda k: label_counts[k])
                    if best_label != labels[node_id]:
                        labels[node_id] = best_label
                        changed = True
            
            if not changed:
                break
        
        return labels
    
    def detect_mule_patterns(self, node_id: str) -> Dict[str, Any]:
        """Detect money mule patterns for a node"""
        with self._lock:
            features = self.extract_features(node_id)
            
            mule_indicators = []
            mule_score = 0.0
            
            # High throughput with many counterparties
            if features["unique_neighbors"] > 20:
                mule_indicators.append("Many unique counterparties")
                mule_score += 0.2
            
            # High in/out ratio (funnel pattern)
            if features["in_degree"] > 0 and features["out_degree"] > 0:
                ratio = features["out_degree"] / features["in_degree"]
                if 0.8 < ratio < 1.2:
                    mule_indicators.append("Balanced in/out pattern")
                    mule_score += 0.15
            
            # Shared devices with multiple accounts
            if features["shared_device_edges"] > 2:
                mule_indicators.append("Shared device with multiple accounts")
                mule_score += 0.25
            
            # Low clustering (not part of natural social network)
            if features["clustering_coefficient"] < 0.1 and features["degree"] > 5:
                mule_indicators.append("Low clustering coefficient")
                mule_score += 0.15
            
            # Small community (isolated network)
            if 0 < features["community_size"] < 10 and features["degree"] > 5:
                mule_indicators.append("Small isolated community")
                mule_score += 0.15
            
            # Determine mule type
            mule_type = None
            if mule_score >= 0.5:
                if features["in_degree"] > features["out_degree"] * 2:
                    mule_type = "COLLECTOR"
                elif features["out_degree"] > features["in_degree"] * 2:
                    mule_type = "DISTRIBUTOR"
                else:
                    mule_type = "PASS_THROUGH"
            
            return {
                "node_id": node_id,
                "mule_score": min(mule_score, 1.0),
                "mule_type": mule_type,
                "indicators": mule_indicators,
                "features": features
            }


@dataclass
class GraphNode:
    """Graph node"""
    node_id: str
    node_type: str
    attributes: Dict[str, Any]


@dataclass
class GraphEdge:
    """Graph edge"""
    source_id: str
    target_id: str
    edge_type: str
    weight: float
    attributes: Dict[str, Any]
    created_at: datetime


# =============================================================================
# Export
# =============================================================================

__all__ = [
    'FeatureStore',
    'FeatureDefinition',
    'ModelCalibrator',
    'ModelExplainer',
    'ExplainabilityOutput',
    'FeatureContribution',
    'GraphFeatureExtractor',
    'GraphNode',
    'GraphEdge'
]
