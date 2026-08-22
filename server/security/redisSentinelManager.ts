import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { createClient, type RedisClientType } from "redis";
import {
  recordRedisCircuitOperationFailure,
  recordRedisCircuitTrip,
  recordRedisFailoverDuration,
  recordRedisTopologyChange,
} from "../observability/metrics";

export class RedisCircuitOpenError extends Error {
  constructor() {
    super("Redis circuit breaker is open");
    this.name = "RedisCircuitOpenError";
  }
}

type RedisClient = RedisClientType;
type Operation<T> = (client: RedisClient) => Promise<T>;

export interface RedisSentinelManagerOptions {
  sentinelUrls: string[];
  masterName?: string;
  username?: string;
  password?: string;
  tls?: boolean;
  failureThreshold?: number;
  cooldownMs?: number;
  connectTimeoutMs?: number;
}

export class RedisSentinelManager {
  private client?: RedisClient;
  private connecting?: Promise<RedisClient>;
  private failures = 0;
  private circuitOpenedAt = 0;
  private readonly options: Required<
    Pick<
      RedisSentinelManagerOptions,
      "failureThreshold" | "cooldownMs" | "connectTimeoutMs"
    >
  > &
    RedisSentinelManagerOptions;

  constructor(options: RedisSentinelManagerOptions) {
    this.options = {
      failureThreshold: 3,
      cooldownMs: 10_000,
      connectTimeoutMs: 3_000,
      ...options,
    };
    if (!this.options.sentinelUrls.length) {
      throw new Error("At least one Redis URL or Sentinel URL is required");
    }
  }

  async execute<T>(operation: Operation<T>): Promise<T> {
    this.assertCircuitClosed();
    const tracer = trace.getTracer("paymentswitch.redis");
    return tracer.startActiveSpan("redis.sentinel.operation", async span => {
      try {
        const client = await this.getClient();
        const result = await operation(client);
        this.failures = 0;
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        recordRedisCircuitOperationFailure();
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        await this.invalidateClient();
        this.recordFailure();
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async close(): Promise<void> {
    await this.invalidateClient();
  }

  private assertCircuitClosed(): void {
    if (!this.circuitOpenedAt) return;
    if (Date.now() - this.circuitOpenedAt >= this.options.cooldownMs) {
      this.circuitOpenedAt = 0;
      this.failures = 0;
      return;
    }
    throw new RedisCircuitOpenError();
  }

  private async getClient(): Promise<RedisClient> {
    if (this.client?.isReady) return this.client;
    if (!this.connecting) {
      this.connecting = this.connectToCurrentPrimary().finally(() => {
        this.connecting = undefined;
      });
    }
    this.client = await this.connecting;
    return this.client;
  }

  private async connectToCurrentPrimary(): Promise<RedisClient> {
    const startedAt = Date.now();
    const tracer = trace.getTracer("paymentswitch.redis");
    return tracer.startActiveSpan(
      "redis.sentinel.topology_discovery",
      async span => {
        try {
          if (!this.options.masterName) {
            const client = createClient({
              url: this.options.sentinelUrls[0],
              username: this.options.username,
              password: this.options.password,
              socket: {
                connectTimeout: this.options.connectTimeoutMs,
                tls: this.options.tls,
              },
            }) as RedisClient;
            client.on("error", () => undefined);
            await client.connect();
            recordRedisFailoverDuration((Date.now() - startedAt) / 1000);
            span.setStatus({ code: SpanStatusCode.OK });
            return client;
          }

          let lastError: unknown;
          for (const sentinelUrl of this.options.sentinelUrls) {
            let sentinel: RedisClient | undefined;
            try {
              sentinel = createClient({
                url: sentinelUrl,
                username: this.options.username,
                password: this.options.password,
                socket: {
                  connectTimeout: this.options.connectTimeoutMs,
                  tls: this.options.tls,
                },
              }) as RedisClient;
              sentinel.on("error", () => undefined);
              await sentinel.connect();
              const answer = (await sentinel.sendCommand([
                "SENTINEL",
                "get-master-addr-by-name",
                this.options.masterName,
              ])) as string[];
              const [host, port] = answer;
              if (!host || !port)
                throw new Error("Sentinel returned no primary address");

              const scheme = this.options.tls ? "rediss" : "redis";
              const auth = this.options.username
                ? `${encodeURIComponent(this.options.username)}:${encodeURIComponent(this.options.password ?? "")}@`
                : this.options.password
                  ? `:${encodeURIComponent(this.options.password)}@`
                  : "";
              const primary = createClient({
                url: `${scheme}://${auth}${host}:${port}`,
                username: this.options.username,
                password: this.options.password,
                socket: {
                  connectTimeout: this.options.connectTimeoutMs,
                  tls: this.options.tls,
                },
              }) as RedisClient;
              primary.on("error", () => undefined);
              await primary.connect();
              await sentinel.quit();
              recordRedisTopologyChange();
              recordRedisFailoverDuration((Date.now() - startedAt) / 1000);
              span.setStatus({ code: SpanStatusCode.OK });
              return primary;
            } catch (error) {
              lastError = error;
              if (sentinel) await sentinel.quit().catch(() => undefined);
            }
          }
          throw lastError instanceof Error
            ? lastError
            : new Error("No Redis Sentinel could locate the primary");
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      }
    );
  }

  private async invalidateClient(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client) await client.quit().catch(() => undefined);
  }

  private recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.options.failureThreshold) {
      this.circuitOpenedAt = Date.now();
      recordRedisCircuitTrip();
    }
  }
}
