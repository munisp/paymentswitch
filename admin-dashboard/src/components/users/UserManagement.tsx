'use client';

import { logger } from "@/lib/logger";
import React, { useState, useEffect, useCallback } from 'react';
import { lakehouseAPI, useLakehouseData } from '@/lib/api';
import {
  Users,
  UserPlus,
  Search,
  Filter,
  MoreVertical,
  Shield,
  Mail,
  Phone,
  Building2,
  Calendar,
  Edit,
  Trash2,
  Key,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  X,
  Save,
  Eye,
  EyeOff,
  RefreshCw,
} from 'lucide-react';

// Types
interface User {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'LOCKED';
  roles: string[];
  permissions: string[];
  organizationId?: string;
  organizationName?: string;
  participantId?: string;
  createdAt: string;
  lastLogin?: string;
  kycStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'APPROVED' | 'REJECTED';
  mfaEnabled: boolean;
}

interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
}

const defaultUsers: User[] = [
  {
    id: 'usr-001',
    username: 'john.adeyemi',
    email: 'j.adeyemi@fnb.ng',
    firstName: 'John',
    lastName: 'Adeyemi',
    phone: '+234 803 123 4567',
    status: 'ACTIVE',
    roles: ['participant_admin', 'kyc_reviewer'],
    permissions: ['view_kyc', 'review_kyc', 'approve_kyc'],
    organizationId: 'org-001',
    organizationName: 'First National Bank',
    participantId: 'fnb',
    createdAt: '2024-01-15T10:30:00Z',
    lastLogin: '2024-12-24T02:15:00Z',
    kycStatus: 'APPROVED',
    mfaEnabled: true,
  },
  {
    id: 'usr-002',
    username: 'amina.okonkwo',
    email: 'a.okonkwo@fnb.ng',
    firstName: 'Amina',
    lastName: 'Okonkwo',
    phone: '+234 805 987 6543',
    status: 'ACTIVE',
    roles: ['settlement_officer'],
    permissions: ['view_settlements', 'approve_settlement'],
    organizationId: 'org-001',
    organizationName: 'First National Bank',
    participantId: 'fnb',
    createdAt: '2024-02-20T14:45:00Z',
    lastLogin: '2024-12-23T18:30:00Z',
    kycStatus: 'APPROVED',
    mfaEnabled: true,
  },
  {
    id: 'usr-003',
    username: 'david.mwangi',
    email: 'd.mwangi@mobilepay.ke',
    firstName: 'David',
    lastName: 'Mwangi',
    phone: '+254 722 123 456',
    status: 'PENDING',
    roles: ['developer'],
    permissions: ['view_system_metrics'],
    organizationId: 'org-002',
    organizationName: 'MobilePay Ltd',
    participantId: 'mobilepay',
    createdAt: '2024-12-20T09:00:00Z',
    kycStatus: 'IN_PROGRESS',
    mfaEnabled: false,
  },
  {
    id: 'usr-004',
    username: 'sarah.mensah',
    email: 's.mensah@paytech.gh',
    firstName: 'Sarah',
    lastName: 'Mensah',
    status: 'INACTIVE',
    roles: ['auditor'],
    permissions: ['view_kyc', 'view_kyb', 'view_settlements'],
    organizationId: 'org-003',
    organizationName: 'PayTech Solutions',
    participantId: 'paytech',
    createdAt: '2024-03-10T11:20:00Z',
    lastLogin: '2024-11-15T09:45:00Z',
    kycStatus: 'APPROVED',
    mfaEnabled: false,
  },
  {
    id: 'usr-005',
    username: 'admin.noc',
    email: 'noc@payment-switch.ng',
    firstName: 'NOC',
    lastName: 'Administrator',
    status: 'ACTIVE',
    roles: ['super_admin', 'noc_operator'],
    permissions: ['*'],
    createdAt: '2024-01-01T00:00:00Z',
    lastLogin: '2024-12-24T03:00:00Z',
    kycStatus: 'APPROVED',
    mfaEnabled: true,
  },
  {
    id: 'usr-006',
    username: 'kwame.asante',
    email: 'k.asante@quickmerchant.za',
    firstName: 'Kwame',
    lastName: 'Asante',
    phone: '+27 82 123 4567',
    status: 'LOCKED',
    roles: ['participant_admin'],
    permissions: ['view_kyc'],
    organizationId: 'org-004',
    organizationName: 'QuickMerchant POS',
    participantId: 'quickmerchant',
    createdAt: '2024-06-15T16:30:00Z',
    lastLogin: '2024-12-10T14:20:00Z',
    kycStatus: 'REJECTED',
    mfaEnabled: false,
  },
];

