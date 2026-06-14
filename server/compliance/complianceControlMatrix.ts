/**
 * Compliance Control Matrix
 * 
 * Provides comprehensive compliance tracking for:
 * - PCI DSS requirements
 * - AML/KYC regulations
 * - GDPR/NDPR data protection
 * - SOC2 controls
 * - Local regulatory requirements
 */

import crypto from 'crypto';

export interface ComplianceControl {
  id: string;
  framework: ComplianceFramework;
  category: string;
  requirement: string;
  description: string;
  status: ControlStatus;
  evidence: ControlEvidence[];
  owner: string;
  dueDate?: Date;
  lastAssessed?: Date;
  nextAssessment?: Date;
  risk: RiskLevel;
  remediation?: string;
  notes?: string;
}

export type ComplianceFramework = 'PCI_DSS' | 'AML_KYC' | 'GDPR' | 'NDPR' | 'SOC2' | 'CBN' | 'ISO27001';
export type ControlStatus = 'compliant' | 'non_compliant' | 'partial' | 'not_applicable' | 'not_assessed';
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

export interface ControlEvidence {
  id: string;
  type: 'document' | 'screenshot' | 'log' | 'test_result' | 'audit_report';
  description: string;
  location: string;
  collectedAt: Date;
  collectedBy: string;
  validUntil?: Date;
}

export interface ComplianceAssessment {
  id: string;
  framework: ComplianceFramework;
  assessmentDate: Date;
  assessor: string;
  scope: string;
  findings: AssessmentFinding[];
  overallStatus: ControlStatus;
  score: number;
  recommendations: string[];
}

export interface AssessmentFinding {
  controlId: string;
  status: ControlStatus;
  finding: string;
  risk: RiskLevel;
  remediation?: string;
  dueDate?: Date;
}

export interface ComplianceReport {
  id: string;
  generatedAt: Date;
  framework: ComplianceFramework;
  period: { start: Date; end: Date };
  summary: ComplianceSummary;
  controls: ComplianceControl[];
  gaps: ComplianceGap[];
  recommendations: string[];
}

export interface ComplianceSummary {
  totalControls: number;
  compliant: number;
  nonCompliant: number;
  partial: number;
  notAssessed: number;
  complianceRate: number;
  criticalGaps: number;
  highGaps: number;
}

export interface ComplianceGap {
  controlId: string;
  requirement: string;
  currentState: string;
  targetState: string;
  risk: RiskLevel;
  remediationPlan: string;
  estimatedEffort: string;
  priority: number;
}

/**
 * Compliance Control Matrix Manager
 */
export class ComplianceControlMatrix {
  private controls: Map<string, ComplianceControl> = new Map();
  private assessments: Map<string, ComplianceAssessment> = new Map();

  constructor() {
    this.initializeControls();
  }

  /**
   * Initialize default compliance controls
   */
  private initializeControls(): void {
    // PCI DSS Controls
    this.addPCIDSSControls();
    
    // AML/KYC Controls
    this.addAMLKYCControls();
    
    // GDPR/NDPR Controls
    this.addDataProtectionControls();
    
    // SOC2 Controls
    this.addSOC2Controls();
    
    // CBN (Central Bank of Nigeria) Controls
    this.addCBNControls();
  }

