#!/usr/bin/env python3
"""
Enhanced Wazuh-OpenCTI Integration Script
Sends critical Wazuh alerts (level 12) to OpenCTI as incidents with full context
"""

import json
import sys
import os
import logging
from datetime import datetime
from typing import Dict, List, Optional
from pycti import OpenCTIApiClient

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/var/ossec/logs/opencti_integration.log'),
        logging.StreamHandler(sys.stderr)
    ]
)
logger = logging.getLogger(__name__)

# Configuration
OPENCTI_URL = os.getenv('OPENCTI_URL', 'http://opencti-platform.security.svc.cluster.local:8080')
OPENCTI_TOKEN = os.getenv('OPENCTI_TOKEN', '').strip()
if not OPENCTI_TOKEN:
    logger.error('OPENCTI_TOKEN must be injected by the managed secret store')
    sys.exit(1)

# Initialize OpenCTI client only after the managed token is present.
try:
    opencti_api_client = OpenCTIApiClient(OPENCTI_URL, OPENCTI_TOKEN)
    logger.info("OpenCTI API client initialized successfully")
except Exception as e:
    logger.error(f"Failed to initialize OpenCTI API client: {e}")
    sys.exit(1)

# Severity mapping
SEVERITY_MAPPING = {
    12: 'critical',
    10: 'high',
    8: 'medium',
    5: 'low'
}

# Incident type mapping based on rule groups
INCIDENT_TYPE_MAPPING = {
    'authentication_failures': 'Authentication Failure',
    'brute_force': 'Authentication Failure',
    'unauthorized_execution': 'Unauthorized Execution',
    'privilege_escalation': 'Privilege Escalation',
    'api_abuse': 'API Abuse',
    'dos': 'DoS Attack',
    'attack': 'Wazuh Security Alert',
    'fraud': 'Fraud Detection',
    'money_laundering': 'Fraud Detection',
    'data_access': 'Data Exfiltration',
    'enumeration': 'Data Exfiltration'
}

def parse_wazuh_alert(alert_json: str) -> Optional[Dict]:
    """Parse Wazuh alert JSON"""
    try:
        alert = json.loads(alert_json)
        logger.info(f"Parsed Wazuh alert: Rule {alert['rule']['id']}")
        return alert
    except json.JSONDecodeError as e:
        logger.error(f"Error parsing alert JSON: {e}")
        return None
    except KeyError as e:
        logger.error(f"Missing required field in alert: {e}")
        return None

def determine_severity(alert: Dict) -> str:
    """Determine incident severity from alert level"""
    alert_level = alert['rule'].get('level', 0)
    return SEVERITY_MAPPING.get(alert_level, 'low')

def determine_incident_type(alert: Dict) -> str:
    """Determine incident type from alert groups"""
    groups = alert['rule'].get('groups', [])
    
    for group in groups:
        if group in INCIDENT_TYPE_MAPPING:
            return INCIDENT_TYPE_MAPPING[group]
    
    return 'Wazuh Security Alert'

def get_or_create_incident_type(incident_type_name: str) -> Optional[str]:
    """Get or create incident type in OpenCTI"""
    try:
        # Search for existing incident type
        incident_types = opencti_api_client.incident_type.list(
            filters=[{
                'key': 'name',
                'values': [incident_type_name]
            }]
        )
        
        if incident_types:
            logger.info(f"Found existing incident type: {incident_type_name}")
            return incident_types[0]['id']
        
        # Create new incident type
        incident_type = opencti_api_client.incident_type.create(
            name=incident_type_name,
            description=f"Incident type for {incident_type_name}"
        )
        logger.info(f"Created new incident type: {incident_type_name}")
        return incident_type['id']
        
    except Exception as e:
        logger.error(f"Error getting/creating incident type: {e}")
        return None

def get_or_create_label(label_value: str, color: str = '#ff5722') -> Optional[str]:
    """Get or create label in OpenCTI"""
    try:
        # Search for existing label
        labels = opencti_api_client.label.list(
            filters=[{
                'key': 'value',
                'values': [label_value]
            }]
        )
        
        if labels:
            return labels[0]['id']
        
        # Create new label
        label = opencti_api_client.label.create(
            value=label_value,
            color=color
        )
        logger.info(f"Created new label: {label_value}")
        return label['id']
        
    except Exception as e:
        logger.error(f"Error getting/creating label: {e}")
        return None