const availableRoles: Role[] = [
  { id: 'super_admin', name: 'Super Admin', description: 'Full system access', permissions: ['*'] },
  { id: 'noc_operator', name: 'NOC Operator', description: 'Network operations center access', permissions: ['view_system_metrics', 'manage_participants'] },
  { id: 'compliance_officer', name: 'Compliance Officer', description: 'Compliance and regulatory access', permissions: ['view_kyc', 'view_kyb', 'view_settlements'] },
  { id: 'kyc_reviewer', name: 'KYC Reviewer', description: 'Review and approve KYC cases', permissions: ['view_kyc', 'review_kyc', 'approve_kyc', 'reject_kyc'] },
  { id: 'kyb_reviewer', name: 'KYB Reviewer', description: 'Review and approve KYB cases', permissions: ['view_kyb', 'review_kyb', 'approve_kyb', 'reject_kyb'] },
  { id: 'settlement_officer', name: 'Settlement Officer', description: 'Manage settlements', permissions: ['view_settlements', 'approve_settlement'] },
  { id: 'fraud_analyst', name: 'Fraud Analyst', description: 'Fraud detection and analysis', permissions: ['view_fraud_alerts', 'resolve_fraud_alert'] },
  { id: 'developer', name: 'Developer', description: 'API access and development', permissions: ['view_system_metrics'] },
  { id: 'auditor', name: 'Auditor', description: 'Read-only audit access', permissions: ['view_kyc', 'view_kyb', 'view_settlements', 'view_fraud_alerts'] },
  { id: 'participant_admin', name: 'Participant Admin', description: 'Manage participant organization', permissions: ['view_kyc', 'manage_onboarding'] },
];