  /**
   * Add PCI DSS controls
   */
  private addPCIDSSControls(): void {
    const pciControls: Omit<ComplianceControl, 'id' | 'evidence'>[] = [
      {
        framework: 'PCI_DSS',
        category: 'Network Security',
        requirement: 'PCI-DSS 1.1',
        description: 'Install and maintain a firewall configuration to protect cardholder data',
        status: 'compliant',
        owner: 'Security Team',
        risk: 'high',
        notes: 'OpenAppSec WAF deployed on all nodes'
      },
      {
        framework: 'PCI_DSS',
        category: 'Network Security',
        requirement: 'PCI-DSS 1.2',
        description: 'Build firewall and router configurations that restrict connections',
        status: 'compliant',
        owner: 'Security Team',
        risk: 'high',
        notes: 'Network policies implemented in Kubernetes'
      },
      {
        framework: 'PCI_DSS',
        category: 'Data Protection',
        requirement: 'PCI-DSS 3.4',
        description: 'Render PAN unreadable anywhere it is stored',
        status: 'compliant',
        owner: 'Development Team',
        risk: 'critical',
        notes: 'AES-256 encryption for all card data'
      },
      {
        framework: 'PCI_DSS',
        category: 'Access Control',
        requirement: 'PCI-DSS 7.1',
        description: 'Limit access to system components to only those individuals whose job requires such access',
        status: 'compliant',
        owner: 'Security Team',
        risk: 'high',
        notes: 'Permify RBAC implemented'
      },
      {
        framework: 'PCI_DSS',
        category: 'Access Control',
        requirement: 'PCI-DSS 8.1',
        description: 'Define and implement policies and procedures to ensure proper user identification management',
        status: 'compliant',
        owner: 'Security Team',
        risk: 'high',
        notes: 'Keycloak SSO with MFA'
      },
      {
        framework: 'PCI_DSS',
        category: 'Monitoring',
        requirement: 'PCI-DSS 10.1',
        description: 'Implement audit trails to link all access to system components to each individual user',
        status: 'compliant',
        owner: 'Security Team',
        risk: 'high',
        notes: 'Comprehensive audit logging with OpenTelemetry'
      },
      {
        framework: 'PCI_DSS',
        category: 'Vulnerability Management',
        requirement: 'PCI-DSS 6.1',
        description: 'Establish a process to identify security vulnerabilities',
        status: 'partial',
        owner: 'Security Team',
        risk: 'high',
        remediation: 'Implement automated vulnerability scanning in CI/CD'
      },
      {
        framework: 'PCI_DSS',
        category: 'Testing',
        requirement: 'PCI-DSS 11.2',
        description: 'Run internal and external network vulnerability scans at least quarterly',
        status: 'partial',
        owner: 'Security Team',
        risk: 'medium',
        remediation: 'Schedule quarterly penetration testing'
      }
    ];

    for (const control of pciControls) {
      this.addControl(control);
    }
  }

  /**
   * Add AML/KYC controls
   */
  private addAMLKYCControls(): void {
    const amlControls: Omit<ComplianceControl, 'id' | 'evidence'>[] = [
      {
        framework: 'AML_KYC',
        category: 'Customer Due Diligence',
        requirement: 'AML-CDD-1',
        description: 'Verify customer identity before establishing business relationship',
        status: 'compliant',
        owner: 'Compliance Team',
        risk: 'critical',
        notes: 'Smile Identity integration for BVN/NIN verification'
      },
      {
        framework: 'AML_KYC',
        category: 'Customer Due Diligence',
        requirement: 'AML-CDD-2',
        description: 'Perform enhanced due diligence for high-risk customers',
        status: 'compliant',
        owner: 'Compliance Team',
        risk: 'high',
        notes: 'Risk-based KYC tiers implemented'
      },
      {
        framework: 'AML_KYC',
        category: 'Transaction Monitoring',
        requirement: 'AML-TM-1',
        description: 'Monitor transactions for suspicious activity',
        status: 'compliant',
        owner: 'Compliance Team',
        risk: 'critical',
        notes: 'ML-based fraud detection with GNN'
      },
      {
        framework: 'AML_KYC',
        category: 'Sanctions Screening',
        requirement: 'AML-SS-1',
        description: 'Screen customers and transactions against sanctions lists',
        status: 'compliant',
        owner: 'Compliance Team',
        risk: 'critical',
        notes: 'Real-time sanctions screening integrated'
      },
      {
        framework: 'AML_KYC',
        category: 'Record Keeping',
        requirement: 'AML-RK-1',
        description: 'Maintain records of customer identification and transactions for 5 years',
        status: 'compliant',
        owner: 'Compliance Team',
        risk: 'high',
        notes: 'Automated retention policies in place'
      },
      {
        framework: 'AML_KYC',
        category: 'Reporting',
        requirement: 'AML-RPT-1',
        description: 'File Suspicious Activity Reports (SARs) within required timeframes',
        status: 'compliant',
        owner: 'Compliance Team',
        risk: 'critical',
        notes: 'Automated SAR generation workflow'
      }
    ];

    for (const control of amlControls) {
      this.addControl(control);
    }
  }