def extract_indicators(alert: Dict) -> List[Dict]:
    """Extract indicators from Wazuh alert"""
    indicators = []
    data = alert.get('data', {})
    
    # Extract IP addresses
    if 'srcip' in data:
        indicators.append({
            'type': 'IPv4-Addr',
            'value': data['srcip'],
            'description': f"Source IP from Wazuh alert {alert['rule']['id']}"
        })
    
    if 'source_ip' in data:
        indicators.append({
            'type': 'IPv4-Addr',
            'value': data['source_ip'],
            'description': f"Source IP from Wazuh alert {alert['rule']['id']}"
        })
    
    # Extract user accounts
    if 'user' in data:
        indicators.append({
            'type': 'User-Account',
            'value': data['user'],
            'description': f"User account from Wazuh alert {alert['rule']['id']}"
        })
    
    if 'user_id' in data:
        indicators.append({
            'type': 'User-Account',
            'value': data['user_id'],
            'description': f"User ID from Wazuh alert {alert['rule']['id']}"
        })
    
    # Extract account IDs
    if 'account_id' in data:
        indicators.append({
            'type': 'Text',
            'value': data['account_id'],
            'description': f"Account ID from Wazuh alert {alert['rule']['id']}"
        })
    
    # Extract workflow IDs
    if 'workflow_id' in data:
        indicators.append({
            'type': 'Text',
            'value': data['workflow_id'],
            'description': f"Workflow ID from Wazuh alert {alert['rule']['id']}"
        })
    
    # Extract API keys
    if 'api_key' in data:
        indicators.append({
            'type': 'Text',
            'value': data['api_key'],
            'description': f"API key from Wazuh alert {alert['rule']['id']}"
        })
    
    logger.info(f"Extracted {len(indicators)} indicators from alert")
    return indicators

def create_opencti_incident(alert: Dict) -> Optional[Dict]:
    """Create an incident in OpenCTI from Wazuh alert"""
    try:
        # Determine severity and incident type
        severity = determine_severity(alert)
        incident_type_name = determine_incident_type(alert)
        
        # Get or create incident type
        incident_type_id = get_or_create_incident_type(incident_type_name)
        
        # Create labels
        labels = []
        labels.append(get_or_create_label('wazuh-alert'))
        
        # Add service-specific labels
        if 'go-ledger' in alert['rule'].get('groups', []):
            labels.append(get_or_create_label('go-ledger', '#4caf50'))
        if 'workflow-orchestrator' in alert['rule'].get('groups', []):
            labels.append(get_or_create_label('workflow-orchestrator', '#2196f3'))
        
        # Add severity label
        labels.append(get_or_create_label(severity, '#f44336' if severity == 'critical' else '#ff9800'))
        
        # Add compliance labels
        groups = alert['rule'].get('groups', [])
        if any('pci_dss' in g for g in groups):
            labels.append(get_or_create_label('pci-dss', '#607d8b'))
        if any('gdpr' in g for g in groups):
            labels.append(get_or_create_label('gdpr', '#795548'))
        if any('hipaa' in g for g in groups):
            labels.append(get_or_create_label('hipaa', '#9e9e9e'))
        
        # Remove None values
        labels = [l for l in labels if l is not None]
        
        # Build incident description
        incident_name = f"Wazuh Alert: {alert['rule']['description']}"
        incident_description = f"""
## Wazuh Security Alert

**Rule ID**: {alert['rule']['id']}  
**Rule Description**: {alert['rule']['description']}  
**Alert Level**: {alert['rule']['level']}  
**Severity**: {severity.upper()}  
**Timestamp**: {alert['timestamp']}

### Alert Details

```json
{json.dumps(alert.get('data', {}), indent=2)}
```

### Agent Information

- **Agent Name**: {alert.get('agent', {}).get('name', 'Unknown')}
- **Agent ID**: {alert.get('agent', {}).get('id', 'Unknown')}
- **Manager**: {alert.get('manager', {}).get('name', 'Unknown')}

### MITRE ATT&CK Techniques

{', '.join(alert['rule'].get('mitre', {}).get('id', ['None']))}

### Compliance Frameworks

{', '.join([g for g in alert['rule'].get('groups', []) if 'pci_dss' in g or 'gdpr' in g or 'hipaa' in g or 'nist' in g])}

### Rule Groups

{', '.join(alert['rule'].get('groups', []))}
"""
        
        # Create incident
        incident = opencti_api_client.incident.create(
            name=incident_name,
            description=incident_description,
            severity=severity,
            incident_type=incident_type_id,
            objective=alert['rule']['description'],
            first_seen=alert['timestamp'],
            last_seen=alert['timestamp'],
            labels=labels,
            created_by=None,
            confidence=80
        )
        
        logger.info(f"Created OpenCTI incident: {incident['id']}")
        return incident
        
    except Exception as e:
        logger.error(f"Error creating OpenCTI incident: {e}", exc_info=True)
        return None

