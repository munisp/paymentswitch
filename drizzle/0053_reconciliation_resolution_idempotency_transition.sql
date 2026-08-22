-- A quarantined idempotency key may be completed only by reconciliation after finality evidence exists.
CREATE OR REPLACE FUNCTION enforce_idempotency_key_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.idempotency_key <> NEW.idempotency_key
       OR OLD.operation <> NEW.operation
       OR OLD.request_hash <> NEW.request_hash THEN
        RAISE EXCEPTION 'idempotency identity is immutable';
    END IF;

    IF OLD.status IN ('completed', 'rejected') THEN
        RAISE EXCEPTION 'terminal idempotency state % is immutable', OLD.status;
    END IF;

    IF OLD.status = 'in_progress' AND NEW.status NOT IN ('in_progress', 'completed', 'rejected', 'reconciliation_required') THEN
        RAISE EXCEPTION 'invalid idempotency transition % -> %', OLD.status, NEW.status;
    END IF;
    IF OLD.status = 'reconciliation_required' AND NEW.status NOT IN ('reconciliation_required', 'completed') THEN
        RAISE EXCEPTION 'invalid reconciliation idempotency transition % -> %', OLD.status, NEW.status;
    END IF;

    IF NEW.status IN ('completed', 'rejected', 'reconciliation_required')
       AND (NEW.response IS NULL OR NEW.response_status IS NULL) THEN
        RAISE EXCEPTION 'terminal idempotency state requires response and response_status';
    END IF;
    IF NEW.status = 'reconciliation_required' AND NEW.response_status < 500 THEN
        RAISE EXCEPTION 'reconciliation_required is reserved for ambiguous 5xx outcomes';
    END IF;
    IF OLD.status = 'reconciliation_required' AND NEW.status = 'completed' AND NEW.response_status <> 200 THEN
        RAISE EXCEPTION 'reconciliation resolution must record an HTTP 200 final response';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
