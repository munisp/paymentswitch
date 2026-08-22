import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export type ISO20022MessageType = 'pacs.008.001.13' | 'pacs.002.001.15' | 'camt.056.001.10' | 'camt.029.001.14';
export type IsoDirection = 'INBOUND' | 'OUTBOUND';

const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Currency must be an ISO 4217 alpha-3 code');
const identifierSchema = z.string().min(1).max(140);
const amountSchema = z.string().regex(/^(0|[1-9]\d*)(\.\d{1,4})?$/, 'Amount must be a non-negative decimal string');

export const isoPaymentSchema = z.object({
  messageId: identifierSchema,
  uetr: z.string().uuid(),
  instructionId: identifierSchema,
  endToEndId: identifierSchema,
  transactionId: identifierSchema,
  amount: amountSchema,
  currency: currencySchema,
  debtor: z.object({ name: z.string().min(1).max(140), account: identifierSchema, agent: identifierSchema }),
  creditor: z.object({ name: z.string().min(1).max(140), account: identifierSchema, agent: identifierSchema }),
  settlementMethod: z.enum(['CLRG', 'INDA', 'INGA', 'COVE']),
  requestedExecutionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  remittanceInformation: z.string().max(140).optional(),
  correlationId: z.string().uuid(),
});
export type IsoPayment = z.infer<typeof isoPaymentSchema>;

export type IsoStatus = 'ACCP' | 'ACSP' | 'ACSC' | 'RJCT' | 'PDNG' | 'BLCK';

export interface IsoStatusReport {
  messageId: string;
  originalMessageId: string;
  originalTransactionId: string;
  originalUetr: string;
  status: IsoStatus;
  reasonCode?: string;
  additionalInformation?: string;
  correlationId: string;
}

export interface IsoCancellationRequest {
  messageId: string;
  originalMessageId: string;
  originalTransactionId: string;
  originalUetr: string;
  cancellationReason: string;
  requestedBy: string;
  correlationId: string;
}

export interface IsoResolution {
  messageId: string;
  originalMessageId: string;
  originalTransactionId: string;
  originalUetr: string;
  resolution: 'CNCL' | 'RJCR' | 'AMND';
  reasonCode?: string;
  correlationId: string;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] as string);
}
function tag(name: string, value: string | undefined): string {
  return value === undefined ? '' : `<${name}>${escapeXml(value)}</${name}>`;
}
function normalizeDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function createPacs008(input: Omit<IsoPayment, 'messageId' | 'uetr' | 'correlationId'> & Partial<Pick<IsoPayment, 'messageId' | 'uetr' | 'correlationId'>>): IsoPayment {
  const parsed = isoPaymentSchema.parse({
    ...input,
    messageId: input.messageId ?? `PS-${randomUUID()}`,
    uetr: input.uetr ?? randomUUID(),
    correlationId: input.correlationId ?? randomUUID(),
  });
  return parsed;
}

export function createPacs002(input: Omit<IsoStatusReport, 'messageId'> & Partial<Pick<IsoStatusReport, 'messageId'>>): IsoStatusReport {
  return {
    ...input,
    messageId: input.messageId ?? `PS-STATUS-${randomUUID()}`,
  };
}

export function createCamt056(input: Omit<IsoCancellationRequest, 'messageId'> & Partial<Pick<IsoCancellationRequest, 'messageId'>>): IsoCancellationRequest {
  return {
    ...input,
    messageId: input.messageId ?? `PS-CANCEL-${randomUUID()}`,
  };
}

export function createCamt029(input: Omit<IsoResolution, 'messageId'> & Partial<Pick<IsoResolution, 'messageId'>>): IsoResolution {
  return {
    ...input,
    messageId: input.messageId ?? `PS-RESOLUTION-${randomUUID()}`,
  };
}

