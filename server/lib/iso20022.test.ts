import { describe, expect, it } from 'vitest';
import {
  assertIsoMessage,
  camt029ToXml,
  camt056ToXml,
  createCamt029,
  createCamt056,
  createPacs008,
  createPacs002,
  pacs002ToXml,
  pacs008ToXml,
} from './iso20022';

describe('ISO 20022 payment profile', () => {
  const payment = createPacs008({
    instructionId: 'INSTR-1',
    endToEndId: 'E2E-1',
    transactionId: 'TX-1',
    amount: '1250.50',
    currency: 'NGN',
    debtor: { name: 'Debtor & Co', account: 'acct-debtor', agent: 'DEBTBIC' },
    creditor: { name: 'Creditor <Ltd>', account: 'acct-creditor', agent: 'CRED BIC' },
    settlementMethod: 'CLRG',
    requestedExecutionDate: '2026-08-22',
    remittanceInformation: 'Invoice 1',
  });

  it('creates stable UETR and correlation identifiers', () => {
    expect(payment.uetr).toMatch(/^[0-9a-f-]{36}$/);
    expect(payment.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(payment.messageId).toMatch(/^PS-/);
  });

  it('serializes pacs.008 and escapes XML values', () => {
    const xml = pacs008ToXml(payment);
    assertIsoMessage(xml, 'pacs.008.001.13');
    expect(xml).toContain('Debtor &amp; Co');
    expect(xml).toContain('Creditor &lt;Ltd&gt;');
    expect(xml).toContain('Ccy="NGN"');
    expect(xml).toContain(payment.uetr);
  });

  it('serializes status reports, cancellation requests, and resolutions', () => {
    const status = createPacs002({
      originalMessageId: payment.messageId,
      originalTransactionId: payment.transactionId,
      originalUetr: payment.uetr,
      status: 'ACSC',
      correlationId: payment.correlationId,
    });
    assertIsoMessage(pacs002ToXml(status), 'pacs.002.001.15');

    const cancellation = createCamt056({
      originalMessageId: payment.messageId,
      originalTransactionId: payment.transactionId,
      originalUetr: payment.uetr,
      cancellationReason: 'DUPL',
      requestedBy: 'BANKBIC',
      correlationId: payment.correlationId,
    });
    assertIsoMessage(camt056ToXml(cancellation), 'camt.056.001.10');

    const resolution = createCamt029({
      originalMessageId: payment.messageId,
      originalTransactionId: payment.transactionId,
      originalUetr: payment.uetr,
      resolution: 'CNCL',
      reasonCode: 'DUPL',
      correlationId: payment.correlationId,
    });
    assertIsoMessage(camt029ToXml(resolution), 'camt.029.001.14');
  });

  it('rejects invalid currency and unsafe XML constructs', () => {
    expect(() => createPacs008({ ...payment, currency: 'NG' })).toThrow();
    expect(() => assertIsoMessage('<!DOCTYPE x><Document/>')).toThrow();
  });
});
