"""Verified CPU-local fraud-model runtime.

The runtime loads only the approved ensemble bundle, validates its immutable
manifest and artifact hashes before deserializing, validates the exact training
feature order, and emits a model-versioned score. It does not train, generate,
or substitute a synthetic model at request time.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import joblib
import lightgbm
import numpy as np
import pandas as pd
import sklearn
import xgboost


class ModelBundleError(RuntimeError):
    """Raised when a CPU model bundle is absent, invalid, or incompatible."""


@dataclass(frozen=True)
class CpuPrediction:
    probability: float
    decision: str
    model_id: str
    model_version: str
    feature_contract_version: str
    latency_ms: float


class CpuFraudModelBundle:
    """Loads and serves a signed-on-disk CPU ensemble without fallbacks."""

    def __init__(self, bundle_dir: Path | None = None):
        default_dir = Path(__file__).resolve().parents[2] / "ml-platform" / "weights"
        self.bundle_dir = Path(os.getenv("FRAUD_MODEL_BUNDLE_DIR", str(bundle_dir or default_dir))).resolve()
        self.manifest_path = self.bundle_dir / os.getenv("FRAUD_MODEL_BUNDLE_MANIFEST", "model_bundle.json")
        self.manifest: dict[str, Any] = {}
        self.feature_names: tuple[str, ...] = ()
        self._ensemble: dict[str, Any] | None = None
        self._encoders: dict[str, Any] | None = None

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def load(self) -> None:
        if not self.manifest_path.is_file():
            raise ModelBundleError(f"CPU model manifest is missing: {self.manifest_path}")
        try:
            self.manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ModelBundleError(f"CPU model manifest is not valid JSON: {exc}") from exc

        if self.manifest.get("provenance", {}).get("status") != "approved_for_cpu_serving":
            raise ModelBundleError("CPU model bundle is not approved for serving")

        expected_runtime = self.manifest.get("runtime", {}).get("frameworks", {})
        installed_runtime = {
            "numpy": np.__version__,
            "joblib": joblib.__version__,
            "scikit_learn": sklearn.__version__,
            "xgboost": xgboost.__version__,
            "lightgbm": lightgbm.__version__,
        }
        for dependency, expected_version in expected_runtime.items():
            if installed_runtime.get(dependency) != expected_version:
                raise ModelBundleError(
                    f"CPU model runtime version mismatch for {dependency}: "
                    f"expected {expected_version}, got {installed_runtime.get(dependency)}"
                )

        expected_artifacts = self.manifest.get("artifacts")
        if not isinstance(expected_artifacts, dict) or not expected_artifacts:
            raise ModelBundleError("CPU model manifest does not declare artifact hashes")
        for filename, expected_hash in expected_artifacts.items():
            artifact = self.bundle_dir / filename
            if not artifact.is_file():
                raise ModelBundleError(f"Required CPU model artifact is missing: {filename}")
            actual_hash = self._sha256(artifact)
            if actual_hash != expected_hash:
                raise ModelBundleError(f"Artifact digest mismatch for {filename}")

        contract = self.manifest.get("feature_contract", {})
        feature_names = contract.get("names")
        if not isinstance(feature_names, list) or not feature_names or len(set(feature_names)) != len(feature_names):
            raise ModelBundleError("CPU model feature contract is invalid")
        self.feature_names = tuple(str(name) for name in feature_names)

        try:
            ensemble = joblib.load(self.bundle_dir / "fraud_ensemble.joblib")
            encoders = joblib.load(self.bundle_dir / "encoders.joblib")
        except Exception as exc:
            raise ModelBundleError(f"CPU model artifacts could not be deserialized: {exc}") from exc

        required_models = ("xgb_model", "lgb_model", "meta_learner", "scaler", "feature_names")
        if not all(key in ensemble for key in required_models):
            raise ModelBundleError("Fraud ensemble artifact is missing required trained components")
        if tuple(ensemble["feature_names"]) != self.feature_names:
            raise ModelBundleError("Ensemble feature order does not match the approved CPU contract")
        if tuple(encoders.get("feature_names", ())) != self.feature_names:
            raise ModelBundleError("Encoder feature order does not match the approved CPU contract")
        if "le_channel" not in encoders or "le_narration" not in encoders:
            raise ModelBundleError("Categorical encoders are missing from the CPU bundle")

        self._ensemble = ensemble
        self._encoders = encoders

    @property
    def ready(self) -> bool:
        return self._ensemble is not None and self._encoders is not None

    def _encode_category(self, encoder_name: str, value: str) -> float:
        if not self._encoders:
            raise ModelBundleError("CPU model bundle has not been loaded")
        encoder = self._encoders[encoder_name]
        normalized = value.strip()
        if normalized not in set(str(item) for item in encoder.classes_):
            raise ModelBundleError(f"Unsupported {encoder_name} value for approved model contract: {normalized}")
        return float(encoder.transform([normalized])[0])

    def build_feature_vector(self, raw: Mapping[str, Any]) -> np.ndarray:
        """Build the exact approved tabular vector; missing data is an error."""
        try:
            amount = float(raw["amount"])
            sender_balance = float(raw["sender_balance"])
            sender_age = float(raw["sender_age"])
            sender_is_mule = int(raw["sender_is_mule"])
            occurred_at = raw["occurred_at"]
            channel = str(raw["channel"])
            narration = str(raw["narration"])
            source_bank = str(raw["source_bank_code"])
            destination_bank = str(raw["destination_bank_code"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ModelBundleError(f"Fraud feature contract cannot be satisfied: {exc}") from exc

        if not math.isfinite(amount) or amount <= 0:
            raise ModelBundleError("Fraud amount must be a positive finite value")
        if not math.isfinite(sender_balance) or sender_balance < 0:
            raise ModelBundleError("Sender balance must be a non-negative finite value")
        if not math.isfinite(sender_age) or sender_age < 0:
            raise ModelBundleError("Sender age must be a non-negative finite value")
        if sender_is_mule not in (0, 1):
            raise ModelBundleError("Sender mule indicator must be 0 or 1")
        if not hasattr(occurred_at, "hour"):
            raise ModelBundleError("Occurred-at value must be a timezone-aware datetime")

        vector = {
            "amount": amount,
            "amount_log": math.log1p(amount),
            "channel_enc": self._encode_category("le_channel", channel),
            "narration_enc": self._encode_category("le_narration", narration),
            "hour": float(occurred_at.hour),
            "day_of_week": float(occurred_at.weekday()),
            "day_of_month": float(occurred_at.day),
            "is_weekend": float(1 if occurred_at.weekday() >= 5 else 0),
            "is_night": float(1 if occurred_at.hour < 6 or occurred_at.hour >= 22 else 0),
            "is_salary_day": float(1 if 25 <= occurred_at.day <= 28 else 0),
            "is_interbank": float(1 if source_bank != destination_bank else 0),
            "sender_balance": sender_balance,
            "sender_age": sender_age,
            "sender_is_mule": float(sender_is_mule),
        }
        missing = [name for name in self.feature_names if name not in vector]
        if missing:
            raise ModelBundleError(f"CPU feature implementation is incomplete: {missing}")
        return np.asarray([[vector[name] for name in self.feature_names]], dtype=np.float32)

    def predict(self, raw_features: Mapping[str, Any]) -> CpuPrediction:
        if not self.ready or not self._ensemble:
            raise ModelBundleError("CPU model bundle is not ready")
        started = time.perf_counter()
        features = self.build_feature_vector(raw_features)
        scaler = self._ensemble["scaler"]
        scaled = scaler.transform(features)
        named_scaled = pd.DataFrame(scaled, columns=self.feature_names)
        xgb_probability = self._ensemble["xgb_model"].predict_proba(named_scaled)[:, 1]
        lgb_probability = self._ensemble["lgb_model"].predict_proba(named_scaled)[:, 1]
        meta_features = np.column_stack([xgb_probability, lgb_probability])
        probability = float(self._ensemble["meta_learner"].predict_proba(meta_features)[0][1])
        if not math.isfinite(probability) or probability < 0 or probability > 1:
            raise ModelBundleError("CPU ensemble produced an invalid probability")

        policy = self.manifest["decision_policy"]
        decision = "BLOCK" if probability >= float(policy["block_threshold"]) else "REVIEW" if probability >= float(policy["review_threshold"]) else "ALLOW"
        return CpuPrediction(
            probability=probability,
            decision=decision,
            model_id=str(self.manifest["bundle_id"]),
            model_version=str(self.manifest["model_version"]),
            feature_contract_version=str(self.manifest["feature_contract"]["version"]),
            latency_ms=round((time.perf_counter() - started) * 1000, 3),
        )


def load_cpu_fraud_model() -> CpuFraudModelBundle:
    bundle = CpuFraudModelBundle()
    bundle.load()
    return bundle