  /**
   * Add GDPR/NDPR data protection controls
   */
  private addDataProtectionControls(): void {
    const dataControls: Omit<ComplianceControl, 'id' | 'evidence'>[] = [
      {
        framework: 'GDPR',
        category: 'Lawful Basis',
        requirement: 'GDPR-6',
        description: 'Process personal data only with valid lawful basis',
        status: 'compliant',
        owner: 'Legal Team',
        risk: 'high',
        notes: 'Consent management implemented'
      },
      {
        framework: 'GDPR',
        category: 'Data Subject Rights',
        requirement: 'GDPR-15-20',
        description: 'Implement data subject rights (access, rectification, erasure, portability)',
        status: 'compliant',
        owner: 'Development Team',
        risk: 'high',
        notes: 'Self-service data export and deletion available'
      },
      {
        framework: 'GDPR',
        category: 'Data Protection',
        requirement: 'GDPR-32',
        description: 'Implement appropriate technical and organizational security measures',
        status: 'compliant',
        owner: 'Security Team',
        risk: 'high',
        notes: 'Encryption at rest and in transit'
      },
      {
        framework: 'GDPR',
        category: 'Breach Notification',
        requirement: 'GDPR-33-34',
        description: 'Notify authorities and data subjects of breaches within 72 hours',
        status: 'compliant',
        owner: 'Security Team',
        risk: 'critical',
        notes: 'Incident response playbook in place'
      },
      {
        framework: 'NDPR',
        category: 'Biometric Data',
        requirement: 'NDPR-2.3',
        description: 'Obtain explicit consent for biometric data processing',
        status: 'compliant',
        owner: 'Legal Team',
        risk: 'critical',
        notes: 'Biometric consent flow implemented'
      },
      {
        framework: 'NDPR',
        category: 'Data Localization',
        requirement: 'NDPR-2.11',
        description: 'Store and process Nigerian personal data within Nigeria',
        status: 'partial',
        owner: 'Infrastructure Team',
        risk: 'high',
        remediation: 'Deploy additional data centers in Nigeria'
      }
    ];

    for (const control of dataControls) {
      this.addControl(control);
    }
  }

  /**
   * Add SOC2 controls
   */
  private addSOC2Controls(): void {
    const soc2Controls: Omit<ComplianceControl, 'id' | 'evidence'>[] = [
      {
        framework: 'SOC2',
        category: 'Security',
        requirement: 'CC6.1',
        description: 'Logical and physical access controls',
        status: 'compliant',
        owner: 'Security Team',
        risk: 'high',
        notes: 'Keycloak + Permify access control'
      },
      {
        framework: 'SOC2',
        category: 'Availability',
        requirement: 'A1.1',
        description: 'System availability commitments and SLAs',
        status: 'compliant',
        owner: 'Operations Team',
        risk: 'high',
        notes: 'HA configurations for all services'
      },
      {
        framework: 'SOC2',
        category: 'Processing Integrity',
        requirement: 'PI1.1',
        description: 'System processing is complete, accurate, timely, and authorized',
        status: 'compliant',
        owner: 'Development Team',
        risk: 'high',
        notes: 'Ledger reconciliation and audit trails'
      },
      {
        framework: 'SOC2',
        category: 'Confidentiality',
        requirement: 'C1.1',
        description: 'Confidential information is protected',
        status: 'compliant',
        owner: 'Security Team',
        risk: 'high',
        notes: 'Encryption and access controls'
      },
      {
        framework: 'SOC2',
        category: 'Change Management',
        requirement: 'CC8.1',
        description: 'Changes to infrastructure and software are authorized and tested',
        status: 'compliant',
        owner: 'Development Team',
        risk: 'medium',
        notes: 'CI/CD with approval gates'
      },
      {
        framework: 'SOC2',
        category: 'Risk Assessment',
        requirement: 'CC3.1',
        description: 'Risk assessment process is in place',
        status: 'partial',
        owner: 'Security Team',
        risk: 'medium',
        remediation: 'Formalize quarterly risk assessments'
      }
    ];

    for (const control of soc2Controls) {
      this.addControl(control);
    }
  }

