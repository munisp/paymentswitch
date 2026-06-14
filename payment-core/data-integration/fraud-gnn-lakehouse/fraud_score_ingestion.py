#!/usr/bin/env python3
"""
Fraud Score Ingestion Service
Consumes fraud scores from Kafka and writes them to Delta Lake
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Dict, Any, List

from kafka import KafkaConsumer
from pyspark.sql import SparkSession
from pyspark.sql.types import *
from delta import *

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class FraudScoreIngestionService:
    """
    Ingests fraud scores from Kafka and writes them to Delta Lake
    
    This service creates a real-time stream of fraud scores that can be used
    for analytics and model performance monitoring.
    """
    
    def __init__(
        self,
        kafka_bootstrap_servers: str,
        kafka_topic: str,
        kafka_group_id: str,
        delta_lake_path: str,
        s3_endpoint: str,
        s3_access_key: str,
        s3_secret_key: str,
        batch_size: int = 1000,
        batch_timeout: float = 10.0
    ):
        self.kafka_bootstrap_servers = kafka_bootstrap_servers
        self.kafka_topic = kafka_topic
        self.kafka_group_id = kafka_group_id
        self.delta_lake_path = delta_lake_path
        self.s3_endpoint = s3_endpoint
        self.s3_access_key = s3_access_key
        self.s3_secret_key = s3_secret_key
        self.batch_size = batch_size
        self.batch_timeout = batch_timeout
        
        # Kafka consumer
        self.kafka_consumer: KafkaConsumer = None
        
        # Spark session
        self.spark = self._create_spark_session()
        
        # Metrics
        self.scores_ingested = 0
        self.batches_written = 0
        
    def _create_spark_session(self) -> SparkSession:
        """Create a Spark session configured for Delta Lake"""
        builder = (
            SparkSession.builder
            .appName("Fraud Score Ingestion")
            .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
            .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog")
            .config("spark.hadoop.fs.s3a.endpoint", self.s3_endpoint)
            .config("spark.hadoop.fs.s3a.access.key", self.s3_access_key)
            .config("spark.hadoop.fs.s3a.secret.key", self.s3_secret_key)
            .config("spark.hadoop.fs.s3a.path.style.access", "true")
            .config("spark.hadoop.fs.s3a.impl", "org.apache.hadoop.fs.s3a.S3AFileSystem")
        )
        
        return configure_spark_with_delta_pip(builder).getOrCreate()
    
    def initialize(self):
        """Initialize the Kafka consumer"""
        logger.info("Initializing Fraud Score Ingestion Service...")
        
        try:
            self.kafka_consumer = KafkaConsumer(
                self.kafka_topic,
                bootstrap_servers=self.kafka_bootstrap_servers,
                group_id=self.kafka_group_id,
                value_deserializer=lambda m: json.loads(m.decode('utf-8')),
                enable_auto_commit=False,
                max_poll_records=self.batch_size,
                auto_offset_reset='earliest'
            )
            logger.info(f"Connected to Kafka: {self.kafka_bootstrap_servers}")
        except Exception as e:
            logger.error(f"Failed to connect to Kafka: {e}")
            raise
        
        # Ensure Delta table exists
        self.create_delta_table()
        
        logger.info("Service initialized successfully")
    
    def create_delta_table(self):
        """Create the fraud scores Delta table if it doesn't exist"""
        schema = StructType([
            StructField("transaction_id", LongType(), False),
            StructField("fraud_score", DoubleType(), False),
            StructField("model_version", StringType(), False),
            StructField("scored_at", TimestampType(), False),
            StructField("ingested_at", TimestampType(), False)
        ])
        
        delta_path = f"{self.delta_lake_path}/fraud_scores"
        
        # Check if table exists
        try:
            self.spark.read.format("delta").load(delta_path)
            logger.info(f"Delta table already exists at {delta_path}")
        except Exception:
            # Create empty DataFrame with schema
            empty_df = self.spark.createDataFrame([], schema)
            empty_df.write.format("delta").save(delta_path)
            logger.info(f"Created Delta table at {delta_path}")
    
    def write_batch_to_delta(self, batch: List[Dict[str, Any]]):
        """Write a batch of fraud scores to Delta Lake"""
        if not batch:
            return
        
        try:
            # Convert batch to DataFrame
            df = self.spark.createDataFrame(batch)
            
            # Add ingestion timestamp
            from pyspark.sql.functions import current_timestamp
            df = df.withColumn("ingested_at", current_timestamp())
            
            # Write to Delta Lake
            delta_path = f"{self.delta_lake_path}/fraud_scores"
            df.write.format("delta").mode("append").save(delta_path)
            
            self.batches_written += 1
            self.scores_ingested += len(batch)
            
            logger.info(f"Wrote batch of {len(batch)} fraud scores to Delta Lake")
            
        except Exception as e:
            logger.error(f"Failed to write batch to Delta Lake: {e}")
            raise
    
    def run(self):
        """Main ingestion loop"""
        logger.info("Starting ingestion loop...")
        
        try:
            batch = []
            last_write_time = datetime.now()
            
            for message in self.kafka_consumer:
                event = message.value
                
                # Extract fraud score data
                score_data = {
                    'transaction_id': event.get('transaction_id'),
                    'fraud_score': event.get('fraud_score'),
                    'model_version': event.get('model_version', 'v1.0'),
                    'scored_at': datetime.fromisoformat(event.get('timestamp'))
                }
                
                batch.append(score_data)
                
                # Write batch if size reached or timeout elapsed
                should_write = (
                    len(batch) >= self.batch_size or
                    (datetime.now() - last_write_time).total_seconds() >= self.batch_timeout
                )
                
                if should_write:
                    self.write_batch_to_delta(batch)
                    self.kafka_consumer.commit()
                    batch = []
                    last_write_time = datetime.now()
                    
                    # Log metrics
                    if self.scores_ingested % 10000 == 0:
                        logger.info(
                            f"Ingestion Metrics: scores_ingested={self.scores_ingested}, "
                            f"batches_written={self.batches_written}"
                        )
            
        except KeyboardInterrupt:
            logger.info("Shutting down ingestion service...")
        except Exception as e:
            logger.error(f"Ingestion loop error: {e}", exc_info=True)
            raise
        finally:
            self.cleanup()
    
    def cleanup(self):
        """Cleanup resources"""
        logger.info("Cleaning up resources...")
        
        if self.kafka_consumer:
            self.kafka_consumer.close()
        
        if self.spark:
            self.spark.stop()
        
        logger.info("Cleanup complete")


def main():
    """Main entry point"""
    # Configuration from environment variables
    kafka_bootstrap_servers = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092')
    kafka_topic = os.getenv('KAFKA_TOPIC', 'fraud.scores')
    kafka_group_id = os.getenv('KAFKA_GROUP_ID', 'fraud-score-ingestion')
    delta_lake_path = os.getenv('DELTA_LAKE_PATH', 's3a://lakehouse/delta')
    s3_endpoint = os.getenv('S3_ENDPOINT', 'http://rustfs.lakehouse:9000')
    s3_access_key = os.getenv('S3_ACCESS_KEY', 'minioadmin')
    s3_secret_key = os.getenv('S3_SECRET_KEY', 'minioadmin')
    
    # Create and run the ingestion service
    service = FraudScoreIngestionService(
        kafka_bootstrap_servers=kafka_bootstrap_servers,
        kafka_topic=kafka_topic,
        kafka_group_id=kafka_group_id,
        delta_lake_path=delta_lake_path,
        s3_endpoint=s3_endpoint,
        s3_access_key=s3_access_key,
        s3_secret_key=s3_secret_key
    )
    
    service.initialize()
    service.run()


if __name__ == '__main__':
    main()
