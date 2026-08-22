import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

export type ISO20022MessageType = 'pacs.008.001.13' | 'pacs.002.001.15' | 'camt.056.001.10' | 'camt.029.001.14';
export type IsoDirection = 'INBOUND' | 'OUTBOUND';

const ISO_NAMESPACES: Record<ISO20022MessageType, string> = {
  'pacs.008.001.13': 'urn:iso:std:iso:20022:tech:xsd:pacs.008.001.13',
  'pacs.002.001.15': 'urn:iso:std:iso:20022:tech:xsd:pacs.002.001.15',
  'camt.056.001.10': 'urn:iso:std:iso:20022:tech:xsd:camt.056.001.10',
  'camt.029.001.14': 'urn:iso:std:iso:20022:tech:xsd:camt.029.001.14',
};
const MAX_ISO_XML_BYTES = 1_000_000;
const ISO_TEXT_LIMIT = 10_000;

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

export interface ParsedIsoMessage<T = IsoPayment> {
  messageType: ISO20022MessageType;
  businessService?: string;
  message: T;
  payloadSha256: string;
}

export interface XsdValidationResult {
  valid: boolean;
  stdout: string;
  stderr: string;
}

export interface XsdValidator {
  validate(xml: string, xsdPath: string): Promise<XsdValidationResult>;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] as string);
}
function tag(name: string, value: string | undefined): string {
  return value === undefined ? '' : `<${name}>${escapeXml(value)}</${name}>`;
}
function element(name: string, children: string): string {
  return `<${name}>${children}</${name}>`;
}
function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function assertSafeXmlInput(xml: string): void {
  if (Buffer.byteLength(xml, 'utf8') > MAX_ISO_XML_BYTES) throw new Error('ISO 20022 XML exceeds the maximum permitted size');
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<\!\[CDATA\[/i.test(xml)) throw new Error('Unsafe XML constructs are not permitted');
}
function requireField(values: Record<string, string>, field: string): string {
  const value = values[field];
  if (!value) throw new Error(`Missing mandatory ISO 20022 element ${field}`);
  return value;
}

/**
 * Validates against a scheme-provided official XSD using libxml2's xmllint.
 * The deployment image must install libxml2-utils. Failure to execute the validator
 * is intentionally propagated; a certification path must not silently skip XSD checks.
 */
export class XmllintXsdValidator implements XsdValidator {
  async validate(xml: string, xsdPath: string): Promise<XsdValidationResult> {
    assertSafeXmlInput(xml);
    const workspace = await mkdtemp(join(tmpdir(), 'paymentswitch-iso-'));
    const xmlPath = join(workspace, 'message.xml');
    try {
      await readFile(xsdPath, 'utf8');
      await writeFile(xmlPath, xml, { encoding: 'utf8', mode: 0o600 });
      try {
        const result = await execFileAsync('xmllint', ['--noout', '--nonet', '--schema', xsdPath, xmlPath], { maxBuffer: 1_000_000 });
        return { valid: true, stdout: result.stdout, stderr: result.stderr };
      } catch (error: unknown) {
        const failed = error as { stdout?: string; stderr?: string; code?: number; cause?: unknown };
        if ((failed as { code?: string }).code === 'ENOENT' || (failed.cause as { code?: string } | undefined)?.code === 'ENOENT') {
          throw new Error('xmllint is required for official XSD validation but is not installed');
        }
        return { valid: false, stdout: failed.stdout ?? '', stderr: failed.stderr ?? String(error) };
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

export async function assertOfficialXsd(xml: string, xsdPath: string, validator: XsdValidator = new XmllintXsdValidator()): Promise<void> {
  const result = await validator.validate(xml, xsdPath);
  if (!result.valid) throw new Error(`ISO 20022 XSD validation failed: ${result.stderr || result.stdout || 'validator rejected message'}`);
}

export function createPacs008(input: Omit<IsoPayment, 'messageId' | 'uetr' | 'correlationId'> & Partial<Pick<IsoPayment, 'messageId' | 'uetr' | 'correlationId'>>): IsoPayment {
  return isoPaymentSchema.parse({
    ...input,
    messageId: input.messageId ?? `PS-${randomUUID()}`,
    uetr: input.uetr ?? randomUUID(),
    correlationId: input.correlationId ?? randomUUID(),
  });
}

export function createPacs002(input: Omit<IsoStatusReport, 'messageId'> & Partial<Pick<IsoStatusReport, 'messageId'>>): IsoStatusReport {
  return { ...input, messageId: input.messageId ?? `PS-STATUS-${randomUUID()}` };
}

export function createCamt056(input: Omit<IsoCancellationRequest, 'messageId'> & Partial<Pick<IsoCancellationRequest, 'messageId'>>): IsoCancellationRequest {
  return { ...input, messageId: input.messageId ?? `PS-CANCEL-${randomUUID()}` };
}

export function createCamt029(input: Omit<IsoResolution, 'messageId'> & Partial<Pick<IsoResolution, 'messageId'>>): IsoResolution {
  return { ...input, messageId: input.messageId ?? `PS-RESOLUTION-${randomUUID()}` };
}

export function pacs008ToXml(payment: IsoPayment, createdAt = new Date()): string {
  const p = isoPaymentSchema.parse(payment);
  const debtorAgent = element('Fr', element('FIId', element('FinInstnId', tag('BICFI', p.debtor.agent))));
  const creditorAgent = element('To', element('FIId', element('FinInstnId', tag('BICFI', p.creditor.agent))));
  const appHeader = element('AppHdr', debtorAgent + creditorAgent + tag('BizMsgIdr', p.messageId) + tag('MsgDefIdr', 'pacs.008.001.13') + tag('CreDt', createdAt.toISOString()) + tag('BizSvc', 'paymentswitch.realtime') + tag('PssblDplct', 'false'));
  const paymentId = element('PmtId', tag('InstrId', p.instructionId) + tag('EndToEndId', p.endToEndId) + tag('TxId', p.transactionId) + tag('UETR', p.uetr));
  const amount = `<Amt><InstdAmt Ccy="${escapeXml(p.currency)}">${escapeXml(p.amount)}</InstdAmt></Amt>`;
  const debtor = element('Dbtr', tag('Nm', p.debtor.name) + element('Id', element('PrvtId', element('Othr', tag('Id', p.debtor.account)))));
  const creditor = element('Cdtr', tag('Nm', p.creditor.name) + element('Id', element('PrvtId', element('Othr', tag('Id', p.creditor.account)))));
  const body = `<Document xmlns="${ISO_NAMESPACES['pacs.008.001.13']}">` + element('FIToFICstmrCdtTrf', element('GrpHdr', tag('MsgId', p.messageId) + tag('CreDtTm', createdAt.toISOString()) + tag('NbOfTxs', '1') + element('SttlmInf', tag('SttlmMtd', p.settlementMethod))) + element('CdtTrfTxInf', paymentId + amount + element('ReqdExctnDt', tag('Dt', p.requestedExecutionDate)) + debtor + element('DbtrAgt', element('FinInstnId', tag('BICFI', p.debtor.agent))) + element('CdtrAgt', element('FinInstnId', tag('BICFI', p.creditor.agent))) + creditor + (p.remittanceInformation ? element('RmtInf', tag('Ustrd', p.remittanceInformation)) : ''))) + `</Document>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Envelope xmlns="urn:iso:std:iso:20022:tech:xsd:head.001.001.03">${appHeader}${body}</Envelope>`;
}

export function pacs002ToXml(report: IsoStatusReport, createdAt = new Date()): string {
  const r = createPacs002(report);
  return `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="${ISO_NAMESPACES['pacs.002.001.15']}"><FIToFIPmtStsRpt><GrpHdr>${tag('MsgId', r.messageId)}${tag('CreDtTm', createdAt.toISOString())}</GrpHdr><OrgnlGrpInfAndSts>${tag('OrgnlMsgId', r.originalMessageId)}${tag('OrgnlMsgNmId', 'pacs.008.001.13')}</OrgnlGrpInfAndSts><TxInfAndSts>${tag('OrgnlInstrId', r.originalTransactionId)}${tag('OrgnlTxId', r.originalTransactionId)}${tag('OrgnlUETR', r.originalUetr)}${tag('TxSts', r.status)}${r.reasonCode ? `<StsRsnInf>${tag('Rsn', tag('Cd', r.reasonCode))}</StsRsnInf>` : ''}${r.additionalInformation ? `<AddtlInf>${escapeXml(r.additionalInformation)}</AddtlInf>` : ''}</TxInfAndSts></FIToFIPmtStsRpt></Document>`;
}

export function camt056ToXml(request: IsoCancellationRequest, createdAt = new Date()): string {
  const r = createCamt056(request);
  return `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="${ISO_NAMESPACES['camt.056.001.10']}"><FIToFIPmtCxlReq><Assgnmt>${tag('Id', r.messageId)}${tag('Assgnr', tag('Agt', tag('FinInstnId', tag('Othr', tag('Id', r.requestedBy)))))}${tag('AssgnDtTm', createdAt.toISOString())}</Assgnmt><Undrlyg>${tag('OrgnlGrpInf', tag('OrgnlMsgId', r.originalMessageId))}<TxInf>${tag('CxlId', r.messageId)}${tag('OrgnlInstrId', r.originalTransactionId)}${tag('OrgnlTxId', r.originalTransactionId)}${tag('OrgnlUETR', r.originalUetr)}${tag('CxlRsnInf', tag('Rsn', tag('Prtry', r.cancellationReason)))}</TxInf></Undrlyg></FIToFIPmtCxlReq></Document>`;
}

export function camt029ToXml(resolution: IsoResolution, createdAt = new Date()): string {
  const r = createCamt029(resolution);
  return `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="${ISO_NAMESPACES['camt.029.001.14']}"><RsltnOfInvstgtn><Assgnmt>${tag('Id', r.messageId)}${tag('CreDtTm', createdAt.toISOString())}</Assgnmt><RslvdCase><CaseId>${escapeXml(r.originalTransactionId)}</CaseId></RslvdCase><CxlDtls><TxInfAndSts>${tag('OrgnlGrpInf', tag('OrgnlMsgId', r.originalMessageId))}${tag('OrgnlUETR', r.originalUetr)}${tag('CxlSts', tag('Conf', r.resolution))}${r.reasonCode ? tag('Rsn', tag('Prtry', r.reasonCode)) : ''}</TxInfAndSts></CxlDtls></RsltnOfInvstgtn></Document>`;
}

/** Parses a single inbound pacs.008 document and rejects unsupported or unsafe XML. */
export function parsePacs008Xml(xml: string): ParsedIsoMessage<IsoPayment> {
  assertSafeXmlInput(xml);
  const values: Record<string, string> = {};
  let messageType: ISO20022MessageType | undefined;
  let businessService: string | undefined;
  let currency: string | undefined;
  let currentText = '';
  let currentPath: string[] = [];
  let parserError: Error | undefined;
  let rootSeen = false;
  let documentSeen = false;
  const parser = new SaxesParser({ xmlns: true, fragment: false, forceXMLVersion: true, defaultXMLVersion: '1.0' });
  parser.on('error', error => { parserError ??= error; });
  parser.on('opentag', (node: SaxesTagNS) => {
    if (parserError) return;
    if (currentPath.length >= 32) parserError = new Error('ISO 20022 XML nesting limit exceeded');
    currentPath.push(node.local);
    currentText = '';
    if (currentPath.length === 1) {
      rootSeen = node.local === 'Envelope';
      if (!rootSeen) parserError = new Error('ISO 20022 business message envelope is required');
    }
    if (node.local === 'Document') {
      documentSeen = true;
      const namespace = node.uri;
      const found = (Object.entries(ISO_NAMESPACES).find(([, value]) => value === namespace)?.[0]) as ISO20022MessageType | undefined;
      if (!found) parserError = new Error(`Unsupported ISO 20022 document namespace ${namespace || '(missing)'}`);
      else messageType = found;
    }
    if (node.local === 'InstdAmt') currency = node.attributes.Ccy?.value;
  });
  parser.on('text', text => {
    currentText += text;
    if (currentText.length > ISO_TEXT_LIMIT) parserError = new Error('ISO 20022 XML text node exceeds the maximum permitted size');
  });
  parser.on('closetag', (_node: SaxesTagNS) => {
    if (parserError) return;
    const path = currentPath.join('/');
    const value = currentText.trim();
    if (value) {
      if (path.endsWith('AppHdr/BizMsgIdr')) values.messageId = value;
      else if (path.endsWith('AppHdr/BizSvc')) businessService = value;
      else if (path.endsWith('CdtTrfTxInf/PmtId/InstrId')) values.instructionId = value;
      else if (path.endsWith('CdtTrfTxInf/PmtId/EndToEndId')) values.endToEndId = value;
      else if (path.endsWith('CdtTrfTxInf/PmtId/TxId')) values.transactionId = value;
      else if (path.endsWith('CdtTrfTxInf/PmtId/UETR')) values.uetr = value;
      else if (path.endsWith('CdtTrfTxInf/Amt/InstdAmt')) values.amount = value;
      else if (path.endsWith('CdtTrfTxInf/Dbtr/Nm')) values.debtorName = value;
      else if (path.endsWith('CdtTrfTxInf/Dbtr/Id/PrvtId/Othr/Id')) values.debtorAccount = value;
      else if (path.endsWith('CdtTrfTxInf/DbtrAgt/FinInstnId/BICFI')) values.debtorAgent = value;
      else if (path.endsWith('CdtTrfTxInf/Cdtr/Nm')) values.creditorName = value;
      else if (path.endsWith('CdtTrfTxInf/Cdtr/Id/PrvtId/Othr/Id')) values.creditorAccount = value;
      else if (path.endsWith('CdtTrfTxInf/CdtrAgt/FinInstnId/BICFI')) values.creditorAgent = value;
      else if (path.endsWith('CdtTrfTxInf/RmtInf/Ustrd')) values.remittanceInformation = value;
      else if (path.endsWith('GrpHdr/SttlmInf/SttlmMtd')) values.settlementMethod = value;
      else if (path.endsWith('CdtTrfTxInf/ReqdExctnDt/Dt')) values.requestedExecutionDate = value;
    }
    currentPath.pop();
    currentText = '';
  });
  try {
    parser.write(xml).close();
  } catch (error) {
    throw new Error(`Invalid ISO 20022 XML: ${String(error)}`);
  }
  if (parserError) throw new Error(`Invalid ISO 20022 XML: ${parserError.message}`);
  if (!rootSeen || !documentSeen || messageType !== 'pacs.008.001.13') throw new Error('Inbound message is not a supported pacs.008.001.13 envelope');
  const message = isoPaymentSchema.parse({
    messageId: requireField(values, 'messageId'),
    uetr: requireField(values, 'uetr'),
    instructionId: requireField(values, 'instructionId'),
    endToEndId: requireField(values, 'endToEndId'),
    transactionId: requireField(values, 'transactionId'),
    amount: requireField(values, 'amount'),
    currency: currency ?? '',
    debtor: { name: requireField(values, 'debtorName'), account: requireField(values, 'debtorAccount'), agent: requireField(values, 'debtorAgent') },
    creditor: { name: requireField(values, 'creditorName'), account: requireField(values, 'creditorAccount'), agent: requireField(values, 'creditorAgent') },
    settlementMethod: requireField(values, 'settlementMethod'),
    requestedExecutionDate: requireField(values, 'requestedExecutionDate'),
    remittanceInformation: values.remittanceInformation,
    correlationId: randomUUID(),
  });
  return { messageType, businessService, message, payloadSha256: sha256(xml) };
}

export function assertIsoMessage(xml: string, expectedType?: ISO20022MessageType): void {
  assertSafeXmlInput(xml);
  if (!xml.startsWith('<?xml') || !xml.includes('<Document')) throw new Error('Invalid ISO 20022 XML envelope');
  if (expectedType && !xml.includes(ISO_NAMESPACES[expectedType])) throw new Error(`Expected ISO 20022 message ${expectedType}`);
}