  /**
   * Add CBN regulatory controls
   */
  private addCBNControls(): void {
    const cbnControls: Omit<ComplianceControl, 'id' | 'evidence'>[] = [
      {
        framework: 'CBN',
        category: 'Licensing',
        requirement: 'CBN-PSP-1',
        description: 'Obtain and maintain Payment Service Provider license',
        status: 'not_assessed',
        owner: 'Legal Team',
        risk: 'critical',
        notes: 'License application in progress'
      },
      {
        framework: 'CBN',
        category: 'Capital Requirements',
        requirement: 'CBN-CAP-1',
        description: 'Maintain minimum capital requirements',
        status: 'not_assessed',
        owner: 'Finance Team',
        risk: 'critical'
      },
      {
        framework: 'CBN',
        category: 'Transaction Limits',
        requirement: 'CBN-TXN-1',
        description: 'Enforce transaction limits per customer tier',
        status: 'compliant',
        owner: 'Development Team',
        risk: 'high',
        notes: 'KYC-based transaction limits implemented'
      },
      {
        framework: 'CBN',
        category: 'Reporting',
        requirement: 'CBN-RPT-1',
        description: 'Submit required regulatory reports',
        status: 'compliant',
        owner: 'Compliance Team',
        risk: 'high',
        notes: 'Automated regulatory reporting'
      }
    ];

    for (const control of cbnControls) {
      this.addControl(control);
    }
  }

  /**
   * Add a control to the matrix
   */
  addControl(control: Omit<ComplianceControl, 'id' | 'evidence'>): ComplianceControl {
    const fullControl: ComplianceControl = {
      ...control,
      id: crypto.randomUUID(),
      evidence: []
    };
    this.controls.set(fullControl.id, fullControl);
    return fullControl;
  }

  /**
   * Update control status
   */
  updateControlStatus(controlId: string, status: ControlStatus, notes?: string): void {
    const control = this.controls.get(controlId);
    if (control) {
      control.status = status;
      control.lastAssessed = new Date();
      if (notes) control.notes = notes;
    }
  }

  /**
   * Add evidence to a control
   */
  addEvidence(controlId: string, evidence: Omit<ControlEvidence, 'id'>): void {
    const control = this.controls.get(controlId);
    if (control) {
      control.evidence.push({
        ...evidence,
        id: crypto.randomUUID()
      });
    }
  }

  /**
   * Get controls by framework
   */
  getControlsByFramework(framework: ComplianceFramework): ComplianceControl[] {
    return Array.from(this.controls.values()).filter(c => c.framework === framework);
  }

  /**
   * Get controls by status
   */
  getControlsByStatus(status: ControlStatus): ComplianceControl[] {
    return Array.from(this.controls.values()).filter(c => c.status === status);
  }

  /**
   * Get all controls
   */
  getAllControls(): ComplianceControl[] {
    return Array.from(this.controls.values());
  }

  /**
   * Generate compliance summary
   */
  generateSummary(framework?: ComplianceFramework): ComplianceSummary {
    const controls = framework 
      ? this.getControlsByFramework(framework)
      : this.getAllControls();

    const summary: ComplianceSummary = {
      totalControls: controls.length,
      compliant: controls.filter(c => c.status === 'compliant').length,
      nonCompliant: controls.filter(c => c.status === 'non_compliant').length,
      partial: controls.filter(c => c.status === 'partial').length,
      notAssessed: controls.filter(c => c.status === 'not_assessed').length,
      complianceRate: 0,
      criticalGaps: controls.filter(c => c.status !== 'compliant' && c.risk === 'critical').length,
      highGaps: controls.filter(c => c.status !== 'compliant' && c.risk === 'high').length
    };

    const assessedControls = summary.totalControls - summary.notAssessed;
    summary.complianceRate = assessedControls > 0 
      ? (summary.compliant / assessedControls) * 100 
      : 0;

    return summary;
  }

