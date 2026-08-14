#!/usr/bin/env python3
"""
Wazuh-OpenCTI Integration Script
Sends critical Wazuh alerts to OpenCTI for threat intelligence correlation
"""

import json
import sys
import os
import requests
from datetime import datetime
from pycti import OpenCTIApiClient

# Configuration
OPENCTI_URL = os.getenv('OPENCTI_URL', 'http://opencti-platform.security.svc.cluster.local:8080')
OPENCTI_TOKEN = os.getenv('OPENCTI_TOKEN', '').strip()
WAZUH_MANAGER_URL = os.getenv('WAZUH_MANAGER_URL', 'http://wazuh-manager.security.svc.cluster.local:55000')

if not OPENCTI_TOKEN:
    raise RuntimeError('OPENCTI_TOKEN must be injected by the managed secret store')

# Initialize OpenCTI client only after the managed token is present.
opencti_api_client = OpenCTIApiClient(OPENCTI_URL, OPENCTI_TOKEN)

def parse_wazuh_alert(alert_json):
    """Parse Wazuh alert JSON"""
    try:
        alert = json.loads(alert_json)
        return alert
    except json.JSONDecodeError as e:
        print(f"Error parsing alert JSON: {e}", file=sys.stderr)
        return None

def extract_indicators(alert):
    """Extract indicators from Wazuh alert"""
    indicators = []
    
    # Extract IP addresses
    if 'data' in alert and 'srcip' in alert['data']:
        indicators.append({
            'type': 'IPv4-Addr',
            'value': alert['data']['srcip'],
            'description': f"Source IP from Wazuh alert {alert['rule']['id']}"
        })
    
    # Extract user accounts
    if 'data' in alert and 'user' in alert['data']:
        indicators.append({
            'type': 'User-Account',
            'value': alert['data']['user'],
            'description': f"User account from Wazuh alert {alert['rule']['id']}"
        })
    
    # Extract account IDs (custom observable)
    if 'data' in alert and 'account_id' in alert['data']:
        indicators.append({
            'type': 'Text',
            'value': alert['data']['account_id'],
            'description': f"Account ID from Wazuh alert {alert['rule']['id']}"
        })
    
    return indicators

def create_opencti_incident(alert):
    """Create an incident in OpenCTI from Wazuh alert"""
    try:
        # Determine severity
        alert_level = alert['rule']['level']
        if alert_level >= 12:
            severity = 'critical'
        elif alert_level >= 10:
            severity = 'high'
        elif alert_level >= 7:
            severity = 'medium'
        else:
            severity = 'low'
        
        # Create incident
        incident_name = f"Wazuh Alert: {alert['rule']['description']}"
        incident_description = f"""
Wazuh Security Alert

**Rule ID**: {alert['rule']['id']}
**Rule Description**: {alert['rule']['description']}
**Alert Level**: {alert_level}
**Timestamp**: {alert['timestamp']}

**Alert Details**:
{json.dumps(alert.get('data', {}), indent=2)}

**Agent**: {alert.get('agent', {}).get('name', 'Unknown')}
**Manager**: {alert.get('manager', {}).get('name', 'Unknown')}

**MITRE ATT&CK**: {', '.join(alert['rule'].get('mitre', {}).get('id', []))}
**Groups**: {', '.join(alert['rule'].get('groups', []))}
"""
        
        # Create incident in OpenCTI
        incident = opencti_api_client.incident.create(
            name=incident_name,
            description=incident_description,
            severity=severity,
            objective=alert['rule']['description'],
            first_seen=alert['timestamp'],
            last_seen=alert['timestamp']
        )
        
        print(f"Created OpenCTI incident: {incident['id']}", file=sys.stderr)
        return incident
        
    except Exception as e:
        print(f"Error creating OpenCTI incident: {e}", file=sys.stderr)
        return None

def create_opencti_observables(alert, incident_id):
    """Create observables in OpenCTI from alert indicators"""
    try:
        indicators = extract_indicators(alert)
        
        for indicator in indicators:
            # Create observable
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
                description=indicator['description']
            )
            
            print(f"Created observable: {observable['id']}", file=sys.stderr)
        
        return True
        
    except Exception as e:
        print(f"Error creating OpenCTI observables: {e}", file=sys.stderr)
        return False

def create_opencti_indicator(alert, incident_id):
    """Create indicator in OpenCTI from Wazuh alert"""
    try:
        # Extract primary indicator (IP address)
        if 'data' in alert and 'srcip' in alert['data']:
            srcip = alert['data']['srcip']
            
            # Create indicator
            indicator = opencti_api_client.indicator.create(
                name=f"Malicious IP from Wazuh: {srcip}",
                description=f"IP address detected in Wazuh alert {alert['rule']['id']}: {alert['rule']['description']}",
                pattern=f"[ipv4-addr:value = '{srcip}']",
                pattern_type='stix',
                valid_from=alert['timestamp'],
                x_opencti_main_observable_type='IPv4-Addr'
            )
            
            # Link indicator to incident
            opencti_api_client.stix_core_relationship.create(
                fromId=incident_id,
                toId=indicator['id'],
                relationship_type='indicates',
                description=f"Indicator from Wazuh alert {alert['rule']['id']}"
            )
            
            print(f"Created indicator: {indicator['id']}", file=sys.stderr)
            return indicator
        
        return None
        
    except Exception as e:
        print(f"Error creating OpenCTI indicator: {e}", file=sys.stderr)
        return None

def enrich_with_threat_intelligence(alert):
    """Query OpenCTI for existing threat intelligence on indicators"""
    try:
        if 'data' in alert and 'srcip' in alert['data']:
            srcip = alert['data']['srcip']
            
            # Search for existing indicators
            indicators = opencti_api_client.indicator.list(
                filters=[{
                    'key': 'pattern',
                    'values': [srcip]
                }]
            )
            
            if indicators:
                print(f"Found {len(indicators)} existing indicators for {srcip}", file=sys.stderr)
                return indicators
        
        return []
        
    except Exception as e:
        print(f"Error querying threat intelligence: {e}", file=sys.stderr)
        return []

def main():
    """Main function"""
    # Read alert from stdin
    alert_json = sys.stdin.read()
    
    if not alert_json:
        print("No alert data received", file=sys.stderr)
        sys.exit(1)
    
    # Parse alert
    alert = parse_wazuh_alert(alert_json)
    if not alert:
        sys.exit(1)
    
    # Check if this is a critical alert that should trigger OpenCTI integration
    if 'opencti_integration' not in alert['rule'].get('groups', []):
        print(f"Alert {alert['rule']['id']} does not require OpenCTI integration", file=sys.stderr)
        sys.exit(0)
    
    print(f"Processing Wazuh alert {alert['rule']['id']} for OpenCTI integration", file=sys.stderr)
    
    # Enrich with existing threat intelligence
    existing_ti = enrich_with_threat_intelligence(alert)
    if existing_ti:
        print(f"Alert matches existing threat intelligence: {existing_ti}", file=sys.stderr)
    
    # Create incident in OpenCTI
    incident = create_opencti_incident(alert)
    if not incident:
        sys.exit(1)
    
    # Create observables
    create_opencti_observables(alert, incident['id'])
    
    # Create indicator
    create_opencti_indicator(alert, incident['id'])
    
    print(f"Successfully processed alert and created OpenCTI incident {incident['id']}", file=sys.stderr)
    sys.exit(0)

if __name__ == '__main__':
    main()
