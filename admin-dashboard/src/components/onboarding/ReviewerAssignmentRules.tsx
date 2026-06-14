'use client';

import { logger } from "@/lib/logger";
import { toast } from '@/lib/toast';
import React, { useState, useEffect, useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle,
  Globe,
  Building2,
  Shield,
  Clock,
  User,
  Settings,
} from 'lucide-react';

interface AssignmentRule {
  id: string;
  name: string;
  description: string;
  priority: number;
  isActive: boolean;
  conditions: RuleCondition[];
  assignees: Assignee[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

interface RuleCondition {
  field: 'STAKEHOLDER_TYPE' | 'COUNTRY' | 'RISK_SCORE' | 'DOCUMENT_TYPE' | 'APPLICATION_TYPE';
  operator: 'EQUALS' | 'NOT_EQUALS' | 'IN' | 'NOT_IN' | 'GREATER_THAN' | 'LESS_THAN';
  value: string | string[] | number;
}

interface Assignee {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  isBackup: boolean;
  maxCaseload: number;
  currentCaseload: number;
}

const API_BASE = process.env.NEXT_PUBLIC_ONBOARDING_API || 'http://localhost:8082';

const defaultReviewers: Assignee[] = [
  { id: 'rev-001', name: 'John Reviewer', email: 'john@example.com', role: 'Senior Analyst', department: 'Compliance', isBackup: false, maxCaseload: 20, currentCaseload: 12 },
  { id: 'rev-002', name: 'Jane Analyst', email: 'jane@example.com', role: 'Analyst', department: 'Compliance', isBackup: false, maxCaseload: 15, currentCaseload: 8 },
  { id: 'rev-003', name: 'Mike Compliance', email: 'mike@example.com', role: 'Compliance Officer', department: 'Compliance', isBackup: false, maxCaseload: 10, currentCaseload: 7 },
  { id: 'rev-004', name: 'Sarah Manager', email: 'sarah@example.com', role: 'Manager', department: 'Operations', isBackup: true, maxCaseload: 5, currentCaseload: 2 },
  { id: 'rev-005', name: 'Peter Admin', email: 'peter@example.com', role: 'Admin', department: 'Operations', isBackup: true, maxCaseload: 10, currentCaseload: 4 },
];

const defaultRules: AssignmentRule[] = [
  {
    id: 'rule-001',
    name: 'Nigerian Banks Assignment',
    description: 'Assign Nigerian bank applications to senior compliance team',
    priority: 1,
    isActive: true,
    conditions: [
      { field: 'STAKEHOLDER_TYPE', operator: 'EQUALS', value: 'BANK' },
      { field: 'COUNTRY', operator: 'EQUALS', value: 'Nigeria' },
    ],
    assignees: [defaultReviewers[0], defaultReviewers[2]],
    createdAt: '2024-10-01T10:00:00Z',
    updatedAt: '2024-11-15T14:00:00Z',
    createdBy: 'Admin User',
  },
  {
    id: 'rule-002',
    name: 'High Risk Applications',
    description: 'Route high-risk applications to compliance officers',
    priority: 2,
    isActive: true,
    conditions: [
      { field: 'RISK_SCORE', operator: 'GREATER_THAN', value: 70 },
    ],
    assignees: [defaultReviewers[2], defaultReviewers[3]],
    createdAt: '2024-09-15T09:00:00Z',
    updatedAt: '2024-10-20T11:00:00Z',
    createdBy: 'Admin User',
  },
  {
    id: 'rule-003',
    name: 'FinTech Applications',
    description: 'Assign FinTech applications to specialized team',
    priority: 3,
    isActive: true,
    conditions: [
      { field: 'STAKEHOLDER_TYPE', operator: 'IN', value: ['FINTECH', 'PAYMENT_SERVICE_PROVIDER'] },
    ],
    assignees: [defaultReviewers[1], defaultReviewers[4]],
    createdAt: '2024-08-20T08:00:00Z',
    updatedAt: '2024-09-10T16:00:00Z',
    createdBy: 'Admin User',
  },
  {
    id: 'rule-004',
    name: 'East Africa Region',
    description: 'Route East African applications to regional team',
    priority: 4,
    isActive: false,
    conditions: [
      { field: 'COUNTRY', operator: 'IN', value: ['Kenya', 'Tanzania', 'Uganda', 'Rwanda'] },
    ],
    assignees: [defaultReviewers[1]],
    createdAt: '2024-07-10T12:00:00Z',
    updatedAt: '2024-08-05T10:00:00Z',
    createdBy: 'Admin User',
  },
];

export function ReviewerAssignmentRules() {
  const fetcher = useCallback(() =>
    lakehouseAPI.fetch<{ rules: AssignmentRule[]; reviewers: Assignee[] }>('/api/v1/onboarding/assignment-rules')
      .then(d => ({ rules: d.rules, reviewers: d.reviewers }))
      .catch((err: unknown) => { logger.error("API fallback:", err); return { rules: defaultRules, reviewers: defaultReviewers }; }), []);
  const { data: apiData } = useLakehouseData(fetcher, 30000);
  const [rules, setRules] = useState<AssignmentRule[]>(defaultRules);
  const [reviewers] = useState<Assignee[]>(defaultReviewers);
  useEffect(() => { if (apiData) { setRules(apiData.rules); } }, [apiData]);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRule, setEditingRule] = useState<AssignmentRule | null>(null);
  const [newRule, setNewRule] = useState<Partial<AssignmentRule>>({
    name: '',
    description: '',
    priority: rules.length + 1,
    isActive: true,
    conditions: [],
    assignees: [],
  });

  const stakeholderTypes = [
    'BANK',
    'MOBILE_MONEY_OPERATOR',
    'FINTECH',
    'MICROFINANCE_INSTITUTION',
    'PAYMENT_SERVICE_PROVIDER',
    'INSURANCE_COMPANY',
    'PENSION_FUND',
  ];

  const countries = [
    'Nigeria',
    'Kenya',
    'Ghana',
    'South Africa',
    'Tanzania',
    'Uganda',
    'Rwanda',
    'Ethiopia',
    'Egypt',
    'Morocco',
  ];

  const conditionFields = [
    { value: 'STAKEHOLDER_TYPE', label: 'Stakeholder Type' },
    { value: 'COUNTRY', label: 'Country' },
    { value: 'RISK_SCORE', label: 'Risk Score' },
    { value: 'DOCUMENT_TYPE', label: 'Document Type' },
    { value: 'APPLICATION_TYPE', label: 'Application Type' },
  ];

  const operators = [
    { value: 'EQUALS', label: 'Equals' },
    { value: 'NOT_EQUALS', label: 'Not Equals' },
    { value: 'IN', label: 'In List' },
    { value: 'NOT_IN', label: 'Not In List' },
    { value: 'GREATER_THAN', label: 'Greater Than' },
    { value: 'LESS_THAN', label: 'Less Than' },
  ];

  const toggleRule = (ruleId: string) => {
    setExpandedRule(expandedRule === ruleId ? null : ruleId);
  };

  const toggleRuleActive = (ruleId: string) => {
    setRules(rules.map(rule => 
      rule.id === ruleId ? { ...rule, isActive: !rule.isActive } : rule
    ));
  };

  const deleteRule = (ruleId: string) => {
    if (confirm('Are you sure you want to delete this rule?')) {
      setRules(rules.filter(rule => rule.id !== ruleId));
    }
  };

  const moveRulePriority = (ruleId: string, direction: 'up' | 'down') => {
    const ruleIndex = rules.findIndex(r => r.id === ruleId);
    if (ruleIndex === -1) return;
    
    const newIndex = direction === 'up' ? ruleIndex - 1 : ruleIndex + 1;
    if (newIndex < 0 || newIndex >= rules.length) return;
    
    const newRules = [...rules];
    const temp = newRules[ruleIndex].priority;
    newRules[ruleIndex].priority = newRules[newIndex].priority;
    newRules[newIndex].priority = temp;
    
    [newRules[ruleIndex], newRules[newIndex]] = [newRules[newIndex], newRules[ruleIndex]];
    setRules(newRules);
  };

  const addCondition = () => {
    setNewRule({
      ...newRule,
      conditions: [
        ...(newRule.conditions || []),
        { field: 'STAKEHOLDER_TYPE', operator: 'EQUALS', value: '' },
      ],
    });
  };

  const removeCondition = (index: number) => {
    setNewRule({
      ...newRule,
      conditions: newRule.conditions?.filter((_, i) => i !== index),
    });
  };

  const updateCondition = (index: number, field: keyof RuleCondition, value: unknown) => {
    const conditions = [...(newRule.conditions || [])];
    conditions[index] = { ...conditions[index], [field]: value };
    setNewRule({ ...newRule, conditions });
  };

  const toggleAssignee = (assignee: Assignee) => {
    const currentAssignees = newRule.assignees || [];
    const exists = currentAssignees.find(a => a.id === assignee.id);
    
    if (exists) {
      setNewRule({
        ...newRule,
        assignees: currentAssignees.filter(a => a.id !== assignee.id),
      });
    } else {
      setNewRule({
        ...newRule,
        assignees: [...currentAssignees, assignee],
      });
    }
  };

  const saveRule = () => {
    if (!newRule.name || !newRule.conditions?.length || !newRule.assignees?.length) {
      toast.warning('Please fill in all required fields');
      return;
    }

    const rule: AssignmentRule = {
      id: editingRule?.id || `rule-${Date.now()}`,
      name: newRule.name!,
      description: newRule.description || '',
      priority: newRule.priority || rules.length + 1,
      isActive: newRule.isActive ?? true,
      conditions: newRule.conditions!,
      assignees: newRule.assignees!,
      createdAt: editingRule?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: editingRule?.createdBy || 'Current User',
    };

    if (editingRule) {
      setRules(rules.map(r => r.id === editingRule.id ? rule : r));
    } else {
      setRules([...rules, rule]);
    }

    setShowCreateModal(false);
    setEditingRule(null);
    setNewRule({
      name: '',
      description: '',
      priority: rules.length + 1,
      isActive: true,
      conditions: [],
      assignees: [],
    });
  };

  const editRule = (rule: AssignmentRule) => {
    setEditingRule(rule);
    setNewRule({
      name: rule.name,
      description: rule.description,
      priority: rule.priority,
      isActive: rule.isActive,
      conditions: [...rule.conditions],
      assignees: [...rule.assignees],
    });
    setShowCreateModal(true);
  };

  const getConditionDisplay = (condition: RuleCondition) => {
    const fieldLabel = conditionFields.find(f => f.value === condition.field)?.label || condition.field;
    const operatorLabel = operators.find(o => o.value === condition.operator)?.label || condition.operator;
    const valueDisplay = Array.isArray(condition.value) ? condition.value.join(', ') : condition.value;
    return `${fieldLabel} ${operatorLabel} ${valueDisplay}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Reviewer Assignment Rules</h2>
          <p className="text-sm text-gray-500 mt-1">
            Configure automatic reviewer assignment based on application criteria
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          Create Rule
        </button>
      </div>

      {/* Rules List */}
      <div className="space-y-4">
        {rules.sort((a, b) => a.priority - b.priority).map((rule, index) => (
          <div
            key={rule.id}
            className={`bg-white border rounded-lg ${rule.isActive ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}
          >
            <div
              className="flex items-center justify-between p-4 cursor-pointer"
              onClick={() => toggleRule(rule.id)}
            >
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); moveRulePriority(rule.id, 'up'); }}
                    disabled={index === 0}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <span className="text-sm font-medium text-gray-500">#{rule.priority}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveRulePriority(rule.id, 'down'); }}
                    disabled={index === rules.length - 1}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{rule.name}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      rule.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">{rule.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-600">{rule.assignees.length} assignees</span>
                </div>
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-600">{rule.conditions.length} conditions</span>
                </div>
                {expandedRule === rule.id ? (
                  <ChevronUp className="h-5 w-5 text-gray-400" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-gray-400" />
                )}
              </div>
            </div>

            {expandedRule === rule.id && (
              <div className="border-t border-gray-200 p-4 space-y-4">
                {/* Conditions */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Conditions</h4>
                  <div className="space-y-2">
                    {rule.conditions.map((condition, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded">
                          {getConditionDisplay(condition)}
                        </span>
                        {idx < rule.conditions.length - 1 && (
                          <span className="text-gray-400">AND</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Assignees */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Assigned Reviewers</h4>
                  <div className="flex flex-wrap gap-2">
                    {rule.assignees.map((assignee) => (
                      <div
                        key={assignee.id}
                        className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg"
                      >
                        <User className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{assignee.name}</p>
                          <p className="text-xs text-gray-500">
                            {assignee.role} • {assignee.currentCaseload}/{assignee.maxCaseload} cases
                          </p>
                        </div>
                        {assignee.isBackup && (
                          <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">
                            Backup
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Meta Info */}
                <div className="flex items-center gap-6 text-sm text-gray-500 pt-2 border-t border-gray-100">
                  <span>Created by {rule.createdBy}</span>
                  <span>Created: {new Date(rule.createdAt).toLocaleDateString()}</span>
                  <span>Updated: {new Date(rule.updatedAt).toLocaleDateString()}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => toggleRuleActive(rule.id)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
                      rule.isActive
                        ? 'text-yellow-700 bg-yellow-50 hover:bg-yellow-100'
                        : 'text-green-700 bg-green-50 hover:bg-green-100'
                    }`}
                  >
                    {rule.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => editRule(rule)}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100"
                  >
                    <Edit2 className="h-4 w-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {rules.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500">No assignment rules configured</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-4 text-primary-600 hover:text-primary-700 font-medium"
          >
            Create your first rule
          </button>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingRule ? 'Edit Assignment Rule' : 'Create Assignment Rule'}
              </h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingRule(null);
                  setNewRule({
                    name: '',
                    description: '',
                    priority: rules.length + 1,
                    isActive: true,
                    conditions: [],
                    assignees: [],
                  });
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Rule Name *
                  </label>
                  <input
                    type="text"
                    value={newRule.name || ''}
                    onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                    placeholder="e.g., Nigerian Banks Assignment"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={newRule.description || ''}
                    onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                    placeholder="Describe when this rule should apply..."
                    rows={2}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={newRule.isActive ?? true}
                    onChange={(e) => setNewRule({ ...newRule, isActive: e.target.checked })}
                    className="h-4 w-4 text-primary-600 rounded focus:ring-primary-500"
                  />
                  <label htmlFor="isActive" className="text-sm text-gray-700">
                    Rule is active
                  </label>
                </div>
              </div>

              {/* Conditions */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-gray-700">
                    Conditions *
                  </label>
                  <button
                    onClick={addCondition}
                    className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                  >
                    + Add Condition
                  </button>
                </div>

                {(newRule.conditions || []).length === 0 ? (
                  <div className="text-center py-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500">No conditions added yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(newRule.conditions || []).map((condition, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <select
                          value={condition.field}
                          onChange={(e) => updateCondition(index, 'field', e.target.value)}
                          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          {conditionFields.map(field => (
                            <option key={field.value} value={field.value}>{field.label}</option>
                          ))}
                        </select>

                        <select
                          value={condition.operator}
                          onChange={(e) => updateCondition(index, 'operator', e.target.value)}
                          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          {operators.map(op => (
                            <option key={op.value} value={op.value}>{op.label}</option>
                          ))}
                        </select>

                        {condition.field === 'STAKEHOLDER_TYPE' ? (
                          <select
                            value={Array.isArray(condition.value) ? condition.value[0] : condition.value as string}
                            onChange={(e) => updateCondition(index, 'value', e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                          >
                            <option value="">Select type...</option>
                            {stakeholderTypes.map(type => (
                              <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                            ))}
                          </select>
                        ) : condition.field === 'COUNTRY' ? (
                          <select
                            value={Array.isArray(condition.value) ? condition.value[0] : condition.value as string}
                            onChange={(e) => updateCondition(index, 'value', e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                          >
                            <option value="">Select country...</option>
                            {countries.map(country => (
                              <option key={country} value={country}>{country}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={condition.field === 'RISK_SCORE' ? 'number' : 'text'}
                            value={condition.value as string}
                            onChange={(e) => updateCondition(index, 'value', condition.field === 'RISK_SCORE' ? parseInt(e.target.value) : e.target.value)}
                            placeholder="Enter value..."
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                        )}

                        <button
                          onClick={() => removeCondition(index)}
                          className="p-2 text-red-500 hover:text-red-700"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Assignees */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Assign To *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {reviewers.map((reviewer) => {
                    const isSelected = (newRule.assignees || []).some(a => a.id === reviewer.id);
                    return (
                      <div
                        key={reviewer.id}
                        onClick={() => toggleAssignee(reviewer)}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center ${
                          isSelected ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {isSelected ? (
                            <CheckCircle className="h-5 w-5" />
                          ) : (
                            <User className="h-5 w-5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{reviewer.name}</p>
                          <p className="text-xs text-gray-500">
                            {reviewer.role} • {reviewer.currentCaseload}/{reviewer.maxCaseload} cases
                          </p>
                        </div>
                        {reviewer.isBackup && (
                          <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">
                            Backup
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Info Box */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-blue-700">
                  Rules are evaluated in priority order. The first matching rule will be used to assign reviewers.
                  If no rules match, applications will be assigned to the default reviewer pool.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingRule(null);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveRule}
                disabled={!newRule.name || !(newRule.conditions?.length) || !(newRule.assignees?.length)}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
                {editingRule ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReviewerAssignmentRules;