export function UserManagement() {
  const fetcher = useCallback(() =>
    lakehouseAPI.fetch<{ users: User[] }>('/api/v1/users')
      .then(d => d.users)
      .catch((err: unknown) => { logger.error("API fallback:", err); return []; }), []);
  const { data: apiUsers, loading } = useLakehouseData(fetcher, 30000);
  const [users, setUsers] = useState<User[]>(defaultUsers);
  useEffect(() => { if (apiUsers) setUsers(apiUsers); }, [apiUsers]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Filter users
  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      searchQuery === '' ||
      user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      `${user.firstName} ${user.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.organizationName?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || user.status === statusFilter;
    const matchesRole = roleFilter === 'all' || user.roles.includes(roleFilter);

    return matchesSearch && matchesStatus && matchesRole;
  });

  const getStatusBadge = (status: User['status']) => {
    const styles = {
      ACTIVE: 'bg-green-100 text-green-700',
      INACTIVE: 'bg-gray-100 text-gray-700',
      PENDING: 'bg-yellow-100 text-yellow-700',
      LOCKED: 'bg-red-100 text-red-700',
    };
    const icons = {
      ACTIVE: <CheckCircle className="h-3 w-3" />,
      INACTIVE: <XCircle className="h-3 w-3" />,
      PENDING: <Clock className="h-3 w-3" />,
      LOCKED: <AlertTriangle className="h-3 w-3" />,
    };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
        {icons[status]}
        {status}
      </span>
    );
  };

  const getKycStatusBadge = (status?: User['kycStatus']) => {
    if (!status) return null;
    const styles = {
      NOT_STARTED: 'bg-gray-100 text-gray-600',
      IN_PROGRESS: 'bg-blue-100 text-blue-700',
      APPROVED: 'bg-green-100 text-green-700',
      REJECTED: 'bg-red-100 text-red-700',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
        KYC: {status.replace('_', ' ')}
      </span>
    );
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Stats
  const stats = {
    total: users.length,
    active: users.filter((u) => u.status === 'ACTIVE').length,
    pending: users.filter((u) => u.status === 'PENDING').length,
    locked: users.filter((u) => u.status === 'LOCKED').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-500">Manage platform users, roles, and permissions</p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          Add User
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Total Users</div>
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Active</div>
          <div className="text-2xl font-bold text-green-600">{stats.active}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Pending</div>
          <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Locked</div>
          <div className="text-2xl font-bold text-red-600">{stats.locked}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, email, or organization..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="PENDING">Pending</option>
            <option value="LOCKED">Locked</option>
          </select>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All Roles</option>
            {availableRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Organization</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Roles</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">KYC</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Login</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredUsers.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center">
                      <span className="text-primary-700 font-medium">
                        {user.firstName[0]}
                        {user.lastName[0]}
                      </span>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">
                        {user.firstName} {user.lastName}
                      </div>
                      <div className="text-sm text-gray-500">{user.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {user.organizationName ? (
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-gray-400" />
                      <span className="text-sm text-gray-900">{user.organizationName}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {user.roles.slice(0, 2).map((role) => (
                      <span
                        key={role}
                        className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium"
                      >
                        {role.replace('_', ' ')}
                      </span>
                    ))}
                    {user.roles.length > 2 && (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                        +{user.roles.length - 2}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">{getStatusBadge(user.status)}</td>
                <td className="px-4 py-3">{getKycStatusBadge(user.kycStatus)}</td>
                <td className="px-4 py-3">
                  <span className="text-sm text-gray-500">{formatDate(user.lastLogin)}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedUser(user);
                        setIsEditModalOpen(true);
                      }}
                      className="p-1 text-gray-400 hover:text-gray-600"
                      title="Edit user"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      className="p-1 text-gray-400 hover:text-gray-600"
                      title="Reset password"
                    >
                      <Key className="h-4 w-4" />
                    </button>
                    {user.status === 'LOCKED' ? (
                      <button
                        className="p-1 text-green-500 hover:text-green-600"
                        title="Unlock user"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        className="p-1 text-red-400 hover:text-red-600"
                        title="Delete user"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create User Modal */}
      {isCreateModalOpen && (
        <CreateUserModal
          roles={availableRoles}
          onClose={() => setIsCreateModalOpen(false)}
          onCreate={(newUser) => {
            setUsers([...users, newUser]);
            setIsCreateModalOpen(false);
          }}
        />
      )}

      {/* Edit User Modal */}
      {isEditModalOpen && selectedUser && (
        <EditUserModal
          user={selectedUser}
          roles={availableRoles}
          onClose={() => {
            setIsEditModalOpen(false);
            setSelectedUser(null);
          }}
          onSave={(updatedUser) => {
            setUsers(users.map((u) => (u.id === updatedUser.id ? updatedUser : u)));
            setIsEditModalOpen(false);
            setSelectedUser(null);
          }}
        />
      )}
    </div>
  );
}

// Create User Modal
function CreateUserModal({
  roles,
  onClose,
  onCreate,
}: {
  roles: Role[];
  onClose: () => void;
  onCreate: (user: User) => void;
}) {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    firstName: '',
    lastName: '',
    phone: '',
    password: '',
    confirmPassword: '',
    roles: [] as string[],
    organizationId: '',
    triggerKyc: true,
    sendWelcomeEmail: true,
  });
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newUser: User = {
      id: `usr-${Date.now()}`,
      username: formData.username,
      email: formData.email,
      firstName: formData.firstName,
      lastName: formData.lastName,
      phone: formData.phone || undefined,
      status: formData.triggerKyc ? 'PENDING' : 'ACTIVE',
      roles: formData.roles,
      permissions: [],
      organizationId: formData.organizationId || undefined,
      createdAt: new Date().toISOString(),
      kycStatus: formData.triggerKyc ? 'NOT_STARTED' : undefined,
      mfaEnabled: false,
    };
    onCreate(newUser);
  };

  const toggleRole = (roleId: string) => {
    setFormData((prev) => ({
      ...prev,
      roles: prev.roles.includes(roleId)
        ? prev.roles.filter((r) => r !== roleId)
        : [...prev.roles, roleId],
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Create New User</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Basic Info */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">Basic Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">First Name *</label>
                <input
                  type="text"
                  required
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Last Name *</label>
                <input
                  type="text"
                  required
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Username *</label>
                <input
                  type="text"
                  required
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Phone</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Organization</label>
                <select
                  value={formData.organizationId}
                  onChange={(e) => setFormData({ ...formData, organizationId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">No Organization</option>
                  <option value="org-001">First National Bank</option>
                  <option value="org-002">MobilePay Ltd</option>
                  <option value="org-003">PayTech Solutions</option>
                  <option value="org-004">QuickMerchant POS</option>
                </select>
              </div>
            </div>
          </div>

          {/* Password */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">Password</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Password *</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Confirm Password *</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
          </div>

          {/* Roles */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">Roles</h3>
            <div className="grid grid-cols-2 gap-2">
              {roles.map((role) => (
                <label
                  key={role.id}
                  className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                    formData.roles.includes(role.id)
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={formData.roles.includes(role.id)}
                    onChange={() => toggleRole(role.id)}
                    className="rounded border-gray-300 text-primary-600"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{role.name}</div>
                    <div className="text-xs text-gray-500">{role.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Options */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">Options</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={formData.triggerKyc}
                  onChange={(e) => setFormData({ ...formData, triggerKyc: e.target.checked })}
                  className="rounded border-gray-300 text-primary-600"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">Trigger KYC Verification</div>
                  <div className="text-xs text-gray-500">
                    User will be required to complete KYC before accessing the platform
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={formData.sendWelcomeEmail}
                  onChange={(e) => setFormData({ ...formData, sendWelcomeEmail: e.target.checked })}
                  className="rounded border-gray-300 text-primary-600"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">Send Welcome Email</div>
                  <div className="text-xs text-gray-500">
                    Send login credentials and KYC instructions to the user
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-2"
            >
              <UserPlus className="h-4 w-4" />
              Create User
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Edit User Modal
function EditUserModal({
  user,
  roles,
  onClose,
  onSave,
}: {
  user: User;
  roles: Role[];
  onClose: () => void;
  onSave: (user: User) => void;
}) {
  const [formData, setFormData] = useState({
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone || '',
    status: user.status,
    roles: [...user.roles],
    mfaEnabled: user.mfaEnabled,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...user,
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      phone: formData.phone || undefined,
      status: formData.status,
      roles: formData.roles,
      mfaEnabled: formData.mfaEnabled,
    });
  };

  const toggleRole = (roleId: string) => {
    setFormData((prev) => ({
      ...prev,
      roles: prev.roles.includes(roleId)
        ? prev.roles.filter((r) => r !== roleId)
        : [...prev.roles, roleId],
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Edit User</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* User Info Header */}
          <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
            <div className="h-16 w-16 rounded-full bg-primary-100 flex items-center justify-center">
              <span className="text-primary-700 font-bold text-xl">
                {user.firstName[0]}
                {user.lastName[0]}
              </span>
            </div>
            <div>
              <div className="font-medium text-gray-900">@{user.username}</div>
              <div className="text-sm text-gray-500">Created {new Date(user.createdAt).toLocaleDateString()}</div>
              {user.kycStatus && (
                <div className="mt-1">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      user.kycStatus === 'APPROVED'
                        ? 'bg-green-100 text-green-700'
                        : user.kycStatus === 'REJECTED'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    KYC: {user.kycStatus}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Basic Info */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">Basic Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">First Name *</label>
                <input
                  type="text"
                  required
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Last Name *</label>
                <input
                  type="text"
                  required
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Phone</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as User['status'] })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="PENDING">Pending</option>
                  <option value="LOCKED">Locked</option>
                </select>
              </div>
              <div className="flex items-center">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.mfaEnabled}
                    onChange={(e) => setFormData({ ...formData, mfaEnabled: e.target.checked })}
                    className="rounded border-gray-300 text-primary-600"
                  />
                  <span className="text-sm text-gray-700">MFA Enabled</span>
                </label>
              </div>
            </div>
          </div>

          {/* Roles */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">Roles</h3>
            <div className="grid grid-cols-2 gap-2">
              {roles.map((role) => (
                <label
                  key={role.id}
                  className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                    formData.roles.includes(role.id)
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={formData.roles.includes(role.id)}
                    onChange={() => toggleRole(role.id)}
                    className="rounded border-gray-300 text-primary-600"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{role.name}</div>
                    <div className="text-xs text-gray-500">{role.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default UserManagement;
