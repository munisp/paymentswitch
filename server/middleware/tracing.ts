/**
 * OpenTelemetry Distributed Tracing Configuration
 * 
 * Provides end-to-end tracing across all services with:
 * - Automatic context propagation
 * - Custom span attributes for payment operations
 * - Integration with Jaeger/Zipkin exporters
 * - Correlation ID management
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('tracing');

// Trace context headers (W3C Trace Context standard)
const TRACEPARENT_HEADER = 'traceparent';
const TRACESTATE_HEADER = 'tracestate';
const CORRELATION_ID_HEADER = 'x-correlation-id';
const REQUEST_ID_HEADER = 'x-request-id';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: number;
  correlationId: string;
  requestId: string;
}

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  serviceName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'OK' | 'ERROR' | 'UNSET';
  attributes: SpanAttributes;
  events: SpanEvent[];
  links: SpanLink[];
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: SpanAttributes;
}

export interface SpanLink {
  traceId: string;
  spanId: string;
  attributes?: SpanAttributes;
}

// In-memory span storage (replace with actual exporter in production)
const spanBuffer: Span[] = [];
const MAX_BUFFER_SIZE = 10000;
const FLUSH_INTERVAL_MS = 5000;

// Active spans for context management
const activeSpans = new Map<string, Span>();

/**
 * Generate a random trace ID (32 hex characters)
 */
function generateTraceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a random span ID (16 hex characters)
 */
function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Parse W3C traceparent header
 * Format: version-traceId-spanId-traceFlags
 */
function parseTraceparent(header: string): Partial<TraceContext> | null {
  const parts = header.split('-');
  if (parts.length !== 4) return null;
  
  const [version, traceId, spanId, flags] = parts;
  
  if (version !== '00') return null;
  if (traceId.length !== 32) return null;
  if (spanId.length !== 16) return null;
  
  return {
    traceId,
    parentSpanId: spanId,
    traceFlags: parseInt(flags, 16)
  };
}

/**
 * Create traceparent header value
 */
function createTraceparent(context: TraceContext): string {
  const flags = context.traceFlags.toString(16).padStart(2, '0');
  return `00-${context.traceId}-${context.spanId}-${flags}`;
}

/**
 * Create a new span
 */
export function createSpan(
  operationName: string,
  serviceName: string,
  parentContext?: TraceContext,
  attributes?: SpanAttributes
): Span {
  const span: Span = {
    traceId: parentContext?.traceId || generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: parentContext?.spanId,
    operationName,
    serviceName,
    startTime: Date.now(),
    status: 'UNSET',
    attributes: attributes || {},
    events: [],
    links: []
  };
  
  activeSpans.set(span.spanId, span);
  return span;
}

/**
 * End a span and add to buffer
 */
export function endSpan(span: Span, status: 'OK' | 'ERROR' = 'OK'): void {
  span.endTime = Date.now();
  span.duration = span.endTime - span.startTime;
  span.status = status;
  
  activeSpans.delete(span.spanId);
  
  spanBuffer.push(span);
  
  // Prevent buffer overflow
  if (spanBuffer.length > MAX_BUFFER_SIZE) {
    spanBuffer.splice(0, spanBuffer.length - MAX_BUFFER_SIZE);
  }
}

/**
 * Add an event to a span
 */
export function addSpanEvent(span: Span, name: string, attributes?: SpanAttributes): void {
  span.events.push({
    name,
    timestamp: Date.now(),
    attributes
  });
}

/**
 * Set span attributes
 */
export function setSpanAttributes(span: Span, attributes: SpanAttributes): void {
  Object.assign(span.attributes, attributes);
}

/**
 * Express middleware for distributed tracing
 */
export function tracingMiddleware(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Extract or create trace context
    const traceparent = req.headers[TRACEPARENT_HEADER] as string;
    const correlationId = (req.headers[CORRELATION_ID_HEADER] as string) || generateTraceId();
    const requestId = (req.headers[REQUEST_ID_HEADER] as string) || generateSpanId();
    
    let parentContext: Partial<TraceContext> | null = null;
    if (traceparent) {
      parentContext = parseTraceparent(traceparent);
    }
    
    // Create trace context
    const traceContext: TraceContext = {
      traceId: parentContext?.traceId || generateTraceId(),
      spanId: generateSpanId(),
      parentSpanId: parentContext?.parentSpanId,
      traceFlags: parentContext?.traceFlags || 1,
      correlationId,
      requestId
    };
    
    // Create span for this request
    const span = createSpan(
      `${req.method} ${req.path}`,
      serviceName,
      traceContext,
      {
        'http.method': req.method,
        'http.url': req.originalUrl,
        'http.host': req.hostname,
        'http.user_agent': req.headers['user-agent'],
        'http.request_content_length': req.headers['content-length'],
        'net.peer.ip': req.ip,
        'correlation.id': correlationId,
        'request.id': requestId
      }
    );
    
    // Attach context to request
    (req as any).traceContext = traceContext;
    (req as any).span = span;
    
    // Set response headers for trace propagation
    res.setHeader(TRACEPARENT_HEADER, createTraceparent(traceContext));
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    res.setHeader(REQUEST_ID_HEADER, requestId);
    
    // Capture response
    const originalEnd = res.end.bind(res);
    res.end = function(...args: any[]) {
      // Add response attributes
      setSpanAttributes(span, {
        'http.status_code': res.statusCode,
        'http.response_content_length': res.getHeader('content-length') as number
      });
      
      // End span with appropriate status
      const status = res.statusCode >= 400 ? 'ERROR' : 'OK';
      endSpan(span, status);
      
      return originalEnd(...args);
    };
    
    next();
  };
}

/**
 * Create a child span for internal operations
 */