export function pacs008ToXml(payment: IsoPayment, createdAt = new Date()): string {
  const p = isoPaymentSchema.parse(payment);
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Envelope xmlns="urn:iso:std:iso:20022:tech:xsd:head.001.001.03">` +
    `<AppHdr>` +
    tag('Fr', tag('FIId', tag('FinInstnId', tag('BICFI', p.debtor.agent)))) +
    tag('To', tag('FIId', tag('FinInstnId', tag('BICFI', p.creditor.agent)))) +
    tag('BizMsgIdr', p.messageId) + tag('MsgDefIdr', 'pacs.008.001.13') +
    tag('CreDt', createdAt.toISOString()) + tag('BizSvc', 'paymentswitch.realtime') +
    tag('PssblDplct', 'false') +
    `</AppHdr></Envelope>` .replace('</Envelope>',
      `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.13"><FIToFICstmrCdtTrf>` +
      `<GrpHdr>${tag('MsgId', p.messageId)}${tag('CreDtTm', createdAt.toISOString())}${tag('NbOfTxs', '1')}` +
      `<SttlmInf>${tag('SttlmMtd', p.settlementMethod)}</SttlmInf></GrpHdr>` +
      `<CdtTrfTxInf>${tag('PmtId', tag('InstrId', p.instructionId) + tag('EndToEndId', p.endToEndId) + tag('TxId', p.transactionId) + tag('UETR', p.uetr))}` +
      `<Amt>${tag('InstdAmt', p.amount).replace('<InstdAmt>', `<InstdAmt Ccy="${escapeXml(p.currency)}">`)}</Amt>` +
      `<Dbtr>${tag('Nm', p.debtor.name)}${tag('Id', tag('PrvtId', tag('Othr', tag('Id', p.debtor.account))))}</Dbtr>` +
      `<DbtrAgt>${tag('FinInstnId', tag('BICFI', p.debtor.agent))}</DbtrAgt>` +
      `<CdtrAgt>${tag('FinInstnId', tag('BICFI', p.creditor.agent))}</CdtrAgt>` +
      `<Cdtr>${tag('Nm', p.creditor.name)}${tag('Id', tag('PrvtId', tag('Othr', tag('Id', p.creditor.account))))}</Cdtr>` +
      (p.remittanceInformation ? `<RmtInf>${tag('Ustrd', p.remittanceInformation)}</RmtInf>` : '') +
      `</CdtTrfTxInf></FIToFICstmrCdtTrf></Document></Envelope>`);
}

export function pacs002ToXml(report: IsoStatusReport, createdAt = new Date()): string {
  const r = createPacs002(report);
  return `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.002.001.15"><FIToFIPmtStsRpt><GrpHdr>${tag('MsgId', r.messageId)}${tag('CreDtTm', createdAt.toISOString())}</GrpHdr><OrgnlGrpInfAndSts>${tag('OrgnlMsgId', r.originalMessageId)}${tag('OrgnlMsgNmId', 'pacs.008.001.13')}</OrgnlGrpInfAndSts><TxInfAndSts>${tag('OrgnlInstrId', r.originalTransactionId)}${tag('OrgnlTxId', r.originalTransactionId)}${tag('OrgnlUETR', r.originalUetr)}${tag('TxSts', r.status)}${r.reasonCode ? `<StsRsnInf>${tag('Rsn', tag('Cd', r.reasonCode))}</StsRsnInf>` : ''}${r.additionalInformation ? `<AddtlInf>${escapeXml(r.additionalInformation)}</AddtlInf>` : ''}</TxInfAndSts></FIToFIPmtStsRpt></Document>`;
}

export function camt056ToXml(request: IsoCancellationRequest, createdAt = new Date()): string {
  const r = createCamt056(request);
  return `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.056.001.10"><FIToFIPmtCxlReq><Assgnmt>${tag('Id', r.messageId)}${tag('Assgnr', tag('Agt', tag('FinInstnId', tag('Othr', tag('Id', r.requestedBy)))))}${tag('AssgnDtTm', createdAt.toISOString())}</Assgnmt><Undrlyg>${tag('OrgnlGrpInf', tag('OrgnlMsgId', r.originalMessageId))}<TxInf>${tag('CxlId', r.messageId)}${tag('OrgnlInstrId', r.originalTransactionId)}${tag('OrgnlTxId', r.originalTransactionId)}${tag('OrgnlUETR', r.originalUetr)}${tag('CxlRsnInf', tag('Rsn', tag('Prtry', r.cancellationReason)))}</TxInf></Undrlyg></FIToFIPmtCxlReq></Document>`;
}

export function camt029ToXml(resolution: IsoResolution, createdAt = new Date()): string {
  const r = createCamt029(resolution);
  return `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.029.001.14"><RsltnOfInvstgtn><Assgnmt>${tag('Id', r.messageId)}${tag('CreDtTm', createdAt.toISOString())}</Assgnmt><RslvdCase><CaseId>${escapeXml(r.originalTransactionId)}</CaseId></RslvdCase><CxlDtls><TxInfAndSts>${tag('OrgnlGrpInf', tag('OrgnlMsgId', r.originalMessageId))}${tag('OrgnlUETR', r.originalUetr)}${tag('CxlSts', tag('Conf', r.resolution))}${r.reasonCode ? tag('Rsn', tag('Prtry', r.reasonCode)) : ''}</TxInfAndSts></CxlDtls></RsltnOfInvstgtn></Document>`;
}

export function assertIsoMessage(xml: string, expectedType?: ISO20022MessageType): void {
  if (!xml.startsWith('<?xml') || !xml.includes('<Document')) throw new Error('Invalid ISO 20022 XML envelope');
  if (expectedType && !xml.includes(`iso:std:iso:20022:tech:xsd:${expectedType}`)) throw new Error(`Expected ISO 20022 message ${expectedType}`);
  if (xml.includes('<!DOCTYPE') || /<\!\[CDATA\[/i.test(xml)) throw new Error('Unsafe XML constructs are not permitted');
}