def create_opencti_observables(alert: Dict, incident_id: str) -> bool:
    """Create observables in OpenCTI from alert indicators"""
    try:
        indicators = extract_indicators(alert)
        
        for indicator in indicators:
            try:
                # Create observable based on type
                if indicator['type'] == 'IPv4-Addr':
                    observable = opencti_api_client.stix_cyber_observable.create(
                        observableData={
                            'type': 'ipv4-addr',
                            'value': indicator['value']
                        }
                    )
                elif indicator['type'] == 'User-Account':
                    observable = opencti_api_client.stix_cyber_observable.create(
                        observableData={
                            'type': 'user-account',
                            'account_login': indicator['value']
                        }
                    )
                else:
                    # Generic text observable
                    observable = opencti_api_client.stix_cyber_observable.create(
                        observableData={
                            'type': 'text',
                            'value': indicator['value']
                        }
                    )
                
                # Link observable to incident
                opencti_api_client.stix_core_relationship.create(
                    fromId=incident_id,
                    toId=observable['id'],
                    relationship_type='related-to',
                    description=indicator['description'],
                    confidence=70
                )
                
                logger.info(f"Created observable: {observable['id']}")
                
            except Exception as e:
                logger.error(f"Error creating observable {indicator['value']}: {e}")
                continue
        
        return True
        
    except Exception as e:
        logger.error(f"Error creating OpenCTI observables: {e}")
        return False

def create_opencti_indicator(alert: Dict, incident_id: str) -> Optional[Dict]:
    """Create indicator in OpenCTI from Wazuh alert"""
    try:
        data = alert.get('data', {})
        
        # Extract primary indicator (IP address)
        srcip = data.get('srcip') or data.get('source_ip')
        
        if not srcip:
            logger.info("No IP address found in alert, skipping indicator creation")
            return None
        
        # Create indicator
        indicator = opencti_api_client.indicator.create(
            name=f"Malicious IP from Wazuh: {srcip}",
            description=f"IP address detected in Wazuh alert {alert['rule']['id']}: {alert['rule']['description']}",
            pattern=f"[ipv4-addr:value = '{srcip}']",
            pattern_type='stix',
            valid_from=alert['timestamp'],
            x_opencti_main_observable_type='IPv4-Addr',
            confidence=75
        )
        
        # Link indicator to incident
        opencti_api_client.stix_core_relationship.create(
            fromId=incident_id,
            toId=indicator['id'],
            relationship_type='indicates',
            description=f"Indicator from Wazuh alert {alert['rule']['id']}",
            confidence=75
        )
        
        logger.info(f"Created indicator: {indicator['id']}")
        return indicator
        
    except Exception as e:
        logger.error(f"Error creating OpenCTI indicator: {e}")
        return None

def enrich_with_threat_intelligence(alert: Dict) -> List[Dict]:
    """Query OpenCTI for existing threat intelligence on indicators"""
    try:
        data = alert.get('data', {})
        srcip = data.get('srcip') or data.get('source_ip')
        
        if not srcip:
            return []
        
        # Search for existing indicators
        indicators = opencti_api_client.indicator.list(
            filters=[{
                'key': 'pattern',
                'values': [srcip],
                'operator': 'match'
            }]
        )
        
        if indicators:
            logger.info(f"Found {len(indicators)} existing indicators for {srcip}")
            return indicators
        
        return []
        
    except Exception as e:
        logger.error(f"Error querying threat intelligence: {e}")
        return []

def main():
    """Main function"""
    # Read alert from stdin
    alert_json = sys.stdin.read()
    
    if not alert_json:
        logger.error("No alert data received")
        sys.exit(1)
    
    # Parse alert
    alert = parse_wazuh_alert(alert_json)
    if not alert:
        sys.exit(1)
    
    # Check if this is a critical alert that should trigger OpenCTI integration
    if 'opencti_integration' not in alert['rule'].get('groups', []):
        logger.info(f"Alert {alert['rule']['id']} does not require OpenCTI integration")
        sys.exit(0)
    
    logger.info(f"Processing Wazuh alert {alert['rule']['id']} for OpenCTI integration")
    
    # Enrich with existing threat intelligence
    existing_ti = enrich_with_threat_intelligence(alert)
    if existing_ti:
        logger.info(f"Alert matches existing threat intelligence: {len(existing_ti)} indicators found")
    
    # Create incident in OpenCTI
    incident = create_opencti_incident(alert)
    if not incident:
        logger.error("Failed to create OpenCTI incident")
        sys.exit(1)
    
    # Create observables
    create_opencti_observables(alert, incident['id'])
    
    # Create indicator
    create_opencti_indicator(alert, incident['id'])
    
    logger.info(f"Successfully processed alert and created OpenCTI incident {incident['id']}")
    sys.exit(0)

if __name__ == '__main__':
    main()