export function createChildSpan(
  req: Request,
  operationName: string,
  attributes?: SpanAttributes
): Span {
  const parentContext = (req as any).traceContext as TraceContext;
  const serviceName = ((req as any).span as Span)?.serviceName || 'unknown';
  
  return createSpan(operationName, serviceName, parentContext, attributes);
}

/**
 * Span context for async operations
 */
export class SpanContext {
  private span: Span;
  
  constructor(span: Span) {
    this.span = span;
  }
  
  addEvent(name: string, attributes?: SpanAttributes): void {
    addSpanEvent(this.span, name, attributes);
  }
  
  setAttributes(attributes: SpanAttributes): void {
    setSpanAttributes(this.span, attributes);
  }
  
  end(status: 'OK' | 'ERROR' = 'OK'): void {
    endSpan(this.span, status);
  }
  
  getTraceId(): string {
    return this.span.traceId;
  }
  
  getSpanId(): string {
    return this.span.spanId;
  }
}

/**
 * Decorator for tracing async functions
 */
export function traced(operationName: string, serviceName: string = 'payment-switch') {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const span = createSpan(operationName, serviceName);
      
      try {
        const result = await originalMethod.apply(this, args);
        endSpan(span, 'OK');
        return result;
      } catch (error) {
        setSpanAttributes(span, {
          'error': true,
          'error.message': (error as Error).message,
          'error.stack': (error as Error).stack
        });
        endSpan(span, 'ERROR');
        throw error;
      }
    };
    
    return descriptor;
  };
}

/**
 * Trace a function execution
 */
export async function trace<T>(
  operationName: string,
  serviceName: string,
  fn: (ctx: SpanContext) => Promise<T>,
  parentContext?: TraceContext
): Promise<T> {
  const span = createSpan(operationName, serviceName, parentContext);
  const ctx = new SpanContext(span);
  
  try {
    const result = await fn(ctx);
    ctx.end('OK');
    return result;
  } catch (error) {
    ctx.setAttributes({
      'error': true,
      'error.message': (error as Error).message
    });
    ctx.end('ERROR');
    throw error;
  }
}

/**
 * Get all spans for export
 */
export function getSpans(): Span[] {
  return [...spanBuffer];
}

/**
 * Clear span buffer
 */
export function clearSpans(): void {
  spanBuffer.length = 0;
}

/**
 * Span exporter interface
 */
export interface SpanExporter {
  export(spans: Span[]): Promise<void>;
}

/**
 * Console span exporter (for development)
 */
export class ConsoleSpanExporter implements SpanExporter {
  async export(spans: Span[]): Promise<void> {
    for (const span of spans) {
      log.info(JSON.stringify({
        type: 'span',
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        operationName: span.operationName,
        serviceName: span.serviceName,
        duration: span.duration,
        status: span.status,
        attributes: span.attributes
      }));
    }
  }
}

/**
 * Jaeger span exporter
 */
export class JaegerSpanExporter implements SpanExporter {
  private endpoint: string;
  
  constructor(endpoint: string = 'http://localhost:14268/api/traces') {
    this.endpoint = endpoint;
  }
  
  async export(spans: Span[]): Promise<void> {
    // Convert to Jaeger format and send
    const jaegerSpans = spans.map(span => ({
      traceIdLow: span.traceId.slice(16),
      traceIdHigh: span.traceId.slice(0, 16),
      spanId: span.spanId,
      parentSpanId: span.parentSpanId || '0',
      operationName: span.operationName,
      startTime: span.startTime * 1000, // microseconds
      duration: (span.duration || 0) * 1000,
      tags: Object.entries(span.attributes).map(([key, value]) => ({
        key,
        vType: typeof value === 'string' ? 'STRING' : typeof value === 'number' ? 'DOUBLE' : 'BOOL',
        vStr: typeof value === 'string' ? value : undefined,
        vDouble: typeof value === 'number' ? value : undefined,
        vBool: typeof value === 'boolean' ? value : undefined
      })),
      logs: span.events.map(event => ({
        timestamp: event.timestamp * 1000,
        fields: [{ key: 'event', vType: 'STRING', vStr: event.name }]
      }))
    }));
    
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spans: jaegerSpans })
      });
    } catch (error) {
      log.error({ err: error }, 'Failed to export spans to Jaeger:');
    }
  }
}

/**
 * Periodic span flusher
 */
let flushInterval: NodeJS.Timeout | null = null;
let activeExporter: SpanExporter | null = null;

export function startSpanFlusher(exporter: SpanExporter, intervalMs: number = FLUSH_INTERVAL_MS): void {
  activeExporter = exporter;
  
  if (flushInterval) {
    clearInterval(flushInterval);
  }
  
  flushInterval = setInterval(async () => {
    if (spanBuffer.length > 0 && activeExporter) {
      const spansToExport = spanBuffer.splice(0, spanBuffer.length);
      await activeExporter.export(spansToExport);
    }
  }, intervalMs);
}

export function stopSpanFlusher(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
}

/**
 * Payment-specific span attributes
 */
export const PaymentSpanAttributes = {
  PAYMENT_ID: 'payment.id',
  PAYMENT_AMOUNT: 'payment.amount',
  PAYMENT_CURRENCY: 'payment.currency',
  PAYMENT_METHOD: 'payment.method',
  PAYMENT_STATUS: 'payment.status',
  MERCHANT_ID: 'merchant.id',
  CUSTOMER_ID: 'customer.id',
  TRANSACTION_TYPE: 'transaction.type',
  BANK_CODE: 'bank.code',
  CRYPTO_CURRENCY: 'crypto.currency',
  CRYPTO_ADDRESS: 'crypto.address',
  DELIVERY_METHOD: 'delivery.method'
};

export default tracingMiddleware;
