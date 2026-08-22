import { describe, expect, it } from 'vitest';
import {
  assertIsoMessage,
  assertOfficialXsd,
  camt029ToXml,
  camt056ToXml,
  createCamt029,
  createCamt056,
  createPacs008,
  createPacs002,
  pacs002ToXml,
  pacs008ToXml,
  parsePacs008Xml,
  type XsdValidator,
} from './iso20022';

describe('ISO 20022 payment profile', () => {
  const payment = createPacs008({
    instructionId: 'INSTR-1',
    endToEndId: 'E2E-1',
    transactionId: 'TX-1',
    amount: '1250.50',
    currency: 'NGN',
    debtor: { name: 'Debtor & Co', account: 'acct-debtor', agent: 'DEBTBIC' },
    creditor: { name: 'Creditor <Ltd>', account: 'acct-creditor', agent: 'CREDBIC' },
    settlementMethod: 'CLRG',
    requestedExecutionDate: '2026-08-22',
    remittanceInformation: 'Invoice 1',
  });

  it('creates stable UETR and correlation identifiers', () => {
    expect(payment.uetr).toMatch(/^[0-9a-f-]{36}$/);
    expect(payment.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(payment.messageId).toMatch(/^PS-/);
  });

  it('serializes pacs.008, escapes text, and retains nested XML elements', () => {
    const xml = pacs008ToXml(payment, new Date('2026-08-22T12:00:00.000Z'));
    assertIsoMessage(xml, 'pacs.008.001.13');
    expect(xml).toContain('Debtor &amp; Co');
    expect(xml).toContain('Creditor &lt;Ltd&gt;');
    expect(xml).toContain('Ccy="NGN"');
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pacs.008.001.13');
    expect(xml).toContain(payment.uetr);
    expect(xml).toContain('<PmtId>');
    expect(xml).toContain('<Dbtr>');
    expect(xml).toContain('<ReqdExctnDt><Dt>2026-08-22</Dt></ReqdExctnDt>');
    expect(xml).not.toContain('&lt;PmtId&gt;');
    expect(xml).not.toContain('&lt;Dbtr&gt;');
  });

  it('parses a serialized inbound pacs.008 into the validated canonical contract', () => {
    const parsed = parsePacs008Xml(pacs008ToXml(payment));
    expect(parsed.messageType).toBe('pacs.008.001.13');
    expect(parsed.message.messageId).toBe(payment.messageId);
    expect(parsed.message.uetr).toBe(payment.uetr);
    expect(parsed.message.transactionId).toBe(payment.transactionId);
    expect(parsed.message.currency).toBe('NGN');
    expect(parsed.message.amount).toBe('1250.50');
    expect(parsed.message.requestedExecutionDate).toBe('2026-08-22');
    expect(parsed.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects unsafe, unsupported, malformed, and incomplete inbound XML', () => {
    const xml = pacs008ToXml(payment);
    expect(() => parsePacs008Xml(xml.replace('urn:iso:std:iso:20022:tech:xsd:pacs.008.001.13', 'urn:example:unsupported'))).toThrow(/Unsupported ISO 20022 document namespace/);
    expect(() => parsePacs008Xml(xml.replace('<UETR>', '<UETR></UETR><!--'))).toThrow();
    expect(() => parsePacs008Xml('<!DOCTYPE payment [<!ENTITY boom "boom">]><Envelope/>')).toThrow(/Unsafe XML/);
    expect(() => parsePacs008Xml(xml.replace('<TxId>TX-1</TxId>', ''))).toThrow(/Missing mandatory ISO 20022 element transactionId/);
  });

  it('uses an injected official-XSD validator and fails closed on rejection', async () => {
    const accepted: XsdValidator = { validate: async () => ({ valid: true, stdout: 'validated', stderr: '' }) };
    await expect(assertOfficialXsd(pacs008ToXml(payment), '/official/pacs.008.xsd', accepted)).resolves.toBeUndefined();

    const rejected: XsdValidator = { validate: async () => ({ valid: false, stdout: '', stderr: 'schema violation: BICFI' }) };
    await expect(assertOfficialXsd(pacs008ToXml(payment), '/official/pacs.008.xsd', rejected)).rejects.toThrow(/schema violation: BICFI/);
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

  it('rejects invalid Zod-schema input and unsafe XML envelope constructs', () => {
    expect(() => createPacs008({ ...payment, currency: 'NG' })).toThrow();
    expect(() => createPacs008({ ...payment, amount: '001.00' })).toThrow();
    expect(() => assertIsoMessage('<!DOCTYPE x><Document/>')).toThrow();
  });
});
