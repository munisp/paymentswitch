FROM python:3.11.9-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FRAUD_MODEL_BUNDLE_DIR=/app/ml-platform/weights

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

COPY services/fraud-detection-service/requirements-cpu.txt /tmp/requirements-cpu.txt
RUN pip install --require-virtualenv=false -r /tmp/requirements-cpu.txt

COPY ml-platform/weights /app/ml-platform/weights
COPY services/fraud-detection-service /app/fraud-detection-service

WORKDIR /app/fraud-detection-service
RUN python verify_model_bundle.py --manifest "$FRAUD_MODEL_BUNDLE_DIR/model_bundle.json"

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