  /**
   * Identify compliance gaps
   */
  identifyGaps(): ComplianceGap[] {
    const gaps: ComplianceGap[] = [];
    
    for (const control of Array.from(this.controls.values())) {
      if (control.status !== 'compliant' && control.status !== 'not_applicable') {
        gaps.push({
          controlId: control.id,
          requirement: control.requirement,
          currentState: control.status,
          targetState: 'compliant',
          risk: control.risk,
          remediationPlan: control.remediation || 'Remediation plan required',
          estimatedEffort: this.estimateEffort(control),
          priority: this.calculatePriority(control)
        });
      }
    }

    return gaps.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Estimate remediation effort
   */
  private estimateEffort(control: ComplianceControl): string {
    if (control.status === 'partial') return '1-2 weeks';
    if (control.status === 'non_compliant') return '2-4 weeks';
    if (control.status === 'not_assessed') return 'Assessment required';
    return 'Unknown';
  }

  /**
   * Calculate priority score (lower is higher priority)
   */
  private calculatePriority(control: ComplianceControl): number {
    let priority = 100;
    
    // Risk-based priority
    if (control.risk === 'critical') priority -= 40;
    else if (control.risk === 'high') priority -= 30;
    else if (control.risk === 'medium') priority -= 20;
    else priority -= 10;

    // Status-based priority
    if (control.status === 'non_compliant') priority -= 30;
    else if (control.status === 'partial') priority -= 20;
    else if (control.status === 'not_assessed') priority -= 10;

    // Framework-based priority (regulatory > industry)
    if (control.framework === 'CBN' || control.framework === 'AML_KYC') priority -= 20;
    else if (control.framework === 'PCI_DSS') priority -= 15;
    else if (control.framework === 'GDPR' || control.framework === 'NDPR') priority -= 10;

    return priority;
  }

  /**
   * Generate compliance report
   */
  generateReport(framework?: ComplianceFramework): ComplianceReport {
    const controls = framework 
      ? this.getControlsByFramework(framework)
      : this.getAllControls();

    const gaps = this.identifyGaps().filter(g => 
      !framework || controls.some(c => c.id === g.controlId)
    );

    const recommendations: string[] = [];
    
    // Generate recommendations based on gaps
    if (gaps.some(g => g.risk === 'critical')) {
      recommendations.push('Address critical compliance gaps immediately');
    }
    if (gaps.filter(g => g.risk === 'high').length > 3) {
      recommendations.push('Prioritize high-risk control remediation');
    }
    if (controls.filter(c => c.status === 'not_assessed').length > 0) {
      recommendations.push('Complete assessment of all controls');
    }

    return {
      id: crypto.randomUUID(),
      generatedAt: new Date(),
      framework: framework || 'PCI_DSS',
      period: {
        start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        end: new Date()
      },
      summary: this.generateSummary(framework),
      controls,
      gaps,
      recommendations
    };
  }

  /**
   * Generate text report
   */
  generateTextReport(framework?: ComplianceFramework): string {
    const report = this.generateReport(framework);
    const lines: string[] = [
      '='.repeat(70),
      'COMPLIANCE CONTROL MATRIX REPORT',
      '='.repeat(70),
      '',
      `Generated: ${report.generatedAt.toISOString()}`,
      `Framework: ${framework || 'All Frameworks'}`,
      `Period: ${report.period.start.toISOString()} - ${report.period.end.toISOString()}`,
      '',
      '-'.repeat(70),
      'SUMMARY',
      '-'.repeat(70),
      `Total Controls: ${report.summary.totalControls}`,
      `Compliant: ${report.summary.compliant} (${report.summary.complianceRate.toFixed(1)}%)`,
      `Non-Compliant: ${report.summary.nonCompliant}`,
      `Partial: ${report.summary.partial}`,
      `Not Assessed: ${report.summary.notAssessed}`,
      `Critical Gaps: ${report.summary.criticalGaps}`,
      `High-Risk Gaps: ${report.summary.highGaps}`,
      ''
    ];

    if (report.gaps.length > 0) {
      lines.push('-'.repeat(70));
      lines.push('COMPLIANCE GAPS');
      lines.push('-'.repeat(70));
      
      for (const gap of report.gaps) {
        const control = this.controls.get(gap.controlId);
        lines.push(`[${gap.risk.toUpperCase()}] ${gap.requirement}`);
        lines.push(`  Status: ${gap.currentState}`);
        lines.push(`  Remediation: ${gap.remediationPlan}`);
        lines.push(`  Effort: ${gap.estimatedEffort}`);
        lines.push('');
      }
    }

    if (report.recommendations.length > 0) {
      lines.push('-'.repeat(70));
      lines.push('RECOMMENDATIONS');
      lines.push('-'.repeat(70));
      for (const rec of report.recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push('');
    }

    lines.push('='.repeat(70));
    lines.push('END OF REPORT');
    lines.push('='.repeat(70));

    return lines.join('\n');
  }
}

// Singleton instance
let complianceMatrixInstance: ComplianceControlMatrix | null = null;

export function getComplianceControlMatrix(): ComplianceControlMatrix {
  if (!complianceMatrixInstance) {
    complianceMatrixInstance = new ComplianceControlMatrix();
  }
  return complianceMatrixInstance;
}

export default ComplianceControlMatrix;
